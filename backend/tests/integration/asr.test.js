import { redis } from '../../src/database/redis.js';
import { testJobs } from '../../src/jobs/queues.js';
import { processRateSetJob } from '../../src/modules/asr/asr.service.js';
import { as, createEmployee, createFirm, prisma } from '../helpers.js';
import { setupFirm } from '../fixtures.js';
import { startFakeEasr } from '../easr-fake.js';

/**
 * IGR eASR integration against a local fake of the government site (tests/easr-fake.js).
 * Shared platform data: the first request fetches from "eASR", every later request — from any firm — is served
 * from our database.
 */

let server;
let fake;
let fx;
let otherJr;

async function resetAsrData() {
  await prisma.asrRateSet.deleteMany({});
  await prisma.asrVillage.deleteMany({});
  await prisma.asrTaluka.deleteMany({});
  await prisma.asrYear.deleteMany({});
  await prisma.asrDistrict.updateMany({ data: { talukasFetchedAt: null, govCode: null } });
}

/** Runs the queued eASR jobs (the BullMQ worker does this outside tests). */
async function runIgrJobs() {
  const out = [];
  for (let i = testJobs.length - 1; i >= 0; i -= 1) {
    if (testJobs[i].queue !== 'igr') continue;
    const [job] = testJobs.splice(i, 1);
    out.push(await processRateSetJob(job.data));
  }
  return out;
}
const queuedIgr = () => testJobs.filter((j) => j.queue === 'igr');

const ids = {};
async function lookups(token) {
  const d = (await as(token).get('/asr/districts')).body.items;
  ids.pune = d.find((x) => x.key === 'Pune').id;
  ids.akola = d.find((x) => x.key === 'Akola').id;
  return d;
}

beforeAll(async () => {
  server = await startFakeEasr();
  fake = server.fake;
  await resetAsrData();
  testJobs.length = 0;
  fx = await setupFirm();
  const other = await createFirm(fx.sa.token, `Second Valuers ${Date.now()}`);
  otherJr = await createEmployee(other.adminToken, ['JUNIOR_REVIEWER'], 'Other Junior');
}, 60_000);

afterAll(async () => {
  await server.close();
  await prisma.$disconnect();
  await redis.quit();
});

describe('locations', () => {
  test('districts are seeded; talukas and villages are fetched once and then shared by every firm', async () => {
    const districts = await lookups(fx.jr.token);
    expect(districts).toHaveLength(35);
    server.reset();

    const t = await as(fx.jr.token).get(`/asr/districts/${ids.pune}/talukas`);
    expect(t.status).toBe(200);
    expect(t.body.items.map((x) => x.name)).toEqual(['Haveli', 'Khed']);
    expect(fake.requests).toBe(2); // map page (session cookie) + district page
    expect((await as(otherJr.token).get(`/asr/districts/${ids.pune}/talukas`)).body.items).toHaveLength(2);
    expect(fake.requests).toBe(2); // the second firm is served from our database

    ids.khed = t.body.items.find((x) => x.name === 'Khed').id;
    ids.haveli = t.body.items.find((x) => x.name === 'Haveli').id;
    const v = await as(fx.jr.token).get(`/asr/talukas/${ids.khed}/villages`);
    expect(v.body.items.map((x) => x.code).sort((a, b) => a - b)).toEqual([295, 999, 5489]);
    expect(fake.requests).toBe(5);
    await as(otherJr.token).get(`/asr/talukas/${ids.khed}/villages`);
    expect(fake.requests).toBe(5);
    for (const x of v.body.items) ids[x.code] = x.id;
    for (const x of (await as(fx.jr.token).get(`/asr/talukas/${ids.haveli}/villages`)).body.items) ids[x.code] = x.id;

    expect((await as(fx.jr.token).get('/asr/years')).body).toEqual({ current: 13, items: [{ code: 13, label: '2026-2027', startYear: 2026 }, { code: 12, label: '2025-2026', startYear: 2025 }] });
  });

  test('an unreachable or unknown eASR district answers 503 and is logged', async () => {
    const r = await as(fx.jr.token).get(`/asr/districts/${ids.akola}/talukas`);
    expect(r.status).toBe(503);
    expect(r.body.message).toMatch(/eASR site could not be reached/);
    expect(await prisma.asrFetchLog.findFirst({ where: { kind: 'district', target: 'Akola', ok: false } })).toBeTruthy();
  });
});

