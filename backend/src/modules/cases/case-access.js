import { prisma } from '../../database/prisma.js';
import { hasPermission } from '../../middleware/authorize.js';
import { NotFound } from '../../utils/errors.js';

/**
 * Case visibility (single source of truth, reused by documents, inspections, valuations…):
 *  - case.view.all (Firm Admin, Marketing by default)  → every case of the firm
 *  - client portal user                                → only their own client's cases
 *  - other staff (field officers, reviewers, marketing without view.all) → cases they are ACTIVELY assigned to,
 *    plus cases they created
 * Always combined with firm_id from the token. Invisible cases are reported as 404.
 */
function caseScope(principal) {
  const base = { firmId: principal.firmId };
  if (principal.clientId && !principal.employeeId) return { ...base, clientId: principal.clientId };
  if (hasPermission(principal, 'case.view.all')) return base;
  if (!principal.employeeId) return { ...base, id: { in: [] } };
  return {
    ...base,
    OR: [{ assignments: { some: { employeeId: principal.employeeId, endedAt: null } } }, { createdById: principal.userId }],
  };
}

/** Loads a visible case or throws 404. */
async function findVisibleCase(principal, caseId, db = prisma, include) {
  const c = await db.valuationCase.findFirst({ where: { AND: [{ id: caseId }, caseScope(principal)] }, include });
  if (!c) throw NotFound('Case not found');
  return c;
}

/** Stages the principal is actively assigned to on a case. */
async function myStages(principal, caseId, db = prisma) {
  if (!principal.employeeId) return [];
  const rows = await db.caseAssignment.findMany({ where: { caseId, employeeId: principal.employeeId, endedAt: null }, select: { stage: true } });
  return rows.map((r) => r.stage);
}

export { caseScope, findVisibleCase, myStages };
