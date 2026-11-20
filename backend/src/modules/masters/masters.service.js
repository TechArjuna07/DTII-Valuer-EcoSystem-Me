import { prisma } from '../../database/prisma.js';
import { BadRequest, Conflict, NotFound } from '../../utils/errors.js';
import { recordAudit } from '../../services/audit.service.js';
import { paginate, skipTake } from '../../utils/pagination.js';
import { currentFinancialYear } from '../../utils/financial-year.js';
import { ALL_STATUSES } from '../workflow/workflow.definition.js';

/**
 * Firm masters: banks/NBFCs, valuation categories (+ configurable fields), document types, financial years,
 * workflow configuration. Platform defaults (firm_id NULL) are read-only for firms; firms add their own rows.
 */

// ───────────── Banks / NBFCs ─────────────

async function listBanks(principal, { page, pageSize, search, status, institutionType }) {
  const where = {
    firmId: principal.firmId,
    deletedAt: null,
    ...(status ? { status } : {}),
    ...(institutionType ? { institutionType } : {}),
    ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { shortCode: { contains: search, mode: 'insensitive' } }, { branch: { contains: search, mode: 'insensitive' } }, { ifsc: { contains: search, mode: 'insensitive' } }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.bank.findMany({ where, orderBy: [{ name: 'asc' }, { branch: 'asc' }], ...skipTake({ page, pageSize }), include: { _count: { select: { cases: true } } } }),
    prisma.bank.count({ where }),
  ]);
  return paginate(items.map(({ _count, ...b }) => ({ ...b, caseCount: _count.cases })), total, { page, pageSize });
}

async function findBank(principal, id) {
  const b = await prisma.bank.findFirst({ where: { id, firmId: principal.firmId, deletedAt: null } });
  if (!b) throw NotFound('Bank not found');
  return b;
}

