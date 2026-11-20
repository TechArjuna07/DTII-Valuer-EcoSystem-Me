import { redis } from '../../src/database/redis.js';
import { closeRenderer } from '../../src/services/pdf/pdf-renderer.js';
import { getBuffer } from '../../src/services/storage/storage.service.js';
import { api, app, as, PASSWORD, prisma, request } from '../helpers.js';
import { clientApproveAndSign, completeFinal, completeInspection, completePreliminary, createCaseWithTeam, setupFirm, signAndRelease } from '../fixtures.js';

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

describe('valuer signature & release', () => {
  test('release requires the valuer signature; signing needs password + consent; the client sees nothing before release', async () => {
    const c = await approvedCase();
    expect((await as(fx.client.token).get(`/cases/${c.id}/approval`)).body.released).toBe(false);
    const before = await as(fx.client.token).get(`/cases/${c.id}/documents`);
    expect(before.body.folders.find((f) => f.code === 'FINAL_VALUATION_REPORT').documents).toHaveLength(0);

    expect((await as(fx.sr.token).post(`/cases/${c.id}/approval/release`)).status).toBe(409);
    expect((await as(fx.sr.token).post(`/cases/${c.id}/signatures/valuer`, { password: 'wrong', consent: true })).status).toBe(400);
    expect((await as(fx.sr.token).post(`/cases/${c.id}/signatures/valuer`, { password: PASSWORD, consent: false })).status).toBe(400);
    expect((await as(fx.jr.token).post(`/cases/${c.id}/signatures/valuer`, { password: PASSWORD, consent: true })).status).toBe(403);

    const signed = await as(fx.sr.token).post(`/cases/${c.id}/signatures/valuer`, { password: PASSWORD, consent: true });
    expect(signed.status).toBe(200);
    const sig = signed.body.signatures[0];
    expect(sig).toMatchObject({ signerRole: 'VALUER', status: 'SIGNED', provider: 'SANDBOX', legallyValid: false, verificationStatus: 'VERIFIED' });
    expect(signed.body.finalReport.valuerSigned).toBe(true);
    const signedFile = await prisma.documentVersion.findUnique({ where: { id: sig.signedVersionId } });
    const pdf = (await getBuffer(signedFile.storageKey)).toString('latin1');
    expect(pdf).toContain('%PDF-');
    expect((await as(fx.sr.token).post(`/cases/${c.id}/signatures/valuer`, { password: PASSWORD, consent: true })).status).toBe(403); // once only

    // Senior → client hand-over is automatic once the valuer has signed (client has a portal login).
    expect(signed.body.caseStatus).toBe('CLIENT_APPROVAL_PENDING');
    const released = (await as(fx.admin).get(`/cases/${c.id}/timeline`)).body.items.find((i) => i.action === 'RELEASE_TO_CLIENT');
    expect(released).toMatchObject({ actorRole: 'SYSTEM', meta: { automatic: true } });
    const after = await as(fx.client.token).get(`/cases/${c.id}/documents`);
    expect(after.body.folders.find((f) => f.code === 'FINAL_VALUATION_REPORT').documents).toHaveLength(1);
  }, 120_000);
});

describe('manual release when auto-release is switched off', () => {
  test('the senior reviewer releases the signed report explicitly', async () => {
    const settings = (await as(fx.admin).get('/masters/workflow-settings')).body;
    expect(settings.options.autoReleaseToClient).toBe(true);
    await as(fx.admin).put('/masters/workflow-settings', { options: { ...settings.options, autoReleaseToClient: false } });
    try {
      const c = await approvedCase();
      const signed = await as(fx.sr.token).post(`/cases/${c.id}/signatures/valuer`, { password: PASSWORD, consent: true });
      expect(signed.body.caseStatus).toBe('FINAL_APPROVED');
      expect(signed.body.permissions.canRelease).toBe(true);
      expect((await as(fx.sr.token).post(`/cases/${c.id}/approval/release`)).body.caseStatus).toBe('CLIENT_APPROVAL_PENDING');
    } finally {
      await as(fx.admin).put('/masters/workflow-settings', { options: settings.options });
    }
  }, 120_000);
});

describe('client approval, query and signature', () => {
  test('a client query sends the case back to the senior reviewer; after re-issue the client approves and signs', async () => {
    const c = await approvedCase();
    await signAndRelease(fx, c.id);
    const view = await as(fx.client.token).get(`/cases/${c.id}/approval`);
    expect(view.body.permissions.canDecide).toBe(true);
    expect(view.body.consentText).toMatch(/acknowledge receipt/);
    expect((await as(fx.mk.token).post(`/cases/${c.id}/approval/decision`, { decision: 'APPROVED' })).status).toBe(403);
    expect((await as(fx.client.token).post(`/cases/${c.id}/approval/decision`, { decision: 'QUERY' })).status).toBe(400);
    const q = await as(fx.client.token).post(`/cases/${c.id}/approval/decision`, { decision: 'QUERY', comments: 'The built-up area should be 8,200 sq.ft as per the OC' });
    expect(q.body.caseStatus).toBe('CLIENT_QUERY_RAISED');

    // Senior addresses the query: re-review, new final version, approve, sign, release.
    await completeFinal(fx, c.id);
    const again = await signAndRelease(fx, c.id);
    expect(again.body.caseStatus).toBe('CLIENT_APPROVAL_PENDING');
    expect(again.body.finalReport.version).toBe(2);

    const signed = await clientApproveAndSign(fx, c.id);
    expect(signed.status).toBe(200);
    expect(signed.body.caseStatus).toBe('CLIENT_SIGNED');
    const clientSig = signed.body.signatures.find((s) => s.signerRole === 'CLIENT');
    expect(clientSig.status).toBe('SIGNED');
    const tree = await as(fx.client.token).get(`/cases/${c.id}/documents`);
    expect(tree.body.folders.find((f) => f.code === 'CLIENT_SIGNED_FILES').documents).toHaveLength(1);
    expect(await prisma.clientApproval.count({ where: { caseId: c.id } })).toBe(2);
    await expect(prisma.clientApproval.updateMany({ where: { caseId: c.id }, data: { decision: 'APPROVED' } })).rejects.toThrow();

    // Public verification lists both signatures of the current report version.
    const code = signed.body.finalReport.verificationCode;
    const pub = await request(app).get(api(`/verify/${code}`));
    expect(pub.body.signatures.map((s) => s.role)).toEqual(['VALUER', 'CLIENT']);
  }, 180_000);

  test('signatures are re-verifiable, and tampering is detected and blocked', async () => {
    const c = await approvedCase();
    await signAndRelease(fx, c.id);
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
    expect((await as(fx.mk.token).get('/portal/summary')).status).toBe(403);
    const other = await setupFirm();
    const mine = await as(other.client.token).get('/portal/summary');
    expect(mine.body.cases).toHaveLength(0);
  }, 120_000);
});
