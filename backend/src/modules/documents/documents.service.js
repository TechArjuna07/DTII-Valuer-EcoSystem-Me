import { createHash, randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { prisma } from '../../database/prisma.js';
import { FOLDERS } from '../../config/folders.js';
import { BadRequest, Conflict, Forbidden, NotFound } from '../../utils/errors.js';
import { hasPermission } from '../../middleware/authorize.js';
import { recordAudit } from '../../services/audit.service.js';
import { emit } from '../../services/events.js';
import { scanBuffer, DOWNLOADABLE } from '../../services/scanner.service.js';
import * as storage from '../../services/storage/storage.service.js';
import { caseScope, findVisibleCase } from '../cases/case-access.js';
import { recordActivity } from '../workflow/workflow.service.js';
import { TERMINAL } from '../workflow/workflow.definition.js';
import { FileValidationError, validateFile } from './file-validator.js';
import { folderAccess, isPortalClient } from './folder-acl.js';

const maxBytes = () => env.UPLOAD_MAX_MB * 1024 * 1024;

function toVersion(v) {
  return {
    id: v.id,
    version: v.version,
    originalName: v.originalName,
    mimeType: v.mimeType,
    sizeBytes: Number(v.sizeBytes),
    sha256: v.sha256,
    scanStatus: v.scanStatus,
    uploadSource: v.uploadSource,
    uploadedById: v.uploadedById,
    note: v.note,
    createdAt: v.createdAt,
    downloadable: DOWNLOADABLE.includes(v.scanStatus),
  };
}

function toDocument(d, names = new Map()) {
  const current = d.versions?.find((v) => v.id === d.currentVersionId);
  return {
    id: d.id,
    caseId: d.caseId,
    folder: d.folder,
    title: d.title,
    documentTypeId: d.documentTypeId,
    visibility: d.visibility,
    versionCount: d.versionCount,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    uploadedBy: names.get(current?.uploadedById ?? d.createdById) ?? null,
    current: current ? toVersion(current) : null,
  };
}

/** Where-fragment restricting documents to what the principal may read in a case. */
function readableWhere(principal) {
  const { read } = folderAccess(principal);
  const base = { archivedAt: null, folder: { in: [...read] } };
  if (isPortalClient(principal)) return { ...base, OR: [{ visibility: 'CLIENT' }, { createdById: principal.userId }] };
  return base;
}

async function userNames(ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, fullName: true } });
  return new Map(users.map((u) => [u.id, u.fullName]));
}

/** Recomputes the case "awaiting documents" flag from open client requests. */
async function refreshAwaitingDocuments(db, caseId) {
  const open = await db.documentRequest.count({ where: { caseId, status: 'OPEN', requestedFrom: 'CLIENT' } });
  await db.valuationCase.update({ where: { id: caseId }, data: { awaitingDocuments: open > 0 } });
}

/**
 * Stores a new document or a new version of an existing one. Bytes are written to storage FIRST under an id-only
 * key, then the metadata is committed in one transaction. Used by uploads and by system producers
 * (generated reports, signed files, inspection photos).
 *
 * @param {object} args
 * @param {object|null} args.principal   acting user (null for system)
 * @param {object} args.c                case row
 * @param {string} args.folder
 * @param {{ buffer: Buffer, fileName: string, mimeType: string }} args.content  already validated
 * @returns {Promise<{ document: object, version: object, events: Array }>}
 */
