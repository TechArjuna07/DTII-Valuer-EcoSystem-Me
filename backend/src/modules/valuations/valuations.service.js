import { randomBytes } from 'node:crypto';
import { ZodError } from 'zod';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { prisma } from '../../database/prisma.js';
import { ROLES } from '../../config/rbac.js';
import { BadRequest, Conflict, Forbidden, NotFound } from '../../utils/errors.js';
import { hasPermission } from '../../middleware/authorize.js';
import { emit } from '../../services/events.js';
import { htmlToPdf, rendererAvailable } from '../../services/pdf/pdf-renderer.js';
import { findVisibleCase } from '../cases/case-access.js';
import { STATUS } from '../workflow/workflow.definition.js';
import { activeAssignments, lockCase, recordActivity, transition } from '../workflow/workflow.service.js';
import { handOverInTx } from '../cases/cases.service.js';
import { storeVersion } from '../documents/documents.service.js';
import { FileValidationError, validateFile } from '../documents/file-validator.js';
import { calculate } from './engines/index.js';
import { buildReportContext, compileTemplate } from './report-context.js';
import { DEFAULT_TEMPLATE } from './templates/default-report.js';
import { resolveForCase } from './templates.service.js';

/**
 * Valuation workflow:
 *   Junior reviewer  → preliminary versions (inputs → server calculation → PDF in 04_Preliminary_Valuation) → submit
 *   Senior reviewer  → review (approve / return for correction / reject) → final bank-format versions
 *                      (06_Final_Valuation_Report, with verification QR) → approve final
 * Versions and reviews are immutable; maker-checker is enforced (the junior can never act as senior on a case).
 */
const emitAll = (events) => events.forEach(([n, p]) => emit(n, p));
const FINAL_VISIBLE_TO_MARKETING = [STATUS.FINAL_APPROVED, STATUS.CASE_COMPLETED];

const caseInclude = { client: true, bank: true, category: true, financialYear: true, organization: true };

function roleFlags(principal, assignments) {
  const mine = (stage) => assignments.some((a) => a.stage === stage && a.employeeId === principal.employeeId);
  return {
    isAdmin: principal.roles.includes(ROLES.FIRM_ADMIN),
    isJunior: mine('JUNIOR'),
    isSenior: mine('SENIOR') && !mine('JUNIOR'),
    reviewer: principal.roles.includes(ROLES.JUNIOR_REVIEWER) || principal.roles.includes(ROLES.SENIOR_REVIEWER),
  };
}

const toNumber = (d) => (d === null || d === undefined ? null : Number(d));

function toVersion(v, names, reviews = []) {
  return {
    id: v.id,
    version: v.version,
    inputs: v.inputs,
    calculation: v.calculation,
    marketValue: toNumber(v.marketValue),
    realisableValue: toNumber(v.realisableValue),
    distressValue: toNumber(v.distressValue),
    guidelineValue: toNumber(v.guidelineValue),
    insurableValue: toNumber(v.insurableValue),
    summary: v.summary,
    changeNote: v.changeNote,
    documentId: v.documentId,
    documentVersionId: v.documentVersionId,
    verificationCode: v.verificationCode,
    preparedBy: names.get(v.preparedById) ?? null,
    createdAt: v.createdAt,
    reviews: reviews.filter((r) => r.reportVersionId === v.id).map((r) => ({ id: r.id, decision: r.decision, comments: r.comments, reviewer: names.get(r.reviewerId) ?? null, createdAt: r.createdAt })),
  };
}

async function reportView(report) {
  if (!report) return null;
  const versions = await prisma.valuationReportVersion.findMany({ where: { reportId: report.id }, orderBy: { version: 'desc' } });
  const reviews = await prisma.reportReview.findMany({ where: { reportVersionId: { in: versions.map((v) => v.id) } }, orderBy: { createdAt: 'asc' } });
  const ids = [...versions.map((v) => v.preparedById), ...reviews.map((r) => r.reviewerId)];
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } });
  const names = new Map(users.map((u) => [u.id, u.fullName]));
  return { id: report.id, stage: report.stage, status: report.status, engine: report.engine, versionCount: report.versionCount, currentVersionId: report.currentVersionId, versions: versions.map((v) => toVersion(v, names, reviews)) };
}

