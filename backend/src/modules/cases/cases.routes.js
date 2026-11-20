import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { requireAnyPermission, requireFirmContext, requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { documentRoute } from '../../docs/registry.js';
import * as svc from './cases.service.js';
import * as s from './cases.schema.js';

/** /cases — staff with case.view, and clients (portal.access) for their own cases. Scope enforced in services. */
const router = Router();
router.use(authenticate, requireFirmContext);

const view = requireAnyPermission('case.view', 'portal.access');
const id = validate({ params: s.idParam });

router.get('/', view, validate({ query: s.listCasesQuery }), async (req, res) => res.json(await svc.list(req.principal, req.valid.query)));
router.post('/', requirePermission('case.create'), validate({ body: s.createCaseBody }), async (req, res) => res.status(201).json(await svc.create(req.principal, req.valid.body, req)));
router.get('/assignable-employees', requirePermission('case.view'), validate({ query: z.strictObject({ stage: z.enum(['MARKETING', 'FIELD', 'JUNIOR', 'SENIOR']), caseId: z.uuid().optional() }) }), async (req, res) =>
  res.json(await svc.assignableEmployees(req.principal, req.valid.query.stage, req.valid.query.caseId)),
);
router.get('/:id', view, id, async (req, res) => res.json(await svc.get(req.principal, req.valid.params.id)));
router.patch('/:id', requirePermission('case.create'), validate({ params: s.idParam, body: s.updateCaseBody }), async (req, res) =>
  res.json(await svc.update(req.principal, req.valid.params.id, req.valid.body, req)),
);
router.post('/:id/assignments', requirePermission('case.view'), validate({ params: s.idParam, body: s.assignBody }), async (req, res) =>
  res.json(await svc.assign(req.principal, req.valid.params.id, req.valid.body, req)),
);
router.post('/:id/transitions', view, validate({ params: s.idParam, body: s.transitionBody }), async (req, res) =>
  res.json(await svc.runGenericTransition(req.principal, req.valid.params.id, req.valid.body, req)),
);
router.get('/:id/timeline', view, id, async (req, res) => res.json(await svc.timeline(req.principal, req.valid.params.id)));

const tag = 'Cases';
[
  ['get', '/cases', 'List visible cases (filters: status, group, client, bank, FY, category, assigned to me, overdue)', ['case.view', 'portal.access']],
  ['post', '/cases', 'Register a case — generates the permanent Case ID', 'case.create'],
  ['get', '/cases/assignable-employees', 'Employees eligible for a stage, with workload (caseId applies hand-over and maker-checker rules)', 'case.view'],
  ['get', '/cases/:id', 'Case detail with assignments and the actions the caller may perform', ['case.view', 'portal.access']],
  ['patch', '/cases/:id', 'Edit case information (identity fields are immutable)', 'case.create'],
  ['post', '/cases/:id/assignments', 'Assign / reassign a stage (marketing, field, junior, senior); the previous stage assignee may hand over an unassigned reviewer stage', ['case.assign.field', 'case.assign.reviewer', 'case.view']],
  ['post', '/cases/:id/transitions', 'Generic workflow action (hold, resume, cancel, close, start review…)', ['case.hold', 'case.cancel', 'case.close', 'valuation.prepare', 'valuation.review']],
  ['get', '/cases/:id/timeline', 'Case activity timeline (clients see client-visible entries only)', ['case.view', 'portal.access']],
].forEach(([method, path, summary, permission]) => documentRoute({ method, path, tag, summary, permission }));

export default router;
