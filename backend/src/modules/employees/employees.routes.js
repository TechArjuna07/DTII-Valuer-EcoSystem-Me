import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { requireFirmContext, requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { documentRoute } from '../../docs/registry.js';
import * as svc from './employees.service.js';
import * as s from './employees.schema.js';

/** /employees — Firm Admin (employee.manage), always scoped to the caller's firm. */
const router = Router();
router.use(authenticate, requireFirmContext, requirePermission('employee.manage'));

const id = validate({ params: s.idParam });
router.get('/', validate({ query: s.listEmployeesQuery }), async (req, res) => res.json(await svc.list(req.principal, req.valid.query)));
router.post('/', validate({ body: s.createEmployeeBody }), async (req, res) => res.status(201).json(await svc.create(req.principal, req.valid.body, req)));
router.get('/:id', id, async (req, res) => res.json(await svc.get(req.principal, req.valid.params.id)));
router.patch('/:id', validate({ params: s.idParam, body: s.updateEmployeeBody }), async (req, res) =>
  res.json(await svc.update(req.principal, req.valid.params.id, req.valid.body, req)),
);
router.post('/:id/deactivate', id, async (req, res) => res.json(await svc.deactivate(req.principal, req.valid.params.id, req)));
router.post('/:id/reactivate', id, async (req, res) => res.json(await svc.reactivate(req.principal, req.valid.params.id, req)));
router.post('/:id/unlock', id, async (req, res) => res.json(await svc.unlock(req.principal, req.valid.params.id, req)));
router.post('/:id/resend-invite', id, async (req, res) => res.json(await svc.resendEmployeeInvite(req.principal, req.valid.params.id, req)));

[
  ['get', '/employees', 'List employees (search, role, status)'],
  ['post', '/employees', 'Register an employee with one or more roles (sends invite)'],
  ['get', '/employees/:id', 'Employee details'],
  ['patch', '/employees/:id', 'Edit employee details and roles'],
  ['post', '/employees/:id/deactivate', 'Deactivate (revokes firm sessions)'],
  ['post', '/employees/:id/reactivate', 'Reactivate'],
  ['post', '/employees/:id/unlock', 'Clear a login lockout'],
  ['post', '/employees/:id/resend-invite', 'Resend the invitation email'],
].forEach(([method, path, summary]) => documentRoute({ method, path, tag: 'Employees', summary, permission: 'employee.manage' }));

export default router;
