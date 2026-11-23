import { redis } from '../../src/database/redis.js';
import { closeRenderer } from '../../src/services/pdf/pdf-renderer.js';
import { as, prisma } from '../helpers.js';
import { completeFinal, completeInspection, completePreliminary, createCaseWithTeam, recordPayment, setupFirm, signFinalReport } from '../fixtures.js';

let fx;

beforeAll(async () => {
  fx = await setupFirm();
}, 60_000);

afterAll(async () => {
  await closeRenderer();
  await prisma.$disconnect();
  await redis.quit();
});

describe('end-to-end case lifecycle', () => {
  test('case received → inspection → preliminary → final review → final approval → valuer signature → payment → completed', async () => {
    const c = await createCaseWithTeam(fx);
    expect((await completeInspection(fx, c.id)).body.caseStatus).toBe('INSPECTION_COMPLETED');
    expect((await completePreliminary(fx, c.id)).body.caseStatus).toBe('PRELIMINARY_SUBMITTED');
    expect((await completeFinal(fx, c.id)).body.caseStatus).toBe('FINAL_APPROVED');
    expect((await signFinalReport(fx, c.id)).body.caseStatus).toBe('PAYMENT_PENDING');
    expect((await as(fx.admin).get(`/cases/${c.id}`)).body.status).toBe('PAYMENT_PENDING'); // still open
    expect((await recordPayment(fx, c.id)).body.caseStatus).toBe('CASE_COMPLETED');

    const detail = (await as(fx.admin).get(`/cases/${c.id}`)).body;
    expect(detail.pipeline).toEqual([
      'CASE_RECEIVED',
      'INSPECTION_ASSIGNED',
      'INSPECTION_IN_PROGRESS',
      'INSPECTION_COMPLETED',
      'PRELIMINARY_VALUATION_IN_PROGRESS',
      'PRELIMINARY_SUBMITTED',
      'FINAL_REVIEW_IN_PROGRESS',
      'FINAL_APPROVED',
      'PAYMENT_PENDING',
      'CASE_COMPLETED',
    ]);
    expect(detail.allowedActions).toEqual([]);

    const history = (await prisma.caseStatusHistory.findMany({ where: { caseId: c.id }, orderBy: { createdAt: 'asc' } })).map((h) => h.toStatus);
    expect(history).toEqual(detail.pipeline);
    const actions = (await as(fx.admin).get(`/cases/${c.id}/timeline`)).body.items.map((i) => i.action);
    for (const a of ['CASE_CREATED', 'CASE_ID_GENERATED', 'EMPLOYEE_ASSIGNED', 'INSPECTION_STARTED', 'SUBMIT_INSPECTION', 'PRELIMINARY_REPORT_CREATED', 'SUBMIT_PRELIMINARY', 'PRELIMINARY_APPROVED', 'APPROVE_FINAL', 'VALUER_SIGNATURE_COMPLETED', 'RECORD_PAYMENT']) {
      expect(actions).toContain(a);
    }
    const counts = (await as(fx.admin).get(`/repository/clients/${fx.client.id}`)).body.years[0].cases.find((x) => x.id === c.id).folderCounts;
    for (const f of ['PROPERTY_PHOTOGRAPHS', 'PRELIMINARY_VALUATION', 'FINAL_VALUATION_REPORT']) expect(counts[f]).toBeGreaterThanOrEqual(1);

    // The client sees the milestones (not internal working steps) in their portal timeline.
    const clientTl = (await as(fx.client.token).get(`/cases/${c.id}/timeline`)).body.items.map((i) => i.action);
    expect(clientTl).toEqual(expect.arrayContaining(['CASE_CREATED', 'SUBMIT_INSPECTION', 'VALUER_SIGNATURE_COMPLETED', 'RECORD_PAYMENT']));
    expect(clientTl).not.toContain('PRELIMINARY_REPORT_CREATED');
  }, 300_000);

  test('a case left in a retired step (e.g. "submitted to bank") can only be closed or cancelled', async () => {
    const c = await createCaseWithTeam(fx);
    await prisma.valuationCase.update({ where: { id: c.id }, data: { status: 'SUBMITTED_TO_BANK' } });
    const actions = (await as(fx.admin).get(`/cases/${c.id}`)).body.allowedActions.map((a) => a.action).sort();
    expect(actions).toEqual(['CANCEL', 'CLOSE_CASE']);
    expect((await as(fx.admin).post(`/cases/${c.id}/transitions`, { action: 'CLOSE_CASE' })).status).toBe(400); // remarks required
    const closed = await as(fx.admin).post(`/cases/${c.id}/transitions`, { action: 'CLOSE_CASE', remarks: 'Report delivered before the workflow change' });
    expect(closed.body.status).toBe('CASE_COMPLETED');
  }, 120_000);
});
