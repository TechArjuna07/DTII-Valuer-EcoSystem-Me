import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { requireFirmContext, requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { documentRoute } from '../../docs/registry.js';
import * as svc from './clients.service.js';
import * as s from './clients.schema.js';

/** /clients — firm staff. Visibility per role is enforced in the service (clientScope). */
const router = Router();
router.use(authenticate, requireFirmContext);

const view = requirePermission('client.view');
const manage = requirePermission('client.manage');
const id = validate({ params: s.idParam });

router.get('/', view, validate({ query: s.listClientsQuery }), async (req, res) => res.json(await svc.list(req.principal, req.valid.query)));
router.post('/', manage, validate({ body: s.createClientBody }), async (req, res) => res.status(201).json(await svc.create(req.principal, req.valid.body, req)));
router.get('/:id', view, id, async (req, res) => res.json(await svc.get(req.principal, req.valid.params.id)));
router.patch('/:id', manage, validate({ params: s.idParam, body: s.updateClientBody }), async (req, res) =>
  res.json(await svc.update(req.principal, req.valid.params.id, req.valid.body, req)),
);
router.post('/:id/deactivate', manage, id, async (req, res) => res.json(await svc.setStatus(req.principal, req.valid.params.id, 'INACTIVE', req)));
router.post('/:id/reactivate', manage, id, async (req, res) => res.json(await svc.setStatus(req.principal, req.valid.params.id, 'ACTIVE', req)));
router.post('/:id/portal-access', manage, id, async (req, res) => res.json(await svc.grantPortalAccess(req.principal, req.valid.params.id, req)));

[
  ['get', '/clients', 'List clients (search by name, code, email, phone or exact PAN)', 'client.view'],
  ['post', '/clients', 'Register a client (optional portal login)', 'client.manage'],
  ['get', '/clients/:id', 'Client details (PAN masked)', 'client.view'],
  ['patch', '/clients/:id', 'Edit client', 'client.manage'],
  ['post', '/clients/:id/deactivate', 'Deactivate client (signs out the portal login)', 'client.manage'],
  ['post', '/clients/:id/reactivate', 'Reactivate client', 'client.manage'],
  ['post', '/clients/:id/portal-access', 'Create or re-send the client portal login', 'client.manage'],
].forEach(([method, path, summary, permission]) => documentRoute({ method, path, tag: 'Clients', summary, permission }));

export default router;
