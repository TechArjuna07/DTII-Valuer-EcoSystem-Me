import { prisma } from '../../database/prisma.js';
import { ROLES } from '../../config/rbac.js';
import { BadRequest, Conflict, Forbidden } from '../../utils/errors.js';
import { hasPermission } from '../../middleware/authorize.js';
import { emit } from '../../services/events.js';
import { recordAudit } from '../../services/audit.service.js';
import { currentFinancialYear } from '../../utils/financial-year.js';
import { paginate, skipTake } from '../../utils/pagination.js';
import { caseScope, findVisibleCase } from './case-access.js';
import { byAction, PIPELINE, STAGE_ROLE, STATUS, STATUS_GROUPS, TERMINAL } from '../workflow/workflow.definition.js';
import { activeAssignments, allowedActions, lockCase, recordActivity, transition } from '../workflow/workflow.service.js';

const hasFieldAssignment = (current) => current.some((a) => a.stage === 'FIELD');
const emitAll = (events) => events.forEach(([name, payload]) => emit(name, payload));

/**
 * Next Case ID for a firm and financial year: VAL-FIRM001-FY2627-000001.
 * The counter row is upserted with a row lock INSIDE the case-creation transaction, so concurrent creators
 * queue, numbers are unique and gap-free, and a rolled-back case never consumes a number.
 */
async function nextCaseNumber(tx, firm, fy) {
  const rows = await tx.$queryRaw`
    INSERT INTO case_counters (firm_id, financial_year_id, last_value, updated_at)
    VALUES (${firm.id}::uuid, ${fy.id}::uuid, 1, now())
    ON CONFLICT (firm_id, financial_year_id)
    DO UPDATE SET last_value = case_counters.last_value + 1, updated_at = now()
    RETURNING last_value`;
  const seq = Number(rows[0].last_value);
  return { seq, caseNumber: `VAL-${firm.firmCode}-FY${fy.shortCode}-${String(seq).padStart(6, '0')}` };
}

const listInclude = {
  client: { select: { id: true, clientCode: true, name: true } },
  bank: { select: { id: true, name: true, shortCode: true, branch: true, institutionType: true } },
  financialYear: { select: { id: true, code: true, label: true } },
  category: { select: { id: true, code: true, name: true, engine: true } },
  assignments: { where: { endedAt: null }, select: { stage: true, employee: { select: { id: true, employeeCode: true, user: { select: { fullName: true } } } } } },
};

const today = () => new Date(new Date().toISOString().slice(0, 10));

function isOverdueNow(c, sla = {}) {
  if (TERMINAL.includes(c.status) || c.status === STATUS.CASE_ON_HOLD) return false;
  if (c.isOverdue) return true;
  if (c.dueDate && c.dueDate < today()) return true;
  const hours = Number(sla[c.status]);
  return hours > 0 && Date.now() - new Date(c.statusChangedAt).getTime() > hours * 3_600_000;
}

function toListItem(c, sla) {
  return {
    id: c.id,
    caseNumber: c.caseNumber,
    status: c.status,
    priority: c.priority,
    client: c.client,
    bank: c.bank,
    financialYear: c.financialYear,
    category: c.category,
    loanReference: c.loanReference,
    loanAmount: c.loanAmount,
    propertyCity: c.propertyCity,
    receivedOn: c.receivedOn,
    dueDate: c.dueDate,
    statusChangedAt: c.statusChangedAt,
    awaitingDocuments: c.awaitingDocuments,
    overdue: isOverdueNow(c, sla),
    assignees: Object.fromEntries((c.assignments || []).map((a) => [a.stage, { id: a.employee.id, name: a.employee.user.fullName, employeeCode: a.employee.employeeCode }])),
    createdAt: c.createdAt,
  };
}

const firmSla = async (firmId) => (await prisma.organizationSettings.findUnique({ where: { firmId }, select: { slaConfig: true } }))?.slaConfig ?? {};