async function assertBankUnique(principal, { name, branch }, exceptId) {
  const dup = await prisma.bank.findFirst({
    where: { firmId: principal.firmId, deletedAt: null, name: { equals: name, mode: 'insensitive' }, branch: branch ? { equals: branch, mode: 'insensitive' } : null, ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
  if (dup) throw Conflict('This bank / branch is already registered');
}

async function createBank(principal, body, req) {
  await assertBankUnique(principal, body);
  return prisma.$transaction(async (tx) => {
    const b = await tx.bank.create({ data: { ...body, firmId: principal.firmId, createdById: principal.userId } });
    await recordAudit({ action: 'BANK_CREATED', principal, req, entityType: 'bank', entityId: b.id, meta: { name: b.name } }, tx);
    return b;
  });
}

async function updateBank(principal, id, body, req) {
  const current = await findBank(principal, id);
  if (body.name !== undefined || body.branch !== undefined) await assertBankUnique(principal, { name: body.name ?? current.name, branch: body.branch !== undefined ? body.branch : current.branch }, id);
  return prisma.$transaction(async (tx) => {
    const b = await tx.bank.update({ where: { id }, data: body });
    await recordAudit({ action: 'BANK_UPDATED', principal, req, entityType: 'bank', entityId: id, meta: { fields: Object.keys(body) } }, tx);
    return b;
  });
}

// ───────────── Categories & fields ─────────────

const categoryInclude = { fields: { where: { active: true }, orderBy: { sortOrder: 'asc' } } };

async function listCategories(principal, { includeInactive } = {}) {
  const rows = await prisma.valuationCategory.findMany({
    where: { OR: [{ firmId: null }, { firmId: principal.firmId }], ...(includeInactive ? {} : { active: true }) },
    include: { ...categoryInclude, _count: { select: { cases: { where: { firmId: principal.firmId } } } } },
    orderBy: [{ firmId: { sort: 'asc', nulls: 'first' } }, { sortOrder: 'asc' }, { name: 'asc' }],
  });
  return { items: rows.map(({ _count, ...c }) => ({ ...c, isPlatform: c.firmId === null, caseCount: _count.cases })) };
}

async function getCategory(principal, id) {
  const c = await prisma.valuationCategory.findFirst({ where: { id, OR: [{ firmId: null }, { firmId: principal.firmId }] }, include: categoryInclude });
  if (!c) throw NotFound('Category not found');
  return { ...c, isPlatform: c.firmId === null };
}

async function ownCategory(principal, id) {
  const c = await getCategory(principal, id);
  if (c.isPlatform) throw BadRequest('Platform categories cannot be changed. Create your own category instead.');
  return c;
}

async function createCategory(principal, body, req) {
  const exists = await prisma.valuationCategory.findFirst({ where: { code: body.code, OR: [{ firmId: null }, { firmId: principal.firmId }] } });
  if (exists) throw Conflict('A category with this code already exists');
  const c = await prisma.$transaction(async (tx) => {
    const created = await tx.valuationCategory.create({ data: { ...body, firmId: principal.firmId } });
    await recordAudit({ action: 'CATEGORY_CREATED', principal, req, entityType: 'category', entityId: created.id, meta: { code: body.code } }, tx);
    return created;
  });
  return getCategory(principal, c.id);
}

async function updateCategory(principal, id, body, req) {
  await ownCategory(principal, id);
  await prisma.$transaction(async (tx) => {
    await tx.valuationCategory.update({ where: { id }, data: body });
    await recordAudit({ action: 'CATEGORY_UPDATED', principal, req, entityType: 'category', entityId: id, meta: { fields: Object.keys(body) } }, tx);
  });
  return getCategory(principal, id);
}

/** Adds or edits a field of a firm category. Any change bumps fields_version (stored with property data). */
async function upsertField(principal, categoryId, body, req) {
  await ownCategory(principal, categoryId);
  const { key, ...data } = body;
  await prisma.$transaction(async (tx) => {
    await tx.categoryFieldDefinition.upsert({ where: { categoryId_key: { categoryId, key } }, update: { ...data, active: true }, create: { ...data, key, categoryId } });
    await tx.valuationCategory.update({ where: { id: categoryId }, data: { fieldsVersion: { increment: 1 } } });
    await recordAudit({ action: 'CATEGORY_FIELD_SAVED', principal, req, entityType: 'category', entityId: categoryId, meta: { key } }, tx);
  });
  return getCategory(principal, categoryId);
}

/** Fields are deactivated, never deleted, so historic property data stays interpretable. */
async function removeField(principal, categoryId, key, req) {
  await ownCategory(principal, categoryId);
  const field = await prisma.categoryFieldDefinition.findUnique({ where: { categoryId_key: { categoryId, key } } });
  if (!field) throw NotFound('Field not found');
  await prisma.$transaction(async (tx) => {
    await tx.categoryFieldDefinition.update({ where: { id: field.id }, data: { active: false } });
    await tx.valuationCategory.update({ where: { id: categoryId }, data: { fieldsVersion: { increment: 1 } } });
    await recordAudit({ action: 'CATEGORY_FIELD_REMOVED', principal, req, entityType: 'category', entityId: categoryId, meta: { key } }, tx);
  });
  return getCategory(principal, categoryId);
}

// ───────────── Document types ─────────────

async function listDocumentTypes(principal, { includeInactive } = {}) {
  const items = await prisma.documentType.findMany({
    where: { OR: [{ firmId: null }, { firmId: principal.firmId }], ...(includeInactive ? {} : { active: true }) },
    orderBy: [{ firmId: { sort: 'asc', nulls: 'first' } }, { sortOrder: 'asc' }],
  });
  return { items: items.map((d) => ({ ...d, isPlatform: d.firmId === null })) };
}

async function createDocumentType(principal, body, req) {
  const exists = await prisma.documentType.findFirst({ where: { code: body.code, OR: [{ firmId: null }, { firmId: principal.firmId }] } });
  if (exists) throw Conflict('A document type with this code already exists');
  return prisma.$transaction(async (tx) => {
    const d = await tx.documentType.create({ data: { ...body, firmId: principal.firmId } });
    await recordAudit({ action: 'DOCUMENT_TYPE_CREATED', principal, req, entityType: 'document_type', entityId: d.id, meta: { code: d.code } }, tx);
    return d;
  });
}

async function updateDocumentType(principal, id, body, req) {
  const d = await prisma.documentType.findFirst({ where: { id, firmId: principal.firmId } });
  if (!d) throw NotFound('Document type not found (platform types cannot be changed)');
  return prisma.$transaction(async (tx) => {
    const updated = await tx.documentType.update({ where: { id }, data: body });
    await recordAudit({ action: 'DOCUMENT_TYPE_UPDATED', principal, req, entityType: 'document_type', entityId: id, meta: { fields: Object.keys(body) } }, tx);
    return updated;
  });
}

// ───────────── Financial years ─────────────

async function listFinancialYears() {
  const items = await prisma.financialYear.findMany({ orderBy: { startDate: 'desc' } });
  const current = currentFinancialYear().code;
  return { items: items.map((f) => ({ ...f, isCurrent: f.code === current })), current };
}

// ───────────── Workflow configuration ─────────────

const DEFAULT_WORKFLOW = { autoAssign: 'MANUAL', requireSourceDocument: false, minInspectionPhotos: 3, autoReleaseToClient: true };

async function getWorkflowSettings(principal) {
  const s = await prisma.organizationSettings.findUnique({ where: { firmId: principal.firmId } });
  return { slaHours: s?.slaConfig ?? {}, options: { ...DEFAULT_WORKFLOW, ...(s?.workflowOptions ?? {}) }, statuses: ALL_STATUSES };
}

async function updateWorkflowSettings(principal, { slaHours, options }, req) {
  await prisma.$transaction(async (tx) => {
    await tx.organizationSettings.upsert({
      where: { firmId: principal.firmId },
      update: { ...(slaHours ? { slaConfig: slaHours } : {}), ...(options ? { workflowOptions: options } : {}), updatedById: principal.userId },
      create: { firmId: principal.firmId, slaConfig: slaHours ?? {}, workflowOptions: options ?? {}, updatedById: principal.userId },
    });
    await recordAudit({ action: 'WORKFLOW_SETTINGS_UPDATED', principal, req, entityType: 'organization', entityId: principal.firmId, meta: { slaHours, options } }, tx);
  });
  return getWorkflowSettings(principal);
}

export {
  listBanks,
  findBank,
  createBank,
  updateBank,
  listCategories,
  getCategory,
  createCategory,
  updateCategory,
  upsertField,
  removeField,
  listDocumentTypes,
  createDocumentType,
  updateDocumentType,
  listFinancialYears,
  getWorkflowSettings,
  updateWorkflowSettings,
  DEFAULT_WORKFLOW,
};
