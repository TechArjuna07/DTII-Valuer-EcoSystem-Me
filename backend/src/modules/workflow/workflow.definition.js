/**
 * Case workflow — declarative state machine (docs/PHASE_1_ARCHITECTURE_AND_PLAN.md §5).
 *
 * Each transition declares:
 *   action      unique name
 *   from        statuses it may start from
 *   to          target status (or 'HOLD_ORIGIN' = back to the status before the hold)
 *   permission  required permission code
 *   stage       assignment stage whose ACTIVE assignee must perform it (FIELD / JUNIOR / SENIOR / MARKETING)
 *   adminOverride  a Firm Admin may perform it without being the stage assignee
 *   client      must be performed by the case's own client (portal)
 *   system      only the platform may perform it (e.g. signature provider confirmation)
 *   generic     may be triggered through POST /cases/:id/transitions; non-generic transitions are executed by
 *               their own module (inspection, valuation, approval, bank…) after that module's validation
 *   remarks     a remark is mandatory
 *   clientVisible  shown on the client's portal timeline
 *
 * Firm-level configuration (SLA hours per status, auto-assignment, whether a lender needs client approval) is read
 * from organization_settings / banks — the transition graph itself is fixed to protect case integrity.
 */

const S = Object.freeze({
  CASE_RECEIVED: 'CASE_RECEIVED',
  INSPECTION_ASSIGNED: 'INSPECTION_ASSIGNED',
  INSPECTION_IN_PROGRESS: 'INSPECTION_IN_PROGRESS',
  INSPECTION_COMPLETED: 'INSPECTION_COMPLETED',
  PRELIMINARY_VALUATION_IN_PROGRESS: 'PRELIMINARY_VALUATION_IN_PROGRESS',
  PRELIMINARY_SUBMITTED: 'PRELIMINARY_SUBMITTED',
  FINAL_REVIEW_IN_PROGRESS: 'FINAL_REVIEW_IN_PROGRESS',
  SENT_BACK_FOR_CORRECTION: 'SENT_BACK_FOR_CORRECTION',
  FINAL_APPROVED: 'FINAL_APPROVED',
  CLIENT_APPROVAL_PENDING: 'CLIENT_APPROVAL_PENDING',
  CLIENT_QUERY_RAISED: 'CLIENT_QUERY_RAISED',
  CLIENT_APPROVED: 'CLIENT_APPROVED',
  CLIENT_SIGNED: 'CLIENT_SIGNED',
  SUBMITTED_TO_BANK: 'SUBMITTED_TO_BANK',
  LOAN_SANCTIONED: 'LOAN_SANCTIONED',
  DISBURSED: 'DISBURSED',
  CASE_COMPLETED: 'CASE_COMPLETED',
  CASE_ON_HOLD: 'CASE_ON_HOLD',
  CASE_CANCELLED: 'CASE_CANCELLED',
  CASE_REJECTED: 'CASE_REJECTED',
});

const TERMINAL = [S.CASE_COMPLETED, S.CASE_CANCELLED, S.CASE_REJECTED];
const ALL = Object.values(S);
const ACTIVE = ALL.filter((s) => !TERMINAL.includes(s) && s !== S.CASE_ON_HOLD);

/** Ordered pipeline (for progress display and "statusGroup" filters). */
const PIPELINE = [
  S.CASE_RECEIVED,
  S.INSPECTION_ASSIGNED,
  S.INSPECTION_IN_PROGRESS,
  S.INSPECTION_COMPLETED,
  S.PRELIMINARY_VALUATION_IN_PROGRESS,
  S.PRELIMINARY_SUBMITTED,
  S.FINAL_REVIEW_IN_PROGRESS,
  S.FINAL_APPROVED,
  S.CLIENT_APPROVAL_PENDING,
  S.CLIENT_APPROVED,
  S.CLIENT_SIGNED,
  S.SUBMITTED_TO_BANK,
  S.LOAN_SANCTIONED,
  S.DISBURSED,
  S.CASE_COMPLETED,
];

const STATUS_GROUPS = Object.freeze({
  NEW: [S.CASE_RECEIVED],
  INSPECTION: [S.INSPECTION_ASSIGNED, S.INSPECTION_IN_PROGRESS],
  PRELIMINARY: [S.INSPECTION_COMPLETED, S.PRELIMINARY_VALUATION_IN_PROGRESS, S.SENT_BACK_FOR_CORRECTION],
  SENIOR_REVIEW: [S.PRELIMINARY_SUBMITTED, S.FINAL_REVIEW_IN_PROGRESS],
  CLIENT: [S.FINAL_APPROVED, S.CLIENT_APPROVAL_PENDING, S.CLIENT_QUERY_RAISED, S.CLIENT_APPROVED],
  BANK: [S.CLIENT_SIGNED, S.SUBMITTED_TO_BANK],
  LOAN: [S.LOAN_SANCTIONED, S.DISBURSED],
  CLOSED: TERMINAL,
  ON_HOLD: [S.CASE_ON_HOLD],
  ACTIVE,
});

const T = (action, from, to, permission, extra = {}) => ({ action, from: [].concat(from), to, permission, ...extra });

