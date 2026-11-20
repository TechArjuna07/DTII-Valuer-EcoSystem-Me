import { env } from '../../config/env.js';
import { prisma } from '../../database/prisma.js';
import { BadRequest, Conflict, Forbidden } from '../../utils/errors.js';
import { hasPermission } from '../../middleware/authorize.js';
import { emit } from '../../services/events.js';
import { findVisibleCase } from '../cases/case-access.js';
import { STATUS, TERMINAL } from '../workflow/workflow.definition.js';
import { lockCase, recordActivity, transition } from '../workflow/workflow.service.js';
import { handOverInTx } from '../cases/cases.service.js';
import { storeVersion } from '../documents/documents.service.js';
import { FileValidationError, validateFile } from '../documents/file-validator.js';
import { DEFAULT_WORKFLOW } from '../masters/masters.service.js';
import { missingRequired, validatePropertyData } from './property-fields.js';

const emitAll = (events) => events.forEach(([n, p]) => emit(n, p));
const EDITABLE_STATUSES = [STATUS.INSPECTION_ASSIGNED, STATUS.INSPECTION_IN_PROGRESS];

async function categoryFields(categoryId) {
  return prisma.categoryFieldDefinition.findMany({ where: { categoryId, active: true }, orderBy: { sortOrder: 'asc' } });
}

async function fieldAssignee(caseId) {
  return prisma.caseAssignment.findFirst({ where: { caseId, stage: 'FIELD', endedAt: null } });
}

const isFieldOfficerOf = (principal, assignment) => !!assignment && assignment.employeeId === principal.employeeId;

async function assertFieldOfficer(principal, c) {
  if (!hasPermission(principal, 'inspection.perform')) throw Forbidden();
  if (!isFieldOfficerOf(principal, await fieldAssignee(c.id))) throw Forbidden('Only the assigned field officer can do this');
}

// ───────────── Property details ─────────────

/** Marketing / admin may edit property details while the case is open; the field officer during the inspection. */
async function canEditProperty(principal, c) {
  if (TERMINAL.includes(c.status)) return false;
  if (hasPermission(principal, 'case.create')) return true;
  return EDITABLE_STATUSES.includes(c.status) && hasPermission(principal, 'inspection.perform') && isFieldOfficerOf(principal, await fieldAssignee(c.id));
}

async function getProperty(principal, caseId) {
  const c = await findVisibleCase(principal, caseId, prisma, { category: true });
  const [fields, details] = await Promise.all([categoryFields(c.categoryId), prisma.propertyDetails.findUnique({ where: { caseId } })]);
  return {
    category: { id: c.category.id, name: c.category.name, fieldsVersion: c.category.fieldsVersion },
    fields: fields.map((f) => ({ key: f.key, section: f.section, label: f.label, type: f.type, required: f.required, options: f.options, unit: f.unit, helpText: f.helpText })),
    data: details?.data ?? {},
    fieldsVersion: details?.fieldsVersion ?? c.category.fieldsVersion,
    updatedAt: details?.updatedAt ?? null,
    canEdit: await canEditProperty(principal, c),
    missingRequired: missingRequired(fields, details?.data),
  };
}

async function saveProperty(principal, caseId, input, req) {
  const c = await findVisibleCase(principal, caseId, prisma, { category: true });
  if (!(await canEditProperty(principal, c))) throw Forbidden('You cannot edit the property details of this case now');
  const fields = await categoryFields(c.categoryId);
  const { data, errors } = validatePropertyData(fields, input);
  if (errors.length) throw BadRequest(errors);
  await prisma.$transaction(async (tx) => {
    await tx.propertyDetails.upsert({
      where: { caseId },
      update: { data, fieldsVersion: c.category.fieldsVersion, updatedById: principal.userId },
      create: { firmId: c.firmId, caseId, data, fieldsVersion: c.category.fieldsVersion, updatedById: principal.userId },
    });
    await recordActivity(tx, { c, principal, action: 'PROPERTY_DETAILS_UPDATED', meta: { fields: Object.keys(data).length }, req });
  });
  return getProperty(principal, caseId);
}

// ───────────── Inspection ─────────────

const latestRound = (db, caseId) => db.propertyInspection.findFirst({ where: { caseId }, orderBy: { round: 'desc' } });

/**
 * The editable inspection round: creates round 1, or a new round (copying the previous findings, without photos)
 * when the senior reviewer has requested a re-inspection.
 */
