import { Conflict } from '../../utils/errors.js';
import { createInviteToken } from '../auth/invitations.js';

/**
 * One login per email across the platform. When a firm registers a person whose email already has a login
 * (e.g. an employee who also works for another firm), the existing login is reused and simply gains a role in
 * this firm — nothing about their other firms is revealed. Platform administrators can never be added to a firm.
 *
 * Must run inside the caller's transaction.
 * @returns {Promise<{ user: object, inviteToken: string|null }>} inviteToken is set when the person has no password yet
 */
async function ensureUserForFirm(tx, { email, fullName, phone, createdById }) {
  let user = await tx.user.findUnique({ where: { email } });
  if (user && (user.isSuperadmin || user.deletedAt)) throw Conflict('This email address cannot be used');
  if (!user) {
    user = await tx.user.create({ data: { email, fullName, phone: phone ?? null, status: 'INVITED' } });
  }
  const inviteToken = user.passwordHash ? null : await createInviteToken(tx, user.id, createdById);
  return { user, inviteToken };
}

/** Public projection of a user (never the password hash or lockout internals beyond what admins need). */
const userSummary = (u) =>
  u && {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    phone: u.phone,
    status: u.status,
    lastLoginAt: u.lastLoginAt,
    locked: !!(u.lockedUntil && u.lockedUntil > new Date()),
  };

export { ensureUserForFirm, userSummary };
