import { env } from '../../config/env.js';
import { prisma } from '../../database/prisma.js';
import { ROLES } from '../../config/rbac.js';
import { BadRequest, Conflict, Forbidden } from '../../utils/errors.js';
import { hasPermission } from '../../middleware/authorize.js';
import { emit } from '../../services/events.js';
import { findVisibleCase } from '../cases/case-access.js';
import { STATUS } from '../workflow/workflow.definition.js';
import { activeAssignments, lockCase, recordActivity, transition } from '../workflow/workflow.service.js';
import { storeVersion } from '../documents/documents.service.js';
import { FileValidationError, validateFile } from '../documents/file-validator.js';

/**
 * Bank / NBFC submission, loan sanction and disbursement tracking (performed by the case's marketing owner or
 * the Firm Admin). All records are append-only financial evidence; supporting files go to folders 08–10.
 */
const emitAll = (events) => events.forEach(([n, p]) => emit(n, p));
const money = (d) => (d == null ? null : Number(d));

function validated(file) {
  if (!file) return null;
  try {
    const meta = validateFile(file, { maxBytes: env.UPLOAD_MAX_MB * 1024 * 1024 });
    return { buffer: file.buffer, fileName: meta.fileName, mimeType: meta.mimeType };
  } catch (e) {
    if (e instanceof FileValidationError) throw BadRequest(e.message);
    throw e;
  }
}

async function assertActor(principal, caseId, permission) {
  if (!hasPermission(principal, permission)) throw Forbidden();
  if (principal.roles.includes(ROLES.FIRM_ADMIN)) return;
  const a = await activeAssignments(prisma, caseId);
  if (!a.some((x) => x.stage === 'MARKETING' && x.employeeId === principal.employeeId)) throw Forbidden('Only the case’s marketing owner or the Firm Admin can do this');
}

/** The file the bank receives: the client-signed report, or (for lenders without client approval) the valuer-signed report. */
async function deliverable(caseId) {
  const clientSig = await prisma.digitalSignature.findFirst({ where: { caseId, signerRole: 'CLIENT', status: 'SIGNED' }, orderBy: { signedAt: 'desc' } });
  const valuerSig = await prisma.digitalSignature.findFirst({ where: { caseId, signerRole: 'VALUER', status: 'SIGNED' }, orderBy: { signedAt: 'desc' } });
  const sig = clientSig ?? valuerSig;
  if (!sig) return null;
  const v = await prisma.documentVersion.findUnique({ where: { id: sig.signedVersionId } });
  return { signatureRole: sig.signerRole, documentId: v.documentId, versionId: v.id, fileName: v.originalName, sha256: v.sha256 };
}

async function getBankAndLoan(principal, caseId) {
  const c = await findVisibleCase(principal, caseId, prisma, { bank: true });
  const isClient = !!principal.clientId && !principal.employeeId;
  const [submissions, sanction, disbursements, file, assignments] = await Promise.all([
    prisma.bankSubmission.findMany({ where: { caseId }, orderBy: { createdAt: 'asc' } }),
    prisma.loanSanction.findUnique({ where: { caseId } }),
    prisma.loanDisbursement.findMany({ where: { caseId }, orderBy: { trancheNo: 'asc' } }),
    deliverable(caseId),
    activeAssignments(prisma, caseId),
  ]);
  const canAct = (perm) => !isClient && hasPermission(principal, perm) && (principal.roles.includes(ROLES.FIRM_ADMIN) || assignments.some((x) => x.stage === 'MARKETING' && x.employeeId === principal.employeeId));
  const readyForBank = c.status === STATUS.CLIENT_SIGNED || (c.status === STATUS.FINAL_APPROVED && !c.bank.requiresClientApproval && file?.signatureRole === 'VALUER');
  const disbursed = disbursements.reduce((s, d) => s + Number(d.amount), 0);
  return {
    caseStatus: c.status,
    lender: { name: c.bank.name, branch: c.bank.branch, requiresClientApproval: c.bank.requiresClientApproval },
    deliverable: file,
    submissions: submissions.map((s) => ({ ...s, ...(isClient ? { remarks: undefined } : {}) })),
    sanction: sanction ? { ...sanction, amount: money(sanction.amount) } : null,
    disbursements: disbursements.map((d) => ({ ...d, amount: money(d.amount) })),
    totals: { sanctioned: money(sanction?.amount) ?? 0, disbursed, remaining: sanction?.outcome === 'SANCTIONED' ? Math.max(0, Number(sanction.amount) - disbursed) : 0 },
    permissions: {
      canSubmit: canAct('bank.submit') && (readyForBank || c.status === STATUS.SUBMITTED_TO_BANK),
      canRecordSanction: canAct('loan.update') && c.status === STATUS.SUBMITTED_TO_BANK && !sanction,
      canRecordDisbursement: canAct('loan.update') && c.status === STATUS.LOAN_SANCTIONED,
      canClose: canAct('case.close') && c.status === STATUS.DISBURSED,
    },
  };
}

