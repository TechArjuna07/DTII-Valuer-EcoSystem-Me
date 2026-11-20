import { prisma } from '../../database/prisma.js';
import { ROLES } from '../../config/rbac.js';
import { STATUS, STATUS_GROUPS, TERMINAL } from '../workflow/workflow.definition.js';
import { caseScope } from '../cases/case-access.js';

/**
 * Role-specific dashboards and reports. Every figure is computed inside the caller's case scope, so a reviewer's
 * numbers only cover their own cases and the Firm Admin sees the whole firm.
 */
const today = () => new Date(new Date().toISOString().slice(0, 10));

async function statusCounts(where) {
  const rows = await prisma.valuationCase.groupBy({ by: ['status'], where, _count: true });
  return Object.fromEntries(rows.map((r) => [r.status, r._count]));
}

const sum = (counts, statuses) => statuses.reduce((n, s) => n + (counts[s] ?? 0), 0);

async function overdueCount(where) {
  return prisma.valuationCase.count({ where: { AND: [where, { status: { notIn: [...TERMINAL, STATUS.CASE_ON_HOLD] } }, { OR: [{ isOverdue: true }, { dueDate: { lt: today() } }] }] } });
}

/** Average hours spent in each status (from the append-only status history), last 180 days. */
async function turnaround(firmId) {
  const rows = await prisma.$queryRaw`
    SELECT h.to_status AS status, AVG(EXTRACT(EPOCH FROM (n.created_at - h.created_at)) / 3600)::float AS hours, COUNT(*)::int AS samples
    FROM case_status_history h
    JOIN LATERAL (SELECT created_at FROM case_status_history x WHERE x.case_id = h.case_id AND x.created_at > h.created_at ORDER BY x.created_at LIMIT 1) n ON true
    WHERE h.firm_id = ${firmId}::uuid AND h.created_at > now() - interval '180 days'
    GROUP BY h.to_status`;
  return rows.map((r) => ({ status: r.status, hours: Math.round(r.hours * 10) / 10, samples: r.samples }));
}

async function monthlyIntake(firmId) {
  const rows = await prisma.$queryRaw`
    SELECT to_char(date_trunc('month', created_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM') AS month, COUNT(*)::int AS cases
    FROM valuation_cases WHERE firm_id = ${firmId}::uuid AND created_at > now() - interval '6 months'
    GROUP BY 1 ORDER BY 1`;
  return rows;
}

async function workload(firmId) {
  const rows = await prisma.caseAssignment.groupBy({ by: ['employeeId', 'stage'], where: { firmId, endedAt: null, case: { status: { notIn: TERMINAL } } }, _count: true });
  const employees = await prisma.employeeProfile.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.employeeId))] } }, select: { id: true, employeeCode: true, user: { select: { fullName: true } } } });
  const byId = new Map(employees.map((e) => [e.id, { id: e.id, employeeCode: e.employeeCode, name: e.user.fullName, total: 0, stages: {} }]));
  for (const r of rows) {
    const e = byId.get(r.employeeId);
    e.stages[r.stage] = r._count;
    e.total += r._count;
  }
  return [...byId.values()].sort((a, b) => b.total - a.total);
}

async function firmAdmin(principal) {
  const where = { firmId: principal.firmId };
  const counts = await statusCounts(where);
  const [overdue, tat, intake, load, recent] = await Promise.all([
    overdueCount(where),
    turnaround(principal.firmId),
    monthlyIntake(principal.firmId),
    workload(principal.firmId),
    prisma.valuationCase.findMany({ where, orderBy: { createdAt: 'desc' }, take: 6, select: { id: true, caseNumber: true, status: true, createdAt: true, client: { select: { name: true } }, bank: { select: { shortCode: true } } } }),
  ]);
  return {
    role: 'FIRM_ADMIN',
    tiles: {
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      newCases: sum(counts, [STATUS.CASE_RECEIVED]),
      pendingInspection: sum(counts, [STATUS.INSPECTION_ASSIGNED, STATUS.INSPECTION_IN_PROGRESS]),
      inspectionCompleted: sum(counts, [STATUS.INSPECTION_COMPLETED]),
      preliminaryPending: sum(counts, [STATUS.INSPECTION_COMPLETED, STATUS.PRELIMINARY_VALUATION_IN_PROGRESS, STATUS.SENT_BACK_FOR_CORRECTION]),
      seniorPending: sum(counts, STATUS_GROUPS.SENIOR_REVIEW),
      clientApprovalPending: sum(counts, [STATUS.CLIENT_APPROVAL_PENDING, STATUS.CLIENT_QUERY_RAISED, STATUS.CLIENT_APPROVED]),
      bankSubmissionPending: sum(counts, [STATUS.CLIENT_SIGNED, STATUS.FINAL_APPROVED]),
      sanctioned: sum(counts, [STATUS.LOAN_SANCTIONED]),
      disbursed: sum(counts, [STATUS.DISBURSED, STATUS.CASE_COMPLETED]),
      overdue,
    },
    byStatus: counts,
    turnaround: tat,
    monthlyIntake: intake,
    workload: load,
    recent,
  };
}