async function storeVersion({ principal, c, folder, content, title, documentTypeId = null, documentId = null, visibility, uploadSource = 'STAFF', note = null, requestId = null, req, tx: outerTx }) {
  const docId = documentId ?? randomUUID();
  const run = async (tx) => {
    let doc = documentId ? await tx.caseDocument.findFirst({ where: { id: documentId, caseId: c.id, archivedAt: null } }) : null;
    if (documentId && !doc) throw NotFound('Document not found');
    if (doc && doc.folder !== folder) throw BadRequest('A new version must stay in the same folder');
    const version = (doc?.versionCount ?? 0) + 1;
    const key = storage.StorageKeys.documentVersion(c.firmId, c.id, docId, version);
    const sha256 = createHash('sha256').update(content.buffer).digest();
    await storage.putObject(key, content.buffer, { contentType: content.mimeType, sha256Base64: sha256.toString('base64') });

    if (!doc) {
      doc = await tx.caseDocument.create({
        data: { id: docId, firmId: c.firmId, caseId: c.id, folder, title: title || content.fileName, documentTypeId, visibility: visibility ?? (uploadSource === 'CLIENT' ? 'CLIENT' : 'INTERNAL'), createdById: principal?.userId ?? c.createdById },
      });
    }
    const v = await tx.documentVersion.create({
      data: {
        firmId: c.firmId,
        documentId: doc.id,
        version,
        storageKey: key,
        originalName: content.fileName,
        mimeType: content.mimeType,
        sizeBytes: BigInt(content.buffer.length),
        sha256: sha256.toString('hex'),
        scanStatus: env.SCANNER === 'none' ? 'SKIPPED' : 'PENDING',
        uploadSource,
        uploadedById: principal?.userId ?? null,
        note,
      },
    });
    doc = await tx.caseDocument.update({ where: { id: doc.id }, data: { currentVersionId: v.id, versionCount: version, ...(title && documentId ? { title } : {}) } });

    let fulfilled = null;
    if (requestId) {
      fulfilled = await tx.documentRequest.findFirst({ where: { id: requestId, caseId: c.id, status: 'OPEN' } });
      if (!fulfilled) throw BadRequest('That document request is no longer open');
      await tx.documentRequest.update({ where: { id: requestId }, data: { status: 'FULFILLED', fulfilledDocumentId: doc.id, fulfilledById: principal?.userId ?? null, fulfilledAt: new Date() } });
      await refreshAwaitingDocuments(tx, c.id);
    }
    await recordActivity(tx, {
      c,
      principal,
      action: version === 1 ? 'DOCUMENT_UPLOADED' : 'DOCUMENT_VERSION_ADDED',
      documentVersionId: v.id,
      meta: { folder, title: doc.title, version, fileName: content.fileName, requestId },
      req,
      clientVisible: uploadSource === 'CLIENT' || !!fulfilled,
      actorRole: uploadSource === 'SYSTEM' || uploadSource === 'SIGNATURE' ? 'SYSTEM' : undefined,
    });
    return { document: doc, version: v, events: [['document.uploaded', { firmId: c.firmId, caseId: c.id, documentId: doc.id, versionId: v.id, folder, actorId: principal?.userId ?? null, fulfilledRequestId: fulfilled?.id ?? null }]] };
  };
  const result = outerTx ? await run(outerTx) : await prisma.$transaction(run);
  if (env.SCANNER !== 'none') setImmediate(() => scanVersion(result.version.id, content.buffer));
  return result;
}

/** Scans a stored version and records the verdict (only the scan columns change; content stays immutable). */
async function scanVersion(versionId, buffer) {
  try {
    const status = await scanBuffer(buffer ?? (await storage.getBuffer((await prisma.documentVersion.findUnique({ where: { id: versionId } })).storageKey)));
    await prisma.documentVersion.update({ where: { id: versionId }, data: { scanStatus: status, scannedAt: new Date() } });
    if (status === 'INFECTED') logger.warn({ versionId }, 'Uploaded file quarantined (malware detected)');
  } catch (e) {
    logger.error({ versionId, err: e.message }, 'Scan failed');
  }
}

function assertWritable(principal, c, folder) {
  if (!hasPermission(principal, 'document.upload')) throw Forbidden();
  if (!folderAccess(principal).write.has(folder)) throw Forbidden('You cannot upload to this folder');
  if (TERMINAL.includes(c.status)) throw Conflict('This case is closed; its repository is read-only');
}

/** Upload from a user (staff or client portal). */
async function upload(principal, caseId, file, body, req) {
  const c = await findVisibleCase(principal, caseId);
  assertWritable(principal, c, body.folder);
  let content;
  try {
    const meta = validateFile(file, { maxBytes: maxBytes(), imagesOnly: body.folder === 'PROPERTY_PHOTOGRAPHS' });
    content = { buffer: file.buffer, fileName: meta.fileName, mimeType: meta.mimeType };
  } catch (e) {
    if (e instanceof FileValidationError) throw BadRequest(e.message);
    throw e;
  }
  if (body.documentId) {
    const existing = await prisma.caseDocument.findFirst({ where: { AND: [{ id: body.documentId, caseId }, readableWhere(principal)] } });
    if (!existing) throw NotFound('Document not found');
  }
  if (body.documentTypeId) {
    const t = await prisma.documentType.findFirst({ where: { id: body.documentTypeId, active: true, OR: [{ firmId: null }, { firmId: principal.firmId }] } });
    if (!t) throw BadRequest('Select a valid document type');
  }
  const portal = isPortalClient(principal);
  const result = await storeVersion({
    principal,
    c,
    folder: body.folder,
    content,
    title: body.title,
    documentTypeId: body.documentTypeId ?? null,
    documentId: body.documentId ?? null,
    visibility: portal ? 'CLIENT' : body.visibility,
    uploadSource: portal ? 'CLIENT' : 'STAFF',
    note: body.note ?? null,
    requestId: body.requestId ?? null,
    req,
  });
  result.events.forEach(([n, p]) => emit(n, p));
  return getDocument(principal, result.document.id);
}

