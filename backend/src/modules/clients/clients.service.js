import { prisma } from '../../database/prisma.js';
import { ROLES } from '../../config/rbac.js';
import { BadRequest, Conflict, Forbidden, NotFound } from '../../utils/errors.js';
import { nextFirmCode } from '../../database/sequences.js';
import { encrypt, hmac } from '../../services/crypto.js';
import { AuditAction, recordAudit } from '../../services/audit.service.js';
import { hasPermission } from '../../middleware/authorize.js';
import { invalidateUserPrincipals } from '../../services/principal.service.js';
import { paginate, skipTake } from '../../utils/pagination.js';
import { ensureUserForFirm, userSummary } from '../users/users.service.js';
import { resendInvite, sendInvite } from '../auth/invitations.js';
import { PAN_REGEX } from './clients.schema.js';

/**
 * Client master. Tenant scope always comes from the principal.
 * Visibility: Firm Admin and Marketing (case.view.all / client.manage) see every client of the firm.
 * Field officers and reviewers see only clients of cases assigned to them — that link is added with case
 * assignments, so until then their client list is empty by design. A client sees only their own record.
 */
function clientScope(principal) {
  const base = { firmId: principal.firmId, deletedAt: null };
  if (hasPermission(principal, 'case.view.all') || hasPermission(principal, 'client.manage')) return base;
  if (principal.clientId) return { ...base, id: principal.clientId };
  return { ...base, id: { in: [] } };
}

/** PAN → { panEnc, panHmac, panLast4 } (or all null). The plain PAN is never stored or logged. */
function panColumns(pan) {
  if (pan === undefined) return {};
  if (!pan) return { panEnc: null, panHmac: null, panLast4: null };
  return { panEnc: encrypt(pan), panHmac: hmac(pan), panLast4: pan.slice(-4) };
}

const maskedPan = (last4) => (last4 ? `XXXXXX${last4}` : null);

function toClient(c) {
  return {
    id: c.id,
    clientCode: c.clientCode,
    clientType: c.clientType,
    name: c.name,
    contactPerson: c.contactPerson,
    email: c.email,
    phone: c.phone,
    altPhone: c.altPhone,
    panMasked: maskedPan(c.panLast4),
    gstin: c.gstin,
    addressLine1: c.addressLine1,
    addressLine2: c.addressLine2,
    city: c.city,
    state: c.state,
    pincode: c.pincode,
    notes: c.notes,
    status: c.status,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    portalUser: c.user ? userSummary(c.user) : null,
  };
}

async function findVisible(principal, id, db = prisma) {
  const c = await db.client.findFirst({ where: { AND: [{ id }, clientScope(principal)] }, include: { user: true } });
  if (!c) throw NotFound('Client not found');
  return c;
}

async function assertPanUnique(db, firmId, pan, exceptId) {
  if (!pan) return;
  const dup = await db.client.findFirst({ where: { firmId, panHmac: hmac(pan), ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { clientCode: true } });
  if (dup) throw Conflict(`A client with this PAN already exists (${dup.clientCode})`);
}

async function list(principal, { page, pageSize, search, status, clientType }) {
  const term = search?.toUpperCase();
  const where = {
    AND: [
      clientScope(principal),
      status ? { status } : {},
      clientType ? { clientType } : {},
      search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { clientCode: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search } },
              { contactPerson: { contains: search, mode: 'insensitive' } },
              ...(PAN_REGEX.test(term) ? [{ panHmac: hmac(term) }] : []),
            ],
          }
        : {},
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.client.findMany({ where, include: { user: true }, orderBy: { createdAt: 'desc' }, ...skipTake({ page, pageSize }) }),
    prisma.client.count({ where }),
  ]);
  return paginate(rows.map(toClient), total, { page, pageSize });
}

const get = async (principal, id) => toClient(await findVisible(principal, id));

