/**
 * Bootstraps a platform Superadmin (idempotent).
 *
 *   SEED_SUPERADMIN_EMAIL=you@example.com pnpm --filter @valuers/backend db:seed:superadmin
 *
 * Creates the user as INVITED (no password is ever placed in env files or seed data) and sends a one-time
 * "set password" invite. With MAIL_PROVIDER=log (development) the link is printed here instead.
 * Re-running for a user who has not activated yet re-issues the link.
 */
import 'dotenv/config';
import { prisma } from '../../src/database/prisma.js';
import { redis } from '../../src/database/redis.js';
import { createInviteToken, sendInvite } from '../../src/modules/auth/invitations.js';
import { recordAudit, AuditAction } from '../../src/services/audit.service.js';

async function main() {
  const email = String(process.env.SEED_SUPERADMIN_EMAIL || '').trim().toLowerCase();
  const fullName = String(process.env.SEED_SUPERADMIN_NAME || 'Platform Administrator').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Set SEED_SUPERADMIN_EMAIL to a valid email address');

  let user = await prisma.user.findUnique({ where: { email } });
  if (user && !user.isSuperadmin) throw new Error('That email already belongs to a firm user; use a dedicated platform email');
  if (user && user.status === 'ACTIVE') {
    console.log(`Superadmin ${email} already exists and is active. Nothing to do.`);
    return;
  }
  const raw = await prisma.$transaction(async (tx) => {
    user ??= await tx.user.create({ data: { email, fullName, isSuperadmin: true, status: 'INVITED' } });
    const token = await createInviteToken(tx, user.id, null);
    await recordAudit({ action: AuditAction.INVITE_SENT, firmId: null, actorId: null, actorRole: 'SYSTEM', entityType: 'user', entityId: user.id, meta: { superadmin: true } }, tx);
    return token;
  });
  const result = await sendInvite({ rawToken: raw, email, fullName: user.fullName, firmName: null, roleNames: ['Superadmin'] });
  console.log(`Superadmin invite issued for ${email} (email sent: ${result.sent}).`);
  if (result.devInviteUrl) console.log(`Development set-password link (valid 7 days, single use):\n  ${result.devInviteUrl}`);
}

main()
  .catch((e) => {
    console.error('Superadmin seed failed:', e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await redis.quit();
  });
