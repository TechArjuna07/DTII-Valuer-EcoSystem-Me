import { prisma } from '../../database/prisma.js';
import { ROLES } from '../../config/rbac.js';
import { BadRequest, Conflict, Forbidden, NotFound } from '../../utils/errors.js';
import { hasPermission } from '../../middleware/authorize.js';
import { byAction, STAGE_ROLE, STATUS, TERMINAL, TRANSITIONS } from './workflow.definition.js';

/**
 * Workflow engine. Every status change goes through transition():
 *   1. the case row is locked (SELECT … FOR UPDATE) inside the caller's transaction;
 *   2. the transition must exist for the current status;
 *   3. permission, stage assignee / client ownership and maker-checker rules are enforced;
 *   4. the row is updated with an optimistic version check;
 *   5. status history + activity rows are appended (append-only tables).
 * Events are returned to the caller, which emits them after commit.
 */

const isAdmin = (p) => p.roles?.includes(ROLES.FIRM_ADMIN);

/** Locks and loads a case of the principal's firm (404 if it belongs to another firm). */
async function lockCase(tx, firmId, caseId) {
  const rows = await tx.$queryRaw`SELECT id FROM valuation_cases WHERE id = ${caseId}::uuid AND firm_id = ${firmId}::uuid FOR UPDATE`;
  if (!rows.length) throw NotFound('Case not found');
  return tx.valuationCase.findUnique({ where: { id: caseId }, include: { bank: true } });
}

const activeAssignments = (db, caseId) => db.caseAssignment.findMany({ where: { caseId, endedAt: null }, include: { employee: { include: { user: { select: { id: true, fullName: true, email: true } } } } } });

/** Primary role recorded on activity rows for an action. */
function actorRoleFor(principal, def) {
  if (def?.client) return ROLES.CLIENT;
  if (def?.stage && principal.roles.includes(STAGE_ROLE[def.stage])) return STAGE_ROLE[def.stage];
  return principal.roles?.[0] ?? null;
}

/**
 * Whether a principal may perform a transition on a case right now (ignores remarks / module guards).
 * @returns {{ ok: boolean, reason?: string }}
 */
function evaluate(principal, c, def, assignments) {
  if (!def) return { ok: false, reason: 'Unknown action' };
  if (!def.from.includes(c.status)) return { ok: false, reason: `Not allowed while the case is ${c.status}` };
  if (def.system) return { ok: false, reason: 'Performed automatically' };
  if (def.permission && !hasPermission(principal, def.permission)) return { ok: false, reason: 'Missing permission' };
  if (def.client) return principal.clientId && principal.clientId === c.clientId ? { ok: true } : { ok: false, reason: 'Only the client can do this' };
  if (def.stage) {
    const a = assignments.find((x) => x.stage === def.stage);
    const isAssignee = a && a.employeeId === principal.employeeId;
    if (!isAssignee && !(def.adminOverride && isAdmin(principal))) return { ok: false, reason: `Only the assigned ${def.stage.toLowerCase()} employee can do this` };
    // Maker-checker: the junior who prepared the valuation can never perform senior actions on it.
    if (def.stage === 'SENIOR' && assignments.some((x) => x.stage === 'JUNIOR' && x.employeeId === principal.employeeId)) {
      return { ok: false, reason: 'The preparer of a valuation cannot review it' };
    }
  }
  return { ok: true };
}

/** Actions the principal can perform now (drives the UI buttons; the API re-checks on execution). */
function allowedActions(principal, c, assignments) {
  return TRANSITIONS.filter((d) => evaluate(principal, c, d, assignments).ok).map((d) => ({ action: d.action, to: d.to, generic: !!d.generic, remarksRequired: !!d.remarks }));
}

async function recordActivity(tx, { c, principal, action, prevStatus = null, newStatus = null, remarks = null, meta = {}, documentVersionId = null, req, clientVisible = false, actorRole }) {
  return tx.caseActivity.create({
    data: {
      firmId: c.firmId,
      caseId: c.id,
      action,
      actorId: principal?.userId ?? null,
      actorRole: actorRole ?? principal?.roles?.[0] ?? (principal ? null : 'SYSTEM'),
      prevStatus,
      newStatus,
      documentVersionId,
      ip: req?.ip ? String(req.ip).slice(0, 64) : null,
      remarks,
      meta,
      clientVisible,
    },
  });
}

/** Least-loaded active employee holding `roleCode` (fewest open assignments), excluding some employees. */
async function leastLoaded(tx, firmId, roleCode, excludeIds = []) {
  const candidates = await tx.employeeProfile.findMany({
    where: {
      firmId,
      status: 'ACTIVE',
      deletedAt: null,
      id: { notIn: excludeIds },
      user: { status: 'ACTIVE', roles: { some: { firmId, status: 'ACTIVE', role: { code: roleCode } } } },
    },
    select: { id: true, _count: { select: { assignments: { where: { endedAt: null } } } } },
  });
  candidates.sort((a, b) => a._count.assignments - b._count.assignments);
  return candidates[0]?.id ?? null;
}

