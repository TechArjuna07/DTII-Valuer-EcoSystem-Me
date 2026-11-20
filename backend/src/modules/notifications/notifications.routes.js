import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { requireFirmContext, requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { documentRoute } from '../../docs/registry.js';
import { prisma } from '../../database/prisma.js';
import { BadRequest } from '../../utils/errors.js';
import { encrypt } from '../../services/crypto.js';
import { recordAudit } from '../../services/audit.service.js';
import { sendMail } from '../../services/mail/mail.service.js';
import { notificationEmail } from '../../services/mail/templates.js';
import { listQuery, paginate, skipTake } from '../../utils/pagination.js';
import { email, opt, str } from '../organizations/organizations.schema.js';
import * as svc from './notifications.service.js';

/** In-app notifications (every user) and the firm's email (SMTP) settings & delivery log (Firm Admin). */
const router = Router();
const idParam = z.strictObject({ id: z.uuid() });

router.get('/notifications', authenticate, validate({ query: z.strictObject({ page: listQuery.page, pageSize: listQuery.pageSize, unreadOnly: z.enum(['true', 'false']).optional() }) }), async (req, res) =>
  res.json(await svc.list(req.principal, { ...req.valid.query, unreadOnly: req.valid.query.unreadOnly === 'true' })),
);
router.get('/notifications/unread-count', authenticate, async (req, res) => res.json(await svc.unreadCount(req.principal)));
router.post('/notifications/:id/read', authenticate, validate({ params: idParam }), async (req, res) => {
  await svc.markRead(req.principal, req.valid.params.id);
  res.status(204).end();
});
router.post('/notifications/read-all', authenticate, async (req, res) => {
  await svc.markAllRead(req.principal);
  res.status(204).end();
});

// ───── Firm SMTP settings ─────
const smtp = [authenticate, requireFirmContext, requirePermission('firm.smtp.manage')];
const smtpBody = z.discriminatedUnion('provider', [
  z.strictObject({ provider: z.literal('platform') }),
  z.strictObject({ provider: z.literal('gmail'), user: email, from: opt(str(200)), secret: opt(str(200)) }),
  z.strictObject({ provider: z.literal('office365'), tenantId: str(100).min(10), clientId: str(100).min(10), sender: email, secret: opt(str(500)) }),
]);

async function smtpView(firmId) {
  const s = await prisma.organizationSettings.findUnique({ where: { firmId } });
  return { provider: s?.smtpProvider ?? 'platform', config: s?.smtpConfig ?? {}, hasSecret: !!s?.smtpSecretEnc, updatedAt: s?.updatedAt ?? null };
}

router.get('/firm/smtp', ...smtp, async (req, res) => res.json(await smtpView(req.principal.firmId)));
router.put('/firm/smtp', ...smtp, validate({ body: smtpBody }), async (req, res) => {
  const { provider, secret, ...config } = req.valid.body;
  const current = await prisma.organizationSettings.findUnique({ where: { firmId: req.principal.firmId } });
  if (provider !== 'platform' && !secret && (!current?.smtpSecretEnc || current.smtpProvider !== provider)) throw BadRequest(provider === 'gmail' ? 'Enter the Gmail app password' : 'Enter the client secret');
  const data =
    provider === 'platform'
      ? { smtpProvider: null, smtpConfig: null, smtpSecretEnc: null }
      : { smtpProvider: provider, smtpConfig: config, ...(secret ? { smtpSecretEnc: encrypt(secret) } : {}) };
  await prisma.organizationSettings.upsert({ where: { firmId: req.principal.firmId }, update: { ...data, updatedById: req.principal.userId }, create: { firmId: req.principal.firmId, ...data } });
  await recordAudit({ action: 'SMTP_SETTINGS_UPDATED', principal: req.principal, req, entityType: 'organization', entityId: req.principal.firmId, meta: { provider, secretChanged: !!secret } });
  res.json(await smtpView(req.principal.firmId));
});
router.post('/firm/smtp/test', ...smtp, validate({ body: z.strictObject({ to: email }) }), async (req, res) => {
  const mail = notificationEmail({ firmName: req.principal.firm.name, fullName: req.principal.fullName, title: 'Test email', body: 'Your firm email settings work. Workflow notifications will be sent from this account.', url: null });
  const r = await sendMail({ firmId: req.principal.firmId, to: req.valid.body.to, ...mail });
  res.json({ sent: r.sent, provider: r.provider, error: r.error ?? null });
});
router.get('/firm/email-logs', ...smtp, validate({ query: z.strictObject({ page: listQuery.page, pageSize: listQuery.pageSize, status: z.enum(['QUEUED', 'SENT', 'FAILED', 'SKIPPED']).optional() }) }), async (req, res) => {
  const where = { firmId: req.principal.firmId, ...(req.valid.query.status ? { status: req.valid.query.status } : {}) };
  const [items, total] = await Promise.all([prisma.emailLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(req.valid.query) }), prisma.emailLog.count({ where })]);
  res.json(paginate(items.map(({ toHash: _h, ...x }) => x), total, req.valid.query));
});

const tag = 'Notifications & email';
[
  ['get', '/notifications', 'My notifications', null],
  ['get', '/notifications/unread-count', 'Unread notification count', null],
  ['post', '/notifications/:id/read', 'Mark a notification read', null],
  ['post', '/notifications/read-all', 'Mark all notifications read', null],
  ['get', '/firm/smtp', 'Firm email settings (secret never returned)', 'firm.smtp.manage'],
  ['put', '/firm/smtp', 'Set firm email: platform default, Gmail SMTP (app password) or Microsoft 365 (OAuth2)', 'firm.smtp.manage'],
  ['post', '/firm/smtp/test', 'Send a test email with the firm settings', 'firm.smtp.manage'],
  ['get', '/firm/email-logs', 'Email delivery log (recipients masked)', 'firm.smtp.manage'],
].forEach(([method, path, summary, permission]) => documentRoute({ method, path, tag, summary, ...(permission ? { permission } : {}) }));

export default router;
