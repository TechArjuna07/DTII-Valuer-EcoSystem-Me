import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { prisma } from '../../database/prisma.js';
import { randomToken, sha256 } from '../../services/crypto.js';
import { CSRF_COOKIE } from '../../middleware/csrf.js';

/** Refresh cookie: HttpOnly, SameSite=Strict, scoped to the auth endpoints only. */
const REFRESH_COOKIE = 'valuers_rt';
const REFRESH_PATH = '/api/v1/auth';

const ttlMs = () => env.REFRESH_TOKEN_TTL_DAYS * 86_400_000;

/**
 * Creates a refresh session. A new login starts a new token family; rotation keeps the family.
 * @returns {Promise<{ session: object, refreshToken: string }>} the raw token is returned once and only its hash is stored
 */
async function createSession({ userId, firmId, familyId, meta }, db = prisma) {
  const refreshToken = randomToken(48);
  const session = await db.userSession.create({
    data: {
      userId,
      firmId: firmId ?? null,
      familyId: familyId ?? randomUUID(),
      tokenHash: sha256(refreshToken),
      userAgent: meta?.userAgent ?? null,
      ip: meta?.ip ?? null,
      expiresAt: new Date(Date.now() + ttlMs()),
    },
  });
  return { session, refreshToken };
}

/** Revokes every session of a token family (logout, reuse detection, device sign-out). */
const revokeFamily = (familyId, reason, db = prisma) =>
  db.userSession.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });

/** Revokes all sessions of a user, optionally keeping one family (e.g. the current device). */
const revokeAllUserSessions = (userId, reason, { exceptFamilyId } = {}, db = prisma) =>
  db.userSession.updateMany({
    where: { userId, revokedAt: null, ...(exceptFamilyId ? { familyId: { not: exceptFamilyId } } : {}) },
    data: { revokedAt: new Date(), revokedReason: reason },
  });

function setAuthCookies(res, refreshToken) {
  const secure = env.COOKIE_SECURE;
  res.cookie(REFRESH_COOKIE, refreshToken, { httpOnly: true, secure, sameSite: 'strict', path: REFRESH_PATH, maxAge: ttlMs() });
  // Readable by the SPA (double-submit CSRF); carries no authority on its own.
  res.cookie(CSRF_COOKIE, randomToken(24), { httpOnly: false, secure, sameSite: 'strict', path: '/', maxAge: ttlMs() });
}

function clearAuthCookies(res) {
  const secure = env.COOKIE_SECURE;
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure, sameSite: 'strict', path: REFRESH_PATH });
  res.clearCookie(CSRF_COOKIE, { httpOnly: false, secure, sameSite: 'strict', path: '/' });
}

export { createSession, revokeFamily, revokeAllUserSessions, setAuthCookies, clearAuthCookies, REFRESH_COOKIE };