/** Records a submission (first one moves the case to SUBMITTED_TO_BANK). An ack number or ack document is required. */
async function submit(principal, caseId, body, file, req) {
  await findVisibleCase(principal, caseId);
  await assertActor(principal, caseId, 'bank.submit');
  const ack = validated(file);
  if (!body.ackNumber && !ack) throw BadRequest('Enter the acknowledgement number or attach the acknowledgement');
  const signed = await deliverable(caseId);
  if (!signed) throw Conflict('The signed report is not available yet');
  const events = await prisma.$transaction(
    async (tx) => {
      const c = await lockCase(tx, principal.firmId, caseId);
      const out = [];
      if (c.status !== STATUS.SUBMITTED_TO_BANK) {
        if (c.status === STATUS.FINAL_APPROVED && signed.signatureRole !== 'VALUER') throw Conflict('The valuer must sign the report first');
        const t = await transition(tx, principal, c, 'SUBMIT_TO_BANK', { req, documentVersionId: signed.versionId, meta: { mode: body.mode, ackNumber: body.ackNumber ?? null } });
        out.push(...t.events);
      }
      const stored = ack ? await storeVersion({ principal, c, folder: 'BANK_SUBMISSION', content: ack, title: `Bank acknowledgement ${body.ackNumber ?? ''}`.trim(), req, tx }) : null;
      if (stored) out.push(...stored.events);
      await tx.bankSubmission.create({ data: { firmId: c.firmId, caseId, mode: body.mode, submittedOn: body.submittedOn, submittedTo: body.submittedTo ?? null, ackNumber: body.ackNumber ?? null, ackDocumentId: stored?.document.id ?? null, signedVersionId: signed.versionId, remarks: body.remarks ?? null, submittedById: principal.userId } });
      await recordActivity(tx, { c, principal, action: 'BANK_SUBMISSION_RECORDED', meta: { mode: body.mode, ackNumber: body.ackNumber ?? null }, documentVersionId: stored?.version.id ?? null, req, clientVisible: true });
      return out;
    },
    { timeout: 30_000 },
  );
  emitAll(events);
  return getBankAndLoan(principal, caseId);
}

async function recordSanction(principal, caseId, body, file, req) {
  await findVisibleCase(principal, caseId);
  await assertActor(principal, caseId, 'loan.update');
  if (body.outcome === 'SANCTIONED' && !(body.amount > 0)) throw BadRequest('Enter the sanctioned amount');
  if (body.outcome === 'DECLINED' && !(body.remarks && body.remarks.trim().length >= 3)) throw BadRequest('Enter the reason given by the lender');
  const letter = validated(file);
  const events = await prisma.$transaction(
    async (tx) => {
      const c = await lockCase(tx, principal.firmId, caseId);
      if (await tx.loanSanction.findUnique({ where: { caseId } })) throw Conflict('The lender decision is already recorded');
      const stored = letter ? await storeVersion({ principal, c, folder: 'SANCTION_DOCUMENTS', content: letter, title: body.outcome === 'SANCTIONED' ? 'Sanction letter' : 'Decline letter', req, tx }) : null;
      await tx.loanSanction.create({
        data: { firmId: c.firmId, caseId, outcome: body.outcome, amount: body.outcome === 'SANCTIONED' ? body.amount : null, sanctionDate: body.sanctionDate, referenceNo: body.referenceNo ?? null, letterDocumentId: stored?.document.id ?? null, remarks: body.remarks ?? null, recordedById: principal.userId },
      });
      const t = await transition(tx, principal, c, body.outcome === 'SANCTIONED' ? 'RECORD_SANCTION' : 'RECORD_DECLINE', { remarks: body.remarks, req, documentVersionId: stored?.version.id ?? null, meta: { amount: body.amount ?? null, referenceNo: body.referenceNo ?? null } });
      return [...(stored?.events ?? []), ...t.events];
    },
    { timeout: 30_000 },
  );
  emitAll(events);
  return getBankAndLoan(principal, caseId);
}