async function findReadableDocument(principal, documentId) {
  const d = await prisma.caseDocument.findFirst({
    where: { AND: [{ id: documentId, firmId: principal.firmId }, readableWhere(principal), { case: caseScope(principal) }] },
    include: { versions: { orderBy: { version: 'desc' } } },
  });
  if (!d) throw NotFound('Document not found');
  return d;
}

async function getDocument(principal, documentId) {
  const d = await findReadableDocument(principal, documentId);
  const names = await userNames([d.createdById, ...d.versions.map((v) => v.uploadedById)]);
  return { ...toDocument(d, names), versions: d.versions.map((v) => ({ ...toVersion(v), uploadedBy: names.get(v.uploadedById) ?? (v.uploadSource === 'SYSTEM' ? 'System' : null) })) };
}

/** Folder tree of a case (only readable folders), with documents and open requests. */
async function caseRepository(principal, caseId) {
  const c = await findVisibleCase(principal, caseId, prisma, { bank: { select: { shortCode: true } }, client: { select: { name: true } }, financialYear: { select: { code: true } } });
  const { read, write } = folderAccess(principal);
  const docs = await prisma.caseDocument.findMany({ where: { AND: [{ caseId }, readableWhere(principal)] }, include: { versions: true }, orderBy: { createdAt: 'asc' } });
  const names = await userNames(docs.flatMap((d) => [d.createdById, ...d.versions.map((v) => v.uploadedById)]));
  const closed = TERMINAL.includes(c.status);
  return {
    caseId,
    path: [c.client.name, `FY ${c.financialYear.code}`, `${c.caseNumber}_${c.bank.shortCode}`],
    readOnly: closed,
    folders: FOLDERS.filter((f) => read.has(f.code)).map((f) => ({
      ...f,
      canWrite: !closed && write.has(f.code),
      documents: docs.filter((d) => d.folder === f.code).map((d) => toDocument(d, names)),
    })),
  };
}

/** Issues a short-lived download / preview link and audits it. */
async function downloadLink(principal, documentId, versionId, disposition, req) {
  const d = await findReadableDocument(principal, documentId);
  const v = versionId ? d.versions.find((x) => x.id === versionId) : d.versions.find((x) => x.id === d.currentVersionId);
  if (!v) throw NotFound('Version not found');
  if (!DOWNLOADABLE.includes(v.scanStatus)) throw Conflict(v.scanStatus === 'INFECTED' ? 'This file was quarantined by the malware scan' : 'This file is still being scanned');
  const inlineAllowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(v.mimeType);
  const link = await storage.signedUrl(v.storageKey, { fileName: v.originalName, contentType: v.mimeType, disposition: disposition === 'inline' && inlineAllowed ? 'inline' : 'attachment' });
  await recordAudit({ action: 'DOCUMENT_DOWNLOAD_LINK_ISSUED', principal, req, entityType: 'document_version', entityId: v.id, meta: { caseId: d.caseId, documentId: d.id, disposition } });
  return link;
}

async function updateDocument(principal, documentId, body, req) {
  const d = await findReadableDocument(principal, documentId);
  if (isPortalClient(principal) || !folderAccess(principal).write.has(d.folder)) throw Forbidden();
  const c = await prisma.valuationCase.findUnique({ where: { id: d.caseId } });
  await prisma.$transaction(async (tx) => {
    await tx.caseDocument.update({ where: { id: documentId }, data: body });
    await recordActivity(tx, { c, principal, action: 'DOCUMENT_UPDATED', meta: { documentId, fields: Object.keys(body), visibility: body.visibility }, req });
  });
  return getDocument(principal, documentId);
}

/** Archiving hides a document from the repository; all versions are kept (nothing is ever deleted). */
async function archiveDocument(principal, documentId, reason, req) {
  if (!principal.roles.includes('FIRM_ADMIN')) throw Forbidden('Only the Firm Admin can archive documents');
  const d = await findReadableDocument(principal, documentId);
  const c = await prisma.valuationCase.findUnique({ where: { id: d.caseId } });
  await prisma.$transaction(async (tx) => {
    await tx.caseDocument.update({ where: { id: documentId }, data: { archivedAt: new Date(), archivedById: principal.userId, archiveReason: reason } });
    await recordActivity(tx, { c, principal, action: 'DOCUMENT_ARCHIVED', remarks: reason, meta: { documentId, title: d.title }, req });
  });
}