async function ensureDraftRound(tx, c, principal) {
  const last = await latestRound(tx, c.id);
  if (last && last.status === 'DRAFT') return last;
  if (last && c.status !== STATUS.INSPECTION_IN_PROGRESS) throw Conflict('The inspection has already been submitted');
  const carry = last
    ? (({ id: _i, round: _r, status: _s, submittedAt: _sa, createdAt: _c, updatedAt: _u, scheduledAt: _sc, startedAt: _st, inspectedAt: _ia, ...rest }) => rest)(last)
    : {};
  return tx.propertyInspection.create({ data: { ...carry, firmId: c.firmId, caseId: c.id, round: (last?.round ?? 0) + 1, officerId: principal.employeeId, status: 'DRAFT' } });
}

function readiness(insp, photosCount, minPhotos, propertyMissing) {
  const checks = [
    { key: 'property', label: 'Required property details completed', ok: propertyMissing.length === 0, detail: propertyMissing.length ? `Missing: ${propertyMissing.join(', ')}` : null },
    { key: 'type', label: 'Property type recorded', ok: !!insp?.propertyType },
    { key: 'address', label: 'Property address recorded', ok: !!insp?.propertyAddress },
    { key: 'area', label: 'Land or building area recorded', ok: insp?.landArea != null || insp?.buildingArea != null },
    { key: 'condition', label: 'Property condition assessed', ok: !!insp?.condition },
    { key: 'gps', label: 'GPS captured (or consent declined with a reason)', ok: (insp?.gpsLat != null && insp?.gpsLng != null) || (insp?.gpsConsent === false && !!insp?.gpsDeclinedReason) },
    { key: 'photos', label: `At least ${minPhotos} photograph(s)`, ok: photosCount >= minPhotos, detail: `${photosCount} uploaded` },
  ];
  return { ready: checks.every((x) => x.ok), checks };
}

async function minPhotosFor(firmId) {
  const s = await prisma.organizationSettings.findUnique({ where: { firmId }, select: { workflowOptions: true } });
  return Number(s?.workflowOptions?.minInspectionPhotos ?? DEFAULT_WORKFLOW.minInspectionPhotos);
}

async function photoView(photos) {
  const docs = photos.length ? await prisma.caseDocument.findMany({ where: { id: { in: photos.map((p) => p.documentId) } }, include: { versions: true } }) : [];
  const byId = new Map(docs.map((d) => [d.id, d]));
  return photos.map((p) => {
    const d = byId.get(p.documentId);
    const v = d?.versions.find((x) => x.id === d.currentVersionId);
    return { id: p.id, documentId: p.documentId, kind: p.kind, caption: p.caption, gpsLat: p.gpsLat, gpsLng: p.gpsLng, capturedAt: p.capturedAt, fileName: v?.originalName, downloadable: ['CLEAN', 'SKIPPED'].includes(v?.scanStatus) };
  });
}

async function getInspection(principal, caseId) {
  const c = await findVisibleCase(principal, caseId, prisma, { category: true });
  const rounds = await prisma.propertyInspection.findMany({ where: { caseId }, orderBy: { round: 'desc' }, include: { photos: { orderBy: { createdAt: 'asc' } }, officer: { include: { user: { select: { fullName: true } } } } } });
  const current = rounds[0] ?? null;
  const [fields, details, minPhotos, assignment] = await Promise.all([categoryFields(c.categoryId), prisma.propertyDetails.findUnique({ where: { caseId } }), minPhotosFor(c.firmId), fieldAssignee(caseId)]);
  const isOfficer = hasPermission(principal, 'inspection.perform') && isFieldOfficerOf(principal, assignment);
  const editable = isOfficer && EDITABLE_STATUSES.includes(c.status) && (!current || current.status === 'DRAFT' || c.status === STATUS.INSPECTION_IN_PROGRESS);
  const strip = ({ photos: _p, officer, ...r }) => ({ ...r, officerName: officer.user.fullName });
  return {
    caseStatus: c.status,
    isAssignedOfficer: isOfficer,
    canEdit: editable,
    canStart: isOfficer && c.status === STATUS.INSPECTION_ASSIGNED,
    canSubmit: isOfficer && c.status === STATUS.INSPECTION_IN_PROGRESS && current?.status === 'DRAFT',
    current: current ? { ...strip(current), photos: await photoView(current.photos) } : null,
    previousRounds: rounds.slice(1).map((r) => ({ id: r.id, round: r.round, submittedAt: r.submittedAt, officerName: r.officer.user.fullName, photoCount: r.photos.length })),
    readiness: readiness(current, current?.photos.length ?? 0, minPhotos, missingRequired(fields, details?.data)),
  };
}

