import { prisma } from '../../database/prisma.js';
import { on } from '../../services/events.js';
import { notify } from './notifications.service.js';

/**
 * Notification rules: domain events → recipients + message. Registered once at start-up.
 * Covers: new case, inspection assigned / scheduled / completed, preliminary submitted (senior review pending),
 * returned for correction, final approved, client approval required, client query, signature completed,
 * bank submission, loan sanctioned / declined, disbursed, hold / cancel / reject / overdue, document requests.
 */

async function firmAdmins(firmId) {
  const rows = await prisma.userRole.findMany({ where: { firmId, status: 'ACTIVE', role: { code: 'FIRM_ADMIN' } }, select: { userId: true } });
  return rows.map((r) => r.userId);
}

async function stageUsers(caseId, ...stages) {
  const rows = await prisma.caseAssignment.findMany({ where: { caseId, endedAt: null, stage: { in: stages } }, select: { employee: { select: { userId: true } } } });
  return rows.map((r) => r.employee.userId);
}

async function clientUser(caseId) {
  const c = await prisma.valuationCase.findUnique({ where: { id: caseId }, select: { client: { select: { userId: true, status: true } } } });
  return c?.client.status === 'ACTIVE' && c.client.userId ? [c.client.userId] : [];
}

const caseInfo = (caseId) => prisma.valuationCase.findUnique({ where: { id: caseId }, select: { caseNumber: true, statusChangedAt: true, client: { select: { name: true } }, bank: { select: { shortCode: true } } } });

/** to-status → { who, title, body(c), tab } */
const ON_STATUS = {
  INSPECTION_COMPLETED: { who: ['ADMINS', 'JUNIOR'], title: 'Inspection completed', body: (c) => `The site inspection for ${c.caseNumber} (${c.client.name}) is complete. The preliminary valuation can start.`, tab: 'inspection' },
  PRELIMINARY_SUBMITTED: { who: ['SENIOR'], title: 'Senior review pending', body: (c) => `The preliminary valuation of ${c.caseNumber} has been submitted for your review.`, tab: 'senior' },
  SENT_BACK_FOR_CORRECTION: { who: ['JUNIOR'], title: 'Valuation returned for correction', body: (c) => `The senior reviewer returned ${c.caseNumber} for correction.`, tab: 'preliminary' },
  FINAL_APPROVED: { who: ['ADMINS', 'MARKETING', 'SENIOR'], title: 'Final report approved', body: (c) => `The final valuation report of ${c.caseNumber} is approved and awaits the valuer's signature.`, tab: 'approval' },
  CLIENT_APPROVAL_PENDING: { who: ['CLIENT'], title: 'Your valuation report is ready for review', body: (c) => `Please review the valuation report ${c.caseNumber}, then approve it or raise a query.`, tab: 'approval' },
  CLIENT_QUERY_RAISED: { who: ['SENIOR', 'MARKETING', 'ADMINS'], title: 'Client raised a query', body: (c) => `${c.client.name} raised a query on the report ${c.caseNumber}.`, tab: 'approval' },
  CLIENT_APPROVED: { who: ['CLIENT'], title: 'Please sign your valuation report', body: (c) => `Thank you for approving ${c.caseNumber}. Please sign the acknowledgement.`, tab: 'approval' },
  CLIENT_SIGNED: { who: ['MARKETING', 'ADMINS'], title: 'Digital signature completed', body: (c) => `${c.client.name} signed the report ${c.caseNumber}. It is ready for bank submission.`, tab: 'bank' },
  SUBMITTED_TO_BANK: { who: ['ADMINS', 'CLIENT'], title: 'Report submitted to the bank', body: (c) => `The valuation report ${c.caseNumber} was submitted to ${c.bank.shortCode}.`, tab: 'bank' },
  LOAN_SANCTIONED: { who: ['ADMINS', 'CLIENT'], title: 'Loan sanctioned', body: (c) => `${c.bank.shortCode} sanctioned the loan for case ${c.caseNumber}.`, tab: 'loan' },
  DISBURSED: { who: ['ADMINS', 'CLIENT'], title: 'Loan disbursed', body: (c) => `The loan for ${c.caseNumber} has been fully disbursed.`, tab: 'loan' },
  CASE_COMPLETED: { who: ['CLIENT'], title: 'Case completed', body: (c) => `Valuation case ${c.caseNumber} is complete. Your signed documents remain available in the portal.`, tab: 'overview' },
  CASE_ON_HOLD: { who: ['MARKETING', 'FIELD', 'JUNIOR', 'SENIOR'], title: 'Case put on hold', body: (c) => `${c.caseNumber} is on hold.`, tab: 'timeline' },
  CASE_CANCELLED: { who: ['MARKETING', 'FIELD', 'JUNIOR', 'SENIOR', 'ADMINS'], title: 'Case cancelled', body: (c) => `${c.caseNumber} was cancelled.`, tab: 'timeline' },
  CASE_REJECTED: { who: ['MARKETING', 'ADMINS'], title: 'Case rejected', body: (c) => `${c.caseNumber} was closed as rejected.`, tab: 'timeline' },
};

