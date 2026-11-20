import nodemailer from 'nodemailer';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { prisma } from '../../database/prisma.js';
import { decrypt } from '../crypto.js';

/**
 * Outbound mail with per-firm SMTP:
 *   - a firm's own SMTP (Firm Settings → Email): Gmail SMTP with an App Password, or Microsoft 365 with OAuth 2.0
 *     client credentials (XOAUTH2 — Microsoft is retiring basic-auth SMTP). Secrets are AES-256-GCM encrypted.
 *   - otherwise the platform default from the environment (MAIL_PROVIDER = log | gmail | office365).
 * `log` (development only) writes the message to the API log. Credentials are never logged.
 */

const m365Tokens = new Map();

async function office365AccessToken({ tenantId, clientId, clientSecret }) {
  const key = `${tenantId}:${clientId}`;
  const cached = m365Tokens.get(key);
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.value;
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret, scope: 'https://outlook.office365.com/.default' }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Microsoft identity platform responded ${res.status}`);
  const data = await res.json();
  m365Tokens.set(key, { value: data.access_token, expiresAt: Date.now() + Number(data.expires_in) * 1000 });
  return data.access_token;
}

/** Resolves the mail configuration for a firm (its own SMTP if configured) or the platform default. */
async function mailConfig(firmId) {
  if (firmId) {
    const s = await prisma.organizationSettings.findUnique({ where: { firmId }, select: { smtpProvider: true, smtpConfig: true, smtpSecretEnc: true } });
    if (s?.smtpProvider && s.smtpSecretEnc) {
      const secret = decrypt(s.smtpSecretEnc);
      const c = s.smtpConfig || {};
      if (s.smtpProvider === 'gmail') return { provider: 'gmail', from: c.from || c.user, user: c.user, secret, scope: 'firm' };
      if (s.smtpProvider === 'office365') return { provider: 'office365', from: c.sender, tenantId: c.tenantId, clientId: c.clientId, sender: c.sender, secret, scope: 'firm' };
    }
  }
  if (env.MAIL_PROVIDER === 'gmail') return { provider: 'gmail', from: env.MAIL_FROM, user: env.GMAIL_SMTP_USER, secret: env.GMAIL_SMTP_APP_PASSWORD, scope: 'platform' };
  if (env.MAIL_PROVIDER === 'office365') return { provider: 'office365', from: env.M365_SENDER, tenantId: env.M365_TENANT_ID, clientId: env.M365_CLIENT_ID, sender: env.M365_SENDER, secret: env.M365_CLIENT_SECRET, scope: 'platform' };
  return { provider: 'log', from: env.MAIL_FROM, scope: 'platform' };
}

async function transportFor(cfg) {
  if (cfg.provider === 'gmail') return nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: cfg.user, pass: cfg.secret } });
  if (cfg.provider === 'office365') {
    return nodemailer.createTransport({
      host: 'smtp.office365.com',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { type: 'OAuth2', user: cfg.sender, accessToken: await office365AccessToken({ tenantId: cfg.tenantId, clientId: cfg.clientId, clientSecret: cfg.secret }) },
    });
  }
  return null;
}

/**
 * Sends one email. Never throws; returns { sent, provider, messageId?, error? } so callers (and the mail queue)
 * can record the outcome. Business operations never roll back because of mail.
 */
async function sendMail({ firmId = null, to, subject, html, text }) {
  let cfg;
  try {
    cfg = await mailConfig(firmId);
    if (cfg.provider === 'log') {
      logger.info({ mail: { to, subject, text } }, 'Mail (log provider)');
      return { sent: true, provider: 'log' };
    }
    const info = await (await transportFor(cfg)).sendMail({ from: cfg.from, to, subject, html, text });
    return { sent: true, provider: cfg.provider, messageId: info.messageId };
  } catch (e) {
    logger.error({ provider: cfg?.provider, err: e.message }, 'Mail delivery failed');
    return { sent: false, provider: cfg?.provider ?? 'unknown', error: String(e.message).slice(0, 300) };
  }
}

/** In development with the log provider, action links are also returned to the caller for convenience. */
const exposeDevLinks = () => env.MAIL_PROVIDER === 'log' && env.NODE_ENV !== 'production';

export { sendMail, exposeDevLinks, mailConfig };
