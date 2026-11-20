import { redis } from '../../src/database/redis.js';
import { as, createEmployee, prisma } from '../helpers.js';
import { closeRenderer } from '../../src/services/pdf/pdf-renderer.js';
import { completeInspection, completePreliminary, createCaseWithTeam, LAND_PROPERTY, setupFirm, uploadPhoto } from '../fixtures.js';

let fx;
let otherFo;

beforeAll(async () => {
  fx = await setupFirm();
  otherFo = await createEmployee(fx.admin, ['FIELD_OFFICER'], 'Other Officer');
});

afterAll(async () => {
  await closeRenderer();
  await prisma.$disconnect();
  await redis.quit();
});

describe('property details (configurable category fields)', () => {
  test('validates types, options and unknown keys against the category definition', async () => {
    const c = await createCaseWithTeam(fx);
    const def = await as(fx.mk.token).get(`/cases/${c.id}/property`);
    expect(def.body.fields.find((f) => f.key === 'propertyType').options).toContain('Open Plot');
    expect(def.body.canEdit).toBe(true);
    const bad = await as(fx.mk.token).put(`/cases/${c.id}/property`, { data: { propertyType: 'Castle', landArea: -5, hacked: 'x' } });
    expect(bad.status).toBe(400);
    expect(bad.body.message.join(' ')).toMatch(/hacked is not a field/);
    const ok = await as(fx.mk.token).put(`/cases/${c.id}/property`, { data: LAND_PROPERTY });
    expect(ok.status).toBe(200);
    expect(ok.body.missingRequired).toEqual([]);
    expect((await as(otherFo.token).put(`/cases/${c.id}/property`, { data: LAND_PROPERTY })).status).toBe(404);
  });
});

describe('inspection workflow', () => {
  test('scheduling starts the stage; only the assigned field officer can work on it', async () => {
    const c = await createCaseWithTeam(fx);
    expect((await as(fx.mk.token).post(`/cases/${c.id}/inspection/schedule`, { scheduledAt: new Date().toISOString() })).status).toBe(403);
    const s = await as(fx.fo.token).post(`/cases/${c.id}/inspection/schedule`, { scheduledAt: new Date().toISOString() });
    expect(s.status).toBe(200);
    expect(s.body.caseStatus).toBe('INSPECTION_IN_PROGRESS');
    expect(s.body.current.scheduledAt).toBeTruthy();
    const mine = await as(fx.fo.token).get('/inspections/mine');
    expect(mine.body.today.map((x) => x.id)).toContain(c.id);
    const tl = await as(fx.client.token).get(`/cases/${c.id}/timeline`);
    expect(tl.body.items.map((i) => i.action)).toContain('INSPECTION_SCHEDULED');
  });

  test('submission is refused until the report is complete (server-side checks)', async () => {
    const c = await createCaseWithTeam(fx);
    await as(fx.fo.token).post(`/cases/${c.id}/inspection/start`);
    const early = await as(fx.fo.token).post(`/cases/${c.id}/inspection/submit`);
    expect(early.status).toBe(400);
    expect(early.body.message.join(' ')).toMatch(/Required property details/);
    expect(early.body.message.join(' ')).toMatch(/GPS/);
    expect(early.body.message.join(' ')).toMatch(/photograph/);
    const status = (await as(fx.fo.token).get(`/cases/${c.id}`)).body.status;
    expect(status).toBe('INSPECTION_IN_PROGRESS');
  });

  test('GPS can be declined with a reason; a complete report moves the case to INSPECTION_COMPLETED', async () => {
    const c = await createCaseWithTeam(fx);
    await as(fx.fo.token).post(`/cases/${c.id}/inspection/start`);
    const declined = await as(fx.fo.token).put(`/cases/${c.id}/inspection`, { gpsConsent: false, gpsDeclinedReason: 'Owner refused location capture' });
    expect(declined.body.readiness.checks.find((x) => x.key === 'gps').ok).toBe(true);
    expect((await as(fx.fo.token).put(`/cases/${c.id}/inspection`, { gpsLat: 123 })).status).toBe(400);

    const submitted = await completeInspection(fx, c.id);
    expect(submitted.status).toBe(200);
    expect(submitted.body.caseStatus).toBe('INSPECTION_COMPLETED');
    expect(submitted.body.current.status).toBe('SUBMITTED');
    expect(submitted.body.current.photos).toHaveLength(3);
    expect(submitted.body.canEdit).toBe(false);
    // photos are real repository documents
    const tree = await as(fx.fo.token).get(`/cases/${c.id}/documents`);
    expect(tree.body.folders.find((f) => f.code === 'PROPERTY_PHOTOGRAPHS').documents).toHaveLength(3);
    // after submission the officer can no longer change findings
    expect((await as(fx.fo.token).put(`/cases/${c.id}/inspection`, { condition: 'POOR' })).status).toBe(409);
    expect((await uploadPhoto(fx.fo.token, c.id)).status).toBe(409);
    // reviewers can read it
    expect((await as(fx.jr.token).get(`/cases/${c.id}/inspection`)).body.current.condition).toBe('GOOD');
  });

  test('a re-inspection requested by the senior reviewer opens a new round and keeps the old one', async () => {
    const c = await createCaseWithTeam(fx);
    await completeInspection(fx, c.id);
    await completePreliminary(fx, c.id);
    await as(fx.sr.token).post(`/cases/${c.id}/transitions`, { action: 'START_FINAL_REVIEW' });
    const re = await as(fx.sr.token).post(`/cases/${c.id}/transitions`, { action: 'REQUEST_REINSPECTION', remarks: 'Rear structure not photographed' });
    expect(re.body.status).toBe('INSPECTION_IN_PROGRESS');
    const draft = await as(fx.fo.token).put(`/cases/${c.id}/inspection`, { officerRemarks: 'Rear structure covered' });
    expect(draft.body.current.round).toBe(2);
    expect(draft.body.current.condition).toBe('GOOD'); // carried over
    expect(draft.body.current.photos).toHaveLength(0);
    expect(draft.body.previousRounds).toHaveLength(1);
  }, 60_000);
});
