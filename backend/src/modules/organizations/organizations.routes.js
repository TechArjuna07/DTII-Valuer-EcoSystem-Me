import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission, requireSuperadmin } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { documentRoute } from '../../docs/registry.js';
import { auditListQuery, queryAudit } from '../audit/audit.query.js';
import * as svc from './organizations.service.js';
import * as s from './organizations.schema.js';

/** /platform — Superadmin only (platform context). */
const router = Router();
router.use(authenticate, requireSuperadmin);

const manage = requirePermission('platform.firms.manage');

router.get('/summary', requirePermission('platform.dashboard.view'), async (_req, res) => res.json(await svc.platformSummary()));
router.get('/firms', manage, validate({ query: s.listFirmsQuery }), async (req, res) => res.json(await svc.listFirms(req.valid.query)));
router.post('/firms', manage, validate({ body: s.registerFirmBody }), async (req, res) => res.status(201).json(await svc.registerFirm(req.principal, req.valid.body, req)));
router.get('/firms/:id', manage, validate({ params: s.idParam }), async (req, res) => res.json(await svc.getFirm(req.valid.params.id)));
router.patch('/firms/:id', manage, validate({ params: s.idParam, body: s.updateFirmBody }), async (req, res) =>
  res.json(await svc.updateFirm(req.principal, req.valid.params.id, req.valid.body, req)),
);
router.post('/firms/:id/status', manage, validate({ params: s.idParam, body: s.firmStatusBody }), async (req, res) =>
  res.json(await svc.setFirmStatus(req.principal, req.valid.params.id, req.valid.body, req)),
);
router.post('/firms/:id/admins/:userId/resend-invite', manage, validate({ params: s.adminParam }), async (req, res) =>
  res.json(await svc.resendAdminInvite(req.principal, req.valid.params.id, req.valid.params.userId, req)),
);
router.get('/audit-logs', requirePermission('platform.audit.view'), validate({ query: auditListQuery }), async (req, res) => res.json(await queryAudit(req.valid.query)));

const tag = 'Platform (Superadmin)';
[
  ['get', '/platform/summary', 'Platform totals: firms, users, clients', 'platform.dashboard.view'],
  ['get', '/platform/firms', 'List valuation firms (search, status, pagination)', 'platform.firms.manage'],
  ['post', '/platform/firms', 'Register a valuation firm and invite its Firm Admin', 'platform.firms.manage'],
  ['get', '/platform/firms/:id', 'Firm details, admins and counts', 'platform.firms.manage'],
  ['patch', '/platform/firms/:id', 'Edit firm profile / subscription', 'platform.firms.manage'],
  ['post', '/platform/firms/:id/status', 'Activate, suspend or deactivate a firm (signs out its users)', 'platform.firms.manage'],
  ['post', '/platform/firms/:id/admins/:userId/resend-invite', 'Resend the Firm Admin invitation', 'platform.firms.manage'],
  ['get', '/platform/audit-logs', 'Platform audit log (all firms)', 'platform.audit.view'],
].forEach(([method, path, summary, permission]) => documentRoute({ method, path, tag, summary, permission }));

export default router;