async function marketing(principal) {
  const scope = caseScope(principal);
  const mine = { AND: [scope, { OR: [{ createdById: principal.userId }, { assignments: { some: { employeeId: principal.employeeId ?? undefined, stage: 'MARKETING', endedAt: null } } }] }] };
  const counts = await statusCounts(mine);
  const [pendingAssignment, awaitingDocuments] = await Promise.all([
    prisma.valuationCase.count({ where: { AND: [mine, { status: STATUS.CASE_RECEIVED }, { assignments: { none: { stage: 'FIELD', endedAt: null } } }] } }),
    prisma.valuationCase.count({ where: { AND: [mine, { awaitingDocuments: true }, { status: { notIn: TERMINAL } }] } }),
  ]);
  return {
    role: 'MARKETING',
    tiles: {
      received: Object.values(counts).reduce((a, b) => a + b, 0),
      pendingAssignment,
      awaitingDocuments,
      pendingBankSubmission: sum(counts, [STATUS.CLIENT_SIGNED]),
      submitted: sum(counts, [STATUS.SUBMITTED_TO_BANK]),
      sanctioned: sum(counts, [STATUS.LOAN_SANCTIONED]),
      disbursed: sum(counts, [STATUS.DISBURSED, STATUS.CASE_COMPLETED]),
    },
    byStatus: counts,
  };
}

async function reviewer(principal, stage) {
  const where = { firmId: principal.firmId, assignments: { some: { employeeId: principal.employeeId ?? '00000000-0000-0000-0000-000000000000', stage, endedAt: null } } };
  const counts = await statusCounts(where);
  if (stage === 'JUNIOR') {
    return {
      role: ROLES.JUNIOR_REVIEWER,
      tiles: {
        pendingReviews: sum(counts, [STATUS.INSPECTION_COMPLETED]),
        inProgress: sum(counts, [STATUS.PRELIMINARY_VALUATION_IN_PROGRESS]),
        returned: sum(counts, [STATUS.SENT_BACK_FOR_CORRECTION]),
        submitted: sum(counts, [STATUS.PRELIMINARY_SUBMITTED, STATUS.FINAL_REVIEW_IN_PROGRESS]),
      },
      byStatus: counts,
    };
  }
  const approved = await prisma.valuationReport.count({ where: { firmId: principal.firmId, stage: 'FINAL', status: 'APPROVED', case: where } });
  return {
    role: ROLES.SENIOR_REVIEWER,
    tiles: {
      pendingApprovals: sum(counts, [STATUS.PRELIMINARY_SUBMITTED, STATUS.CLIENT_QUERY_RAISED]),
      underReview: sum(counts, [STATUS.FINAL_REVIEW_IN_PROGRESS]),
      returned: sum(counts, [STATUS.SENT_BACK_FOR_CORRECTION]),
      awaitingSignature: sum(counts, [STATUS.FINAL_APPROVED]),
      approved,
    },
    byStatus: counts,
  };
}

/** Picks the dashboard for the principal's primary working role. */
async function dashboard(principal) {
  const r = principal.roles;
  if (r.includes(ROLES.FIRM_ADMIN)) return firmAdmin(principal);
  if (r.includes(ROLES.SENIOR_REVIEWER)) return reviewer(principal, 'SENIOR');
  if (r.includes(ROLES.JUNIOR_REVIEWER)) return reviewer(principal, 'JUNIOR');
  if (r.includes(ROLES.MARKETING)) return marketing(principal);
  return { role: r[0], tiles: {}, byStatus: {} };
}

