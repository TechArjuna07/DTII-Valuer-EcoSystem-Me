import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { prisma } from '../../database/prisma.js';
import { redis } from '../../database/redis.js';
import { enqueue } from '../../jobs/queues.js';
import { recordAudit } from '../../services/audit.service.js';
import { NotFound, ServiceUnavailable } from '../../utils/errors.js';
import { crawlRates, fetchDistrict, fetchVillages } from '../../services/igr/easr.crawler.js';

/**
 * IGR Maharashtra eASR rates as shared platform data.
 *
 * Every lookup reads our database first. Only data we do not have yet is fetched from the government site:
 *   - talukas / villages: fetched synchronously on first use (1–3 requests), then served from the database;
 *   - a village's rates for a statement year: fetched by the background "igr" queue (a statement can take dozens
 *     of requests), stored, and served to every firm from then on. The caller gets status PENDING/FETCHING and polls.
 * Current-year statements older than IGR_EASR_REFRESH_DAYS are refreshed in the background while the cached copy
 * keeps being served; past years never change and are never refetched automatically.
 */

const SOURCE = { name: 'IGR Maharashtra eASR 2.0 (Beta)', url: 'https://igreval.maharashtra.gov.in/eASR2.0/' };
const RETRY_FAILED_AFTER_MS = 10 * 60_000;
const STUCK_AFTER_MS = 30 * 60_000;
const lockKey = (k) => `${env.QUEUE_PREFIX}:igr:lock:${k}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function assertEnabled() {
  if (!env.IGR_EASR_ENABLED) throw ServiceUnavailable('IGR eASR lookups are switched off on this platform');
}

const unavailable = (e) => ServiceUnavailable(`The IGR eASR site could not be reached (${e.message}). Please try again in a few minutes.`);

async function logFetch(kind, target, started, { ok, requests = 0, error = null, rateSetId = null }) {
  await prisma.asrFetchLog
    .create({ data: { kind, target: target.slice(0, 200), rateSetId, ok, requests, durationMs: Date.now() - started, error: error ? String(error).slice(0, 500) : null } })
    .catch((e) => logger.warn({ err: e.message }, 'eASR fetch log failed'));
}

/**
 * Runs `load` once across all processes for `key`; concurrent callers wait for the first one and then re-read
 * the database (`ready`) instead of calling the government site again.
 */
async function singleFlight(key, ready, load) {
  for (let waited = 0; waited < 60_000; waited += 500) {
    if (await ready()) return;
    if (await redis.set(lockKey(key), '1', 'PX', 90_000, 'NX')) {
      try {
        if (!(await ready())) await load();
      } finally {
        await redis.del(lockKey(key));
      }
      return;
    }
    await sleep(500);
  }
  throw ServiceUnavailable('The eASR data is still loading. Please try again shortly.');
}

async function storeYears(years) {
  for (const y of years) await prisma.asrYear.upsert({ where: { govCode: y.code }, update: { label: y.label, startYear: y.startYear }, create: { govCode: y.code, label: y.label, startYear: y.startYear } });
}

// ─────────────── Locations ───────────────

async function listDistricts() {
  const rows = await prisma.asrDistrict.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { talukas: true } } } });
  return { items: rows.map((d) => ({ id: d.id, key: d.key, name: d.name, talukasLoaded: !!d.talukasFetchedAt, talukaCount: d._count.talukas })) };
}

async function listTalukas(districtId) {
  const district = await prisma.asrDistrict.findUnique({ where: { id: districtId } });
  if (!district) throw NotFound('District not found');
  const ready = async () => !!(await prisma.asrDistrict.findUnique({ where: { id: districtId }, select: { talukasFetchedAt: true } }))?.talukasFetchedAt;
  if (!district.talukasFetchedAt) {
    assertEnabled();
    await singleFlight(`district:${districtId}`, ready, async () => {
      const t0 = Date.now();
      try {
        const d = await fetchDistrict(district.key);
        await storeYears(d.years);
        await prisma.$transaction(async (tx) => {
          for (const t of d.talukas) await tx.asrTaluka.upsert({ where: { districtId_govCode: { districtId, govCode: t.code } }, update: { name: t.name }, create: { districtId, govCode: t.code, name: t.name } });
          await tx.asrDistrict.update({ where: { id: districtId }, data: { talukasFetchedAt: new Date(), govCode: d.districtCode } });
        });
        await logFetch('district', district.key, t0, { ok: true, requests: d.requests });
      } catch (e) {
        await logFetch('district', district.key, t0, { ok: false, error: e.message });
        throw unavailable(e);
      }
    });
  }
  const rows = await prisma.asrTaluka.findMany({ where: { districtId }, orderBy: { name: 'asc' } });
  return { items: rows.map((t) => ({ id: t.id, code: t.govCode, name: t.name, villagesLoaded: !!t.villagesFetchedAt })) };
}

async function listVillages(talukaId) {
  const taluka = await prisma.asrTaluka.findUnique({ where: { id: talukaId }, include: { district: true } });
  if (!taluka) throw NotFound('Taluka not found');
  const ready = async () => !!(await prisma.asrTaluka.findUnique({ where: { id: talukaId }, select: { villagesFetchedAt: true } }))?.villagesFetchedAt;
  if (!taluka.villagesFetchedAt) {
    assertEnabled();
    await singleFlight(`taluka:${talukaId}`, ready, async () => {
      const t0 = Date.now();
      const target = `${taluka.district.key}/${taluka.govCode}`;
      try {
        const v = await fetchVillages({ districtKey: taluka.district.key, talukaCode: taluka.govCode });
        await storeYears(v.years);
        await prisma.$transaction(async (tx) => {
          for (const x of v.villages) await tx.asrVillage.upsert({ where: { talukaId_govCode: { talukaId, govCode: x.code } }, update: { name: x.name }, create: { talukaId, govCode: x.code, name: x.name } });
          await tx.asrTaluka.update({ where: { id: talukaId }, data: { villagesFetchedAt: new Date() } });
        });
        await logFetch('villages', target, t0, { ok: true, requests: v.requests });
      } catch (e) {
        await logFetch('villages', target, t0, { ok: false, error: e.message });
        throw unavailable(e);
      }
    });
  }
  const rows = await prisma.asrVillage.findMany({ where: { talukaId }, orderBy: { name: 'asc' } });
  return { items: rows.map((v) => ({ id: v.id, code: v.govCode, name: v.name })) };
}

async function listYears() {
  const rows = await prisma.asrYear.findMany({ orderBy: { startYear: 'desc' } });
  return { items: rows.map((y) => ({ code: y.govCode, label: y.label, startYear: y.startYear })), current: rows[0]?.govCode ?? null };
}

// ─────────────── Rates ───────────────

const n = (d) => (d == null ? null : Number(d));

function rateView(r) {
  return {
    seq: r.seq,
    locationCode: r.locationCode,
    locationName: r.locationName,
    zoneCode: r.zoneCode,
    zoneName: r.zoneName,
    openLand: n(r.openLand),
    residential: n(r.residential),
    office: n(r.office),
    shop: n(r.shop),
    industrial: n(r.industrial),
    rate: n(r.rate),
    assessmentType: r.assessmentType,
    assessmentRange: r.assessmentRange,
    unit: r.unit,
    unitCode: r.unitCode,
    surveyNumbers: r.surveyNumbers,
    surveyNumbersFetched: r.surveyNumbersFetched,
  };
}

async function isCurrentYear(yearCode) {
  const latest = await prisma.asrYear.findFirst({ orderBy: { startYear: 'desc' } });
  return latest?.govCode === yearCode;
}

async function isStale(set) {
  if (set.status !== 'READY' || !set.fetchedAt) return false;
  if (Date.now() - set.fetchedAt.getTime() < env.IGR_EASR_REFRESH_DAYS * 86_400_000) return false;
  return isCurrentYear(set.yearCode);
}

async function queueFetch(rateSetId) {
  // removeOnComplete/Fail free the jobId so a later refresh can be queued; while queued or running, the jobId
  // de-duplicates requests from every firm.
  await enqueue('igr', 'fetch-rates', { rateSetId }, { jobId: `easr-${rateSetId}`, attempts: 3, backoff: { type: 'exponential', delay: 60_000 }, removeOnComplete: true, removeOnFail: true });
}

async function rateSetView(set, village) {
  const year = await prisma.asrYear.findUnique({ where: { govCode: set.yearCode } });
  const rates = set.status === 'READY' ? await prisma.asrRate.findMany({ where: { rateSetId: set.id }, orderBy: { seq: 'asc' } }) : [];
  return {
    village: { id: village.id, code: village.govCode, name: village.name },
    taluka: { id: village.taluka.id, code: village.taluka.govCode, name: village.taluka.name },
    district: { id: village.taluka.district.id, key: village.taluka.district.key, name: village.taluka.district.name },
    year: year ? { code: year.govCode, label: year.label } : { code: set.yearCode, label: null },
    status: set.status,
    areaType: set.areaType,
    vibhagNo: set.vibhagNo,
    locations: set.locations,
    surveyNumbersStatus: set.surveyNumbersStatus,
    fetchedAt: set.fetchedAt,
    stale: await isStale(set),
    lastError: set.status === 'FAILED' ? set.lastError : null,
    source: SOURCE,
    rates: rates.map(rateView),
  };
}

async function loadVillage(villageId) {
  const village = await prisma.asrVillage.findUnique({ where: { id: villageId }, include: { taluka: { include: { district: true } } } });
  if (!village) throw NotFound('Village not found');
  return village;
}

/**
 * Rates of a village for a statement year (default: the latest year eASR offers). Served from the database;
 * queued for fetching when we do not have them yet (status PENDING / FETCHING — poll again).
 */
async function getRates(villageId, yearCode) {
  const village = await loadVillage(villageId);
  const year = yearCode ?? (await listYears()).current;
  if (!year || !(await prisma.asrYear.findUnique({ where: { govCode: year } }))) throw NotFound('Unknown eASR statement year');

  let set = await prisma.asrRateSet.findUnique({ where: { villageId_yearCode: { villageId, yearCode: year } } });
  if (!set) {
    assertEnabled();
    set = await prisma.asrRateSet.upsert({ where: { villageId_yearCode: { villageId, yearCode: year } }, update: {}, create: { villageId, yearCode: year } });
    await queueFetch(set.id);
  } else if (env.IGR_EASR_ENABLED) {
    const age = Date.now() - set.updatedAt.getTime();
    const retry = (set.status === 'FAILED' && age > RETRY_FAILED_AFTER_MS) || (['PENDING', 'FETCHING'].includes(set.status) && age > STUCK_AFTER_MS);
    if (retry) {
      set = await prisma.asrRateSet.update({ where: { id: set.id }, data: { status: set.status === 'FAILED' ? 'PENDING' : set.status, requestedAt: new Date() } });
      await queueFetch(set.id);
    } else if ((await isStale(set)) || (set.status === 'READY' && set.surveyNumbersStatus === 'FAILED' && age > RETRY_FAILED_AFTER_MS)) {
      await queueFetch(set.id);
    }
  }
  return rateSetView(set, village);
}

/** Superadmin: fetch again from eASR now (the cached copy stays visible until the new one is stored). */
async function refreshRates(principal, villageId, yearCode, req) {
  assertEnabled();
  const village = await loadVillage(villageId);
  const year = yearCode ?? (await listYears()).current;
  if (!year) throw NotFound('Unknown eASR statement year');
  const set = await prisma.asrRateSet.upsert({ where: { villageId_yearCode: { villageId, yearCode: year } }, update: { requestedAt: new Date() }, create: { villageId, yearCode: year } });
  await queueFetch(set.id);
  await recordAudit({ action: 'ASR_REFRESH_REQUESTED', principal, req, entityType: 'asr_rate_set', entityId: set.id, meta: { village: village.name, yearCode: year } });
  return rateSetView(set, village);
}

/**
 * Job processor ("igr" queue, concurrency 1): fetches one village statement from eASR and stores it.
 * Rates become visible as soon as they are read; survey numbers follow row by row.
 */
async function processRateSetJob({ rateSetId }) {
  const set = await prisma.asrRateSet.findUnique({ where: { id: rateSetId }, include: { village: { include: { taluka: { include: { district: true } } } } } });
  if (!set) return { skipped: 'missing' };
  if (set.status === 'READY' && !(await isStale(set)) && set.surveyNumbersStatus !== 'FAILED' && set.requestedAt <= set.fetchedAt) return { skipped: 'fresh' };
  const t0 = Date.now();
  const { village } = set;
  const target = { districtKey: village.taluka.district.key, talukaCode: village.taluka.govCode, villageCode: village.govCode, yearCode: set.yearCode };
  const label = `${target.districtKey}/${target.talukaCode}/${target.villageCode}/${target.yearCode}`;
  const firstFetch = set.status !== 'READY';
  await prisma.asrRateSet.update({ where: { id: rateSetId }, data: { attempts: { increment: 1 }, ...(firstFetch ? { status: 'FETCHING' } : {}) } });

  let ratesStored = false;
  try {
    const result = await crawlRates(target, {
      onRates: async ({ areaType, vibhagNo, locations, rows }) => {
        const needSurvey = rows.some((r) => r.gridRow != null);
        await prisma.$transaction(async (tx) => {
          await tx.asrRate.deleteMany({ where: { rateSetId } });
          if (rows.length) {
            await tx.asrRate.createMany({
              data: rows.map((r) => ({
                rateSetId,
                seq: r.seq,
                locationCode: r.locationCode ?? null,
                locationName: r.locationName ?? null,
                zoneCode: r.zoneCode ?? null,
                zoneName: r.zoneName ?? null,
                openLand: r.openLand ?? null,
                residential: r.residential ?? null,
                office: r.office ?? null,
                shop: r.shop ?? null,
                industrial: r.industrial ?? null,
                rate: r.rate ?? null,
                assessmentType: r.assessmentType ?? null,
                assessmentRange: r.assessmentRange ?? null,
                unit: r.unit ?? null,
                unitCode: r.unitCode ?? null,
                gridPage: r.gridRow != null ? r.gridPage : null,
                gridRow: r.gridRow,
              })),
            });
          }
          await tx.asrRateSet.update({
            where: { id: rateSetId },
            data: { status: 'READY', areaType, vibhagNo, locations: locations.map((l) => ({ code: l.code, name: l.name })), fetchedAt: new Date(), lastError: null, surveyNumbersStatus: needSurvey ? 'FETCHING' : 'READY' },
          });
        });
        ratesStored = true;
      },
      onSurvey: async (seq, numbers) => {
        await prisma.asrRate.update({ where: { rateSetId_seq: { rateSetId, seq } }, data: { surveyNumbers: numbers, surveyNumbersFetched: true } });
      },
    });
    await prisma.asrRateSet.update({ where: { id: rateSetId }, data: { surveyNumbersStatus: 'READY' } });
    await logFetch('rates', label, t0, { ok: true, requests: result.requests, rateSetId });
    return result;
  } catch (e) {
    await logFetch('rates', label, t0, { ok: false, error: e.message, rateSetId });
    if (ratesStored) {
      // Rates are stored; only survey numbers are incomplete. Keep the statement usable, retry later via getRates.
      await prisma.asrRateSet.update({ where: { id: rateSetId }, data: { surveyNumbersStatus: 'FAILED', lastError: e.message.slice(0, 500) } });
      return { partial: true };
    }
    await prisma.asrRateSet.update({ where: { id: rateSetId }, data: { ...(firstFetch ? { status: 'FAILED' } : {}), lastError: e.message.slice(0, 500) } });
    throw e;
  }
}

/** Superadmin: cache coverage and recent government-site traffic. */
async function status() {
  const [districts, talukas, villages, sets, logs, last24h] = await Promise.all([
    prisma.asrDistrict.count(),
    prisma.asrTaluka.count(),
    prisma.asrVillage.count(),
    prisma.asrRateSet.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.asrFetchLog.findMany({ orderBy: { createdAt: 'desc' }, take: 25 }),
    prisma.asrFetchLog.aggregate({ where: { createdAt: { gte: new Date(Date.now() - 86_400_000) } }, _sum: { requests: true }, _count: { _all: true } }),
  ]);
  return {
    enabled: env.IGR_EASR_ENABLED,
    source: SOURCE,
    minIntervalMs: env.IGR_EASR_MIN_INTERVAL_MS,
    refreshDays: env.IGR_EASR_REFRESH_DAYS,
    counts: { districts, talukas, villages, rateSets: Object.fromEntries(sets.map((s) => [s.status, s._count._all])) },
    last24h: { fetches: last24h._count._all, requests: last24h._sum.requests ?? 0 },
    recent: logs.map((l) => ({ kind: l.kind, target: l.target, ok: l.ok, requests: l.requests, durationMs: l.durationMs, error: l.error, at: l.createdAt })),
  };
}

export { listDistricts, listTalukas, listVillages, listYears, getRates, refreshRates, processRateSetJob, status, SOURCE };
