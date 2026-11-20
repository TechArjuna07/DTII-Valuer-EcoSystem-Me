import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { requireFirmContext, requirePermission } from '../../middleware/authorize.js';
import { documentRoute } from '../../docs/registry.js';
import { prisma } from '../../database/prisma.js';
import { STATUS_GROUPS, TERMINAL } from '../workflow/workflow.definition.js';

/** Client portal dashboard (own cases only — scope from the token's client id). */
const router = Router();

router.get('/portal/summary', authenticate, requireFirmContext, requirePermission('portal.access'), async (req, res) => {
  const clientId = req.principal.clientId;
  const where = { firmId: req.principal.firmId, clientId };
  const [cases, requests, signedDocs] = await Promise.all([
    prisma.valuationCase.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: { id: true, caseNumber: true, status: true, statusChangedAt: true, receivedOn: true, bank: { select: { name: true, shortCode: true } }, category: { select: { name: true } }, financialYear: { select: { label: true } } },
    }),
    prisma.documentRequest.findMany({ where: { firmId: req.principal.firmId, status: 'OPEN', requestedFrom: 'CLIENT', case: { clientId } }, orderBy: { createdAt: 'desc' }, select: { id: true, title: true, description: true, dueDate: true, caseId: true, createdAt: true } }),
    prisma.caseDocument.count({ where: { firmId: req.principal.firmId, folder: 'CLIENT_SIGNED_FILES', archivedAt: null, case: { clientId } } }),
  ]);
  const inGroup = (g) => cases.filter((c) => STATUS_GROUPS[g].includes(c.status)).length;
  res.json({
    counts: {
      active: cases.filter((c) => !TERMINAL.includes(c.status)).length,
      pendingDocuments: requests.length,
      inspection: inGroup('INSPECTION'),
      valuation: inGroup('PRELIMINARY') + inGroup('SENIOR_REVIEW'),
      pendingApproval: cases.filter((c) => ['CLIENT_APPROVAL_PENDING', 'CLIENT_APPROVED'].includes(c.status)).length,
      signedDocuments: signedDocs,
      completed: cases.filter((c) => c.status === 'CASE_COMPLETED').length,
    },
    cases,
    requests,
  });
});

documentRoute({ method: 'get', path: '/portal/summary', tag: 'Client portal', summary: 'Client dashboard: own cases, pending documents, approvals, signed files', permission: 'portal.access' });

export default router;
