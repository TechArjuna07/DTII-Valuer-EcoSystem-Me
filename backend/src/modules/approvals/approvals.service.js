import { createHash } from 'node:crypto';
import { logger } from '../../config/logger.js';
import { prisma } from '../../database/prisma.js';
import { ROLES } from '../../config/rbac.js';
import { BadRequest, Conflict, Forbidden, NotFound, ServiceUnavailable } from '../../utils/errors.js';
import { hasPermission } from '../../middleware/authorize.js';
import { emit } from '../../services/events.js';
import { recordAudit } from '../../services/audit.service.js';
import { verifyPassword } from '../../services/password.js';
import * as storage from '../../services/storage/storage.service.js';
import { getSignatureProvider } from '../../services/signature/provider.js';
import { appendSignaturePage } from '../../services/signature/signature-page.js';
import { findVisibleCase } from '../cases/case-access.js';
import { STATUS } from '../workflow/workflow.definition.js';
import { activeAssignments, lockCase, recordActivity, transition } from '../workflow/workflow.service.js';
import { storeVersion } from '../documents/documents.service.js';
import { setSignatureLookup } from '../valuations/valuations.service.js';

/**
 * Client approval & digital signatures (docs/PHASE_1 §11 D3/D4):
 *   1. The senior reviewer (valuer) signs the approved final report.            FINAL_APPROVED
 *   2. The report is released to the client (needs the valuer signature).        → CLIENT_APPROVAL_PENDING
 *   3. The client verifies the facts and approves, or raises a query.          → CLIENT_APPROVED / CLIENT_QUERY_RAISED
 *   4. The client signs an acknowledgement of the (valuer-signed) report.      → CLIENT_SIGNED (system transition)
 * Signing always re-authenticates the signer (password) and records explicit consent, IP and timestamps.
 */
const emitAll = (events) => events.forEach(([n, p]) => emit(n, p));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const isPortalClient = (p) => !!p.clientId && !p.employeeId;

const CONSENT = {
  VALUER: (name, caseNumber, version) => `I, ${name}, as valuer, have prepared/verified valuation report ${caseNumber} version ${version} and sign it electronically. My signature is recorded with date, time and IP address.`,
  CLIENT: (name, caseNumber) => `I, ${name}, acknowledge receipt of valuation report ${caseNumber} and confirm that the property particulars stated in it are correct to my knowledge. My signature is recorded with date, time and IP address.`,
};

async function finalState(caseId) {
  const report = await prisma.valuationReport.findUnique({ where: { caseId_stage: { caseId, stage: 'FINAL' } } });
  const version = report?.currentVersionId ? await prisma.valuationReportVersion.findUnique({ where: { id: report.currentVersionId } }) : null;
  const doc = version?.documentId ? await prisma.caseDocument.findUnique({ where: { id: version.documentId } }) : null;
  const docVersion = doc?.currentVersionId ? await prisma.documentVersion.findUnique({ where: { id: doc.currentVersionId } }) : null;
  return { report, version, doc, docVersion };
}

const toSignature = (s) => ({
  id: s.id,
  signerRole: s.signerRole,
  signerName: s.signerName,
  provider: s.provider,
  status: s.status,
  legallyValid: s.legallyValid,
  verificationStatus: s.verificationStatus,
  documentSha256: s.documentSha256,
  signedSha256: s.signedSha256,
  certSubject: s.certSubject,
  certIssuer: s.certIssuer,
  certSerial: s.certSerial,
  signatureAlgorithm: s.signatureAlgorithm,
  requestedAt: s.requestedAt,
  signedAt: s.signedAt,
  verifiedAt: s.verifiedAt,
  signedVersionId: s.signedVersionId,
  lastError: s.lastError,
});

