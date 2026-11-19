import { prisma } from '../database/prisma.js';
import { logger } from '../config/logger.js';

/** Audit actions. Never put passwords, tokens, PAN or document contents in `meta`. */
const AuditAction = Object.freeze({
  LOGIN_SUCCEEDED: 'LOGIN_SUCCEEDED',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGIN_BLOCKED_LOCKED: 'LOGIN_BLOCKED_LOCKED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_UNLOCKED: 'ACCOUNT_UNLOCKED',
  LOGOUT: 'LOGOUT',
  CONTEXT_SWITCHED: 'CONTEXT_SWITCHED',
  TOKEN_REUSE_DETECTED: 'TOKEN_REUSE_DETECTED',
  SESSION_REVOKED: 'SESSION_REVOKED',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  PASSWORD_RESET_REQUESTED: 'PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET_COMPLETED: 'PASSWORD_RESET_COMPLETED',
  INVITE_SENT: 'INVITE_SENT',
  INVITE_ACCEPTED: 'INVITE_ACCEPTED',
  FIRM_REGISTERED: 'FIRM_REGISTERED',
  FIRM_UPDATED: 'FIRM_UPDATED',
  FIRM_STATUS_CHANGED: 'FIRM_STATUS_CHANGED',
  FIRM_PROFILE_UPDATED: 'FIRM_PROFILE_UPDATED',
  EMPLOYEE_REGISTERED: 'EMPLOYEE_REGISTERED',
  EMPLOYEE_UPDATED: 'EMPLOYEE_UPDATED',
  EMPLOYEE_ROLES_CHANGED: 'EMPLOYEE_ROLES_CHANGED',
  EMPLOYEE_DEACTIVATED: 'EMPLOYEE_DEACTIVATED',
  EMPLOYEE_REACTIVATED: 'EMPLOYEE_REACTIVATED',
  CLIENT_CREATED: 'CLIENT_CREATED',
  CLIENT_UPDATED: 'CLIENT_UPDATED',
  CLIENT_DEACTIVATED: 'CLIENT_DEACTIVATED',
  CLIENT_REACTIVATED: 'CLIENT_REACTIVATED',
  CLIENT_PORTAL_ACCESS_GRANTED: 'CLIENT_PORTAL_ACCESS_GRANTED',
  PERMISSIONS_CHANGED: 'PERMISSIONS_CHANGED',
});

/** Request metadata captured with every audit row. */
const requestMeta = (req) => ({
  ip: req?.ip ? String(req.ip).slice(0, 64) : null,
  userAgent: req?.headers?.['user-agent'] ? String(req.headers['user-agent']).slice(0, 400) : null,
  requestId: req?.id ? String(req.id).slice(0, 64) : null,
});

/** Primary role code shown in audit rows for a principal. */
const actorRoleOf = (p) => (p ? (p.isSuperadmin && !p.firmId ? 'SUPER_ADMIN' : p.roles?.[0] ?? null) : null);

/**
 * Appends an audit row. Pass `db` (a transaction client) to make the audit part of the business transaction.
 * @param {{ action: string, principal?: object, req?: object, firmId?: string|null, actorId?: string|null,
 *           entityType?: string, entityId?: string, meta?: object }} entry
 */
async function recordAudit(entry, db = prisma) {
  const { action, principal, req, entityType = null, entityId = null, meta = {} } = entry;
  const firmId = entry.firmId !== undefined ? entry.firmId : principal?.firmId ?? null;
  const actorId = entry.actorId !== undefined ? entry.actorId : principal?.userId ?? null;
  return db.auditLog.create({
    data: { action, firmId, actorId, actorRole: entry.actorRole ?? actorRoleOf(principal), entityType, entityId, meta, ...requestMeta(req) },
  });
}

/** Best-effort audit outside a transaction (e.g. failed logins): never breaks the request. */
async function recordAuditSafe(entry) {
  try {
    await recordAudit(entry);
  } catch (e) {
    logger.error({ err: e.message, action: entry.action }, 'Audit write failed');
  }
}

export { AuditAction, recordAudit, recordAuditSafe, requestMeta };
