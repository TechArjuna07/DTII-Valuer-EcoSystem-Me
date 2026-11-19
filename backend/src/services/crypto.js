import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Field-level encryption (PAN, SMTP secrets) with AES-256-GCM.
 * Stored layout: [version:1][iv:12][tag:16][ciphertext]. The version byte allows key rotation later.
 */
const KEY_VERSION = 1;
const key = Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64');

function encrypt(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([KEY_VERSION]), iv, cipher.getAuthTag(), ct]);
}

function decrypt(blob) {
  const buf = Buffer.from(blob);
  if (buf[0] !== KEY_VERSION) throw new Error('Unsupported encryption key version');
  const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(1, 13));
  decipher.setAuthTag(buf.subarray(13, 29));
  return Buffer.concat([decipher.update(buf.subarray(29)), decipher.final()]).toString('utf8');
}

/** Keyed hash for equality lookups on encrypted values (e.g. duplicate PAN detection). */
const hmac = (value) => createHmac('sha256', env.HMAC_KEY).update(String(value)).digest('hex');

/** One-way hash for stored bearer secrets (refresh / invite / reset tokens). */
const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');

/** URL-safe random secret. */
const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export { encrypt, decrypt, hmac, sha256, randomToken, safeEqual };