async function create(principal, body, req) {
  const { createPortalLogin, pan, ...data } = body;
  if (createPortalLogin && !data.email) throw BadRequest('An email address is required to create a portal login');
  const client = await prisma.$transaction(async (tx) => {
    await assertPanUnique(tx, principal.firmId, pan);
    const clientCode = await nextFirmCode(tx, principal.firmId, 'CLIENT');
    const created = await tx.client.create({ data: { ...data, ...panColumns(pan), firmId: principal.firmId, clientCode, createdById: principal.userId } });
    await recordAudit({ action: AuditAction.CLIENT_CREATED, principal, req, entityType: 'client', entityId: created.id, meta: { clientCode } }, tx);
    return created;
  });
  const portal = createPortalLogin ? await grantPortalAccess(principal, client.id, req) : null;
  return { client: await get(principal, client.id), portal };
}

async function update(principal, id, body, req) {
  if (!hasPermission(principal, 'client.manage')) throw Forbidden();
  const { pan, ...data } = body;
  await findVisible(principal, id);
  await prisma.$transaction(async (tx) => {
    if (pan) await assertPanUnique(tx, principal.firmId, pan, id);
    await tx.client.update({ where: { id }, data: { ...data, ...panColumns(pan) } });
    await recordAudit({ action: AuditAction.CLIENT_UPDATED, principal, req, entityType: 'client', entityId: id, meta: { fields: Object.keys(body) } }, tx);
  });
  return get(principal, id);
}

async function setStatus(principal, id, status, req) {
  const c = await findVisible(principal, id);
  if (c.status === status) throw BadRequest(`Client is already ${status.toLowerCase()}`);
  await prisma.$transaction(async (tx) => {
    await tx.client.update({ where: { id }, data: { status } });
    if (status === 'INACTIVE' && c.userId) {
      await tx.userSession.updateMany({ where: { userId: c.userId, firmId: principal.firmId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'CLIENT_DEACTIVATED' } });
    }
    await recordAudit({ action: status === 'ACTIVE' ? AuditAction.CLIENT_REACTIVATED : AuditAction.CLIENT_DEACTIVATED, principal, req, entityType: 'client', entityId: id }, tx);
  });
  if (c.userId) await invalidateUserPrincipals(c.userId);
  return get(principal, id);
}

/**
 * Creates (or re-sends) the client's portal login: a CLIENT role in this firm linked to the client record.
 * The client's email becomes their login. One portal login per client per firm.
 */
async function grantPortalAccess(principal, id, req) {
  const c = await findVisible(principal, id);
  if (c.status !== 'ACTIVE') throw BadRequest('Activate the client before granting portal access');
  if (!c.email) throw BadRequest('Add an email address to the client first');

  if (c.userId) {
    if (c.user.status !== 'INVITED') throw BadRequest('This client already has an active portal login');
    const invite = await resendInvite({ user: c.user, firmName: principal.firm.name, roleNames: ['Client'], createdById: principal.userId });
    await recordAudit({ action: AuditAction.INVITE_SENT, principal, req, entityType: 'client', entityId: id });
    return invite;
  }

  const result = await prisma.$transaction(async (tx) => {
    const { user, inviteToken } = await ensureUserForFirm(tx, { email: c.email, fullName: c.contactPerson || c.name, phone: c.phone, createdById: principal.userId });
    const linked = await tx.client.findUnique({ where: { firmId_userId: { firmId: principal.firmId, userId: user.id } }, select: { clientCode: true } });
    if (linked) throw Conflict(`This email is already the portal login of client ${linked.clientCode}`);
    const role = await tx.role.findUniqueOrThrow({ where: { code: ROLES.CLIENT } });
    await tx.userRole.upsert({
      where: { userId_firmId_roleId: { userId: user.id, firmId: principal.firmId, roleId: role.id } },
      update: { status: 'ACTIVE' },
      create: { userId: user.id, firmId: principal.firmId, roleId: role.id, createdById: principal.userId },
    });
    await tx.client.update({ where: { id }, data: { userId: user.id } });
    await recordAudit({ action: AuditAction.CLIENT_PORTAL_ACCESS_GRANTED, principal, req, entityType: 'client', entityId: id }, tx);
    return { user, inviteToken };
  });
  await invalidateUserPrincipals(result.user.id);
  return result.inviteToken
    ? sendInvite({ rawToken: result.inviteToken, email: result.user.email, fullName: result.user.fullName, firmName: principal.firm.name, roleNames: ['Client'] })
    : { sent: false, existingAccount: true };
}

export { list, get, create, update, setStatus, grantPortalAccess, clientScope };