async function list(principal, q) {
  const yes = (v) => v === 'true';
  const and = [caseScope(principal)];
  if (q.status) and.push({ status: q.status });
  if (q.statusGroup) and.push({ status: { in: STATUS_GROUPS[q.statusGroup] } });
  for (const k of ['clientId', 'bankId', 'categoryId', 'financialYearId']) if (q[k]) and.push({ [k]: q[k] });
  if (yes(q.assignedToMe)) and.push({ assignments: { some: { employeeId: principal.employeeId ?? '00000000-0000-0000-0000-000000000000', endedAt: null } } });
  if (yes(q.awaitingDocuments)) and.push({ awaitingDocuments: true });
  if (yes(q.overdue)) and.push({ status: { notIn: [...TERMINAL, STATUS.CASE_ON_HOLD] }, OR: [{ isOverdue: true }, { dueDate: { lt: today() } }] });
  if (q.search) {
    and.push({
      OR: [
        { caseNumber: { contains: q.search, mode: 'insensitive' } },
        { loanReference: { contains: q.search, mode: 'insensitive' } },
        { client: { name: { contains: q.search, mode: 'insensitive' } } },
        { client: { clientCode: { contains: q.search, mode: 'insensitive' } } },
        { propertyCity: { contains: q.search, mode: 'insensitive' } },
      ],
    });
  }
  const orderBy = q.sort === 'oldest' ? { createdAt: 'asc' } : q.sort === 'due' ? [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }] : { createdAt: 'desc' };
  const where = { AND: and };
  const [rows, total, sla] = await Promise.all([
    prisma.valuationCase.findMany({ where, include: listInclude, orderBy, ...skipTake(q) }),
    prisma.valuationCase.count({ where }),
    firmSla(principal.firmId),
  ]);
  return paginate(rows.map((r) => toListItem(r, sla)), total, q);
}

async function get(principal, id) {
  const c = await findVisibleCase(principal, id, prisma, { ...listInclude, client: true, bank: true, organization: { select: { firmCode: true, name: true } } });
  const [assignments, sla] = await Promise.all([activeAssignments(prisma, id), firmSla(principal.firmId)]);
  const isClient = principal.clientId && !principal.employeeId;
  return {
    ...toListItem(c, sla),
    loanType: c.loanType,
    propertyAddress: c.propertyAddress,
    description: c.description,
    holdFromStatus: c.holdFromStatus,
    closureReason: c.closureReason,
    closedAt: c.closedAt,
    rowVersion: c.rowVersion,
    client: isClient
      ? { id: c.client.id, clientCode: c.client.clientCode, name: c.client.name }
      : {
          id: c.client.id,
          clientCode: c.client.clientCode,
          name: c.client.name,
          clientType: c.client.clientType,
          contactPerson: c.client.contactPerson,
          email: c.client.email,
          phone: c.client.phone,
          city: c.client.city,
          panMasked: c.client.panLast4 ? `XXXXXX${c.client.panLast4}` : null,
        },
    bank: { id: c.bank.id, name: c.bank.name, shortCode: c.bank.shortCode, branch: c.bank.branch, institutionType: c.bank.institutionType, requiresClientApproval: c.bank.requiresClientApproval },
    assignments: isClient
      ? []
      : assignments.map((a) => ({ id: a.id, stage: a.stage, assignedAt: a.assignedAt, employee: { id: a.employee.id, employeeCode: a.employee.employeeCode, name: a.employee.user.fullName, email: a.employee.user.email } })),
    repositoryLabel: `${c.caseNumber}_${c.bank.shortCode}`,
    pipeline: PIPELINE,
    allowedActions: allowedActions(principal, { ...c, bank: c.bank }, assignments),
  };
}

/** Validates master references belong to the firm (or the platform, for categories) and are active. */
async function resolveRefs(tx, firmId, { clientId, bankId, categoryId, financialYearId }) {
  const [client, bank, category] = await Promise.all([
    tx.client.findFirst({ where: { id: clientId, firmId, deletedAt: null } }),
    tx.bank.findFirst({ where: { id: bankId, firmId, deletedAt: null } }),
    tx.valuationCategory.findFirst({ where: { id: categoryId, active: true, OR: [{ firmId: null }, { firmId }] } }),
  ]);
  if (!client) throw BadRequest('Select a valid client');
  if (client.status !== 'ACTIVE') throw BadRequest('The selected client is inactive');
  if (!bank || bank.status !== 'ACTIVE') throw BadRequest('Select an active bank / NBFC');
  if (!category) throw BadRequest('Select a valid valuation category');
  const fy = financialYearId
    ? await tx.financialYear.findUnique({ where: { id: financialYearId } })
    : await tx.financialYear.findUnique({ where: { code: currentFinancialYear().code } });
  if (!fy) throw BadRequest('Select a valid financial year');
  if (fy.status !== 'OPEN') throw BadRequest('That financial year is closed');
  return { client, bank, category, fy };
}

