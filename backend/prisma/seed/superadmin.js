/**
 * Bootstraps the platform Superadmin (idempotent).
 *
 *   Set in backend/.env (git-ignored — never commit real credentials):
 *     SEED_SUPERADMIN_EMAIL=you@yourcompany.com
 *     SEED_SUPERADMIN_NAME=Platform Administrator
 *     SEED_SUPERADMIN_PASSWORD=…        (optional)
 *   then:  pnpm --filter @valuers/backend db:seed:superadmin
 *
 * With SEED_SUPERADMIN_PASSWORD the account is created ACTIVE with that password (it must meet the password
 * policy). Without it, the account is created INVITED and a one-time set-password link is emailed (printed here
 * when MAIL_PROVIDER=log). An existing, activated Superadmin is never modified.
 */
import 'dotenv/config';
import { prisma } from '../../src/database/prisma.js';
import { redis } from '../../src/database/redis.js';
import { createInviteToken, sendInvite } from '../../src/modules/auth/invitations.js';
import { recordAudit, AuditAction } from '../../src/services/audit.service.js';
import { hashPassword, passwordContainsEmail, passwordSchema } from '../../src/services/password.js';

async function main() {
  const email = String(process.env.SEED_SUPERADMIN_EMAIL || '').trim().toLowerCase();
  const fullName = String(process.env.SEED_SUPERADMIN_NAME || 'Platform Administrator').trim();
  const password = process.env.SEED_SUPERADMIN_PASSWORD || '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Set SEED_SUPERADMIN_EMAIL to a valid email address');
  if (password) {
    const check = passwordSchema.safeParse(password);
    if (!check.success) throw new Error(`SEED_SUPERADMIN_PASSWORD does not meet the password policy: ${check.error.issues.map((i) => i.message).join('; ')}`);
    if (passwordContainsEmail(password, email)) throw new Error('SEED_SUPERADMIN_PASSWORD must not contain the email name');
  }

  let user = await prisma.user.findUnique({ where: { email } });
  if (user && !user.isSuperadmin) throw new Error('That email already belongs to a firm user; use a dedicated platform email');
  if (user && user.status === 'ACTIVE' && user.passwordHash) {
    console.log(`Superadmin ${email} already exists and is active. Nothing changed.`);
    return;
  }

  if (password) {
    const passwordHash = await hashPassword(password);
    await prisma.$transaction(async (tx) => {
      user = user
        ? await tx.user.update({ where: { id: user.id }, data: { passwordHash, status: 'ACTIVE', fullName, passwordChangedAt: new Date() } })
        : await tx.user.create({ data: { email, fullName, isSuperadmin: true, status: 'ACTIVE', passwordHash, passwordChangedAt: new Date() } });
      await recordAudit({ action: 'SUPERADMIN_SEEDED', firmId: null, actorId: null, actorRole: 'SYSTEM', entityType: 'user', entityId: user.id, meta: { withPassword: true } }, tx);
    });
    console.log(`Superadmin ${email} is ready. Sign in with the password from SEED_SUPERADMIN_PASSWORD.`);
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
