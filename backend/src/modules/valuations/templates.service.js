import { prisma } from '../../database/prisma.js';
import { BadRequest, NotFound } from '../../utils/errors.js';
import { recordAudit } from '../../services/audit.service.js';
import { assertTemplateCompiles, compileTemplate, sampleContext } from './report-context.js';
import { DEFAULT_TEMPLATE } from './templates/default-report.js';

/**
 * Report Template Master: bank / NBFC-specific report formats (Handlebars HTML) with immutable versions.
 * Final reports use the most specific active template: bank+category → bank → category → firm generic → built-in.
 */

const toTemplate = (t) => ({ ...t, current: t.versions?.find((v) => v.id === t.currentVersionId) ?? null, versions: t.versions?.map(({ bodyHtml: _b, ...v }) => v) });

async function list(principal) {
  const rows = await prisma.reportTemplate.findMany({ where: { firmId: principal.firmId }, orderBy: [{ status: 'asc' }, { name: 'asc' }] });
  const banks = await prisma.bank.findMany({ where: { firmId: principal.firmId }, select: { id: true, name: true, branch: true } });
  const cats = await prisma.valuationCategory.findMany({ where: { OR: [{ firmId: null }, { firmId: principal.firmId }] }, select: { id: true, name: true } });
  const bn = new Map(banks.map((b) => [b.id, `${b.name}${b.branch ? ` – ${b.branch}` : ''}`]));
  const cn = new Map(cats.map((c) => [c.id, c.name]));
  return { items: rows.map((t) => ({ ...t, bankName: t.bankId ? bn.get(t.bankId) : null, categoryName: t.categoryId ? cn.get(t.categoryId) : null })), defaultBody: DEFAULT_TEMPLATE };
}

async function get(principal, id) {
  const t = await prisma.reportTemplate.findFirst({ where: { id, firmId: principal.firmId }, include: { versions: { orderBy: { version: 'desc' } } } });
  if (!t) throw NotFound('Template not found');
  return toTemplate(t);
}

async function assertRefs(principal, { bankId, categoryId }) {
  if (bankId && !(await prisma.bank.findFirst({ where: { id: bankId, firmId: principal.firmId } }))) throw BadRequest('Select a valid bank');
  if (categoryId && !(await prisma.valuationCategory.findFirst({ where: { id: categoryId, OR: [{ firmId: null }, { firmId: principal.firmId }] } }))) throw BadRequest('Select a valid category');
}

function validateBody(body) {
  try {
    assertTemplateCompiles(body);
  } catch (e) {
    throw BadRequest(e.message);
  }
}

async function create(principal, { name, description, bankId, categoryId, bodyHtml }, req) {
  await assertRefs(principal, { bankId, categoryId });
  const body = bodyHtml ?? DEFAULT_TEMPLATE;
  validateBody(body);
  const id = await prisma.$transaction(async (tx) => {
    const t = await tx.reportTemplate.create({ data: { firmId: principal.firmId, name, description, bankId: bankId ?? null, categoryId: categoryId ?? null, createdById: principal.userId } });
    const v = await tx.reportTemplateVersion.create({ data: { firmId: principal.firmId, templateId: t.id, version: 1, bodyHtml: body, createdById: principal.userId, changeNote: 'Initial version' } });
    await tx.reportTemplate.update({ where: { id: t.id }, data: { currentVersionId: v.id, versionCount: 1 } });
    await recordAudit({ action: 'REPORT_TEMPLATE_CREATED', principal, req, entityType: 'report_template', entityId: t.id, meta: { name } }, tx);
    return t.id;
  });
  return get(principal, id);
}

async function update(principal, id, body, req) {
  await get(principal, id);
  await assertRefs(principal, body);
  await prisma.$transaction(async (tx) => {
    await tx.reportTemplate.update({ where: { id }, data: body });
    await recordAudit({ action: 'REPORT_TEMPLATE_UPDATED', principal, req, entityType: 'report_template', entityId: id, meta: { fields: Object.keys(body) } }, tx);
  });
  return get(principal, id);
}

async function addVersion(principal, id, { bodyHtml, changeNote }, req) {
  const t = await get(principal, id);
  validateBody(bodyHtml);
  await prisma.$transaction(async (tx) => {
    const v = await tx.reportTemplateVersion.create({ data: { firmId: principal.firmId, templateId: id, version: t.versionCount + 1, bodyHtml, changeNote: changeNote ?? null, createdById: principal.userId } });
    await tx.reportTemplate.update({ where: { id }, data: { currentVersionId: v.id, versionCount: t.versionCount + 1 } });
    await recordAudit({ action: 'REPORT_TEMPLATE_VERSION_ADDED', principal, req, entityType: 'report_template', entityId: id, meta: { version: v.version } }, tx);
  });
  return get(principal, id);
}

/** Renders a template body with sample data (HTML) for the in-browser preview (sandboxed iframe). */
async function preview(bodyHtml) {
  validateBody(bodyHtml);
  return { html: compileTemplate(bodyHtml)(await sampleContext()) };
}

/** Most specific active template version for a case, or null (built-in default). */
async function resolveForCase(firmId, { bankId, categoryId }, templateId) {
  const where = { firmId, status: 'ACTIVE', currentVersionId: { not: null } };
  let t = templateId ? await prisma.reportTemplate.findFirst({ where: { ...where, id: templateId } }) : null;
  if (templateId && !t) throw BadRequest('Select an active report template');
  if (!t) {
    const candidates = await prisma.reportTemplate.findMany({ where: { ...where, OR: [{ bankId }, { bankId: null }], AND: [{ OR: [{ categoryId }, { categoryId: null }] }] } });
    const score = (x) => (x.bankId ? 2 : 0) + (x.categoryId ? 1 : 0);
    t = candidates.sort((a, b) => score(b) - score(a) || b.updatedAt - a.updatedAt)[0] ?? null;
  }
  if (!t) return null;
  return prisma.reportTemplateVersion.findUnique({ where: { id: t.currentVersionId } });
}

export { list, get, create, update, addVersion, preview, resolveForCase };