/** Firm option autoAssign = 'LEAST_LOADED' assigns reviewers automatically when a case reaches their stage. */
async function autoAssign(tx, c, stage, events) {
  const settings = await tx.organizationSettings.findUnique({ where: { firmId: c.firmId } });
  if (settings?.workflowOptions?.autoAssign !== 'LEAST_LOADED') return;
  const current = await activeAssignments(tx, c.id);
  if (current.some((a) => a.stage === stage)) return;
  // Maker-checker: the junior is never auto-picked as senior.
  const exclude = stage === 'SENIOR' ? current.filter((a) => a.stage === 'JUNIOR').map((a) => a.employeeId) : [];
  const employeeId = await leastLoaded(tx, c.firmId, STAGE_ROLE[stage], exclude);
  if (!employeeId) return;
  await tx.caseAssignment.create({ data: { firmId: c.firmId, caseId: c.id, employeeId, stage, assignedById: c.createdById } });
  await recordActivity(tx, { c, principal: null, action: 'EMPLOYEE_AUTO_ASSIGNED', meta: { stage, employeeId }, actorRole: 'SYSTEM' });
  events.push(['case.assigned', { firmId: c.firmId, caseId: c.id, stage, employeeId, actorId: null }]);
}

/**
 * Executes a transition on a LOCKED case (call lockCase first in the same transaction).
 * @param {object} principal  null + options.system=true for platform-initiated transitions
 * @returns {Promise<{ case: object, events: Array<[string, object]> }>}
 */
async function transition(tx, principal, c, action, { remarks, meta = {}, documentVersionId = null, req, system = false } = {}) {
  const def = byAction.get(action);
  if (!def) throw BadRequest('Unknown workflow action');
  if (!def.from.includes(c.status)) throw Conflict(`This action is not allowed while the case is ${c.status.replaceAll('_', ' ').toLowerCase()}`);
  if (def.system && !system) throw Forbidden('This step is performed automatically');
  if (!system) {
    const assignments = await activeAssignments(tx, c.id);
    const verdict = evaluate(principal, c, def, assignments);
    if (!verdict.ok) throw Forbidden(verdict.reason);
  }
  if (def.remarks && !(remarks && remarks.trim().length >= 3)) throw BadRequest('Remarks are required for this action');

  const to = def.to === 'HOLD_ORIGIN' ? c.holdFromStatus : def.to;
  if (!to) throw Conflict('The status before the hold is unknown');
  const now = new Date();
  const updated = await tx.valuationCase.updateMany({
    where: { id: c.id, status: c.status, rowVersion: c.rowVersion },
    data: {
      status: to,
      statusChangedAt: now,
      rowVersion: { increment: 1 },
      isOverdue: false,
      holdFromStatus: to === STATUS.CASE_ON_HOLD ? c.status : null,
      ...(TERMINAL.includes(to) ? { closedAt: now, closureReason: remarks ?? null } : {}),
    },
  });
  if (updated.count !== 1) throw Conflict('The case was changed by someone else. Reload and try again.');

  const actorRole = system ? 'SYSTEM' : actorRoleFor(principal, def);
  await tx.caseStatusHistory.create({ data: { firmId: c.firmId, caseId: c.id, fromStatus: c.status, toStatus: to, actorId: principal?.userId ?? null, actorRole, remarks: remarks ?? null } });
  await recordActivity(tx, { c, principal, action, prevStatus: c.status, newStatus: to, remarks, meta, documentVersionId, req, clientVisible: !!def.clientVisible, actorRole });

  const events = [['case.transitioned', { firmId: c.firmId, caseId: c.id, action, from: c.status, to, actorId: principal?.userId ?? null, remarks: remarks ?? null }]];
  const fresh = await tx.valuationCase.findUnique({ where: { id: c.id }, include: { bank: true } });
  if (to === STATUS.INSPECTION_COMPLETED) await autoAssign(tx, fresh, 'JUNIOR', events);
  if (to === STATUS.PRELIMINARY_SUBMITTED) await autoAssign(tx, fresh, 'SENIOR', events);
  return { case: fresh, events };
}

/** Convenience: lock + transition in a new transaction. */
async function runTransition(principal, firmId, caseId, action, opts = {}) {
  return prisma.$transaction(async (tx) => {
    const c = await lockCase(tx, firmId, caseId);
    return transition(tx, principal, c, action, opts);
  });
}

export { lockCase, transition, runTransition, allowedActions, evaluate, recordActivity, activeAssignments, leastLoaded, actorRoleFor };