/**
 * Moves a sanctioned case whose loan is fully disbursed to DISBURSED and then CASE_COMPLETED (both automatic,
 * recorded as SYSTEM steps). Call inside the transaction, on a LOCKED case in LOAN_SANCTIONED.
 */
async function completeDisbursement(tx, principal, c, { tranche, total, req, system = false }) {
  const disbursed = await transition(tx, principal, c, 'RECORD_FINAL_DISBURSEMENT', { req, system, meta: { tranche, total, ...(system ? { automatic: true } : {}) } });
  const closed = await transition(tx, principal, disbursed.case, 'CLOSE_CASE', { system: true, remarks: 'Loan fully disbursed', req, meta: { automatic: true } });
  return [...disbursed.events, ...closed.events];
}

/**
 * Records a disbursement tranche; the cumulative amount may not exceed the sanction. The tranche marked final, or
 * the one that brings the total to the sanctioned amount, completes the case (DISBURSED → CASE_COMPLETED).
 */
async function recordDisbursement(principal, caseId, body, file, req) {
  await findVisibleCase(principal, caseId);
  await assertActor(principal, caseId, 'loan.update');
  const proof = validated(file);
  const events = await prisma.$transaction(
    async (tx) => {
      const c = await lockCase(tx, principal.firmId, caseId);
      if (c.status !== STATUS.LOAN_SANCTIONED) throw Conflict('Disbursements can be recorded only for a sanctioned loan');
      const sanction = await tx.loanSanction.findUnique({ where: { caseId } });
      const previous = await tx.loanDisbursement.findMany({ where: { caseId } });
      const total = previous.reduce((s, d) => s + Number(d.amount), 0) + body.amount;
      const isFinal = !!body.isFinal || total >= Number(sanction.amount) - 0.001;
      if (total > Number(sanction.amount) + 0.001) throw BadRequest(`Total disbursed (₹${total.toLocaleString('en-IN')}) would exceed the sanctioned amount (₹${Number(sanction.amount).toLocaleString('en-IN')})`);
      if (body.disbursedOn < sanction.sanctionDate) throw BadRequest('The disbursement date cannot be before the sanction date');
      const stored = proof ? await storeVersion({ principal, c, folder: 'DISBURSEMENT_DOCUMENTS', content: proof, title: `Disbursement ${previous.length + 1} confirmation`, req, tx }) : null;
      await tx.loanDisbursement.create({
        data: { firmId: c.firmId, caseId, trancheNo: previous.length + 1, amount: body.amount, disbursedOn: body.disbursedOn, referenceNo: body.referenceNo ?? null, proofDocumentId: stored?.document.id ?? null, isFinal, remarks: body.remarks ?? null, recordedById: principal.userId },
      });
      const out = [...(stored?.events ?? [])];
      if (isFinal) out.push(...(await completeDisbursement(tx, principal, c, { tranche: previous.length + 1, total, req })));
      else await recordActivity(tx, { c, principal, action: 'DISBURSEMENT_RECORDED', meta: { tranche: previous.length + 1, amount: body.amount }, req, clientVisible: true });
      return out;
    },
    { timeout: 30_000 },
  );
  emitAll(events);
  return getBankAndLoan(principal, caseId);
}

export { getBankAndLoan, submit, recordSanction, recordDisbursement, completeDisbursement };