/** Platform-wide case statistics for the Superadmin (aggregates only; no case or client details). */
async function platformCaseStats() {
  const rows = await prisma.valuationCase.groupBy({ by: ['status'], _count: true });
  const byStatus = Object.fromEntries(rows.map((x) => [x.status, x._count]));
  const perFirm = await prisma.valuationCase.groupBy({ by: ['firmId'], _count: true });
  return { total: Object.values(byStatus).reduce((a, b) => a + b, 0), active: Object.entries(byStatus).filter(([s]) => !TERMINAL.includes(s)).reduce((a, [, n]) => a + n, 0), byStatus, perFirm: perFirm.map((p) => ({ firmId: p.firmId, cases: p._count })) };
}

const REPORT_COLUMNS = ['Case ID', 'Received on', 'Client', 'Bank / NBFC', 'Branch', 'Category', 'Financial year', 'Status', 'Loan amount', 'Market value', 'Field officer', 'Junior reviewer', 'Senior reviewer', 'Sanctioned amount', 'Disbursed', 'Overdue'];

/** Case register report (filters + CSV). Values come from the current final report version. */
async function caseReport(principal, q) {
  const and = [caseScope(principal)];
  if (q.from || q.to) and.push({ receivedOn: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } });
  if (q.statusGroup) and.push({ status: { in: STATUS_GROUPS[q.statusGroup] } });
  for (const k of ['bankId', 'categoryId', 'financialYearId']) if (q[k]) and.push({ [k]: q[k] });
  const cases = await prisma.valuationCase.findMany({
    where: { AND: and },
    orderBy: { receivedOn: 'desc' },
    take: 5000,
    include: {
      client: { select: { name: true } },
      bank: { select: { name: true, branch: true } },
      category: { select: { name: true } },
      financialYear: { select: { code: true } },
      assignments: { where: { endedAt: null }, select: { stage: true, employee: { select: { user: { select: { fullName: true } } } } } },
      reports: { where: { stage: 'FINAL' }, select: { currentVersionId: true } },
      sanction: { select: { amount: true, outcome: true } },
      disbursements: { select: { amount: true } },
    },
  });
  const versionIds = cases.map((c) => c.reports[0]?.currentVersionId).filter(Boolean);
  const versions = versionIds.length ? await prisma.valuationReportVersion.findMany({ where: { id: { in: versionIds } }, select: { id: true, marketValue: true } }) : [];
  const mv = new Map(versions.map((v) => [v.id, Number(v.marketValue)]));
  const who = (c, s) => c.assignments.find((a) => a.stage === s)?.employee.user.fullName ?? '';
  const rows = cases.map((c) => ({
    caseId: c.id,
    caseNumber: c.caseNumber,
    receivedOn: c.receivedOn.toISOString().slice(0, 10),
    client: c.client.name,
    bank: c.bank.name,
    branch: c.bank.branch ?? '',
    category: c.category.name,
    financialYear: c.financialYear.code,
    status: c.status,
    loanAmount: c.loanAmount != null ? Number(c.loanAmount) : null,
    marketValue: mv.get(c.reports[0]?.currentVersionId) ?? null,
    fieldOfficer: who(c, 'FIELD'),
    juniorReviewer: who(c, 'JUNIOR'),
    seniorReviewer: who(c, 'SENIOR'),
    sanctioned: c.sanction?.outcome === 'SANCTIONED' ? Number(c.sanction.amount) : null,
    disbursed: c.disbursements.reduce((s, d) => s + Number(d.amount), 0) || null,
    overdue: c.isOverdue || (!!c.dueDate && c.dueDate < today() && !TERMINAL.includes(c.status)),
  }));
  return { columns: REPORT_COLUMNS, rows, totals: { cases: rows.length, marketValue: rows.reduce((s, r) => s + (r.marketValue ?? 0), 0), sanctioned: rows.reduce((s, r) => s + (r.sanctioned ?? 0), 0), disbursed: rows.reduce((s, r) => s + (r.disbursed ?? 0), 0) } };
}

/** CSV with formula-injection protection (cells starting with = + - @ are prefixed with '). */
function toCsv(report) {
  const cell = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const keys = ['caseNumber', 'receivedOn', 'client', 'bank', 'branch', 'category', 'financialYear', 'status', 'loanAmount', 'marketValue', 'fieldOfficer', 'juniorReviewer', 'seniorReviewer', 'sanctioned', 'disbursed', 'overdue'];
  return [report.columns.map(cell).join(','), ...report.rows.map((r) => keys.map((k) => cell(r[k])).join(','))].join('\r\n');
}

export { dashboard, platformCaseStats, caseReport, toCsv, turnaround };