async function getApproval(principal, caseId) {
  const c = await findVisibleCase(principal, caseId, prisma, { bank: true });
  const portal = isPortalClient(principal);
  const released = [STATUS.CLIENT_APPROVAL_PENDING, STATUS.CLIENT_QUERY_RAISED, STATUS.CLIENT_APPROVED, STATUS.CLIENT_SIGNED, STATUS.SUBMITTED_TO_BANK, STATUS.LOAN_SANCTIONED, STATUS.DISBURSED, STATUS.CASE_COMPLETED].includes(c.status);
  if (portal && !released) return { caseStatus: c.status, released: false, finalReport: null, approvals: [], signatures: [], permissions: {} };
  const { report, version, doc, docVersion } = await finalState(caseId);
  const [approvals, signatures, assignments] = await Promise.all([
    prisma.clientApproval.findMany({ where: { caseId }, orderBy: { createdAt: 'desc' } }),
    prisma.digitalSignature.findMany({ where: { caseId, ...(portal ? { status: 'SIGNED' } : {}) }, orderBy: { requestedAt: 'desc' } }),
    activeAssignments(prisma, caseId),
  ]);
  const isSenior = assignments.some((a) => a.stage === 'SENIOR' && a.employeeId === principal.employeeId);
  const isAdmin = principal.roles.includes(ROLES.FIRM_ADMIN);
  const valuerSigned = signatures.find((s) => s.signerRole === 'VALUER' && s.status === 'SIGNED' && s.signedVersionId === doc?.currentVersionId);
  const pendingValuer = signatures.find((s) => s.signerRole === 'VALUER' && s.status === 'PENDING');
  const pendingClient = signatures.find((s) => s.signerRole === 'CLIENT' && s.status === 'PENDING');
  const provider = getSignatureProvider();
  const me = await prisma.user.findUnique({ where: { id: principal.userId }, select: { fullName: true } });
  return {
    caseStatus: c.status,
    released,
    requiresClientApproval: c.bank.requiresClientApproval,
    provider: { name: provider.name, legallyValid: provider.legallyValid, synchronous: provider.synchronous },
    finalReport: version
      ? {
          reportStatus: report.status,
          version: version.version,
          marketValue: Number(version.marketValue),
          realisableValue: Number(version.realisableValue),
          distressValue: Number(version.distressValue),
          documentId: doc?.id ?? null,
          documentVersionId: docVersion?.id ?? null,
          documentSha256: docVersion?.sha256 ?? null,
          verificationCode: version.verificationCode,
          valuerSigned: !!valuerSigned,
        }
      : null,
    approvals: approvals.map((a) => ({ id: a.id, decision: a.decision, comments: a.comments, createdAt: a.createdAt })),
    signatures: signatures.map(toSignature),
    consentText: portal ? CONSENT.CLIENT(me.fullName, c.caseNumber) : version ? CONSENT.VALUER(me.fullName, c.caseNumber, version.version) : null,
    permissions: {
      canValuerSign: !portal && isSenior && hasPermission(principal, 'signature.valuer') && c.status === STATUS.FINAL_APPROVED && !!docVersion && !valuerSigned && !pendingValuer,
      canRelease: !portal && (isSenior || isAdmin) && hasPermission(principal, 'report.release') && c.status === STATUS.FINAL_APPROVED && !!valuerSigned && c.bank.requiresClientApproval,
      canDecide: portal && principal.clientId === c.clientId && hasPermission(principal, 'client.approve') && c.status === STATUS.CLIENT_APPROVAL_PENDING,
      canClientSign: portal && principal.clientId === c.clientId && hasPermission(principal, 'signature.client') && c.status === STATUS.CLIENT_APPROVED && !pendingClient,
    },
  };
}

async function reauthenticate(principal, password) {
  const user = await prisma.user.findUnique({ where: { id: principal.userId } });
  if (!(await verifyPassword(user.passwordHash, password))) throw BadRequest('Password is incorrect');
  return user;
}

/**
 * Starts (and, for synchronous providers, completes) a signature on the current final-report document version.
 * VALUER signatures produce a new version of the final report document; CLIENT signatures are filed into
 * 07_Client_Signed_Files and complete the CLIENT_SIGNED transition.
 */