/** Active employee of the firm holding the role required for a stage. */
async function assertEmployeeForStage(tx, firmId, employeeId, stage) {
  const e = await tx.employeeProfile.findFirst({
    where: { id: employeeId, firmId, status: 'ACTIVE', deletedAt: null, user: { status: { in: ['ACTIVE', 'INVITED'] }, roles: { some: { firmId, status: 'ACTIVE', role: { code: STAGE_ROLE[stage] } } } } },
    include: { user: { select: { fullName: true } } },
  });
  if (!e) throw BadRequest(`Select an active employee with the ${STAGE_ROLE[stage].replaceAll('_', ' ').toLowerCase()} role`);
  return e;
}

async function create(principal, body, req) {
  const { fieldOfficerId, marketingEmployeeId, clientId, bankId, categoryId, financialYearId, ...info } = body;
  const result = await prisma.$transaction(async (tx) => {
    const { fy } = await resolveRefs(tx, principal.firmId, { clientId, bankId, categoryId, financialYearId });
    const { seq, caseNumber } = await nextCaseNumber(tx, principal.firm, fy);
    const c = await tx.valuationCase.create({
      data: { firmId: principal.firmId, caseNumber, seq, clientId, bankId, categoryId, financialYearId: fy.id, ...info, createdById: principal.userId },
    });
    await tx.caseStatusHistory.create({ data: { firmId: c.firmId, caseId: c.id, fromStatus: null, toStatus: STATUS.CASE_RECEIVED, actorId: principal.userId, actorRole: principal.roles[0] } });
    await recordActivity(tx, { c, principal, action: 'CASE_CREATED', newStatus: STATUS.CASE_RECEIVED, req, clientVisible: true, meta: { caseNumber } });
    await recordActivity(tx, { c, principal, action: 'CASE_ID_GENERATED', meta: { caseNumber, financialYear: fy.code, seq }, req });

    // The marketing owner: the creator when they are marketing staff, or the employee the admin picks.
    const marketingId = marketingEmployeeId ?? (principal.roles.includes(ROLES.MARKETING) ? principal.employeeId : null);
    const events = [['case.created', { firmId: c.firmId, caseId: c.id, actorId: principal.userId }]];
    if (marketingId) events.push(...(await assignInTx(tx, principal, c, 'MARKETING', marketingId, req)));
    if (fieldOfficerId) {
      if (!hasPermission(principal, 'case.assign.field')) throw Forbidden();
      events.push(...(await assignInTx(tx, principal, await lockCase(tx, principal.firmId, c.id), 'FIELD', fieldOfficerId, req)));
    }
    await recordAudit({ action: 'CASE_CREATED', principal, req, entityType: 'case', entityId: c.id, meta: { caseNumber } }, tx);
    return { id: c.id, events };
  });
  emitAll(result.events);
  return get(principal, result.id);
}

async function update(principal, id, body, req) {
  const c = await findVisibleCase(principal, id);
  if (TERMINAL.includes(c.status)) throw Conflict('Closed cases cannot be edited');
  await prisma.$transaction(async (tx) => {
    await tx.valuationCase.update({ where: { id }, data: { ...body, rowVersion: { increment: 1 } } });
    await recordActivity(tx, { c, principal, action: 'CASE_DETAILS_UPDATED', meta: { fields: Object.keys(body) }, req });
  });
  return get(principal, id);
}

/**
 * (Re)assigns a stage. Ends the previous active assignment of that stage. Enforces maker-checker
 * (one person can never be both junior and senior reviewer on a case). Assigning the field officer moves a new
 * case to INSPECTION_ASSIGNED.
 */
