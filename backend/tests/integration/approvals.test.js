import { redis } from '../../src/database/redis.js';
import { closeRenderer } from '../../src/services/pdf/pdf-renderer.js';
import { getBuffer } from '../../src/services/storage/storage.service.js';
import { api, app, as, PASSWORD, prisma, request } from '../helpers.js';
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

async function approvedCase() {
  const c = await createCaseWithTeam(fx);
  await completeInspection(fx, c.id);
  await completePreliminary(fx, c.id);
  await completeFinal(fx, c.id);
  return c;
}

describe('valuer signature, then payment completes the case', () => {
  test('signing needs password + consent; the case waits for payment; payment completes it and shares the report', async () => {
    const c = await approvedCase();
    expect((await as(fx.client.token).get(`/cases/${c.id}/approval`)).body.released).toBe(false);
    const before = await as(fx.client.token).get(`/cases/${c.id}/documents`);
    expect(before.body.folders.find((f) => f.code === 'FINAL_VALUATION_REPORT').documents).toHaveLength(0);

    expect((await as(fx.sr.token).post(`/cases/${c.id}/signatures/valuer`, { password: 'wrong', consent: true })).status).toBe(400);
    expect((await as(fx.sr.token).post(`/cases/${c.id}/signatures/valuer`, { password: PASSWORD, consent: false })).status).toBe(400);
    expect((await as(fx.jr.token).post(`/cases/${c.id}/signatures/valuer`, { password: PASSWORD, consent: true })).status).toBe(403);
    // Retired steps are gone.
    for (const path of ['approval/release', 'approval/decision', 'signatures/client', 'bank/submissions']) expect((await as(fx.sr.token).post(`/cases/${c.id}/${path}`, {})).status).toBe(404);

    const signed = await as(fx.sr.token).post(`/cases/${c.id}/signatures/valuer`, { password: PASSWORD, consent: true });
    expect(signed.status).toBe(200);
    expect(signed.body.caseStatus).toBe('PAYMENT_PENDING');
    const sig = signed.body.signatures[0];
    expect(sig).toMatchObject({ signerRole: 'VALUER', status: 'SIGNED', provider: 'SANDBOX', legallyValid: false, verificationStatus: 'VERIFIED' });
    expect(signed.body.finalReport.valuerSigned).toBe(true);
    const signedFile = await prisma.documentVersion.findUnique({ where: { id: sig.signedVersionId } });
    expect((await getBuffer(signedFile.storageKey)).toString('latin1')).toContain('%PDF-');
    expect((await as(fx.sr.token).post(`/cases/${c.id}/signatures/valuer`, { password: PASSWORD, consent: true })).status).toBe(403); // once only

    // Signed but unpaid: the case stays open and the client does not get the report yet.
    expect(signed.body.permissions).toMatchObject({ canRecordPayment: false }); // the senior has no payment.record
    expect((await as(fx.client.token).get(`/cases/${c.id}/approval`)).body.released).toBe(false);
    expect((await as(fx.client.token).get(`/cases/${c.id}/documents`)).body.folders.find((f) => f.code === 'FINAL_VALUATION_REPORT').documents).toHaveLength(0);

    // Payment received: only payment.record holders (marketing / admin), valid amount and date.
    const pay = { amount: 2950, receivedOn: new Date().toISOString().slice(0, 10), mode: 'UPI', reference: 'UPI-123' };
    expect((await as(fx.sr.token).post(`/cases/${c.id}/payments`, pay)).status).toBe(403);
    expect((await as(fx.client.token).post(`/cases/${c.id}/payments`, pay)).status).toBe(403);
    expect((await as(fx.mk.token).post(`/cases/${c.id}/payments`, { ...pay, amount: 0 })).status).toBe(400);
    expect((await as(fx.mk.token).post(`/cases/${c.id}/payments`, { ...pay, receivedOn: '2099-01-01' })).status).toBe(400);
    expect((await as(fx.mk.token).get(`/cases/${c.id}/approval`)).body.permissions.canRecordPayment).toBe(true);
    const paid = await recordPayment(fx, c.id, pay);
    expect(paid.body).toMatchObject({ caseStatus: 'CASE_COMPLETED', released: true, payment: { payments: [{ amount: 2950, mode: 'UPI', source: 'MANUAL', reference: 'UPI-123' }] } });
    expect((await as(fx.mk.token).post(`/cases/${c.id}/payments`, pay)).status).toBe(403); // once completed, no more
    const payment = await prisma.casePayment.findFirst({ where: { caseId: c.id } });
    await expect(prisma.casePayment.update({ where: { id: payment.id }, data: { amount: 1 } })).rejects.toThrow(); // append-only
    expect(await prisma.auditLog.findFirst({ where: { action: 'PAYMENT_RECORDED', entityId: payment.id } })).toBeTruthy();

    const history = (await prisma.caseStatusHistory.findMany({ where: { caseId: c.id }, orderBy: { createdAt: 'desc' }, take: 3 })).map((h) => h.toStatus);
    expect(history).toEqual(['CASE_COMPLETED', 'PAYMENT_PENDING', 'FINAL_APPROVED']);

    // The client now sees the signed report (and only the signed version).
    const view = await as(fx.client.token).get(`/cases/${c.id}/approval`);
    expect(view.body).toMatchObject({ released: true, caseStatus: 'CASE_COMPLETED', permissions: {} });
    const after = await as(fx.client.token).get(`/cases/${c.id}/documents`);
    expect(after.body.folders.find((f) => f.code === 'FINAL_VALUATION_REPORT').documents).toHaveLength(1);
    await expect(prisma.caseActivity.findFirst({ where: { caseId: c.id, action: 'VALUER_SIGNATURE_COMPLETED', clientVisible: true } })).resolves.toBeTruthy();

    // Public verification lists the valuer signature of the current report version.
    const pub = await request(app).get(api(`/verify/${signed.body.finalReport.verificationCode}`));
    expect(pub.body.signatures.map((s) => s.role)).toEqual(['VALUER']);
  }, 180_000);

  test('signatures are re-verifiable, and tampering is detected and blocked', async () => {
    const c = await approvedCase();
    await signFinalReport(fx, c.id);
    const sig = await prisma.digitalSignature.findFirst({ where: { caseId: c.id, signerRole: 'VALUER' } });
    const ok = await as(fx.sr.token).post(`/signatures/${sig.id}/verify`);
    expect(ok.body).toMatchObject({ ok: true, sourceIntact: true, signedFileIntact: true, cryptographicCheck: true });
    // A completed signature cannot be altered in the database.
    await expect(prisma.digitalSignature.update({ where: { id: sig.id }, data: { signatureValue: 'forged' } })).rejects.toThrow();
    await expect(prisma.digitalSignature.delete({ where: { id: sig.id } })).rejects.toThrow();
    // Another firm cannot verify or see it.
    const other = await setupFirm();
    expect((await as(other.admin).post(`/signatures/${sig.id}/verify`)).status).toBe(404);
  }, 180_000);
});

describe('client portal dashboard', () => {
  test('summarises only the client’s own cases; staff cannot use it', async () => {
    const c = await createCaseWithTeam(fx);
    await as(fx.mk.token).post(`/cases/${c.id}/document-requests`, { title: 'Electricity bill', requestedFrom: 'CLIENT' });
    const s = await as(fx.client.token).get('/portal/summary');
    expect(s.status).toBe(200);
    expect(s.body.cases.every((x) => x.caseNumber.startsWith(`VAL-${fx.firm.firm.firmCode}-`))).toBe(true);
    expect(s.body.requests.map((r) => r.title)).toContain('Electricity bill');
    expect(s.body.counts.pendingDocuments).toBeGreaterThanOrEqual(1);
    expect(s.body.counts).toHaveProperty('signedReports');
    expect((await as(fx.mk.token).get('/portal/summary')).status).toBe(403);
    const other = await setupFirm();
    const mine = await as(other.client.token).get('/portal/summary');
    expect(mine.body.cases).toHaveLength(0);
  }, 120_000);
});
