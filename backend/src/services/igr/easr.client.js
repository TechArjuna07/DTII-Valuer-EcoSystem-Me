import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { redis } from '../../database/redis.js';
import { EASR_FIELD_PREFIX as P, parseDelta, parseFormValues, parseHiddenFields } from './easr.parser.js';

/**
 * Browser-equivalent session against the IGR Maharashtra eASR 2.0 site (ASP.NET WebForms, no public JSON API).
 *
 *   1. GET frmMap.aspx                         → session cookie MyCustomSessionId (required for grid paging)
 *   2. GET eASRCommon.aspx?hDistName=<key>     → full page: hidden fields, years, district, talukas
 *   3. POST partial postbacks (MS-AJAX delta)  → ddlYear / ddlTaluka / ddlVillage / ddlLocationName / grid Page$n,Select$n
 *
 * Every request first takes a global "slot" in Redis so that all API and worker processes together never send more
 * than one request per IGR_EASR_MIN_INTERVAL_MS (polite crawling of a government site). Transient failures
 * (network, timeout, 5xx, 429) are retried twice with back-off; the WebForms state is only advanced on success.
 */

class EasrError extends Error {
  constructor(message, { code = 'EASR_ERROR', retryable = true } = {}) {
    super(message);
    this.name = 'EasrError';
    this.code = code;
    this.retryable = retryable;
  }
}

const MAX_BYTES = 8 * 1024 * 1024;
const PANEL = `${P}UpdatePanel1`;
const SLOT_KEY = () => `${env.QUEUE_PREFIX}:igr:easr:slot`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Waits for the platform-wide request slot (one request per IGR_EASR_MIN_INTERVAL_MS across all processes). */
async function acquireSlot() {
  const gap = env.IGR_EASR_MIN_INTERVAL_MS;
  if (!gap) return;
  for (;;) {
    if (await redis.set(SLOT_KEY(), '1', 'PX', gap, 'NX')) return;
    const ttl = await redis.pttl(SLOT_KEY());
    await sleep(Math.min(Math.max(ttl, 25), gap));
  }
}

async function readLimited(res) {
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_BYTES) throw new EasrError('eASR response too large', { retryable: false });
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new EasrError('eASR response too large', { retryable: false });
  return text;
}

class EasrSession {
  /** @param {{ baseUrl?: string, fetchImpl?: typeof fetch }} [opts] */
  constructor({ baseUrl = env.IGR_EASR_BASE_URL, fetchImpl = fetch } = {}) {
    this.base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    this.fetch = fetchImpl;
    this.cookies = new Map();
    this.hidden = {};
    this.form = {};
    this.html = '';
    this.requests = 0;
    this.pageUrl = null;
  }

  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  keepCookies(res) {
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const c of list) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      if (i > 0) this.cookies.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
    }
  }

  async request(url, init = {}, label = 'request') {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt) await sleep(attempt * (env.NODE_ENV === 'test' ? 10 : 3000));
      await acquireSlot();
      this.requests += 1;
      try {
        const res = await this.fetch(url, {
          ...init,
          redirect: 'manual',
          signal: AbortSignal.timeout(env.IGR_EASR_TIMEOUT_MS),
          headers: { 'User-Agent': env.IGR_EASR_USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9', ...(this.cookies.size ? { Cookie: this.cookieHeader() } : {}), ...init.headers },
        });
        this.keepCookies(res);
        if (res.status === 429 || res.status >= 500) throw new EasrError(`eASR responded ${res.status}`);
        if (res.status >= 300) throw new EasrError(`eASR responded ${res.status}`, { retryable: false });
        return await readLimited(res);
      } catch (e) {
        lastError = e instanceof EasrError ? e : new EasrError(e.name === 'TimeoutError' ? 'The eASR site did not respond in time' : `Could not reach the eASR site (${e.cause?.code ?? e.message})`);
        if (!lastError.retryable) throw lastError;
        logger.warn({ label, attempt: attempt + 1, err: lastError.message }, 'eASR request failed');
      }
    }
    throw lastError;
  }

  /** Opens the district page the way a browser does (map page first, for the session cookie). */
  async open(districtKey) {
    await this.request(`${this.base}frmMap.aspx`, {}, 'map');
    this.pageUrl = `${this.base}eASRCommon.aspx?hDistName=${encodeURIComponent(districtKey)}`;
    const html = await this.request(this.pageUrl, { headers: { Referer: `${this.base}frmMap.aspx` } }, 'district');
    if (!/ddlTaluka/.test(html)) throw new EasrError(`eASR has no rate page for district "${districtKey}"`, { code: 'EASR_NO_DISTRICT', retryable: false });
    this.hidden = parseHiddenFields(html);
    this.form = parseFormValues(html);
    this.form[`${P}ddlLanguage`] = 'en-US';
    this.html = html;
    return html;
  }

  /**
   * Partial postback (what the page's __doPostBack does inside the UpdatePanel).
   * @param {string} target  control name, e.g. ctl00$ContentPlaceHolder5$ddlTaluka
   * @param {string} [argument]  e.g. "Page$2" / "Select$0"
   * @param {Record<string,string>} [values]  form values to change first
   * @returns {Promise<string>} the refreshed panel HTML
   */
  async postback(target, argument = '', values = {}) {
    if (!this.pageUrl) throw new EasrError('eASR session not opened', { retryable: false });
    const form = { ...this.form, ...values };
    const body = new URLSearchParams({
      'ctl00$ScriptManager1': `${PANEL}|${target}`,
      ...form,
      __EVENTTARGET: target,
      __EVENTARGUMENT: argument,
      __LASTFOCUS: '',
      __VIEWSTATE: this.hidden.__VIEWSTATE ?? '',
      __VIEWSTATEGENERATOR: this.hidden.__VIEWSTATEGENERATOR ?? '',
      __SCROLLPOSITIONX: '0',
      __SCROLLPOSITIONY: '0',
      __VIEWSTATEENCRYPTED: '',
      __EVENTVALIDATION: this.hidden.__EVENTVALIDATION ?? '',
      __ASYNCPOST: 'true',
    });
    const text = await this.request(
      this.pageUrl,
      {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-MicrosoftAjax': 'Delta=true', 'X-Requested-With': 'XMLHttpRequest', Referer: this.pageUrl },
      },
      argument || target.slice(P.length),
    );
    const delta = parseDelta(text);
    if (delta.error) throw new EasrError(`eASR error: ${delta.error.slice(0, 200)}`);
    if (delta.redirect) throw new EasrError('The eASR site reset the session', { code: 'EASR_SESSION_RESET' });
    const panel = Object.entries(delta.panels).find(([id]) => id.endsWith('UpdatePanel1'))?.[1];
    if (panel == null) throw new EasrError('Unexpected eASR response (no update panel)');
    Object.assign(this.hidden, delta.hidden);
    this.form = { [`${P}ddlLanguage`]: 'en-US', ...parseFormValues(panel) };
    this.html = panel;
    return panel;
  }
}

export { EasrSession, EasrError, acquireSlot };