describe('rates', () => {
  test('first request queues one fetch; the job stores rates and survey numbers; every firm then reads the database', async () => {
    const first = await as(fx.jr.token).get(`/asr/villages/${ids[295]}/rates`);
    expect(first.status).toBe(202);
    expect(first.body).toMatchObject({ status: 'PENDING', rates: [], year: { code: 13, label: '2026-2027' }, village: { code: 295 }, taluka: { name: 'Khed' }, district: { key: 'Pune' } });
    expect((await as(otherJr.token).get(`/asr/villages/${ids[295]}/rates`)).status).toBe(202);
    expect(await prisma.asrRateSet.count({ where: { villageId: ids[295] } })).toBe(1);
    expect(queuedIgr()[0]).toMatchObject({ name: 'fetch-rates', opts: { jobId: expect.stringMatching(/^easr-/) } });

    server.reset();
    const [result] = await runIgrJobs();
    expect(result).toMatchObject({ areaType: 'URBAN', rows: 7 });
    expect(fake.log).toEqual(expect.arrayContaining(['POST /eASR2.0/eASRCommon.aspx dg_Valuation2_0 Page$2', 'POST /eASR2.0/eASRCommon.aspx dg_Valuation2_0 Select$0']));

    const ready = await as(fx.jr.token).get(`/asr/villages/${ids[295]}/rates`);
    expect(ready.status).toBe(200);
    expect(ready.body).toMatchObject({ status: 'READY', areaType: 'URBAN', surveyNumbersStatus: 'READY', stale: false, source: { name: expect.stringMatching(/eASR/) } });
    expect(ready.body.rates).toHaveLength(7);
    expect(ready.body.rates[0]).toMatchObject({ zoneCode: '1', openLand: 13370, residential: 44280, office: 50930, shop: 55350, industrial: 0, unitCode: 'SQ_M', surveyNumbers: ['10', '493', '1173'], surveyNumbersFetched: true });
    expect(ready.body.rates[6]).toMatchObject({ zoneCode: '7', surveyNumbers: [] });

    const before = fake.requests;
    const shared = await as(otherJr.token).get(`/asr/villages/${ids[295]}/rates`);
    expect(shared.body.rates).toEqual(ready.body.rates);
    expect(fake.requests).toBe(before);
    expect(await prisma.asrFetchLog.findFirst({ where: { kind: 'rates', ok: true }, orderBy: { createdAt: 'desc' } })).toMatchObject({ requests: expect.any(Number) });
  });

  test('influence-area, rural and no-data villages', async () => {
    await as(fx.jr.token).get(`/asr/villages/${ids[7158]}/rates`);
    await as(fx.jr.token).get(`/asr/villages/${ids[5489]}/rates`);
    await as(fx.jr.token).get(`/asr/villages/${ids[999]}/rates`);
    await runIgrJobs();

    const inf = (await as(fx.jr.token).get(`/asr/villages/${ids[7158]}/rates`)).body;
    expect(inf).toMatchObject({ status: 'READY', areaType: 'INFLUENCE', locations: [{ code: 59915 }, { code: 59919 }] });
    expect(inf.rates).toHaveLength(4);
    expect(inf.rates.find((r) => r.zoneCode === '11/11.1')).toMatchObject({ locationCode: 59919, rate: 10510, surveyNumbers: ['43', '90', '140'] });
    expect(inf.rates.find((r) => r.zoneCode === '6/6.2')).toMatchObject({ rate: 21575000, unitCode: 'HECTARE' });

    const rural = (await as(fx.jr.token).get(`/asr/villages/${ids[5489]}/rates`)).body;
    expect(rural).toMatchObject({ areaType: 'RURAL', vibhagNo: '1', surveyNumbersStatus: 'READY' });
    expect(rural.rates.map((r) => [r.assessmentRange, r.rate])).toEqual([['0-1.25', 518000], ['1.26-2.50', 590000], ['0-7.50', 2014000]]);

    expect((await as(fx.jr.token).get(`/asr/villages/${ids[999]}/rates`)).body).toMatchObject({ status: 'READY', areaType: 'NONE', rates: [] });
  });

  test('an older statement year is selected through the year dropdown and stored separately', async () => {
    await as(fx.jr.token).get(`/asr/villages/${ids[295]}/rates?year=12`);
    server.reset();
    await runIgrJobs();
    expect(fake.log).toContain('POST /eASR2.0/eASRCommon.aspx ddlYear');
    const old = (await as(fx.jr.token).get(`/asr/villages/${ids[295]}/rates?year=12`)).body;
    expect(old).toMatchObject({ status: 'READY', year: { code: 12, label: '2025-2026' } });
    expect(old.rates[0].openLand).toBe(12033);
    expect((await as(fx.jr.token).get(`/asr/villages/${ids[295]}/rates?year=99`)).status).toBe(404);
  });

  test('a failed fetch is reported, not retried immediately, and retried after the cool-down', async () => {
    await as(fx.jr.token).get(`/asr/villages/${ids[5489]}/rates?year=12`);
    fake.down = true;
    await expect(runIgrJobs()).rejects.toThrow(/503/);
    const failed = await as(fx.jr.token).get(`/asr/villages/${ids[5489]}/rates?year=12`);
    expect(failed.status).toBe(202);
    expect(failed.body).toMatchObject({ status: 'FAILED', lastError: expect.stringMatching(/503/) });
    expect(queuedIgr()).toHaveLength(0); // no hammering of the government site

    fake.down = false;
    await prisma.$executeRaw`UPDATE asr_rate_sets SET updated_at = now() - interval '11 minutes' WHERE village_id = ${ids[5489]}::uuid AND year_code = 12`;
    expect((await as(fx.jr.token).get(`/asr/villages/${ids[5489]}/rates?year=12`)).body.status).toBe('PENDING');
    expect(queuedIgr()).toHaveLength(1);
    await runIgrJobs();
    expect((await as(fx.jr.token).get(`/asr/villages/${ids[5489]}/rates?year=12`)).body).toMatchObject({ status: 'READY', rates: [expect.objectContaining({ rate: 466200 }), expect.anything(), expect.anything()] });
  });

  test('a stale current-year statement is still served while a background refresh is queued', async () => {
    await prisma.$executeRaw`UPDATE asr_rate_sets SET fetched_at = now() - interval '40 days' WHERE village_id = ${ids[295]}::uuid AND year_code = 13`;
    const r = await as(fx.jr.token).get(`/asr/villages/${ids[295]}/rates`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'READY', stale: true });
    expect(r.body.rates).toHaveLength(7);
    expect(queuedIgr()).toHaveLength(1);
    await runIgrJobs();
    expect((await as(fx.jr.token).get(`/asr/villages/${ids[295]}/rates`)).body.stale).toBe(false);

    // Past years never go stale.
    await prisma.$executeRaw`UPDATE asr_rate_sets SET fetched_at = now() - interval '400 days' WHERE village_id = ${ids[295]}::uuid AND year_code = 12`;
    expect((await as(fx.jr.token).get(`/asr/villages/${ids[295]}/rates?year=12`)).body.stale).toBe(false);
    expect(queuedIgr()).toHaveLength(0);
  });
});

describe('access', () => {
  test('clients have no access; only the Superadmin refreshes and sees the fetch status', async () => {
    expect((await as(fx.client.token).get('/asr/districts')).status).toBe(403);
    expect((await as(fx.admin).post(`/asr/villages/${ids[295]}/refresh`, {})).status).toBe(403);
    expect((await as(fx.admin).get('/asr/status')).status).toBe(403);
    expect((await as(fx.sa.token).get('/asr/districts')).status).toBe(200);

    const r = await as(fx.sa.token).post(`/asr/villages/${ids[295]}/refresh`, {});
    expect(r.status).toBe(202);
    expect(queuedIgr()).toHaveLength(1);
    expect(await prisma.auditLog.findFirst({ where: { action: 'ASR_REFRESH_REQUESTED' }, orderBy: { createdAt: 'desc' } })).toBeTruthy();
    await runIgrJobs();

    const s = await as(fx.sa.token).get('/asr/status');
    expect(s.body).toMatchObject({ enabled: true, counts: { districts: 35, rateSets: { READY: expect.any(Number) } }, last24h: { requests: expect.any(Number) } });
    expect(s.body.recent.length).toBeGreaterThan(0);
  });
});
