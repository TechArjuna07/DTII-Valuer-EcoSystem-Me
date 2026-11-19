import nodemailer from 'nodemailer';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

/**
 * Outbound mail. Providers:
 *  - log        development only: the message (including action links) is written to the API log.
 *  - gmail      Gmail SMTP (smtp.gmail.com:465, TLS) with an App Password.
 *  - office365  Microsoft 365 SMTP (smtp.office365.com:587, STARTTLS) with OAuth 2.0 client credentials
 *               (XOAUTH2). Basic-auth SMTP is being retired by Microsoft, so no username/password is used.
 * Credentials come from the environment only and are never logged.
 * Background delivery via Redis queues and firm-level SMTP settings arrive with the notifications module.
 */

let transporter;
let m365Token = { value: null, expiresAt: 0 };

async function office365AccessToken() {
  if (m365Token.value && Date.now() < m365Token.expiresAt - 60_000) return m365Token.value;
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(env.M365_TENANT_ID)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.M365_CLIENT_ID,
      client_secret: env.M365_CLIENT_SECRET,
      scope: 'https://outlook.office365.com/.default',
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Microsoft identity platform responded ${res.status}`);
  const data = await res.json();
  m365Token = { value: data.access_token, expiresAt: Date.now() + Number(data.expires_in) * 1000 };
  return m365Token.value;
}

async function getTransporter() {
  if (env.MAIL_PROVIDER === 'gmail') {
    transporter ??= nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: env.GMAIL_SMTP_USER, pass: env.GMAIL_SMTP_APP_PASSWORD },
    });
    return transporter;
  }
  if (env.MAIL_PROVIDER === 'office365') {
    // A fresh transport per send carries the current OAuth access token.
    return nodemailer.createTransport({
      host: 'smtp.office365.com',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { type: 'OAuth2', user: env.M365_SENDER, accessToken: await office365AccessToken() },
    });
  }
  return null;
}

/**
 * Sends one email. Never throws: failures are logged (without credentials) and reported as { sent: false },
 * so a mail outage cannot roll back business operations that have already committed.
 */
async function sendMail({ to, subject, html, text }) {
  if (env.MAIL_PROVIDER === 'log') {
    logger.info({ mail: { to, subject, text } }, 'Mail (log provider)');
    return { sent: true, provider: 'log' };
  }
  try {
    const t = await getTransporter();
    const info = await t.sendMail({ from: env.MAIL_PROVIDER === 'office365' ? env.M365_SENDER : env.MAIL_FROM, to, subject, html, text });
    return { sent: true, provider: env.MAIL_PROVIDER, messageId: info.messageId };
  } catch (e) {
    logger.error({ provider: env.MAIL_PROVIDER, err: e.message }, 'Mail delivery failed');
    return { sent: false, provider: env.MAIL_PROVIDER };
  }
}

/** In development with the log provider, action links are also returned to the caller for convenience. */
const exposeDevLinks = () => env.MAIL_PROVIDER === 'log' && env.NODE_ENV !== 'production';

export { sendMail, exposeDevLinks };