/** Inspection / property data used to prefill inputs and to fill the report template. */
async function sourceData(c) {
  const [fields, details, inspection] = await Promise.all([
    prisma.categoryFieldDefinition.findMany({ where: { categoryId: c.categoryId, active: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.propertyDetails.findUnique({ where: { caseId: c.id } }),
    prisma.propertyInspection.findFirst({ where: { caseId: c.id, status: 'SUBMITTED' }, orderBy: { round: 'desc' }, include: { officer: { include: { user: { select: { fullName: true } } } }, _count: { select: { photos: true } } } }),
  ]);
  return {
    fields,
    data: details?.data ?? {},
    inspection: inspection ? { ...inspection, officerName: inspection.officer.user.fullName, photoCount: inspection._count.photos } : null,
  };
}

function defaultInputs(engine, src) {
  const year = new Date().getFullYear();
  const d = src.data;
  const i = src.inspection;
  if (engine === 'LAND_BUILDING') {
    const builtYear = Number(i?.construction?.yearOfConstruction ?? d.yearOfConstruction);
    return {
      land: { area: Number(i?.landArea ?? d.landArea ?? 0), unit: i?.landAreaUnit ?? d.landAreaUnit ?? 'sq.ft', ratePerUnit: 0 },
      building: { builtUpArea: Number(i?.buildingArea ?? d.builtUpArea ?? 0), unit: i?.buildingAreaUnit ?? 'sq.ft', replacementRatePerUnit: 0, ageYears: builtYear ? Math.max(0, year - builtYear) : 0, totalLifeYears: Number(i?.construction?.estimatedLifeYears ?? 60), salvagePct: 10 },
      amenities: [],
      realisablePct: 90,
      distressPct: 80,
      roundTo: 1000,
    };
  }
  if (engine === 'PLANT_MACHINERY') return { valuationYear: year, items: [{ description: '', quantity: 1, yearOfPurchase: year, replacementCostNew: 0, usefulLifeYears: 15, conditionFactor: 1 }], salvagePct: 5, realisablePct: 85, distressPct: 70, roundTo: 1000 };
  return { items: [{ description: '', category: 'RAW_MATERIAL', quantity: 0, unit: 'nos', ratePerUnit: 0, obsolescencePct: 0 }], realisablePct: 75, distressPct: 60, roundTo: 1000 };
}

async function getValuations(principal, caseId) {
  const c = await findVisibleCase(principal, caseId, prisma, { category: true });
  const assignments = await activeAssignments(prisma, caseId);
  const f = roleFlags(principal, assignments);
  const [prelim, final, src] = await Promise.all([
    prisma.valuationReport.findUnique({ where: { caseId_stage: { caseId, stage: 'PRELIMINARY' } } }),
    prisma.valuationReport.findUnique({ where: { caseId_stage: { caseId, stage: 'FINAL' } } }),
    sourceData(c),
  ]);
  const seesPrelim = f.isAdmin || f.reviewer;
  const seesFinal = f.isAdmin || f.reviewer || (hasPermission(principal, 'case.view') && FINAL_VISIBLE_TO_MARKETING.includes(c.status));
  if (!seesPrelim && !seesFinal) throw Forbidden();
  const prelimApproved = prelim?.status === 'APPROVED';
  const canPrepareFinal = f.isSenior && hasPermission(principal, 'valuation.approve') && c.status === STATUS.FINAL_REVIEW_IN_PROGRESS && prelimApproved;
  const templates = canPrepareFinal
    ? await prisma.reportTemplate.findMany({ where: { firmId: principal.firmId, status: 'ACTIVE', currentVersionId: { not: null }, OR: [{ bankId: c.bankId }, { bankId: null }] }, select: { id: true, name: true, bankId: true, categoryId: true }, orderBy: { name: 'asc' } })
    : [];
  return {
    templates,
    caseStatus: c.status,
    engine: c.category.engine,
    rendererAvailable: rendererAvailable(),
    defaults: defaultInputs(c.category.engine, src),
    preliminary: seesPrelim ? await reportView(prelim) : null,
    final: seesFinal ? await reportView(final) : null,
    permissions: {
      canPrepare: f.isJunior && hasPermission(principal, 'valuation.prepare') && c.status === STATUS.PRELIMINARY_VALUATION_IN_PROGRESS,
      canSubmit: f.isJunior && hasPermission(principal, 'valuation.submit') && c.status === STATUS.PRELIMINARY_VALUATION_IN_PROGRESS && (prelim?.versionCount ?? 0) > 0,
      canReview: f.isSenior && hasPermission(principal, 'valuation.review') && c.status === STATUS.FINAL_REVIEW_IN_PROGRESS && prelim?.status === 'SUBMITTED',
      canPrepareFinal,
      canApproveFinal: f.isSenior && hasPermission(principal, 'valuation.approve') && c.status === STATUS.FINAL_REVIEW_IN_PROGRESS && prelimApproved && (final?.versionCount ?? 0) > 0,
    },
  };
}

function calcOrBadRequest(engine, inputs) {
  try {
    return calculate(engine, inputs);
  } catch (e) {
    if (e instanceof ZodError) throw BadRequest(e.issues.map((i) => `${i.path.join('.') || 'inputs'}: ${i.message}`));
    throw e;
  }
}

const newVerificationCode = () => randomBytes(8).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, 'X').match(/.{1,4}/g).join('-');

async function peopleFor(c, assignments) {
  const junior = assignments.find((a) => a.stage === 'JUNIOR');
  const senior = assignments.find((a) => a.stage === 'SENIOR');
  return { preparedBy: junior?.employee.user.fullName ?? '—', valuer: senior?.employee.user.fullName ?? '—', valuerRegistration: senior?.employee.registrationNo ?? null };
}

/** Renders the PDF for a version (null when no renderer is configured; the valuer can upload a PDF instead). */
async function renderPdf({ c, stage, version, calc, summary, verificationCode, templateVersion, assignments }) {
  if (!rendererAvailable()) return null;
  const src = await sourceData(c);
  const context = await buildReportContext({ c, propertyFields: src.fields, propertyData: src.data, inspection: src.inspection, calc, stage, version, summary, people: await peopleFor(c, assignments), verificationCode });
  const html = compileTemplate(templateVersion?.bodyHtml ?? DEFAULT_TEMPLATE)(context);
  return htmlToPdf(html, { footerText: `${c.caseNumber} · ${stage === 'FINAL' ? 'Valuation report' : 'Preliminary valuation'} v${version}` });
}

/**
 * Creates a new immutable version of the preliminary (junior) or final (senior) report.
 * The calculation is always done server-side from the inputs.
 */
async function createVersion(principal, caseId, stage, { inputs, summary, changeNote, templateId }, req, uploaded = null) {
  const c0 = await findVisibleCase(principal, caseId, prisma, caseInclude);
  const assignments = await activeAssignments(prisma, caseId);
  const f = roleFlags(principal, assignments);
  if (stage === 'PRELIMINARY') {
    if (!f.isJunior || !hasPermission(principal, 'valuation.prepare')) throw Forbidden('Only the assigned junior reviewer prepares the preliminary valuation');
    if (c0.status !== STATUS.PRELIMINARY_VALUATION_IN_PROGRESS) throw Conflict('Start the preliminary valuation first');
  } else {
    if (!f.isSenior || !hasPermission(principal, 'valuation.approve')) throw Forbidden('Only the assigned senior reviewer prepares the final report');
    if (c0.status !== STATUS.FINAL_REVIEW_IN_PROGRESS) throw Conflict('The case is not in final review');
    const prelim = await prisma.valuationReport.findUnique({ where: { caseId_stage: { caseId, stage: 'PRELIMINARY' } } });
    if (prelim?.status !== 'APPROVED') throw Conflict('Approve the preliminary valuation before preparing the final report');
  }
  const engine = c0.category.engine;
  const calc = calcOrBadRequest(engine, inputs);
  const templateVersion = stage === 'FINAL' ? await resolveForCase(principal.firmId, { bankId: c0.bankId, categoryId: c0.categoryId }, templateId) : null;

  const events = await prisma.$transaction(
    async (tx) => {
      const locked = await lockCase(tx, principal.firmId, caseId);
      const c = { ...locked, client: c0.client, category: c0.category, financialYear: c0.financialYear, organization: c0.organization };
      if (c.status !== c0.status) throw Conflict('The case changed; reload and try again');
      const report =
        (await tx.valuationReport.findUnique({ where: { caseId_stage: { caseId, stage } } })) ??
        (await tx.valuationReport.create({ data: { firmId: c.firmId, caseId, stage, engine } }));
      const version = report.versionCount + 1;
      const verificationCode = stage === 'FINAL' ? newVerificationCode() : null;

      let pdf = uploaded;
      if (!pdf) {
        try {
          const buffer = await renderPdf({ c, stage, version, calc, summary, verificationCode, templateVersion, assignments });
          if (buffer) pdf = { buffer, fileName: `${c.caseNumber}_${stage === 'FINAL' ? 'Valuation_Report' : 'Preliminary_Valuation'}_v${version}.pdf`, mimeType: 'application/pdf' };
        } catch (e) {
          logger.error({ err: e.message, caseId }, 'Report rendering failed');
        }
      }
      const folder = stage === 'FINAL' ? 'FINAL_VALUATION_REPORT' : 'PRELIMINARY_VALUATION';
      let stored = null;
      if (pdf) {
        const existingDoc = report.currentVersionId ? (await tx.valuationReportVersion.findUnique({ where: { id: report.currentVersionId } }))?.documentId : null;
        stored = await storeVersion({
          principal,
          c,
          folder,
          content: pdf,
          title: stage === 'FINAL' ? 'Valuation report' : 'Preliminary valuation report',
          documentId: existingDoc ?? null,
          uploadSource: uploaded ? 'STAFF' : 'SYSTEM',
          note: `Report version ${version}`,
          req,
          tx,
        });
      }
      const v = await tx.valuationReportVersion.create({
        data: {
          firmId: c.firmId,
          reportId: report.id,
          version,
          inputs: calc.inputs,
          calculation: { lines: calc.lines, assumptions: calc.assumptions, totals: calc.totals },
          marketValue: calc.totals.marketValue,
          realisableValue: calc.totals.realisableValue,
          distressValue: calc.totals.distressValue,
          guidelineValue: calc.totals.guidelineValue,
          insurableValue: calc.totals.insurableValue,
          summary: summary ?? null,
          changeNote: changeNote ?? null,
          documentId: stored?.document.id ?? null,
          documentVersionId: stored?.version.id ?? null,
          templateVersionId: templateVersion?.id ?? null,
          verificationCode,
          preparedById: principal.userId,
        },
      });
      await tx.valuationReport.update({ where: { id: report.id }, data: { currentVersionId: v.id, versionCount: version, status: 'DRAFT', ...(templateVersion ? { templateId: templateVersion.templateId } : {}) } });
      await recordActivity(tx, {
        c,
        principal,
        action: stage === 'FINAL' ? 'FINAL_REPORT_VERSION_CREATED' : 'PRELIMINARY_REPORT_CREATED',
        documentVersionId: stored?.version.id ?? null,
        meta: { version, marketValue: calc.totals.marketValue, changeNote, rendered: !!pdf },
        req,
      });
      return stored?.events ?? [];
    },
    { timeout: 120_000 },
  );
  emitAll(events);
  return getValuations(principal, caseId);
}

/** Attaches an externally prepared PDF as a new version (same inputs / calculation as the current version). */
async function attachReport(principal, caseId, stage, file, req) {
  let content;
  try {
    const meta = validateFile(file, { maxBytes: env.UPLOAD_MAX_MB * 1024 * 1024 });
    if (meta.mimeType !== 'application/pdf') throw new FileValidationError('Reports must be PDF files');
    content = { buffer: file.buffer, fileName: meta.fileName, mimeType: meta.mimeType };
  } catch (e) {
    if (e instanceof FileValidationError) throw BadRequest(e.message);
    throw e;
  }
  const report = await prisma.valuationReport.findUnique({ where: { caseId_stage: { caseId, stage } } });
  const current = report?.currentVersionId ? await prisma.valuationReportVersion.findUnique({ where: { id: report.currentVersionId } }) : null;
  if (!current) throw Conflict('Calculate the valuation first, then attach the signed-off PDF');
  return createVersion(principal, caseId, stage, { inputs: current.inputs, summary: current.summary, changeNote: 'Report PDF uploaded by valuer' }, req, content);
}

/** Submits the preliminary valuation; nextAssigneeId (optional) hands the case over to that senior reviewer. */
async function submitPreliminary(principal, caseId, req, { nextAssigneeId } = {}) {
  await findVisibleCase(principal, caseId);
  const events = await prisma.$transaction(async (tx) => {
    const c = await lockCase(tx, principal.firmId, caseId);
    const report = await tx.valuationReport.findUnique({ where: { caseId_stage: { caseId, stage: 'PRELIMINARY' } } });
    if (!report?.currentVersionId) throw Conflict('Prepare the preliminary valuation first');
    const current = await tx.valuationReportVersion.findUnique({ where: { id: report.currentVersionId } });
    if (!current.documentVersionId) throw Conflict('The current version has no report PDF; attach one before submitting');
    const handover = await handOverInTx(tx, principal, c, 'SENIOR', nextAssigneeId, req);
    const t = await transition(tx, principal, c, 'SUBMIT_PRELIMINARY', { req, documentVersionId: current.documentVersionId, meta: { version: current.version, marketValue: Number(current.marketValue) } });
    await tx.valuationReport.update({ where: { id: report.id }, data: { status: 'SUBMITTED' } });
    return [...handover, ...t.events];
  });
  emitAll(events);
  return getValuations(principal, caseId);
}

/** Senior review of the submitted preliminary version: APPROVE (stay in review, prepare final), RETURN or REJECT. */
async function review(principal, caseId, { decision, comments }, req) {
  await findVisibleCase(principal, caseId);
  if (decision !== 'APPROVED' && !(comments && comments.trim().length >= 3)) throw BadRequest('Comments are required when returning or rejecting');
  const events = await prisma.$transaction(async (tx) => {
    const c = await lockCase(tx, principal.firmId, caseId);
    const assignments = await activeAssignments(tx, caseId);
    const f = roleFlags(principal, assignments);
    if (!f.isSenior || !hasPermission(principal, 'valuation.review')) throw Forbidden('Only the assigned senior reviewer can review (and never the preparer)');
    if (c.status !== STATUS.FINAL_REVIEW_IN_PROGRESS) throw Conflict('Start the final review first');
    const report = await tx.valuationReport.findUnique({ where: { caseId_stage: { caseId, stage: 'PRELIMINARY' } } });
    if (report?.status !== 'SUBMITTED') throw Conflict('There is no submitted preliminary valuation to review');
    await tx.reportReview.create({ data: { firmId: c.firmId, reportVersionId: report.currentVersionId, reviewerId: principal.userId, decision, comments: comments ?? null } });
    await tx.valuationReport.update({ where: { id: report.id }, data: { status: decision } });
    if (decision === 'APPROVED') {
      await recordActivity(tx, { c, principal, action: 'PRELIMINARY_APPROVED', remarks: comments ?? null, req, actorRole: ROLES.SENIOR_REVIEWER });
      return [['case.reviewed', { firmId: c.firmId, caseId, decision, actorId: principal.userId }]];
    }
    const t = await transition(tx, principal, c, decision === 'RETURNED' ? 'RETURN_FOR_CORRECTION' : 'REJECT_VALUATION', { remarks: comments, req });
    return t.events;
  });
  emitAll(events);
  return getValuations(principal, caseId);
}

async function approveFinal(principal, caseId, { comments }, req) {
  await findVisibleCase(principal, caseId);
  const events = await prisma.$transaction(async (tx) => {
    const c = await lockCase(tx, principal.firmId, caseId);
    const final = await tx.valuationReport.findUnique({ where: { caseId_stage: { caseId, stage: 'FINAL' } } });
    if (!final?.currentVersionId) throw Conflict('Prepare the final report first');
    const current = await tx.valuationReportVersion.findUnique({ where: { id: final.currentVersionId } });
    if (!current.documentVersionId) throw Conflict('The final report has no PDF; attach one before approving');
    const t = await transition(tx, principal, c, 'APPROVE_FINAL', { remarks: comments, req, documentVersionId: current.documentVersionId, meta: { version: current.version, marketValue: Number(current.marketValue) } });
    await tx.valuationReport.update({ where: { id: final.id }, data: { status: 'APPROVED' } });
    return t.events;
  });
  emitAll(events);
  return getValuations(principal, caseId);
}

/** Signatures recorded on a report document version (filled in by the signatures module). */
let signaturesFor = async () => [];
const setSignatureLookup = (fn) => {
  signaturesFor = fn;
};

/** Public report verification (QR code on the report). Returns provenance only — never values or documents. */
async function verify(code) {
  const v = await prisma.valuationReportVersion.findUnique({ where: { verificationCode: code }, include: { report: { include: { case: { include: { organization: true, bank: true, category: true } } } } } });
  if (!v || v.report.stage !== 'FINAL') throw NotFound('No report matches this verification code');
  const c = v.report.case;
  const docVersion = v.documentVersionId ? await prisma.documentVersion.findUnique({ where: { id: v.documentVersionId } }) : null;
  const signatures = await signaturesFor(v.documentVersionId);
  return {
    valid: true,
    current: v.report.currentVersionId === v.id,
    reportStatus: v.report.status,
    caseNumber: c.caseNumber,
    firm: { name: c.organization.name, firmCode: c.organization.firmCode },
    lender: { name: c.bank.name, branch: c.bank.branch },
    category: c.category.name,
    version: v.version,
    issuedAt: v.createdAt,
    documentSha256: docVersion?.sha256 ?? null,
    signatures,
  };
}

export { getValuations, createVersion, attachReport, submitPreliminary, review, approveFinal, verify, defaultInputs, setSignatureLookup };
