/**
 * One-off backfill: completes cases that are still LOAN_SANCTIONED although the whole sanctioned amount has been
 * disbursed (recorded before full disbursement completed cases automatically). Each case moves
 * DISBURSED → CASE_COMPLETED as SYSTEM steps, with history and timeline entries. Safe to run repeatedly.
 *
 *   pnpm --filter @valuers/backend cases:complete-disbursed            (dry run: lists the cases)
 *   pnpm --filter @valuers/backend cases:complete-disbursed -- --apply
 */
import 'dotenv/config';
import { prisma } from '../src/database/prisma.js';
import { redis } from '../src/database/redis.js';
import { emit } from '../src/services/events.js';
import { registerNotificationRules } from '../src/modules/notifications/rules.js';
import { lockCase } from '../src/modules/workflow/workflow.service.js';
import { completeDisbursement } from '../src/modules/submissions/submissions.service.js';

const apply = process.argv.includes('--apply');
registerNotificationRules();

const candidates = await prisma.valuationCase.findMany({
  where: { status: 'LOAN_SANCTIONED', sanction: { isNot: null } },
  select: { id: true, firmId: true, caseNumber: true, sanction: { select: { amount: true } }, disbursements: { select: { amount: true } } },
});
const due = candidates.filter((c) => c.disbursements.length && c.disbursements.reduce((s, d) => s + Number(d.amount), 0) >= Number(c.sanction.amount) - 0.001);
console.log(due.length ? `Fully disbursed but not completed: ${due.map((c) => c.caseNumber).join(', ')}` : 'No fully disbursed cases waiting for completion.');

if (apply) {
  for (const d of due) {
    const total = d.disbursements.reduce((s, x) => s + Number(x.amount), 0);
    const events = await prisma.$transaction(async (tx) => {
      const c = await lockCase(tx, d.firmId, d.id);
      if (c.status !== 'LOAN_SANCTIONED') return [];
      return completeDisbursement(tx, null, c, { tranche: d.disbursements.length, total, system: true });
    });
    events.forEach(([n, p]) => emit(n, p));
    console.log(`${d.caseNumber} → CASE_COMPLETED`);
  }
  await new Promise((r) => setTimeout(r, 1500)); // let notification listeners finish
} else if (due.length) console.log('Dry run. Re-run with --apply to complete them.');

await prisma.$disconnect();
await redis.quit();
process.exit(0); // open queue connections (notification mail jobs) would keep the process alive
