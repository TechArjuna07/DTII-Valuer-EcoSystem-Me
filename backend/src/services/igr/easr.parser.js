import * as cheerio from 'cheerio';

/**
 * Parsers for the IGR Maharashtra eASR 2.0 pages (ASP.NET WebForms, eASRCommon.aspx).
 * Pure functions: input is HTML / MS-AJAX delta text exactly as returned by the site, output is plain data.
 *
 * Page anatomy (verified against the live site, Nov 2026):
 *   ddlYear (value 13 = "2026-2027"), ddlLanguage, ddlDistrict (disabled), ddlTaluka, ddlVillage
 *   URBAN      grid dg_Valuation2_0: Select | उपविभाग | खुली जमीन | निवासी सदनिका | ऑफ़ीस | दुकाने | औद्योगिक | एकक
 *   INFLUENCE  ddlLocationName (land category) → grid grdInfSublocationWiseRate: Select | विभाग नं. | उपविभाग | दर | एकक
 *   RURAL      lblVibhagNo + grid ruralDataGrid: Assesment Type | Assesment Range | Rate Rs/- | Unit
 *   Survey numbers of a row: postback Select$<row> on the grid → read-only textarea txt_survy…
 *   Paging: postback Page$<n> on the grid (requires the MyCustomSessionId cookie set by frmMap.aspx).
 */

const P = 'ctl00$ContentPlaceHolder5$';
const ID = 'ctl00_ContentPlaceHolder5_';

// \s also matches the non-breaking spaces (&nbsp;) the site pads cells with.
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** Hidden form fields of a full page (__VIEWSTATE, __EVENTVALIDATION, …). */
function parseHiddenFields(html) {
  const $ = cheerio.load(html);
  const out = {};
  $('input[type="hidden"]').each((_i, el) => {
    const name = $(el).attr('name');
    if (name) out[name] = $(el).attr('value') ?? '';
  });
  return out;
}

/**
 * MS-AJAX partial-postback response: a sequence of `length|type|id|content|` records, where length counts the
 * characters of content (which may itself contain "|").
 * @returns {{ panels: Record<string,string>, hidden: Record<string,string>, redirect: string|null, error: string|null }}
 */
function parseDelta(text) {
  const panels = {};
  const hidden = {};
  let redirect = null;
  let error = null;
  let i = 0;
  while (i < text.length) {
    const a = text.indexOf('|', i);
    if (a < 0) break;
    const len = Number(text.slice(i, a));
    const b = text.indexOf('|', a + 1);
    const c = text.indexOf('|', b + 1);
    if (!Number.isInteger(len) || b < 0 || c < 0) throw new Error('Malformed eASR partial response');
    const type = text.slice(a + 1, b);
    const id = text.slice(b + 1, c);
    const content = text.slice(c + 1, c + 1 + len);
    if (type === 'updatePanel') panels[id] = content;
    else if (type === 'hiddenField') hidden[id] = content;
    else if (type === 'pageRedirect') redirect = decodeURIComponent(content);
    else if (type === 'error') error = content;
    i = c + 1 + len + 1;
  }
  return { panels, hidden, redirect, error };
}

/** Options of a <select> by its short id (e.g. "ddlTaluka"); placeholder options ("- - Select … - -") are dropped. */
function parseSelect(html, shortId) {
  const $ = cheerio.load(html);
  const sel = $(`#${ID}${shortId}`);
  if (!sel.length) return null;
  const options = [];
  let selected = null;
  sel.find('option').each((_i, el) => {
    const value = clean($(el).attr('value'));
    const name = clean($(el).text());
    if ($(el).attr('selected') !== undefined) selected = value;
    if (/^\d+$/.test(value) && name) options.push({ code: Number(value), name });
  });
  return { selected: selected && /^\d+$/.test(selected) ? Number(selected) : selected, options, disabled: sel.attr('disabled') !== undefined };
}

/** eASR statement years: [{ code: 13, label: "2026-2027", startYear: 2026 }]. */
function parseYears(html) {
  const s = parseSelect(html, 'ddlYear');
  if (!s) return { selected: null, years: [] };
  const years = s.options.filter((o) => /^\d{4}-\d{4}$/.test(o.name)).map((o) => ({ code: o.code, label: o.name, startYear: Number(o.name.slice(0, 4)) }));
  return { selected: s.selected, years };
}

/**
 * Values a browser would submit for the form controls inside `html` (enabled selects, checked radios, text inputs),
 * keyed by control name. Used to carry the form state into the next postback.
 */
function parseFormValues(html) {
  const $ = cheerio.load(html);
  const out = {};
  $('select[name]').each((_i, el) => {
    if ($(el).attr('disabled') !== undefined) return;
    const opt = $(el).find('option[selected]').first();
    const first = $(el).find('option').first();
    out[$(el).attr('name')] = (opt.length ? opt : first).attr('value') ?? '';
  });
  $('input[type="radio"][checked]').each((_i, el) => {
    out[$(el).attr('name')] = $(el).attr('value') ?? '';
  });
  $('input[type="text"][name]').each((_i, el) => {
    out[$(el).attr('name')] = $(el).attr('value') ?? '';
  });
  return out;
}

const GRIDS = { URBAN: /^ctl00_ContentPlaceHolder5_dg_Valuation/, INFLUENCE: /^ctl00_ContentPlaceHolder5_grdInfSublocationWiseRate/, RURAL: /^ctl00_ContentPlaceHolder5_ruralDataGrid/ };

