/**
 * Sends one test email with the PLATFORM mail settings from backend/.env and reports the result.
 * For Microsoft 365 it first diagnoses the OAuth token request and prints Microsoft's error code (never secrets).
 *
 *   pnpm --filter @valuers/backend mail:test -- you@yourcompany.com
 *   (MAIL_PROVIDER=office365 in .env is read; pass --provider office365 to test it without changing .env)
 */
import 'dotenv/config';

const to = process.argv.slice(2).find((a) => a.includes('@'));
const pi = process.argv.indexOf('--provider');
if (pi > 0) process.env.MAIL_PROVIDER = process.argv[pi + 1];
if (!to) {
  console.error('Usage: node scripts/test-mail.js <recipient@example.com> [--provider office365|gmail]');
  process.exit(1);
}

if (process.env.MAIL_PROVIDER === 'office365') {
  const e = process.env;
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(e.M365_TENANT_ID?.trim())}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: e.M365_CLIENT_ID?.trim() ?? '', client_secret: e.M365_CLIENT_SECRET?.trim() ?? '', scope: 'https://outlook.office365.com/.default' }),
  });
  const j = await res.json();
  if (!res.ok) {
    console.error(`Microsoft 365 sign-in failed (HTTP ${res.status}): ${(j.error_description || j.error || '').split('\n')[0].replace(/Trace ID.*/, '')}`);
    if (j.error_codes?.includes(7000215)) console.error('→ M365_CLIENT_SECRET must be the secret VALUE (shown once when created), not the Secret ID.');
    process.exit(1);
  }
  console.log('Microsoft 365 sign-in OK (OAuth token issued).');
}

const { sendMail } = await import('../src/services/mail/mail.service.js');
const { notificationEmail } = await import('../src/services/mail/templates.js');
const { prisma } = await import('../src/database/prisma.js');
const { redis } = await import('../src/database/redis.js');
const mail = notificationEmail({ firmName: null, fullName: 'there', title: 'Valuers Ecosystem test email', body: `Sent with MAIL_PROVIDER=${process.env.MAIL_PROVIDER}.`, url: null });
const r = await sendMail({ to, ...mail });
console.log(r.sent ? `Sent via ${r.provider}${r.messageId ? ` (${r.messageId})` : ''}` : `Failed via ${r.provider}: ${r.error}`);
await prisma.$disconnect();
await redis.quit();
process.exit(r.sent ? 0 : 1);
