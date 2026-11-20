import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { requireFirmContext, requirePermission, requireSuperadmin } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { documentRoute } from '../../docs/registry.js';
import { recordAudit } from '../../services/audit.service.js';
import { STATUS_GROUPS } from '../workflow/workflow.definition.js';
import * as svc from './dashboard.service.js';

const router = Router();
const reportQuery = z.strictObject({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  statusGroup: z.enum(Object.keys(STATUS_GROUPS)).optional(),
  bankId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  financialYearId: z.uuid().optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

router.get('/dashboard', authenticate, requireFirmContext, requirePermission('reports.view'), async (req, res) => res.json(await svc.dashboard(req.principal)));
router.get('/reports/cases', authenticate, requireFirmContext, requirePermission('reports.view'), validate({ query: reportQuery }), async (req, res) => {
  const report = await svc.caseReport(req.principal, req.valid.query);
  if (req.valid.query.format !== 'csv') return res.json(report);
  await recordAudit({ action: 'REPORT_EXPORTED', principal: req.principal, req, entityType: 'report', meta: { report: 'cases', rows: report.rows.length } });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="case-register-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(String.fromCharCode(0xfeff) + svc.toCsv(report)); // BOM so Excel reads UTF-8
});
router.get('/platform/case-stats', authenticate, requireSuperadmin, requirePermission('platform.dashboard.view'), async (_req, res) => res.json(await svc.platformCaseStats()));

documentRoute({ method: 'get', path: '/dashboard', tag: 'Dashboards & reports', summary: 'Role-specific dashboard (admin, marketing, junior / senior reviewer), scoped to the caller', permission: 'reports.view' });
documentRoute({ method: 'get', path: '/reports/cases', tag: 'Dashboards & reports', summary: 'Case register report with filters; format=csv for export (audited)', permission: 'reports.view' });
documentRoute({ method: 'get', path: '/platform/case-stats', tag: 'Platform (Superadmin)', summary: 'Platform-wide case counts by status (aggregates only)', permission: 'platform.dashboard.view' });

export default router;
