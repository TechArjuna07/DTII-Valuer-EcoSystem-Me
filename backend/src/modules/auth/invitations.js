import { env } from '../../config/env.js';
import { prisma } from '../../database/prisma.js';
import { randomToken, sha256 } from '../../services/crypto.js';
import { exposeDevLinks, sendMail } from '../../services/mail/mail.service.js';
import { inviteEmail, passwordResetEmail } from '../../services/mail/templates.js';

const INVITE_TTL_DAYS = 7;
const RESET_TTL_MINUTES = 30;

/**
 * Issues a single-use token (only the SHA-256 hash is stored). Earlier unused tokens of the same purpose
 * for the user are invalidated, so only the latest link works.
 */
async function issueToken(db, { userId, purpose, createdById, ttlMs }) {
  const raw = randomToken(32);
  await db.authToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } });
  await db.authToken.create({ data: { userId, purpose, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + ttlMs), createdById: createdById ?? null } });
  return raw;
}

const inviteUrl = (raw) => `${env.WEB_APP_URL}/accept-invite?token=${encodeURIComponent(raw)}`;
const resetUrl = (raw) => `${env.WEB_APP_URL}/reset-password?token=${encodeURIComponent(raw)}`;

/** Creates an invite token inside the caller's transaction. Send the email AFTER commit with sendInvite(). */
const createInviteToken = (db, userId, createdById) =>
  issueToken(db, { userId, purpose: 'INVITE', createdById, ttlMs: INVITE_TTL_DAYS * 86_400_000 });

/** @returns {Promise<{ sent: boolean, devInviteUrl?: string }>} */
async function sendInvite({ rawToken, email, fullName, firmName, roleNames }) {
  const url = inviteUrl(rawToken);
  const mail = inviteEmail({ fullName, firmName, roleNames, url, expiresDays: INVITE_TTL_DAYS });
  const result = await sendMail({ to: email, ...mail });
  return { sent: result.sent, ...(exposeDevLinks() ? { devInviteUrl: url } : {}) };
}

async function createAndSendPasswordReset(user) {
  const raw = await issueToken(prisma, { userId: user.id, purpose: 'PASSWORD_RESET', ttlMs: RESET_TTL_MINUTES * 60_000 });
  const url = resetUrl(raw);
  await sendMail({ to: user.email, ...passwordResetEmail({ fullName: user.fullName, url, expiresMinutes: RESET_TTL_MINUTES }) });
  return exposeDevLinks() ? { devResetUrl: url } : {};
}

/** Re-issues and sends an invite for a user who has not set a password yet. */
async function resendInvite({ user, firmName, roleNames, createdById }) {
  const raw = await createInviteToken(prisma, user.id, createdById);
  return sendInvite({ rawToken: raw, email: user.email, fullName: user.fullName, firmName, roleNames });
}

export { createInviteToken, sendInvite, resendInvite, createAndSendPasswordReset, INVITE_TTL_DAYS, RESET_TTL_MINUTES };
