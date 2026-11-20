import { redis } from '../../src/database/redis.js';
import { getBuffer } from '../../src/services/storage/storage.service.js';
import { closeRenderer } from '../../src/services/pdf/pdf-renderer.js';
import { api, app, as, prisma, request } from '../helpers.js';
import { completeFinal, completeInspection, completePreliminary, createCaseWithTeam, LB_INPUTS, PDF, setupFirm } from '../fixtures.js';

let fx;

beforeAll(async () => {
  fx = await setupFirm();
}, 60_000);

afterAll(async () => {
  await closeRenderer();
  await prisma.$disconnect();
  await redis.quit();
});

async function inspected() {
  const c = await createCaseWithTeam(fx);
  await completeInspection(fx, c.id);
  return c;
}

describe('preliminary valuation (junior reviewer)', () => {
  test('server-side calculation, rendered PDF in 04_Preliminary_Valuation, immutable versions', async () => {
    const c = await inspected();
    expect((await as(fx.jr.token).post(`/cases/${c.id}/valuations/preliminary/versions`, { inputs: LB_INPUTS })).status).toBe(409); // not started
    await as(fx.jr.token).post(`/cases/${c.id}/transitions`, { action: 'START_PRELIMINARY' });
    const view = await as(fx.jr.token).get(`/cases/${c.id}/valuations`);
    expect(view.body.defaults.land.area).toBe(12000); // prefilled from the inspection
    expect(view.body.permissions.canPrepare).toBe(true);

    expect((await as(fx.sr.token).post(`/cases/${c.id}/valuations/preliminary/versions`, { inputs: LB_INPUTS })).status).toBe(403);
    expect((await as(fx.jr.token).post(`/cases/${c.id}/valuations/preliminary/versions`, { inputs: { ...LB_INPUTS, marketValue: 1 } })).status).toBe(400);

    const res = await as(fx.jr.token).post(`/cases/${c.id}/valuations/preliminary/versions`, { inputs: LB_INPUTS, summary: 'Initial' });
    expect(res.status).toBe(201);
    const v1 = res.body.preliminary.versions[0];
    // land 3,00,00,000 + building 1,44,00,000 × (1 − 21%) = 1,13,76,000 + amenities 2,50,000
    expect(v1.marketValue).toBe(41626000);
    expect(v1.guidelineValue).toBe(24000000);
    expect(v1.documentVersionId).toBeTruthy();
    const dv = await prisma.documentVersion.findUnique({ where: { id: v1.documentVersionId } });
    expect((await getBuffer(dv.storageKey)).subarray(0, 5).toString()).toBe('%PDF-');
    const doc = await prisma.caseDocument.findUnique({ where: { id: v1.documentId } });
    expect(doc.folder).toBe('PRELIMINARY_VALUATION');
    await expect(prisma.valuationReportVersion.update({ where: { id: v1.id }, data: { marketValue: 1 } })).rejects.toThrow();

    const submitted = await as(fx.jr.token).post(`/cases/${c.id}/valuations/preliminary/submit`);
    expect(submitted.body.caseStatus).toBe('PRELIMINARY_SUBMITTED');
  }, 60_000);
});

