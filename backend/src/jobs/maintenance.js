import { prisma } from '../database/prisma.js';
import { emit } from '../services/events.js';
import { STATUS, TERMINAL } from '../modules/workflow/workflow.definition.js';

/**
 * SLA / overdue sweep. A case is overdue when its due date has passed, or when it has stayed in its current
 * status longer than the firm's TAT for that status (Workflow Settings). Newly overdue cases are flagged and
 * notified once; any status change clears the flag (workflow engine).
 * @returns {Promise<number>} number of cases newly flagged
 */
async function runSlaSweep(now = new Date()) {
  const today = new Date(now.toISOString().slice(0, 10));
  const settings = await prisma.organizationSettings.findMany({ select: { firmId: true, slaConfig: true } });
  const closed = [...TERMINAL, STATUS.CASE_ON_HOLD];
  let flagged = 0;
  const flag = async (cases, reasonOf) => {
    for (const c of cases) {
      const r = await prisma.valuationCase.updateMany({ where: { id: c.id, isOverdue: false, status: c.status }, data: { isOverdue: true } });
      if (r.count) {
        flagged += 1;
        emit('case.overdue', { firmId: c.firmId, caseId: c.id, reason: reasonOf(c) });
      }
    }
  };
  await flag(await prisma.valuationCase.findMany({ where: { isOverdue: false, status: { notIn: closed }, dueDate: { lt: today } }, select: { id: true, firmId: true, status: true } }), () => 'due date passed');
  for (const s of settings) {
    for (const [status, hours] of Object.entries(s.slaConfig || {})) {
      if (!(Number(hours) > 0) || closed.includes(status)) continue;
      const cutoff = new Date(now.getTime() - Number(hours) * 3_600_000);
      const cases = await prisma.valuationCase.findMany({ where: { firmId: s.firmId, status, isOverdue: false, statusChangedAt: { lt: cutoff } }, select: { id: true, firmId: true, status: true } });
      await flag(cases, (c) => `in ${c.status.replaceAll('_', ' ').toLowerCase()} for more than ${hours} h`);
    }
  }
  return flagged;
}

export { runSlaSweep };