async function assignInTx(tx, principal, c, stage, employeeId, req) {
  if (TERMINAL.includes(c.status)) throw Conflict('Closed cases cannot be reassigned');
  const employee = await assertEmployeeForStage(tx, principal.firmId, employeeId, stage);
  const current = await tx.caseAssignment.findMany({ where: { caseId: c.id, endedAt: null } });
  const other = { JUNIOR: 'SENIOR', SENIOR: 'JUNIOR' }[stage];
  if (other && current.some((a) => a.stage === other && a.employeeId === employeeId)) {
    throw BadRequest('The same person cannot be both junior and senior reviewer on a case');
  }
  if (stage === 'FIELD' && !hasFieldAssignment(current)) {
    const settings = await tx.organizationSettings.findUnique({ where: { firmId: c.firmId }, select: { workflowOptions: true } });
    if (settings?.workflowOptions?.requireSourceDocument && (await tx.caseDocument.count({ where: { caseId: c.id, folder: 'SOURCE_FILES', archivedAt: null } })) === 0) {
      throw BadRequest('Upload at least one source document before assigning the field officer');
    }
  }
  const existing = current.find((a) => a.stage === stage);
  if (existing?.employeeId === employeeId) throw BadRequest('This employee is already assigned to that stage');
  if (existing) await tx.caseAssignment.update({ where: { id: existing.id }, data: { endedAt: new Date(), endReason: 'REASSIGNED' } });
  await tx.caseAssignment.create({ data: { firmId: c.firmId, caseId: c.id, employeeId, stage, assignedById: principal.userId } });
  await recordActivity(tx, { c, principal, action: existing ? 'EMPLOYEE_REASSIGNED' : 'EMPLOYEE_ASSIGNED', meta: { stage, employeeId, employeeName: employee.user.fullName, previousEmployeeId: existing?.employeeId ?? null }, req });
  const events = [['case.assigned', { firmId: c.firmId, caseId: c.id, stage, employeeId, actorId: principal.userId }]];
  if (stage === 'FIELD' && c.status === STATUS.CASE_RECEIVED) {
    const t = await transition(tx, principal, c, 'ASSIGN_FIELD_OFFICER', { req, meta: { employeeId } });
    events.push(...t.events);
  }
  return events;
}

const STAGE_PERMISSION = { MARKETING: 'case.assign.field', FIELD: 'case.assign.field', JUNIOR: 'case.assign.reviewer', SENIOR: 'case.assign.reviewer' };

async function assign(principal, id, { stage, employeeId }, req) {
  if (!hasPermission(principal, STAGE_PERMISSION[stage])) throw Forbidden();
  await findVisibleCase(principal, id);
  const events = await prisma.$transaction(async (tx) => assignInTx(tx, principal, await lockCase(tx, principal.firmId, id), stage, employeeId, req));
  emitAll(events);
  return get(principal, id);
}

/** Generic transitions (hold, resume, cancel, close, start review…). Module-specific steps use their own endpoints. */
async function runGenericTransition(principal, id, { action, remarks }, req) {
  const def = byAction.get(action);
  if (!def || !def.generic) throw BadRequest('This action must be performed from its own screen');
  await findVisibleCase(principal, id);
  const { events } = await prisma.$transaction(async (tx) => transition(tx, principal, await lockCase(tx, principal.firmId, id), action, { remarks, req }));
  emitAll(events);
  return get(principal, id);
}

async function timeline(principal, id) {
  await findVisibleCase(principal, id);
  const isClient = principal.clientId && !principal.employeeId;
  const rows = await prisma.caseActivity.findMany({ where: { caseId: id, ...(isClient ? { clientVisible: true } : {}) }, orderBy: { createdAt: 'asc' } });
  const actorIds = [...new Set(rows.map((r) => r.actorId).filter(Boolean))];
  const actors = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true } }) : [];
  const name = new Map(actors.map((a) => [a.id, a.fullName]));
  return {
    items: rows.map((r) => ({
      id: r.id,
      action: r.action,
      actorName: r.actorId ? name.get(r.actorId) ?? 'User' : 'System',
      actorRole: r.actorRole,
      prevStatus: r.prevStatus,
      newStatus: r.newStatus,
      remarks: r.remarks,
      documentVersionId: isClient ? null : r.documentVersionId,
      ip: isClient ? undefined : r.ip,
      meta: isClient ? {} : r.meta,
      createdAt: r.createdAt,
    })),
  };
}

/** Employees eligible for a stage (for assignment pickers), with their current open workload. */
async function assignableEmployees(principal, stage) {
  if (!hasPermission(principal, STAGE_PERMISSION[stage])) throw Forbidden();
  const rows = await prisma.employeeProfile.findMany({
    where: { firmId: principal.firmId, status: 'ACTIVE', deletedAt: null, user: { status: { in: ['ACTIVE', 'INVITED'] }, roles: { some: { firmId: principal.firmId, status: 'ACTIVE', role: { code: STAGE_ROLE[stage] } } } } },
    select: { id: true, employeeCode: true, designation: true, user: { select: { fullName: true } }, _count: { select: { assignments: { where: { endedAt: null } } } } },
    orderBy: { employeeCode: 'asc' },
  });
  return { items: rows.map((e) => ({ id: e.id, employeeCode: e.employeeCode, name: e.user.fullName, designation: e.designation, openAssignments: e._count.assignments })) };
}

export { list, get, create, update, assign, runGenericTransition, timeline, assignableEmployees, nextCaseNumber, isOverdueNow, emitAll, listInclude, toListItem };