async function sign(principal, caseId, role, { password, consent }, req) {
  if (!consent) throw BadRequest('You must confirm the declaration to sign');
  const view = await getApproval(principal, caseId);
  if (role === 'VALUER' && !view.permissions.canValuerSign) throw Forbidden('You cannot sign this report now');
  if (role === 'CLIENT' && !view.permissions.canClientSign) throw Forbidden('You cannot sign this report now');
  const user = await reauthenticate(principal, password);
  const { doc, docVersion, version } = await finalState(caseId);
  const source = await storage.getBuffer(docVersion.storageKey);
  if (sha256(source) !== docVersion.sha256) throw Conflict('The report file failed its integrity check; contact your firm');
  const provider = getSignatureProvider();
  const meta = { ip: req.ip ? String(req.ip).slice(0, 64) : null, userAgent: req.headers['user-agent']?.slice(0, 400) ?? null };
  const consentText = view.consentText;

  const events = await prisma.$transaction(
    async (tx) => {
      const c = await lockCase(tx, principal.firmId, caseId);
      const base = {
        firmId: c.firmId,
        caseId,
        sourceVersionId: docVersion.id,
        reportVersionId: version.id,
        signerUserId: user.id,
        signerRole: role,
        signerName: user.fullName,
        signerEmail: user.email,
        provider: provider.name,
        documentSha256: docVersion.sha256,
        consentText,
        legallyValid: provider.legallyValid,
        ...meta,
      };
      if (!provider.synchronous) {
        let started;
        try {
          started = await provider.startRequest({ pdf: source, fileName: docVersion.originalName, signerEmail: user.email, signerName: user.fullName, requesterEmail: user.email, message: consentText });
        } catch (e) {
          throw ServiceUnavailable(e.message);
        }
        const s = await tx.digitalSignature.create({ data: { ...base, providerRef: started.providerRef, status: 'PENDING' } });
        await recordActivity(tx, { c, principal, action: `${role}_SIGNATURE_REQUESTED`, meta: { signatureId: s.id, provider: provider.name }, req, clientVisible: role === 'CLIENT', actorRole: role === 'CLIENT' ? ROLES.CLIENT : ROLES.SENIOR_REVIEWER });
        return [];
      }
      const result = provider.signNow({ documentSha256: docVersion.sha256, signerUserId: user.id, signerName: user.fullName, signerRole: role, caseNumber: c.caseNumber });
      return completeSignature(tx, principal, c, { ...base, ...result }, { source, doc, docVersion, req });
    },
    { timeout: 60_000 },
  );
  emitAll(events);
  return getApproval(principal, caseId);
}

/** Files the signed PDF, stores the signature record and (for clients) completes the CLIENT_SIGNED transition. */
async function completeSignature(tx, principal, c, record, { source, doc, signedPdf, req }) {
  const pdf =
    signedPdf ??
    (await appendSignaturePage(source, {
      caseNumber: c.caseNumber,
      documentTitle: doc.title,
      signerName: record.signerName,
      signerEmail: record.signerEmail,
      signerRole: record.signerRole,
      signedAt: record.signedAt,
      ip: record.ip,
      provider: record.provider,
      signatureAlgorithm: record.signatureAlgorithm,
      certSubject: record.certSubject,
      certIssuer: record.certIssuer,
      documentSha256: record.documentSha256,
      signatureValue: record.signatureValue,
      consentText: record.consentText,
      legallyValid: record.legallyValid,
    }));
  const isValuer = record.signerRole === 'VALUER';
  const stored = await storeVersion({
    principal: isValuer ? principal : null,
    c,
    folder: isValuer ? 'FINAL_VALUATION_REPORT' : 'CLIENT_SIGNED_FILES',
    content: { buffer: pdf, fileName: `${c.caseNumber}_${isValuer ? 'Valuation_Report_valuer_signed' : 'Valuation_Report_client_signed'}.pdf`, mimeType: 'application/pdf' },
    title: isValuer ? doc.title : 'Signed valuation report',
    documentId: isValuer ? doc.id : null,
    visibility: isValuer ? 'INTERNAL' : 'CLIENT',
    uploadSource: 'SIGNATURE',
    note: `${record.signerRole.toLowerCase()} signature via ${record.provider}`,
    req,
    tx,
  });
  const { status: _s, signedAt, ...rest } = record;
  const data = { ...rest, status: 'SIGNED', signedAt: new Date(signedAt ?? Date.now()), signedVersionId: stored.version.id, signedSha256: stored.version.sha256, verificationStatus: 'VERIFIED', verifiedAt: new Date(), verificationDetail: { atSigning: true } };
  const sig = record.id ? await tx.digitalSignature.update({ where: { id: record.id }, data }) : await tx.digitalSignature.create({ data });
  await recordActivity(tx, {
    c,
    principal: isValuer ? principal : null,
    action: `${record.signerRole}_SIGNATURE_COMPLETED`,
    documentVersionId: stored.version.id,
    meta: { signatureId: sig.id, provider: record.provider, legallyValid: record.legallyValid },
    req,
    clientVisible: true,
    actorRole: isValuer ? ROLES.SENIOR_REVIEWER : ROLES.CLIENT,
  });
  await recordAudit({ action: 'DIGITAL_SIGNATURE_COMPLETED', firmId: c.firmId, actorId: record.signerUserId, actorRole: record.signerRole, req, entityType: 'digital_signature', entityId: sig.id, meta: { caseId: c.id, provider: record.provider } }, tx);
  const events = [...stored.events, ['signature.completed', { firmId: c.firmId, caseId: c.id, role: record.signerRole, signatureId: sig.id, actorId: record.signerUserId }]];
  if (isValuer) events.push(...(await autoRelease(tx, principal, c.id, doc.id, stored.version.id, req)));
  if (!isValuer) {
    const fresh = await tx.valuationCase.findUnique({ where: { id: c.id }, include: { bank: true } });
    const t = await transition(tx, null, fresh, 'CLIENT_SIGNATURE_COMPLETED', { system: true, documentVersionId: stored.version.id, req });
    events.push(...t.events);
  }
  return events;
}