describe('senior review & final report', () => {
  test('return for correction → new preliminary version → approve → final with verification code → FINAL_APPROVED', async () => {
    const c = await inspected();
    await completePreliminary(fx, c.id);
    const sr = as(fx.sr.token);
    expect((await as(fx.jr.token).post(`/cases/${c.id}/valuations/review`, { decision: 'APPROVED' })).status).toBe(403);
    await sr.post(`/cases/${c.id}/transitions`, { action: 'START_FINAL_REVIEW' });
    expect((await sr.post(`/cases/${c.id}/valuations/review`, { decision: 'RETURNED' })).status).toBe(400); // comments required
    const returned = await sr.post(`/cases/${c.id}/valuations/review`, { decision: 'RETURNED', comments: 'Use the 2026 ready-reckoner land rate' });
    expect(returned.body.caseStatus).toBe('SENT_BACK_FOR_CORRECTION');
    expect(returned.body.preliminary.versions[0].reviews[0]).toMatchObject({ decision: 'RETURNED' });

    await as(fx.jr.token).post(`/cases/${c.id}/transitions`, { action: 'START_PRELIMINARY' });
    await as(fx.jr.token).post(`/cases/${c.id}/valuations/preliminary/versions`, { inputs: { ...LB_INPUTS, land: { ...LB_INPUTS.land, ratePerUnit: 2600 } }, changeNote: 'Land rate corrected' });
    await as(fx.jr.token).post(`/cases/${c.id}/valuations/preliminary/submit`);
    await sr.post(`/cases/${c.id}/transitions`, { action: 'START_FINAL_REVIEW' });
    expect((await sr.post(`/cases/${c.id}/valuations/final/versions`, { inputs: LB_INPUTS })).status).toBe(409); // prelim not approved yet
    const approved = await sr.post(`/cases/${c.id}/valuations/review`, { decision: 'APPROVED' });
    expect(approved.body.preliminary.status).toBe('APPROVED');
    expect(approved.body.preliminary.versionCount).toBe(2);
    expect(approved.body.permissions.canPrepareFinal).toBe(true);

    const final = await sr.post(`/cases/${c.id}/valuations/final/versions`, { inputs: LB_INPUTS, summary: 'Final' });
    expect(final.status).toBe(201);
    const fv = final.body.final.versions[0];
    expect(fv.verificationCode).toMatch(/^[A-Z0-9]{4}(-[A-Z0-9]{1,4})+$/);
    const done = await sr.post(`/cases/${c.id}/valuations/final/approve`, {});
    expect(done.body.caseStatus).toBe('FINAL_APPROVED');
    expect(done.body.final.status).toBe('APPROVED');

    // Marketing sees the final report only (never the preliminary working).
    const mk = await as(fx.mk.token).get(`/cases/${c.id}/valuations`);
    expect(mk.body.preliminary).toBeNull();
    expect(mk.body.final.versions[0].marketValue).toBe(fv.marketValue);
  }, 90_000);

  test('the senior can reject the valuation, closing the case', async () => {
    const c = await inspected();
    await completePreliminary(fx, c.id);
    await as(fx.sr.token).post(`/cases/${c.id}/transitions`, { action: 'START_FINAL_REVIEW' });
    const res = await as(fx.sr.token).post(`/cases/${c.id}/valuations/review`, { decision: 'REJECTED', comments: 'Title documents are not marketable' });
    expect(res.body.caseStatus).toBe('CASE_REJECTED');
  }, 60_000);
});

describe('report templates & public verification', () => {
  test('bank-specific template is validated, previewed and used for the final report; QR code verifies provenance only', async () => {
    const admin = as(fx.admin);
    expect((await admin.post('/report-templates', { name: 'Broken', bodyHtml: '<html>{{#each}}</html>' })).status).toBe(400);
    expect((await as(fx.mk.token).get('/report-templates')).status).toBe(403);
    const body = '<html><body><h1>HDFC FORMAT</h1><p>{{case.caseNumber}}</p><p>₹ {{inr valuation.marketValue}} ({{valuation.marketValueWords}})</p><img src="{{verification.qr}}"></body></html>';
    const t = await admin.post('/report-templates', { name: 'HDFC Land & Building', bankId: fx.bank.id, categoryId: fx.land.id, bodyHtml: body });
    expect(t.status).toBe(201);
    const preview = await admin.post('/report-templates/preview', { bodyHtml: body });
    expect(preview.body.html).toContain('HDFC FORMAT');

    const c = await inspected();
    await completePreliminary(fx, c.id);
    await completeFinal(fx, c.id);
    const final = (await as(fx.sr.token).get(`/cases/${c.id}/valuations`)).body.final.versions[0];
    const row = await prisma.valuationReportVersion.findUnique({ where: { id: final.id } });
    expect(row.templateVersionId).toBe(t.body.currentVersionId);

    const ok = await request(app).get(api(`/verify/${final.verificationCode}`));
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ valid: true, current: true, caseNumber: c.caseNumber, reportStatus: 'APPROVED' });
    expect(ok.body.documentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(ok.body)).not.toMatch(/marketValue|41626000|ABC Industries/);
    expect((await request(app).get(api('/verify/NOPE-NOPE-NOPE'))).status).toBe(404);
  }, 90_000);

  test('a valuer may attach their own PDF as a new version', async () => {
    const c = await inspected();
    await as(fx.jr.token).post(`/cases/${c.id}/transitions`, { action: 'START_PRELIMINARY' });
    await as(fx.jr.token).post(`/cases/${c.id}/valuations/preliminary/versions`, { inputs: LB_INPUTS });
    const up = await request(app).post(api(`/cases/${c.id}/valuations/preliminary/attachments`)).set('Authorization', `Bearer ${fx.jr.token}`).attach('file', PDF, 'signed-off.pdf');
    expect(up.status).toBe(201);
    expect(up.body.preliminary.versions[0]).toMatchObject({ version: 2, changeNote: 'Report PDF uploaded by valuer' });
  }, 60_000);
});