async function resolve(firmId, caseId, who) {
  const ids = [];
  for (const w of who) {
    if (w === 'ADMINS') ids.push(...(await firmAdmins(firmId)));
    else if (w === 'CLIENT') ids.push(...(await clientUser(caseId)));
    else ids.push(...(await stageUsers(caseId, w)));
  }
  return ids;
}

let registered = false;

function registerNotificationRules() {
  if (registered) return;
  registered = true;

  on('case.created', async ({ firmId, caseId, actorId }) => {
    const c = await caseInfo(caseId);
    const ids = (await firmAdmins(firmId)).filter((id) => id !== actorId);
    await notify({ firmId, recipientIds: ids, event: 'CASE_RECEIVED', caseId, title: 'New case received', body: `${c.caseNumber} for ${c.client.name} (${c.bank.shortCode}) was registered.`, link: `/cases/${caseId}`, dedupe: caseId });
  });

  on('case.assigned', async ({ firmId, caseId, stage, employeeId }) => {
    const c = await caseInfo(caseId);
    const e = await prisma.employeeProfile.findUnique({ where: { id: employeeId }, select: { userId: true } });
    const msg = {
      FIELD: ['Inspection assigned', `You are the field officer for ${c.caseNumber} (${c.client.name}). Schedule the site visit.`, 'inspection'],
      JUNIOR: ['Case assigned for preliminary valuation', `You are the junior reviewer for ${c.caseNumber}.`, 'preliminary'],
      SENIOR: ['Case assigned for senior review', `You are the senior reviewer for ${c.caseNumber}.`, 'senior'],
      MARKETING: ['Case assigned to you', `You own case ${c.caseNumber} for ${c.client.name}.`, 'overview'],
    }[stage];
    await notify({ firmId, recipientIds: [e?.userId], event: `ASSIGNED_${stage}`, caseId, title: msg[0], body: msg[1], link: `/cases/${caseId}?tab=${msg[2]}`, dedupe: `${caseId}:${employeeId}:${Date.now()}` });
  });

  on('inspection.scheduled', async ({ firmId, caseId, scheduledAt }) => {
    const c = await caseInfo(caseId);
    const when = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(scheduledAt));
    await notify({ firmId, recipientIds: await clientUser(caseId), event: 'INSPECTION_SCHEDULED', caseId, title: 'Property inspection scheduled', body: `Our field officer will visit the property for ${c.caseNumber} on ${when}.`, link: `/cases/${caseId}`, dedupe: `${caseId}:${scheduledAt}` });
    await notify({ firmId, recipientIds: await stageUsers(caseId, 'MARKETING'), event: 'INSPECTION_SCHEDULED', caseId, title: 'Inspection scheduled', body: `The inspection of ${c.caseNumber} is scheduled for ${when}.`, link: `/cases/${caseId}?tab=inspection`, dedupe: `${caseId}:${scheduledAt}`, email: false });
  });

  on('case.transitioned', async ({ firmId, caseId, to, actorId }) => {
    const rule = ON_STATUS[to];
    if (!rule) return;
    const c = await caseInfo(caseId);
    const ids = (await resolve(firmId, caseId, rule.who)).filter((id) => id !== actorId);
    await notify({ firmId, recipientIds: ids, event: to, caseId, title: rule.title, body: rule.body(c), link: `/cases/${caseId}?tab=${rule.tab}`, dedupe: `${caseId}:${c.statusChangedAt.toISOString()}` });
  });

  on('document.requested', async ({ firmId, caseId, requestId, requestedFrom }) => {
    if (requestedFrom !== 'CLIENT') return;
    const [c, r] = await Promise.all([caseInfo(caseId), prisma.documentRequest.findUnique({ where: { id: requestId } })]);
    await notify({ firmId, recipientIds: await clientUser(caseId), event: 'DOCUMENT_REQUESTED', caseId, title: 'Document requested', body: `Please upload: ${r.title} (case ${c.caseNumber}).`, link: `/cases/${caseId}?tab=documents`, dedupe: requestId });
  });

  on('document.uploaded', async ({ firmId, caseId, fulfilledRequestId }) => {
    if (!fulfilledRequestId) return;
    const [c, r] = await Promise.all([caseInfo(caseId), prisma.documentRequest.findUnique({ where: { id: fulfilledRequestId } })]);
    await notify({ firmId, recipientIds: [r.requestedById], event: 'DOCUMENT_RECEIVED', caseId, title: 'Requested document received', body: `“${r.title}” was uploaded for ${c.caseNumber}.`, link: `/cases/${caseId}?tab=documents`, dedupe: fulfilledRequestId });
  });

  on('case.overdue', async ({ firmId, caseId, reason }) => {
    const c = await caseInfo(caseId);
    const ids = [...(await firmAdmins(firmId)), ...(await stageUsers(caseId, 'MARKETING'))];
    await notify({ firmId, recipientIds: ids, event: 'CASE_OVERDUE', caseId, title: 'Case overdue', body: `${c.caseNumber} is overdue (${reason}).`, link: `/cases/${caseId}`, dedupe: `${caseId}:${c.statusChangedAt.toISOString()}` });
  });
}

export { registerNotificationRules, ON_STATUS };