/** Schedules (or reschedules) the visit. The first scheduling starts the inspection stage. */
async function schedule(principal, caseId, { scheduledAt }, req) {
  const c0 = await findVisibleCase(principal, caseId);
  await assertFieldOfficer(principal, c0);
  const events = await prisma.$transaction(async (tx) => {
    let c = await lockCase(tx, principal.firmId, caseId);
    if (!EDITABLE_STATUSES.includes(c.status)) throw Conflict('The inspection can no longer be scheduled');
    const out = [];
    if (c.status === STATUS.INSPECTION_ASSIGNED) {
      const t = await transition(tx, principal, c, 'START_INSPECTION', { req, meta: { scheduledAt } });
      c = t.case;
      out.push(...t.events);
    }
    const round = await ensureDraftRound(tx, c, principal);
    await tx.propertyInspection.update({ where: { id: round.id }, data: { scheduledAt } });
    await recordActivity(tx, { c, principal, action: 'INSPECTION_SCHEDULED', meta: { scheduledAt, round: round.round }, req, clientVisible: true });
    out.push(['inspection.scheduled', { firmId: c.firmId, caseId, scheduledAt, actorId: principal.userId }]);
    return out;
  });
  emitAll(events);
  return getInspection(principal, caseId);
}

/** Starts the visit now (records the start time). */
async function start(principal, caseId, req) {
  const c0 = await findVisibleCase(principal, caseId);
  await assertFieldOfficer(principal, c0);
  const events = await prisma.$transaction(async (tx) => {
    let c = await lockCase(tx, principal.firmId, caseId);
    const out = [];
    if (c.status === STATUS.INSPECTION_ASSIGNED) {
      const t = await transition(tx, principal, c, 'START_INSPECTION', { req });
      c = t.case;
      out.push(...t.events);
    } else if (c.status !== STATUS.INSPECTION_IN_PROGRESS) throw Conflict('The inspection cannot be started now');
    const round = await ensureDraftRound(tx, c, principal);
    await tx.propertyInspection.update({ where: { id: round.id }, data: { startedAt: round.startedAt ?? new Date() } });
    await recordActivity(tx, { c, principal, action: 'INSPECTION_STARTED', meta: { round: round.round }, req, clientVisible: true });
    return out;
  });
  emitAll(events);
  return getInspection(principal, caseId);
}

async function saveDraft(principal, caseId, body, req) {
  const c0 = await findVisibleCase(principal, caseId);
  await assertFieldOfficer(principal, c0);
  await prisma.$transaction(async (tx) => {
    const c = await lockCase(tx, principal.firmId, caseId);
    if (c.status !== STATUS.INSPECTION_IN_PROGRESS) throw Conflict('Start the inspection before recording findings');
    const round = await ensureDraftRound(tx, c, principal);
    const data = { ...body };
    if (body.gpsLat !== undefined || body.gpsLng !== undefined) data.gpsCapturedAt = body.gpsLat != null ? new Date() : null;
    if (body.gpsConsent === true) data.gpsDeclinedReason = null;
    if (body.gpsConsent === false) Object.assign(data, { gpsLat: null, gpsLng: null, gpsAccuracyM: null, gpsCapturedAt: null });
    await tx.propertyInspection.update({ where: { id: round.id }, data });
    if (body.gpsLat != null) await recordActivity(tx, { c, principal, action: 'INSPECTION_GPS_CAPTURED', meta: { accuracyM: body.gpsAccuracyM ?? null }, req });
  });
  return getInspection(principal, caseId);
}

async function addPhoto(principal, caseId, file, meta, req) {
  const c0 = await findVisibleCase(principal, caseId);
  await assertFieldOfficer(principal, c0);
  let content;
  try {
    const v = validateFile(file, { maxBytes: env.UPLOAD_MAX_MB * 1024 * 1024, imagesOnly: true });
    content = { buffer: file.buffer, fileName: v.fileName, mimeType: v.mimeType };
  } catch (e) {
    if (e instanceof FileValidationError) throw BadRequest(e.message);
    throw e;
  }
  const events = await prisma.$transaction(
    async (tx) => {
      const c = await lockCase(tx, principal.firmId, caseId);
      if (c.status !== STATUS.INSPECTION_IN_PROGRESS) throw Conflict('Start the inspection before adding photographs');
      const round = await ensureDraftRound(tx, c, principal);
      const stored = await storeVersion({ principal, c, folder: 'PROPERTY_PHOTOGRAPHS', content, title: meta.caption || `${meta.kind.toLowerCase()} photo`, uploadSource: 'STAFF', req, tx });
      await tx.inspectionPhoto.create({
        data: { firmId: c.firmId, inspectionId: round.id, documentId: stored.document.id, kind: meta.kind, caption: meta.caption ?? null, gpsLat: meta.gpsLat ?? null, gpsLng: meta.gpsLng ?? null, capturedAt: meta.capturedAt ?? new Date() },
      });
      return stored.events;
    },
    { timeout: 30_000 },
  );
  emitAll(events);
  return getInspection(principal, caseId);
}

