import { EasrError, EasrSession } from './easr.client.js';
import { EASR_FIELD_PREFIX as P, detectAreaType, parseGrid, parseMessages, parseSelect, parseSurveyNumbers, parseVibhagNo, parseYears } from './easr.parser.js';

/**
 * High-level eASR operations built on EasrSession. Each function opens its own browser-like session and follows
 * exactly the clicks a user makes on the site (see the eASR 2.0 user manual):
 *   district page → [year] → taluka → village → (influence: land category) → grid pages → "SurveyNo" per row.
 */

const MAX_PAGES = 200;
const MAX_ROWS = 5000;
const field = (name) => `${P}${name}`;

/** Talukas, statement years and the government district code of one district. */
async function fetchDistrict(districtKey, opts = {}) {
  const s = new EasrSession(opts);
  const html = await s.open(districtKey);
  const district = parseSelect(html, 'ddlDistrict');
  const talukas = parseSelect(html, 'ddlTaluka')?.options ?? [];
  if (!talukas.length) throw new EasrError(`eASR lists no talukas for ${districtKey}`, { retryable: false });
  const { years, selected } = parseYears(html);
  return { districtCode: typeof district?.selected === 'number' ? district.selected : null, talukas, years, currentYear: selected, requests: s.requests };
}

async function openTaluka(s, { districtKey, talukaCode, yearCode }) {
  const html = await s.open(districtKey);
  const { selected } = parseYears(html);
  if (yearCode && Number(selected) !== Number(yearCode)) await s.postback(field('ddlYear'), '', { [field('ddlYear')]: String(yearCode) });
  return s.postback(field('ddlTaluka'), '', { [field('ddlTaluka')]: String(talukaCode) });
}

/** Villages of one taluka. */
async function fetchVillages({ districtKey, talukaCode }, opts = {}) {
  const s = new EasrSession(opts);
  const panel = await openTaluka(s, { districtKey, talukaCode });
  const villages = parseSelect(panel, 'ddlVillage')?.options ?? [];
  return { villages, years: parseYears(s.html).years, requests: s.requests };
}

/** Walks every page of the grid currently shown; rows get gridPage set. */
async function crawlPages(s, html, areaType) {
  let g = parseGrid(html, areaType);
  const rows = g.rows.map((r) => ({ ...r, gridPage: g.currentPage }));
  const seen = new Set([g.currentPage]);
  const gridName = g.gridName;
  for (let n = 0; n < MAX_PAGES && gridName; n += 1) {
    const next = g.pages.find((p) => !seen.has(p));
    if (next == null) break;
    const page = await s.postback(gridName, `Page$${next}`);
    g = parseGrid(page, areaType);
    seen.add(next);
    seen.add(g.currentPage);
    rows.push(...g.rows.map((r) => ({ ...r, gridPage: g.currentPage })));
    if (rows.length > MAX_ROWS) throw new EasrError('eASR grid larger than expected', { retryable: false });
  }
  return { gridName, rows, lastPage: g.currentPage };
}

/**
 * Reads the survey numbers of each row (row "SurveyNo" link → textarea). `rows` must come from crawlPages on the
 * grid currently displayed; onRow(row, numbers) is called as each row completes.
 */
async function crawlSurveyNumbers(s, gridName, rows, currentPage, onRow) {
  let page = currentPage;
  const byPage = new Map();
  for (const r of rows) if (r.gridRow != null) byPage.set(r.gridPage, [...(byPage.get(r.gridPage) ?? []), r]);
  for (const [p, list] of [...byPage].sort((a, b) => a[0] - b[0])) {
    if (p !== page) {
      await s.postback(gridName, `Page$${p}`);
      page = p;
    }
    for (const r of list) {
      const html = await s.postback(gridName, `Select$${r.gridRow}`);
      await onRow(r, parseSurveyNumbers(html) ?? []);
    }
  }
}

/**
 * Full rate statement of one village for one year.
 * @param {{ districtKey: string, talukaCode: number, villageCode: number, yearCode: number }} target
 * @param {{ onRates: (result) => Promise<void>, onSurvey?: (seq: number, numbers: string[]) => Promise<void>, sessionOpts?: object }} hooks
 *   onRates receives { areaType, vibhagNo, locations, rows[{ seq, … }] } as soon as all rates are read;
 *   survey numbers are then read row by row and reported through onSurvey.
 * @returns {Promise<{ areaType: string, rows: number, requests: number }>}
 */
async function crawlRates(target, { onRates, onSurvey, sessionOpts } = {}) {
  const s = new EasrSession(sessionOpts);
  await openTaluka(s, target);
  const villageHtml = await s.postback(field('ddlVillage'), '', { [field('ddlVillage')]: String(target.villageCode) });
  const areaType = detectAreaType(villageHtml);
  let seq = 0;
  const tag = (rows, extra = {}) => rows.map((r) => ({ ...r, ...extra, seq: seq++ }));

  if (areaType === 'NONE') {
    await onRates({ areaType, vibhagNo: null, locations: [], rows: [], messages: parseMessages(villageHtml) });
    return { areaType, rows: 0, requests: s.requests };
  }

  if (areaType === 'URBAN' || areaType === 'RURAL') {
    const vibhagNo = areaType === 'RURAL' ? parseVibhagNo(villageHtml) : null;
    const { gridName, rows, lastPage } = await crawlPages(s, villageHtml, areaType);
    const tagged = tag(rows);
    await onRates({ areaType, vibhagNo, locations: [], rows: tagged });
    if (onSurvey && tagged.some((r) => r.gridRow != null)) await crawlSurveyNumbers(s, gridName, tagged, lastPage, (r, n) => onSurvey(r.seq, n));
    return { areaType, rows: tagged.length, requests: s.requests };
  }

  // INFLUENCE: one grid per land category ("location").
  const locations = parseSelect(villageHtml, 'ddlLocationName')?.options ?? [];
  const perLocation = [];
  for (const loc of locations) {
    const html = await s.postback(field('ddlLocationName'), '', { [field('ddlLocationName')]: String(loc.code), [field('grpSurveyLocation')]: 'rdbLocation' });
    const { gridName, rows, lastPage } = await crawlPages(s, html, 'INFLUENCE');
    perLocation.push({ loc, gridName, rows: tag(rows, { locationCode: loc.code, locationName: loc.name }), lastPage });
  }
  const all = perLocation.flatMap((x) => x.rows);
  await onRates({ areaType, vibhagNo: null, locations, rows: all });
  if (onSurvey) {
    for (const x of perLocation) {
      if (!x.rows.some((r) => r.gridRow != null)) continue;
      await s.postback(field('ddlLocationName'), '', { [field('ddlLocationName')]: String(x.loc.code), [field('grpSurveyLocation')]: 'rdbLocation' });
      await crawlSurveyNumbers(s, x.gridName, x.rows, 1, (r, n) => onSurvey(r.seq, n));
    }
  }
  return { areaType, rows: all.length, requests: s.requests };
}

export { fetchDistrict, fetchVillages, crawlRates };
