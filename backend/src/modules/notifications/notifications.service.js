import { createHash } from 'node:crypto';
import { env } from '../../config/env.js';
import { prisma } from '../../database/prisma.js';
import { NotFound } from '../../utils/errors.js';
import { hmac } from '../../services/crypto.js';
import { enqueue } from '../../jobs/queues.js';
import { sendMail } from '../../services/mail/mail.service.js';
import { notificationEmail } from '../../services/mail/templates.js';
import { paginate, skipTake } from '../../utils/pagination.js';

/**
 * In-app notifications + queued, branded emails.
 * notify() creates one notification per recipient (deduplicated by `dedupeKey`) and queues an email for each
 * recipient with an address; the mail worker delivers it and records the outcome in email_logs.
 */
const mask = (email) => {
  const [l, d] = String(email).split('@');
  return `${l.slice(0, 2)}${'*'.repeat(Math.max(1, l.length - 2))}@${d}`;
};

/**
 * @param {{ firmId: string|null, recipientIds: string[], event: string, caseId?: string, title: string, body: string,
 *           link?: string, dedupe: string, email?: boolean }} n
 */
async function notify({ firmId, recipientIds, event, caseId = null, title, body, link = null, dedupe, email = true }) {
  const ids = [...new Set(recipientIds.filter(Boolean))];
  if (!ids.length) return [];
  const created = [];
  for (const recipientId of ids) {
    const dedupeKey = createHash('sha256').update(`${event}|${dedupe}|${recipientId}`).digest('hex');
    try {
      created.push(await prisma.notification.create({ data: { firmId, recipientId, event, caseId, title, body, link, dedupeKey } }));
    } catch (e) {
      if (e?.code === 'P2002') continue; // already notified for this event
      throw e;
    }
  }
  if (!email || !created.length) return created;
  const users = await prisma.user.findMany({ where: { id: { in: created.map((n) => n.recipientId) }, status: 'ACTIVE', deletedAt: null }, select: { id: true, email: true, fullName: true } });
  const firm = firmId ? await prisma.organization.findUnique({ where: { id: firmId }, select: { name: true } }) : null;
  for (const n of created) {
    const u = users.find((x) => x.id === n.recipientId);
    if (!u) continue;
    const mail = notificationEmail({ firmName: firm?.name, fullName: u.fullName, title, body, url: link ? `${env.WEB_APP_URL}${link}` : null });
    const log = await prisma.emailLog.create({ data: { firmId, notificationId: n.id, toMasked: mask(u.email), toHash: hmac(u.email), template: event, subject: mail.subject } });
    await enqueue('mail', 'send', { emailLogId: log.id, firmId, to: u.email, ...mail }, { jobId: `mail__${log.id}` });
  }
  return created;
}

/** Mail queue processor: deliver and record the outcome (throws on failure so BullMQ retries). */
async function processMailJob(data, attemptsMade = 0) {
  const result = await sendMail({ firmId: data.firmId, to: data.to, subject: data.subject, html: data.html, text: data.text });
  await prisma.emailLog.update({
    where: { id: data.emailLogId },
    data: { status: result.sent ? 'SENT' : 'FAILED', provider: result.provider, attempts: attemptsMade + 1, providerMessageId: result.messageId ?? null, error: result.error ?? null, sentAt: result.sent ? new Date() : null },
  });
  if (!result.sent) throw new Error(result.error ?? 'Mail delivery failed');
  return result;
}

async function list(principal, { page, pageSize, unreadOnly }) {
  const where = { recipientId: principal.userId, ...(principal.firmId ? { OR: [{ firmId: principal.firmId }, { firmId: null }] } : {}), ...(unreadOnly ? { readAt: null } : {}) };
  const [items, total] = await Promise.all([prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake({ page, pageSize }) }), prisma.notification.count({ where })]);
  return paginate(items, total, { page, pageSize });
}

const unreadCount = async (principal) => ({ unread: await prisma.notification.count({ where: { recipientId: principal.userId, readAt: null } }) });

async function markRead(principal, id) {
  const r = await prisma.notification.updateMany({ where: { id, recipientId: principal.userId, readAt: null }, data: { readAt: new Date() } });
  if (!r.count && !(await prisma.notification.findFirst({ where: { id, recipientId: principal.userId } }))) throw NotFound('Notification not found');
}

const markAllRead = (principal) => prisma.notification.updateMany({ where: { recipientId: principal.userId, readAt: null }, data: { readAt: new Date() } });

export { notify, processMailJob, list, unreadCount, markRead, markAllRead, mask };