// ───────────── Document requests ─────────────

async function listRequests(principal, caseId) {
  await findVisibleCase(principal, caseId);
  const rows = await prisma.documentRequest.findMany({
    where: { caseId, ...(isPortalClient(principal) ? { requestedFrom: 'CLIENT' } : {}) },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
  });
  const names = await userNames(rows.flatMap((r) => [r.requestedById, r.fulfilledById]));
  return { items: rows.map((r) => ({ ...r, requestedBy: names.get(r.requestedById) ?? null, fulfilledBy: names.get(r.fulfilledById) ?? null })) };
}

async function createRequest(principal, caseId, body, req) {
  if (!hasPermission(principal, 'document.request')) throw Forbidden();
  const c = await findVisibleCase(principal, caseId);
  if (TERMINAL.includes(c.status)) throw Conflict('This case is closed');
  const r = await prisma.$transaction(async (tx) => {
    const created = await tx.documentRequest.create({ data: { ...body, firmId: c.firmId, caseId, requestedById: principal.userId } });
    await refreshAwaitingDocuments(tx, caseId);
    await recordActivity(tx, { c, principal, action: 'DOCUMENT_REQUESTED', remarks: body.description ?? null, meta: { requestId: created.id, title: body.title, from: body.requestedFrom }, req, clientVisible: body.requestedFrom === 'CLIENT' });
    return created;
  });
  emit('document.requested', { firmId: c.firmId, caseId, requestId: r.id, requestedFrom: r.requestedFrom, actorId: principal.userId });
  return r;
}

async function cancelRequest(principal, requestId, req) {
  if (!hasPermission(principal, 'document.request')) throw Forbidden();
  const r = await prisma.documentRequest.findFirst({ where: { id: requestId, firmId: principal.firmId } });
  if (!r) throw NotFound('Request not found');
  const c = await findVisibleCase(principal, r.caseId);
  if (r.status !== 'OPEN') throw Conflict('Only open requests can be cancelled');
  await prisma.$transaction(async (tx) => {
    await tx.documentRequest.update({ where: { id: requestId }, data: { status: 'CANCELLED' } });
    await refreshAwaitingDocuments(tx, r.caseId);
    await recordActivity(tx, { c, principal, action: 'DOCUMENT_REQUEST_CANCELLED', meta: { requestId, title: r.title }, req });
  });
}

// ───────────── Client-wise repository ─────────────

/** Firm → Client → FY → Case tree with per-folder document counts (read-only overview). */
async function clientRepository(principal, clientId) {
  const cases = await prisma.valuationCase.findMany({
    where: { AND: [caseScope(principal), { clientId }] },
    select: { id: true, caseNumber: true, status: true, bank: { select: { shortCode: true, name: true } }, category: { select: { name: true } }, financialYear: { select: { code: true, label: true, startDate: true } } },
    orderBy: [{ financialYear: { startDate: 'desc' } }, { seq: 'asc' }],
  });
  if (!cases.length) {
    const visible = await prisma.client.findFirst({ where: { id: clientId, firmId: principal.firmId } });
    if (!visible) throw NotFound('Client not found');
  }
  const counts = await prisma.caseDocument.groupBy({ by: ['caseId', 'folder'], where: { AND: [{ caseId: { in: cases.map((c) => c.id) } }, readableWhere(principal)] }, _count: true });
  const byCase = new Map();
  for (const r of counts) byCase.set(r.caseId, { ...(byCase.get(r.caseId) || {}), [r.folder]: r._count });
  const years = new Map();
  for (const c of cases) {
    if (!years.has(c.financialYear.code)) years.set(c.financialYear.code, { code: c.financialYear.code, label: c.financialYear.label, cases: [] });
    const folderCounts = byCase.get(c.id) || {};
    years.get(c.financialYear.code).cases.push({
      id: c.id,
      caseNumber: c.caseNumber,
      label: `${c.caseNumber}_${c.bank.shortCode}`,
      bank: c.bank.name,
      category: c.category.name,
      status: c.status,
      folderCounts,
      documentCount: Object.values(folderCounts).reduce((a, b) => a + b, 0),
    });
  }
  return { clientId, years: [...years.values()] };
}

export { upload, storeVersion, getDocument, caseRepository, downloadLink, updateDocument, archiveDocument, listRequests, createRequest, cancelRequest, clientRepository, scanVersion, refreshAwaitingDocuments };