/** URBAN | INFLUENCE | RURAL | NONE for the panel shown after selecting a village. */
function detectAreaType(html) {
  const $ = cheerio.load(html);
  const ids = $('table[id]')
    .map((_i, el) => $(el).attr('id'))
    .get();
  if (ids.some((id) => GRIDS.URBAN.test(id))) return 'URBAN';
  if ($(`#${ID}ddlLocationName`).length || ids.some((id) => GRIDS.INFLUENCE.test(id))) return 'INFLUENCE';
  if (ids.some((id) => GRIDS.RURAL.test(id))) return 'RURAL';
  return 'NONE';
}

/** "13370" → "13370"; "" / "-" / "0.00" kept as numbers; anything non-numeric → null. */
function num(text) {
  const t = clean(text).replace(/,/g, '');
  return /^\d+(\.\d+)?$/.test(t) ? t : null;
}

function unitCode(unit) {
  const u = clean(unit);
  if (/मीटर|meter|metre|sq\.?\s*m/i.test(u)) return 'SQ_M';
  if (/हेक्टर|hectare/i.test(u)) return 'HECTARE';
  if (/फूट|फुट|sq\.?\s*ft|feet/i.test(u)) return 'SQ_FT';
  if (/आर|\bare\b/i.test(u)) return 'ARE';
  return null;
}

/** "6/129 - गणेश रोड …" → { code: "6/129", name: "गणेश रोड …" }; "11.1-गावठाण …" → { code: "11.1", name: "गावठाण …" }. */
function splitZone(label) {
  const t = clean(label);
  const m = t.match(/^([0-9A-Za-z./()]+)\s*-\s*(.+)$/s);
  return m ? { code: m[1], name: m[2].trim() } : { code: null, name: t || null };
}

/**
 * Rows + pager of the grid inside `html`.
 * @returns {{ gridName: string|null, rows: object[], currentPage: number, pages: number[] }}
 */
function parseGrid(html, areaType) {
  const $ = cheerio.load(html);
  const table = $('table[id]')
    .filter((_i, el) => GRIDS[areaType]?.test($(el).attr('id')))
    .first();
  if (!table.length) return { gridName: null, rows: [], currentPage: 1, pages: [1] };
  const gridName = P + table.attr('id').slice(ID.length);
  const rows = [];
  let currentPage = 1;
  const pages = new Set([1]);

  table.find('> tbody > tr, > tr').each((_i, tr) => {
    const $tr = $(tr);
    if ($tr.find('th').length) return;
    if ($tr.hasClass('cssPager') || $tr.find('table').length) {
      $tr.find('a').each((_j, a) => {
        const m = String($(a).attr('href') ?? '').match(/Page\$(\d+)/);
        if (m) pages.add(Number(m[1]));
      });
      $tr.find('span').each((_j, s) => {
        const n = Number(clean($(s).text()));
        if (Number.isInteger(n) && n > 0) {
          currentPage = n;
          pages.add(n);
        }
      });
      return;
    }
    const cells = $tr.find('> td').map((_j, td) => $(td)).get();
    const selectHref = String(cells[0]?.find('a').attr('href') ?? '');
    const rowMatch = selectHref.match(/Select\$(\d+)/);
    const text = cells.map((c) => clean(c.text()));
    if (areaType === 'URBAN' && cells.length >= 8) {
      const z = splitZone(text[1]);
      rows.push({ zoneCode: z.code, zoneName: z.name, openLand: num(text[2]), residential: num(text[3]), office: num(text[4]), shop: num(text[5]), industrial: num(text[6]), unit: text[7] || null, unitCode: unitCode(text[7]), gridRow: rowMatch ? Number(rowMatch[1]) : null });
    } else if (areaType === 'INFLUENCE' && cells.length >= 5) {
      const z = splitZone(text[2]);
      rows.push({ zoneCode: text[1] || z.code, zoneName: z.name, rate: num(text[3]), unit: text[4] || null, unitCode: unitCode(text[4]), gridRow: rowMatch ? Number(rowMatch[1]) : null });
    } else if (areaType === 'RURAL' && cells.length >= 4 && !rowMatch) {
      rows.push({ assessmentType: text[0] || null, assessmentRange: text[1] || null, rate: num(text[2]), unit: text[3] || null, unitCode: unitCode(text[3]), gridRow: null });
    }
  });
  return { gridName, rows, currentPage, pages: [...pages].sort((a, b) => a - b) };
}

/** RURAL: the "Vibhag Number" label. */
function parseVibhagNo(html) {
  const $ = cheerio.load(html);
  const t = clean($(`#${ID}lblVibhagNo`).text());
  return t || null;
}

/** Survey numbers shown after selecting a grid row: "10 , 493 , 500" → ["10", "493", "500"]. */
function parseSurveyNumbers(html) {
  const $ = cheerio.load(html);
  let area = $('textarea[name*="txt_survy"], textarea[id*="txt_survy"]').first();
  if (!area.length) area = $('textarea[readonly]').first();
  if (!area.length) return null;
  return clean(area.text())
    .split(',')
    .map((s) => clean(s))
    .filter((s) => s && s !== '-')
    .slice(0, 5000);
}

/** Error / "no data" labels the site writes into the panel. */
function parseMessages(html) {
  const $ = cheerio.load(html);
  return ['lblError', 'lbl_not_found', 'lblMsg']
    .map((id) => clean($(`#${ID}${id}`).text()))
    .filter(Boolean);
}

export { P as EASR_FIELD_PREFIX, parseHiddenFields, parseDelta, parseSelect, parseYears, parseFormValues, detectAreaType, parseGrid, parseVibhagNo, parseSurveyNumbers, parseMessages, splitZone, unitCode };