/**
 * Senior → client hand-over: once the valuer has signed, the report goes straight to the client for review and
 * acceptance when the lender needs client approval, the client has an active portal login and the firm has not
 * switched off workflowOptions.autoReleaseToClient. Otherwise the senior reviewer / Firm Admin releases it manually.
 */
async function autoRelease(tx, principal, caseId, documentId, documentVersionId, req) {
  const c = await tx.valuationCase.findUnique({ where: { id: caseId }, include: { bank: true, client: { select: { userId: true, status: true } } } });
  const settings = await tx.organizationSettings.findUnique({ where: { firmId: c.firmId }, select: { workflowOptions: true } });
  if (c.status !== STATUS.FINAL_APPROVED || !c.bank.requiresClientApproval) return [];
  if ((settings?.workflowOptions?.autoReleaseToClient ?? true) === false) return [];
  if (!c.client.userId || c.client.status !== 'ACTIVE') return [];
  await tx.caseDocument.update({ where: { id: documentId }, data: { visibility: 'CLIENT' } });
  const t = await transition(tx, principal, c, 'RELEASE_TO_CLIENT', { system: true, req, documentVersionId, meta: { automatic: true } });
  return t.events;
}

/** Releases the valuer-signed final report to the client portal. */
async function release(principal, caseId, req) {
  const view = await getApproval(principal, caseId);
  if (!view.finalReport?.valuerSigned) throw Conflict('The valuer must sign the final report before it is released');
  if (!view.permissions.canRelease) throw Forbidden('You cannot release this report now');
  const { doc } = await finalState(caseId);
  const events = await prisma.$transaction(async (tx) => {
    const c = await lockCase(tx, principal.firmId, caseId);
    await tx.caseDocument.update({ where: { id: doc.id }, data: { visibility: 'CLIENT' } });
    const t = await transition(tx, principal, c, 'RELEASE_TO_CLIENT', { req, documentVersionId: doc.currentVersionId });
    return t.events;
  });
  emitAll(events);
  return getApproval(principal, caseId);
}

/** Client approves the released report or raises a query (comments required). */
async function decide(principal, caseId, { decision, comments }, req) {
  const view = await getApproval(principal, caseId);
  if (!view.permissions.canDecide) throw Forbidden('You cannot respond to this report now');
  if (decision === 'QUERY' && !(comments && comments.trim().length >= 3)) throw BadRequest('Describe your query');
  const { version } = await finalState(caseId);
  const events = await prisma.$transaction(async (tx) => {
    const c = await lockCase(tx, principal.firmId, caseId);
    await tx.clientApproval.create({ data: { firmId: c.firmId, caseId, reportVersionId: version.id, decision, comments: comments ?? null, clientUserId: principal.userId, ip: req.ip ? String(req.ip).slice(0, 64) : null, userAgent: req.headers['user-agent']?.slice(0, 400) ?? null } });
    const t = await transition(tx, principal, c, decision === 'APPROVED' ? 'CLIENT_APPROVE' : 'CLIENT_RAISE_QUERY', { remarks: comments, req, meta: { reportVersion: version.version } });
    return t.events;
  });
  emitAll(events);
  return getApproval(principal, caseId);
}

