import { redis } from '../../src/database/redis.js';
import { closeRenderer } from '../../src/services/pdf/pdf-renderer.js';
import { api, app, as, PASSWORD, prisma, request } from '../helpers.js';
import { clientApproveAndSign, completeFinal, completeInspection, completePreliminary, createCaseWithTeam, PDF, setupFirm, signAndRelease } from '../fixtures.js';

let fx;
const today = () => new Date().toISOString().slice(0, 10);

const post = (token, path, fields, file) => {
  let r = request(app).post(api(path)).set('Authorization', `Bearer ${token}`);
  for (const [k, v] of Object.entries(fields)) r = r.field(k, String(v));
  return file ? r.attach('file', file, 'evidence.pdf') : r;
};

beforeAll(async () => {
  fx = await setupFirm();
}, 60_000);

afterAll(async () => {
  await closeRenderer();
  await prisma.$disconnect();
  await redis.quit();
});

describe('end-to-end case lifecycle', () => {
  test('case received → … → loan disbursed → case completed, with every step recorded', async () => {
    const c = await createCaseWithTeam(fx);
    expect((await completeInspection(fx, c.id)).body.caseStatus).toBe('INSPECTION_COMPLETED');
    expect((await completePreliminary(fx, c.id)).body.caseStatus).toBe('PRELIMINARY_SUBMITTED');
    expect((await completeFinal(fx, c.id)).body.caseStatus).toBe('FINAL_APPROVED');
    expect((await signAndRelease(fx, c.id)).body.caseStatus).toBe('CLIENT_APPROVAL_PENDING');
    expect((await clientApproveAndSign(fx, c.id)).body.caseStatus).toBe('CLIENT_SIGNED');

    // Bank submission: only the marketing owner / admin; evidence required.
    const bank = await as(fx.mk.token).get(`/cases/${c.id}/bank`);
    expect(bank.body.deliverable.signatureRole).toBe('CLIENT');
    expect(bank.body.permissions.canSubmit).toBe(true);
    expect((await post(fx.fo.token, `/cases/${c.id}/bank/submissions`, { mode: 'DIGITAL', submittedOn: today(), ackNumber: 'X' })).status).toBe(403);
    expect((await post(fx.mk.token, `/cases/${c.id}/bank/submissions`, { mode: 'DIGITAL', submittedOn: today() })).status).toBe(400);
    const sub = await post(fx.mk.token, `/cases/${c.id}/bank/submissions`, { mode: 'BOTH', submittedOn: today(), submittedTo: 'Credit manager', ackNumber: 'HDFC/ACK/7781' }, PDF);
    expect(sub.status).toBe(201);
    expect(sub.body.caseStatus).toBe('SUBMITTED_TO_BANK');

    // Sanction, then disbursement tranches (cannot exceed the sanction).
    expect((await post(fx.mk.token, `/cases/${c.id}/bank/disbursements`, { amount: 1, disbursedOn: today(), isFinal: 'false' })).status).toBe(409);
    expect((await post(fx.mk.token, `/cases/${c.id}/bank/sanction`, { outcome: 'SANCTIONED', sanctionDate: today() })).status).toBe(400);
    const sanc = await post(fx.mk.token, `/cases/${c.id}/bank/sanction`, { outcome: 'SANCTIONED', amount: 6000000, sanctionDate: today(), referenceNo: 'SL-2026-55' }, PDF);
    expect(sanc.body.caseStatus).toBe('LOAN_SANCTIONED');
    expect((await post(fx.mk.token, `/cases/${c.id}/bank/sanction`, { outcome: 'SANCTIONED', amount: 1, sanctionDate: today() })).status).toBe(409);
    const t1 = await post(fx.mk.token, `/cases/${c.id}/bank/disbursements`, { amount: 4000000, disbursedOn: today(), referenceNo: 'UTR1', isFinal: 'false' });
    expect(t1.body.totals).toMatchObject({ sanctioned: 6000000, disbursed: 4000000, remaining: 2000000 });
    expect((await post(fx.mk.token, `/cases/${c.id}/bank/disbursements`, { amount: 2500000, disbursedOn: today(), isFinal: 'true' })).status).toBe(400);
    // The tranche that reaches the sanctioned amount is final even when not ticked: DISBURSED → CASE_COMPLETED automatically.
    const t2 = await post(fx.mk.token, `/cases/${c.id}/bank/disbursements`, { amount: 2000000, disbursedOn: today(), referenceNo: 'UTR2', isFinal: 'false' }, PDF);
    expect(t2.body.caseStatus).toBe('CASE_COMPLETED');
    expect(t2.body.disbursements.map((d) => [d.trancheNo, d.isFinal])).toEqual([[1, false], [2, true]]);
    const closedBy = (await as(fx.admin).get(`/cases/${c.id}/timeline`)).body.items.find((i) => i.action === 'CLOSE_CASE');
    expect(closedBy).toMatchObject({ actorRole: 'SYSTEM', remarks: 'Loan fully disbursed' });

    // Complete status trail, timeline and repository.
    const history = (await prisma.caseStatusHistory.findMany({ where: { caseId: c.id }, orderBy: { createdAt: 'asc' } })).map((h) => h.toStatus);
    expect(history).toEqual([
      'CASE_RECEIVED',
      'INSPECTION_ASSIGNED',
      'INSPECTION_IN_PROGRESS',
      'INSPECTION_COMPLETED',
      'PRELIMINARY_VALUATION_IN_PROGRESS',
      'PRELIMINARY_SUBMITTED',
      'FINAL_REVIEW_IN_PROGRESS',
      'FINAL_APPROVED',
      'CLIENT_APPROVAL_PENDING',
      'CLIENT_APPROVED',
      'CLIENT_SIGNED',
      'SUBMITTED_TO_BANK',
      'LOAN_SANCTIONED',
      'DISBURSED',
      'CASE_COMPLETED',
    ]);
    const actions = (await as(fx.admin).get(`/cases/${c.id}/timeline`)).body.items.map((i) => i.action);
    for (const a of ['CASE_CREATED', 'CASE_ID_GENERATED', 'EMPLOYEE_ASSIGNED', 'INSPECTION_STARTED', 'SUBMIT_INSPECTION', 'PRELIMINARY_REPORT_CREATED', 'SUBMIT_PRELIMINARY', 'PRELIMINARY_APPROVED', 'APPROVE_FINAL', 'VALUER_SIGNATURE_COMPLETED', 'RELEASE_TO_CLIENT', 'CLIENT_APPROVE', 'CLIENT_SIGNATURE_COMPLETED', 'SUBMIT_TO_BANK', 'RECORD_SANCTION', 'DISBURSEMENT_RECORDED', 'RECORD_FINAL_DISBURSEMENT', 'CLOSE_CASE']) {
      expect(actions).toContain(a);
    }
    const counts = (await as(fx.admin).get(`/repository/clients/${fx.client.id}`)).body.years[0].cases.find((x) => x.id === c.id).folderCounts;
    for (const f of ['PROPERTY_PHOTOGRAPHS', 'PRELIMINARY_VALUATION', 'FINAL_VALUATION_REPORT', 'CLIENT_SIGNED_FILES', 'BANK_SUBMISSION', 'SANCTION_DOCUMENTS', 'DISBURSEMENT_DOCUMENTS']) expect(counts[f]).toBeGreaterThanOrEqual(1);
    await expect(prisma.loanDisbursement.updateMany({ where: { caseId: c.id }, data: { amount: 1 } })).rejects.toThrow();
    // The client sees the milestones in their portal timeline.
    const clientTl = (await as(fx.client.token).get(`/cases/${c.id}/timeline`)).body.items.map((i) => i.action);
    expect(clientTl).toEqual(expect.arrayContaining(['CASE_CREATED', 'SUBMIT_TO_BANK', 'RECORD_SANCTION', 'CLOSE_CASE']));
    expect(clientTl).not.toContain('PRELIMINARY_REPORT_CREATED');
  }, 300_000);

  test('a lender that does not need client approval receives the valuer-signed report directly; a decline closes the case', async () => {
    const fx2 = await setupFirm({ requiresClientApproval: false });
    const c = await createCaseWithTeam(fx2);
    await completeInspection(fx2, c.id);
    await completePreliminary(fx2, c.id);
    await completeFinal(fx2, c.id);
    expect((await post(fx2.mk.token, `/cases/${c.id}/bank/submissions`, { mode: 'DIGITAL', submittedOn: today(), ackNumber: 'A1' })).status).toBe(409); // not signed yet
    expect((await as(fx2.sr.token).post(`/cases/${c.id}/signatures/valuer`, { password: PASSWORD, consent: true })).status).toBe(200);
    expect((await as(fx2.sr.token).get(`/cases/${c.id}/approval`)).body.permissions.canRelease).toBe(false);
    const sub = await post(fx2.mk.token, `/cases/${c.id}/bank/submissions`, { mode: 'DIGITAL', submittedOn: today(), ackNumber: 'A1' });
    expect(sub.body.caseStatus).toBe('SUBMITTED_TO_BANK');
    expect(sub.body.deliverable.signatureRole).toBe('VALUER');
    expect((await post(fx2.mk.token, `/cases/${c.id}/bank/sanction`, { outcome: 'DECLINED', sanctionDate: today() })).status).toBe(400);
    const dec = await post(fx2.mk.token, `/cases/${c.id}/bank/sanction`, { outcome: 'DECLINED', sanctionDate: today(), remarks: 'CIBIL score below policy' });
    expect(dec.body.caseStatus).toBe('CASE_REJECTED');
  }, 300_000);
});
