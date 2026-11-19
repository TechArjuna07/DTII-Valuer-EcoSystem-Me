import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

/**
 * Short-lived access token. Claims are identifiers only: roles and permissions are resolved server-side on
 * every request (cached for 30 s), so deactivation and permission changes apply without waiting for expiry.
 *   sub = user id, sid = session id, fid = active firm id (null for the platform context)
 */
function signAccessToken({ userId, sessionId, firmId }) {
  return jwt.sign({ sid: sessionId, fid: firmId ?? null }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    subject: userId,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    expiresIn: env.JWT_ACCESS_TTL_SECONDS,
  });
}

/** Verifies signature, algorithm (no alg:none / confusion), issuer, audience and expiry. Returns null if invalid. */
function verifyAccessToken(token) {
  try {
    const p = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'], issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE });
    if (typeof p.sub !== 'string' || typeof p.sid !== 'string') return null;
    return { userId: p.sub, sessionId: p.sid, firmId: p.fid ?? null };
  } catch {
    return null;
  }
}

export { signAccessToken, verifyAccessToken };
