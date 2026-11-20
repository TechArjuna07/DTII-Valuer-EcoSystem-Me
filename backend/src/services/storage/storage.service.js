import { createHmac } from 'node:crypto';
import { env } from '../../config/env.js';
import { safeEqual } from '../crypto.js';
import * as local from './local.driver.js';
import * as s3 from './s3.driver.js';

/**
 * Storage facade — the ONLY code that touches document bytes. Business logic deals in opaque keys and never in
 * filesystem paths or bucket names.
 *   STORAGE_DRIVER=local  → files under STORAGE_LOCAL_ROOT, downloaded via HMAC-signed, expiring /api/v1/files links
 *   STORAGE_DRIVER=s3     → private bucket, downloaded via pre-signed S3 URLs
 */
const isS3 = env.STORAGE_DRIVER === 's3';
const driver = isS3 ? s3 : local;

/** Keys contain ids only — never client names, folder names or user-supplied file names. */
const StorageKeys = {
  documentVersion: (firmId, caseId, documentId, version) => `firms/${firmId}/cases/${caseId}/${documentId}/v${version}`,
};

const putObject = (key, buffer, opts) => driver.putObject(key, buffer, opts);
const getBuffer = (key) => driver.getBuffer(key);
const ping = () => driver.ping();

/** RFC 6266 / 5987 Content-Disposition with an ASCII fallback (no header injection). */
function contentDisposition(name, disposition = 'attachment') {
  const ascii = String(name).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_').slice(0, 150) || 'document';
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(String(name).slice(0, 200))}`;
}

// ───── Local signed links ─────
const signingKey = createHmac('sha256', env.HMAC_KEY).update('valuers:file-links:v1').digest();
const sign = (payload) => createHmac('sha256', signingKey).update(payload).digest('base64url');

function createLocalToken({ key, fileName, contentType, disposition, ttlSeconds }) {
  const payload = Buffer.from(JSON.stringify({ k: key, n: fileName, t: contentType, d: disposition, e: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/** @returns {null | { key, fileName, contentType, disposition }} */
function verifyLocalToken(token) {
  const [payload, mac] = String(token).split('.');
  if (!payload || !mac || !safeEqual(mac, sign(payload))) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (typeof p.e !== 'number' || p.e < Math.floor(Date.now() / 1000)) return null;
    return { key: p.k, fileName: p.n, contentType: p.t, disposition: p.d === 'inline' ? 'inline' : 'attachment' };
  } catch {
    return null;
  }
}

/**
 * Short-lived download URL for an object. Never a permanent public URL.
 * @returns {Promise<{ url: string, expiresAt: string }>}
 */
async function signedUrl(key, { fileName, contentType, disposition = 'attachment', ttlSeconds = env.SIGNED_URL_TTL_SECONDS }) {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  if (isS3) return { url: await s3.presignGet(key, { contentType, contentDisposition: contentDisposition(fileName, disposition), expiresIn: ttlSeconds }), expiresAt };
  return { url: `/api/v1/files/${createLocalToken({ key, fileName, contentType, disposition, ttlSeconds })}`, expiresAt };
}

export { StorageKeys, putObject, getBuffer, ping, signedUrl, verifyLocalToken, contentDisposition, isS3 };
export const localGetStream = (key) => local.getStream(key);
