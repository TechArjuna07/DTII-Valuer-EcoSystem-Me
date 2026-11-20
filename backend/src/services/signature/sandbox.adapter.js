import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { env } from '../../config/env.js';

/**
 * SANDBOX signature provider — DEVELOPMENT ONLY.
 * Produces a real RSA-SHA256 signature over a canonical payload (document SHA-256, signer, role, case, time) so the
 * whole flow — signing, storage, verification, tamper detection — can be exercised end to end. It is NOT a
 * legally valid digital signature under the IT Act 2000 (no licensed CA, no DSC / Aadhaar eSign) and every record
 * says so (legallyValid = false). env.js refuses SIGNATURE_PROVIDER=sandbox in production.
 */
const NAME = 'SANDBOX';
let keys;

function loadKeys() {
  if (keys) return keys;
  let pem = env.SANDBOX_SIGNING_KEY ? Buffer.from(env.SANDBOX_SIGNING_KEY, 'base64').toString() : null;
  const file = path.resolve(env.STORAGE_LOCAL_ROOT, '.sandbox-signing-key.pem');
  if (!pem && existsSync(file)) pem = readFileSync(file, 'utf8');
  if (!pem) {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, pem, { mode: 0o600 });
  }
  const privateKey = createPrivateKey(pem);
  const publicKey = createPublicKey(privateKey);
  const fingerprint = createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
  keys = { privateKey, publicKey, fingerprint };
  return keys;
}

const canonical = ({ documentSha256, signerUserId, signerName, signerRole, caseNumber, signedAt }) =>
  JSON.stringify({ v: 1, doc: documentSha256, signer: signerUserId, name: signerName, role: signerRole, case: caseNumber, at: signedAt });

/** Signs immediately (the signer has already re-authenticated and consented in the app). */
function signNow(payload) {
  const k = loadKeys();
  const signedAt = new Date().toISOString();
  const value = sign('sha256', Buffer.from(canonical({ ...payload, signedAt })), k.privateKey).toString('base64');
  return {
    status: 'SIGNED',
    signedAt,
    signatureValue: value,
    signatureAlgorithm: 'RSA-SHA256 (sandbox)',
    certSubject: `CN=${payload.signerName} (sandbox signer)`,
    certIssuer: 'CN=DTII Valuers Ecosystem Sandbox CA (not a licensed certifying authority)',
    certSerial: k.fingerprint.slice(0, 32),
    legallyValid: false,
  };
}

function verifyRecord(record) {
  const k = loadKeys();
  const ok = verify(
    'sha256',
    Buffer.from(canonical({ documentSha256: record.documentSha256, signerUserId: record.signerUserId, signerName: record.signerName, signerRole: record.signerRole, caseNumber: record.caseNumber, signedAt: new Date(record.signedAt).toISOString() })),
    k.publicKey,
    Buffer.from(record.signatureValue, 'base64'),
  );
  return { ok, detail: { method: 'RSA-SHA256 over canonical payload', keyFingerprint: k.fingerprint, legallyValid: false } };
}

export const sandboxProvider = { name: NAME, synchronous: true, legallyValid: false, signNow, verifyRecord };