/** Polls an asynchronous provider for a pending signature and completes it when signed. */
async function syncSignature(signatureId) {
  const s = await prisma.digitalSignature.findUnique({ where: { id: signatureId } });
  if (!s || s.status !== 'PENDING') return s;
  const provider = getSignatureProvider();
  if (provider.synchronous || provider.name !== s.provider) return s;
  let r;
  try {
    r = await provider.poll(s.providerRef);
  } catch (e) {
    await prisma.digitalSignature.update({ where: { id: s.id }, data: { lastSyncedAt: new Date(), lastError: String(e.message).slice(0, 500) } });
    return s;
  }
  if (r.status === 'PENDING') return prisma.digitalSignature.update({ where: { id: s.id }, data: { lastSyncedAt: new Date(), lastError: null } });
  if (r.status !== 'SIGNED') return prisma.digitalSignature.update({ where: { id: s.id }, data: { status: r.status, lastSyncedAt: new Date(), lastError: r.error ?? null } });
  const docVersion = await prisma.documentVersion.findUnique({ where: { id: s.sourceVersionId } });
  const doc = await prisma.caseDocument.findUnique({ where: { id: docVersion.documentId } });
  const signer = await prisma.user.findUnique({ where: { id: s.signerUserId } });
  const events = await prisma.$transaction(
    async (tx) => {
      const c = await lockCase(tx, s.firmId, s.caseId);
      const principal = s.signerRole === 'VALUER' ? { userId: signer.id, firmId: s.firmId, roles: [ROLES.SENIOR_REVIEWER], permissions: [] } : null;
      return completeSignature(
        tx,
        principal,
        c,
        {
          ...s,
          signatureAlgorithm: 'PAdES (provider)',
          certSubject: r.cert?.subject ?? s.signerName,
          certIssuer: r.cert?.issuer ?? null,
          certSerial: r.cert?.serial ?? null,
          certValidFrom: r.cert?.validFrom ? new Date(r.cert.validFrom) : null,
          certValidTo: r.cert?.validTo ? new Date(r.cert.validTo) : null,
          signedAt: r.cert?.signedAt ?? new Date().toISOString(),
        },
        { doc, signedPdf: r.signedPdf, req: null },
      );
    },
    { timeout: 60_000 },
  );
  emitAll(events);
  return prisma.digitalSignature.findUnique({ where: { id: s.id } });
}

async function syncAllPending() {
  const pending = await prisma.digitalSignature.findMany({ where: { status: 'PENDING' }, select: { id: true }, take: 100 });
  for (const p of pending) await syncSignature(p.id).catch((e) => logger.error({ err: e.message, id: p.id }, 'Signature sync failed'));
  return pending.length;
}

/** Re-verifies a completed signature: stored bytes still match, and (sandbox) the cryptographic signature holds. */
async function verifySignature(principal, signatureId) {
  const s = await prisma.digitalSignature.findFirst({ where: { id: signatureId, firmId: principal.firmId } });
  if (!s) throw NotFound('Signature not found');
  await findVisibleCase(principal, s.caseId);
  if (s.status !== 'SIGNED') throw Conflict('This signature is not complete');
  const c = await prisma.valuationCase.findUnique({ where: { id: s.caseId } });
  const [source, signed] = await Promise.all([prisma.documentVersion.findUnique({ where: { id: s.sourceVersionId } }), prisma.documentVersion.findUnique({ where: { id: s.signedVersionId } })]);
  const sourceOk = sha256(await storage.getBuffer(source.storageKey)) === s.documentSha256;
  const signedOk = sha256(await storage.getBuffer(signed.storageKey)) === s.signedSha256;
  const provider = getSignatureProvider();
  const crypto = s.provider === 'SANDBOX' && provider.verifyRecord ? provider.verifyRecord({ ...s, caseNumber: c.caseNumber }) : { ok: true, detail: { method: 'provider-signed PDF; validate the embedded certificate in a PDF reader' } };
  const ok = sourceOk && signedOk && crypto.ok;
  await prisma.digitalSignature.update({ where: { id: s.id }, data: { verificationStatus: ok ? 'VERIFIED' : 'INVALID', verifiedAt: new Date(), verificationDetail: { sourceOk, signedOk, ...crypto.detail, cryptographicCheck: crypto.ok } } });
  return { ok, sourceIntact: sourceOk, signedFileIntact: signedOk, cryptographicCheck: crypto.ok, ...crypto.detail };
}

// The public verification page lists the signatures made on a final report document (valuer, then client).
setSignatureLookup(async (documentVersionId) => {
  if (!documentVersionId) return [];
  const valuer = await prisma.digitalSignature.findMany({ where: { sourceVersionId: documentVersionId, status: 'SIGNED' }, orderBy: { signedAt: 'asc' } });
  const client = valuer.length ? await prisma.digitalSignature.findMany({ where: { sourceVersionId: { in: valuer.map((v) => v.signedVersionId) }, status: 'SIGNED' }, orderBy: { signedAt: 'asc' } }) : [];
  return [...valuer, ...client].map((x) => ({ role: x.signerRole, name: x.signerName, provider: x.provider, signedAt: x.signedAt, verification: x.verificationStatus, legallyValid: x.legallyValid }));
});

export { getApproval, sign, release, decide, syncSignature, syncAllPending, verifySignature };