const TRANSITIONS = [
  T('ASSIGN_FIELD_OFFICER', S.CASE_RECEIVED, S.INSPECTION_ASSIGNED, 'case.assign.field', { clientVisible: true }),
  T('START_INSPECTION', S.INSPECTION_ASSIGNED, S.INSPECTION_IN_PROGRESS, 'inspection.perform', { stage: 'FIELD', clientVisible: true }),
  T('SUBMIT_INSPECTION', S.INSPECTION_IN_PROGRESS, S.INSPECTION_COMPLETED, 'inspection.submit', { stage: 'FIELD', clientVisible: true }),
  T('START_PRELIMINARY', [S.INSPECTION_COMPLETED, S.SENT_BACK_FOR_CORRECTION], S.PRELIMINARY_VALUATION_IN_PROGRESS, 'valuation.prepare', { stage: 'JUNIOR', generic: true }),
  T('SUBMIT_PRELIMINARY', S.PRELIMINARY_VALUATION_IN_PROGRESS, S.PRELIMINARY_SUBMITTED, 'valuation.submit', { stage: 'JUNIOR' }),
  T('START_FINAL_REVIEW', [S.PRELIMINARY_SUBMITTED, S.CLIENT_QUERY_RAISED], S.FINAL_REVIEW_IN_PROGRESS, 'valuation.review', { stage: 'SENIOR', generic: true }),
  T('RETURN_FOR_CORRECTION', S.FINAL_REVIEW_IN_PROGRESS, S.SENT_BACK_FOR_CORRECTION, 'valuation.review', { stage: 'SENIOR', remarks: true }),
  T('REQUEST_REINSPECTION', S.FINAL_REVIEW_IN_PROGRESS, S.INSPECTION_IN_PROGRESS, 'valuation.review', { stage: 'SENIOR', remarks: true, generic: true }),
  T('APPROVE_FINAL', S.FINAL_REVIEW_IN_PROGRESS, S.FINAL_APPROVED, 'valuation.approve', { stage: 'SENIOR' }),
  T('REJECT_VALUATION', S.FINAL_REVIEW_IN_PROGRESS, S.CASE_REJECTED, 'valuation.review', { stage: 'SENIOR', remarks: true }),
  T('RELEASE_TO_CLIENT', S.FINAL_APPROVED, S.CLIENT_APPROVAL_PENDING, 'report.release', { stage: 'SENIOR', adminOverride: true, clientVisible: true }),
  T('CLIENT_APPROVE', S.CLIENT_APPROVAL_PENDING, S.CLIENT_APPROVED, 'client.approve', { client: true, clientVisible: true }),
  T('CLIENT_RAISE_QUERY', S.CLIENT_APPROVAL_PENDING, S.CLIENT_QUERY_RAISED, 'client.approve', { client: true, remarks: true, clientVisible: true }),
  T('CLIENT_SIGNATURE_COMPLETED', S.CLIENT_APPROVED, S.CLIENT_SIGNED, null, { system: true, clientVisible: true }),
  T('SUBMIT_TO_BANK', [S.CLIENT_SIGNED, S.FINAL_APPROVED], S.SUBMITTED_TO_BANK, 'bank.submit', { stage: 'MARKETING', adminOverride: true, clientVisible: true }),
  T('RECORD_SANCTION', S.SUBMITTED_TO_BANK, S.LOAN_SANCTIONED, 'loan.update', { stage: 'MARKETING', adminOverride: true, clientVisible: true }),
  T('RECORD_DECLINE', S.SUBMITTED_TO_BANK, S.CASE_REJECTED, 'loan.update', { stage: 'MARKETING', adminOverride: true, remarks: true, clientVisible: true }),
  T('RECORD_FINAL_DISBURSEMENT', S.LOAN_SANCTIONED, S.DISBURSED, 'loan.update', { stage: 'MARKETING', adminOverride: true, clientVisible: true }),
  T('CLOSE_CASE', S.DISBURSED, S.CASE_COMPLETED, 'case.close', { stage: 'MARKETING', adminOverride: true, generic: true, clientVisible: true }),
  T('HOLD', ACTIVE, S.CASE_ON_HOLD, 'case.hold', { remarks: true, generic: true, clientVisible: true }),
  T('RESUME', S.CASE_ON_HOLD, 'HOLD_ORIGIN', 'case.hold', { generic: true, clientVisible: true }),
  T('CANCEL', [...ACTIVE, S.CASE_ON_HOLD], S.CASE_CANCELLED, 'case.cancel', { remarks: true, generic: true, clientVisible: true }),
];

const byAction = new Map(TRANSITIONS.map((t) => [t.action, t]));

/** Stage → employee role required for that assignment. */
const STAGE_ROLE = Object.freeze({ MARKETING: 'MARKETING', FIELD: 'FIELD_OFFICER', JUNIOR: 'JUNIOR_REVIEWER', SENIOR: 'SENIOR_REVIEWER' });

export { S as STATUS, TERMINAL, ACTIVE, ALL as ALL_STATUSES, PIPELINE, STATUS_GROUPS, TRANSITIONS, byAction, STAGE_ROLE };
