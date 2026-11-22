import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { requireAnyPermission, requireFirmContext, requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { documentRoute } from '../../docs/registry.js';
import { firmProfileFields } from '../organizations/organizations.schema.js';
import { auditListQuery, queryAudit } from '../audit/audit.query.js';
import * as firm from './firm.service.js';
import * as rbac from '../rbac/rbac.service.js';
import { getReportSettings, reportSettingsBody, updateReportSettings } from './report-settings.js';

/** /firm — the caller's own firm: profile, dashboard summary, roles & permissions, audit log. */
const router = Router();
router.use(authenticate, requireFirmContext);

const settings = requirePermission('firm.settings.manage');
const profileBody = z.strictObject(firmProfileFields).partial();
const permissionBody = z.strictObject({ roleCode: z.string().max(40), permissionCode: z.string().max(80), granted: z.boolean() });
const firmAuditQuery = auditListQuery.omit({ firmId: true });

router.get('/profile', settings, async (req, res) => res.json(await firm.getProfile(req.principal)));
router.patch('/profile', settings, validate({ body: profileBody }), async (req, res) => res.json(await firm.updateProfile(req.principal, req.valid.body, req)));
router.get('/report-settings', settings, async (req, res) => res.json(await getReportSettings(req.principal.firmId)));
router.put('/report-settings', settings, validate({ body: reportSettingsBody }), async (req, res) => res.json(await updateReportSettings(req.principal, req.valid.body, req)));
router.get('/summary', requireAnyPermission('employee.manage', 'reports.view'), async (req, res) => res.json(await firm.summary(req.principal)));
router.get('/rbac', requirePermission('rbac.manage'), async (req, res) => res.json(await rbac.matrix(req.principal)));
router.put('/rbac', requirePermission('rbac.manage'), validate({ body: permissionBody }), async (req, res) => res.json(await rbac.setPermission(req.principal, req.valid.body, req)));
router.get('/audit-logs', requirePermission('audit.view'), validate({ query: firmAuditQuery }), async (req, res) =>
  res.json(await queryAudit({ ...req.valid.query, scopeFirmId: req.principal.firmId })),
);

[
  ['get', '/firm/profile', 'Own firm profile', 'firm.settings.manage'],
  ['patch', '/firm/profile', 'Edit own firm profile (not firm code / status / subscription)', 'firm.settings.manage'],
  ['get', '/firm/report-settings', 'Letterhead and billing details printed on bank-format reports', 'firm.settings.manage'],
  ['put', '/firm/report-settings', 'Update letterhead and billing details', 'firm.settings.manage'],
  ['get', '/firm/summary', 'Firm dashboard figures', ['employee.manage', 'reports.view']],
  ['get', '/firm/rbac', 'Role × permission matrix for this firm', 'rbac.manage'],
  ['put', '/firm/rbac', 'Grant / revoke a non-critical permission for a role', 'rbac.manage'],
  ['get', '/firm/audit-logs', 'Firm audit log', 'audit.view'],
].forEach(([method, path, summary, permission]) => documentRoute({ method, path, tag: 'Firm', summary, permission }));

export default router;
