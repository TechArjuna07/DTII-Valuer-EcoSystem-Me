import { redis } from '../../src/database/redis.js';
import { closeRenderer } from '../../src/services/pdf/pdf-renderer.js';
import { as, createEmployee, prisma } from '../helpers.js';
import { completeFinal, completeInspection, completePreliminary, setupFirm, signFinalReport } from '../fixtures.js';

/**
 * Stage hand-over: field officer → junior reviewer → senior reviewer → signed report.
 * The assignee of a stage picks the next reviewer while that stage is unassigned; the valuer's signature completes
 * the case and shares the report with the client.
 */

let fx;
const userId = async (email) => (await prisma.user.findUnique({ where: { email } })).id;

async function waitFor(fn, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 100));
  }
}

beforeAll(async () => {
  fx = await setupFirm();
}, 60_000);

afterAll(async () => {
  await closeRenderer();
  await prisma.$disconnect();
  await redis.quit();
});

/** Case with only the marketing owner and field officer: reviewers are picked at hand-over. */
const newCase = async () => (await as(fx.mk.token).post('/cases', { clientId: fx.client.id, bankId: fx.bank.id, categoryId: fx.land.id, loanAmount: 2000000, fieldOfficerId: fx.fo.employee.id })).body;
const stageOf = (c, stage) => c.assignments.find((a) => a.stage === stage)?.employee.id;

describe('field officer → junior reviewer', () => {
  test('the field officer lists juniors for their case and hands over on submission', async () => {
    const c = await newCase();
    const fo = as(fx.fo.token);
    expect((await fo.get(`/cases/${c.id}`)).body.handoverStages).toEqual(['JUNIOR']);
    expect((await fo.get('/cases/assignable-employees?stage=JUNIOR')).status).toBe(403); // firm-wide list stays admin-only
    const list = await fo.get(`/cases/assignable-employees?stage=JUNIOR&caseId=${c.id}`);
    expect(list.status).toBe(200);
    expect(list.body.items.map((e) => e.id)).toContain(fx.jr.employee.id);
    expect(list.body.autoAssign).toBe('MANUAL');
    expect((await fo.get(`/cases/assignable-employees?stage=SENIOR&caseId=${c.id}`)).status).toBe(403);

    // A wrong pick (not a junior reviewer) rolls the whole submission back.
    const wrong = await completeInspection(fx, c.id, { nextAssigneeId: fx.sr.employee.id });
    expect(wrong.status).toBe(400);
    expect((await fo.get(`/cases/${c.id}`)).body.status).toBe('INSPECTION_IN_PROGRESS');

    const ok = await fo.post(`/cases/${c.id}/inspection/submit`, { nextAssigneeId: fx.jr.employee.id });
    expect(ok.status).toBe(200);
    const after = (await fo.get(`/cases/${c.id}`)).body;
    expect(after.status).toBe('INSPECTION_COMPLETED');
    expect(stageOf(after, 'JUNIOR')).toBe(fx.jr.employee.id);
    expect(after.handoverStages).toEqual([]);

    // Once assigned, only the Firm Admin may change the junior.
    const other = await createEmployee(fx.admin, ['JUNIOR_REVIEWER'], 'Jaya Junior');
    expect((await fo.post(`/cases/${c.id}/assignments`, { stage: 'JUNIOR', employeeId: other.employee.id })).status).toBe(403);
    expect((await as(fx.admin).post(`/cases/${c.id}/assignments`, { stage: 'JUNIOR', employeeId: other.employee.id })).status).toBe(200);
  }, 60_000);

  test('a case already at "inspection completed" without a junior can still be handed over from the Team card', async () => {
    const c = await newCase();
    await completeInspection(fx, c.id);
    const fo = as(fx.fo.token);
    expect((await fo.get(`/cases/${c.id}`)).body.handoverStages).toEqual(['JUNIOR']);
    const res = await fo.post(`/cases/${c.id}/assignments`, { stage: 'JUNIOR', employeeId: fx.jr.employee.id });
    expect(res.status).toBe(200);
    expect(stageOf(res.body, 'JUNIOR')).toBe(fx.jr.employee.id);
  }, 60_000);
});

describe('junior reviewer → senior reviewer → signed report', () => {
  test('the junior picks the senior on submission; the signature of the senior completes the case', async () => {
    const c = await newCase();
    await completeInspection(fx, c.id, { nextAssigneeId: fx.jr.employee.id });
    const jr = as(fx.jr.token);
    expect((await jr.get(`/cases/${c.id}`)).body.handoverStages).toEqual(['SENIOR']);

    const sub = await completePreliminary(fx, c.id, undefined, { nextAssigneeId: fx.sr.employee.id });
    expect(sub.status).toBe(200);
    const after = (await jr.get(`/cases/${c.id}`)).body;
    expect(after.status).toBe('PRELIMINARY_SUBMITTED');
    expect(stageOf(after, 'SENIOR')).toBe(fx.sr.employee.id);
    const srUser = await prisma.employeeProfile.findUnique({ where: { id: fx.sr.employee.id }, select: { userId: true } });
    await waitFor(() => prisma.notification.findFirst({ where: { recipientId: srUser.userId, caseId: c.id, event: 'ASSIGNED_SENIOR' } }));

    await completeFinal(fx, c.id);
    const signed = await signFinalReport(fx, c.id);
    expect(signed.body.caseStatus).toBe('CASE_COMPLETED');
    const view = await as(fx.client.token).get(`/cases/${c.id}/approval`);
    expect(view.body.released).toBe(true);
  }, 120_000);

  test('maker-checker: a reviewer holding both roles is never offered as senior on a case they prepared', async () => {
    const both = await createEmployee(fx.admin, ['JUNIOR_REVIEWER', 'SENIOR_REVIEWER'], 'Dual Reviewer');
    const c = await newCase();
    await completeInspection(fx, c.id, { nextAssigneeId: both.employee.id });
    const dual = as(both.token);
    const list = await dual.get(`/cases/assignable-employees?stage=SENIOR&caseId=${c.id}`);
    expect(list.body.items.map((e) => e.id)).not.toContain(both.employee.id);
    expect((await dual.post(`/cases/${c.id}/assignments`, { stage: 'SENIOR', employeeId: both.employee.id })).status).toBe(400);
  }, 60_000);

  test('without a pick (manual mode) the Firm Admins are asked to assign a senior reviewer', async () => {
    const c = await newCase();
    await completeInspection(fx, c.id, { nextAssigneeId: fx.jr.employee.id });
    await completePreliminary(fx, c.id);
    const adminId = await userId(fx.firm.adminEmail);
    const n = await waitFor(() => prisma.notification.findFirst({ where: { recipientId: adminId, caseId: c.id, event: 'SENIOR_UNASSIGNED' } }));
    expect(n.title).toBe('Assign a senior reviewer');
  }, 60_000);
});