/** Detaches a photo from the inspection (the image itself stays in the repository as evidence). */
async function removePhoto(principal, caseId, photoId, req) {
  const c = await findVisibleCase(principal, caseId);
  await assertFieldOfficer(principal, c);
  const photo = await prisma.inspectionPhoto.findFirst({ where: { id: photoId, firmId: principal.firmId, inspection: { caseId, status: 'DRAFT' } } });
  if (!photo) throw BadRequest('Photo not found on the current draft inspection');
  await prisma.$transaction(async (tx) => {
    await tx.inspectionPhoto.delete({ where: { id: photoId } });
    await recordActivity(tx, { c, principal, action: 'INSPECTION_PHOTO_DETACHED', meta: { documentId: photo.documentId }, req });
  });
  return getInspection(principal, caseId);
}

/**
 * Submits the inspection report after the server-side readiness checks; the case moves to INSPECTION_COMPLETED.
 * nextAssigneeId (optional) hands the case over to that junior reviewer; otherwise the firm's auto-assignment
 * (if enabled) or the Firm Admin picks one.
 */
async function submit(principal, caseId, req, { nextAssigneeId } = {}) {
  const c0 = await findVisibleCase(principal, caseId, prisma, { category: true });
  await assertFieldOfficer(principal, c0);
  const [fields, details, minPhotos] = await Promise.all([categoryFields(c0.categoryId), prisma.propertyDetails.findUnique({ where: { caseId } }), minPhotosFor(c0.firmId)]);
  const events = await prisma.$transaction(async (tx) => {
    const c = await lockCase(tx, principal.firmId, caseId);
    const round = await latestRound(tx, caseId);
    if (!round || round.status !== 'DRAFT') throw Conflict('There is no draft inspection to submit');
    const photos = await tx.inspectionPhoto.count({ where: { inspectionId: round.id } });
    const r = readiness(round, photos, minPhotos, missingRequired(fields, details?.data));
    if (!r.ready) throw BadRequest(r.checks.filter((x) => !x.ok).map((x) => (x.detail ? `${x.label} (${x.detail})` : x.label)));
    await tx.propertyInspection.update({ where: { id: round.id }, data: { status: 'SUBMITTED', submittedAt: new Date(), inspectedAt: round.inspectedAt ?? round.startedAt ?? new Date() } });
    const handover = await handOverInTx(tx, principal, c, 'JUNIOR', nextAssigneeId, req);
    const t = await transition(tx, principal, c, 'SUBMIT_INSPECTION', { req, meta: { round: round.round, photos } });
    return [...handover, ...t.events];
  });
  emitAll(events);
  return getInspection(principal, caseId);
}

/** Field officer dashboard lists: today's visits, pending and recently completed inspections. */
async function myInspections(principal) {
  if (!principal.employeeId) return { today: [], pending: [], completed: [] };
  const cases = await prisma.valuationCase.findMany({
    where: { firmId: principal.firmId, assignments: { some: { employeeId: principal.employeeId, stage: 'FIELD', endedAt: null } } },
    select: {
      id: true,
      caseNumber: true,
      status: true,
      priority: true,
      propertyAddress: true,
      propertyCity: true,
      dueDate: true,
      client: { select: { name: true, phone: true } },
      bank: { select: { shortCode: true } },
      category: { select: { name: true } },
      inspections: { orderBy: { round: 'desc' }, take: 1, select: { scheduledAt: true, submittedAt: true, status: true, round: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 300,
  });
  const istDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
  const today = istDay(new Date());
  const item = (c) => ({ ...c, inspection: c.inspections[0] ?? null, inspections: undefined });
  const pending = cases.filter((c) => EDITABLE_STATUSES.includes(c.status)).map(item);
  return {
    today: pending.filter((c) => c.inspection?.scheduledAt && istDay(c.inspection.scheduledAt) === today),
    pending,
    completed: cases.filter((c) => !EDITABLE_STATUSES.includes(c.status) && c.inspections[0]?.status === 'SUBMITTED').slice(0, 25).map(item),
    counts: { assigned: cases.length, pending: pending.length },
  };
}

export { getProperty, saveProperty, getInspection, schedule, start, saveDraft, addPhoto, removePhoto, submit, myInspections };
