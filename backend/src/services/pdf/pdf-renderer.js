import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

/**
 * HTML → PDF with headless Chrome / Edge (puppeteer-core, no bundled browser download).
 * Hardening for firm-authored templates: JavaScript is disabled and every network request except inline data:
 * URLs is blocked, so a template can neither run code nor exfiltrate data.
 * PDF_RENDERER=none disables rendering (valuers then upload their own PDF for each version).
 */
const CANDIDATES = [
  env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const executablePath = env.PDF_RENDERER === 'chrome' ? CANDIDATES.find((p) => existsSync(p)) : null;
let browserPromise = null;

const rendererAvailable = () => !!executablePath;

function getBrowser() {
  browserPromise ??= puppeteer
    .launch({
      executablePath,
      headless: true,
      args: ['--disable-gpu', '--no-first-run', '--disable-extensions', '--disable-dev-shm-usage', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    })
    .catch((e) => {
      browserPromise = null;
      throw e;
    });
  return browserPromise;
}

/** @returns {Promise<Buffer>} A4 PDF */
async function htmlToPdf(html, { footerText = '' } = {}) {
  if (!executablePath) throw new Error('PDF renderer is not available (set CHROME_PATH or PDF_RENDERER=chrome)');
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', (r) => (r.url().startsWith('data:') || r.url() === 'about:blank' ? r.continue() : r.abort()));
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', bottom: '16mm', left: '12mm', right: '12mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="font-size:7px;width:100%;padding:0 12mm;color:#5b667a;display:flex;justify-content:space-between"><span>${footerText.replace(/[<>&"]/g, '')}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
      timeout: 60_000,
    });
    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function closeRenderer() {
  if (!browserPromise) return;
  try {
    await (await browserPromise).close();
  } catch (e) {
    logger.warn({ err: e.message }, 'Closing PDF renderer failed');
  }
  browserPromise = null;
}

export { htmlToPdf, rendererAvailable, closeRenderer };
