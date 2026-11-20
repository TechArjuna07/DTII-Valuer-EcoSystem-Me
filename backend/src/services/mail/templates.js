import { env } from '../../config/env.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Branded HTML layout (inline styles for email clients). All dynamic values are HTML-escaped. */
function layout({ title, firmName, bodyHtml, actionUrl, actionLabel, footer }) {
  return `<!doctype html><html><body style="margin:0;background:#f5f7fb;font-family:Segoe UI,Arial,sans-serif;color:#0b1324">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e3e8f0;border-radius:12px">
<tr><td style="background:#0a1633;border-radius:12px 12px 0 0;padding:20px 28px;color:#ffffff;font-size:15px;font-weight:600">
${esc(firmName || env.APP_NAME)}<div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#c7d0e3;font-weight:500">DTII Valuers Ecosystem</div></td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 12px;font-size:20px">${esc(title)}</h1>
${bodyHtml}
${actionUrl ? `<p style="margin:24px 0"><a href="${esc(actionUrl)}" style="background:#005df8;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;display:inline-block">${esc(actionLabel)}</a></p>
<p style="font-size:12px;color:#5b667a">If the button does not work, copy this link into your browser:<br><span style="word-break:break-all">${esc(actionUrl)}</span></p>` : ''}
<p style="font-size:12px;color:#5b667a;margin-top:24px">${esc(footer || 'If you did not expect this email, you can ignore it.')}</p>
</td></tr></table></td></tr></table></body></html>`;
}

function inviteEmail({ fullName, firmName, roleNames, url, expiresDays }) {
  const where = firmName ? `${firmName} on the DTII Valuers Ecosystem` : 'the DTII Valuers Ecosystem platform';
  const roles = roleNames?.length ? ` as ${roleNames.join(', ')}` : '';
  return {
    subject: `Your account at ${firmName || env.APP_NAME}`,
    text: `Hello ${fullName},\n\nAn account has been created for you at ${where}${roles}.\nSet your password here (valid for ${expiresDays} days):\n${url}\n`,
    html: layout({
      title: 'Set up your account',
      firmName,
      bodyHtml: `<p>Hello ${esc(fullName)},</p><p>An account has been created for you at ${esc(where)}${esc(roles)}.</p><p>Choose a password to activate it. This link is valid for ${esc(expiresDays)} days and can be used once.</p>`,
      actionUrl: url,
      actionLabel: 'Set password',
    }),
  };
}

function passwordResetEmail({ fullName, url, expiresMinutes }) {
  return {
    subject: 'Reset your password',
    text: `Hello ${fullName},\n\nUse this link to reset your password (valid for ${expiresMinutes} minutes):\n${url}\n\nIf you did not ask for this, ignore this email.`,
    html: layout({
      title: 'Reset your password',
      bodyHtml: `<p>Hello ${esc(fullName)},</p><p>We received a request to reset your password. This link is valid for ${esc(expiresMinutes)} minutes and can be used once.</p>`,
      actionUrl: url,
      actionLabel: 'Reset password',
      footer: 'If you did not ask for a password reset, ignore this email. Your password will not change.',
    }),
  };
}

export { inviteEmail, passwordResetEmail, esc };

/** Generic workflow notification email, branded with the firm name. */
function notificationEmail({ firmName, fullName, title, body, url }) {
  return {
    subject: `${title}${firmName ? ` · ${firmName}` : ''}`,
    text: `Hello ${fullName},\n\n${body}\n${url ? `\nOpen: ${url}\n` : ''}`,
    html: layout({ title, firmName, bodyHtml: `<p>Hello ${esc(fullName)},</p><p>${esc(body)}</p>`, actionUrl: url, actionLabel: 'Open in Valuers Ecosystem', footer: 'You receive this email because of your role on this case.' }),
  };
}

export { notificationEmail };
