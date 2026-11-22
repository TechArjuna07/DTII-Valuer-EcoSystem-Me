import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { requireAnyPermission, requireFirmContext } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { limiters } from '../../middleware/rate-limit.js';
import { documentRoute } from '../../docs/registry.js';
import { prisma } from '../../database/prisma.js';
import { NotFound } from '../../utils/errors.js';
import { findVisibleCase } from '../cases/case-access.js';
import * as svc from './approvals.service.js';

/** Final report status and the valuer's digital signature (which completes the case). */
const router = Router();
const auth = [authenticate, requireFirmContext, requireAnyPermission('case.view', 'portal.access')];
const caseParam = z.strictObject({ id: z.uuid() });
const signBody = z.strictObject({ password: z.string().min(1).max(128), consent: z.literal(true, { message: 'You must confirm the declaration' }) });

router.get('/cases/:id/approval', ...auth, validate({ params: caseParam }), async (req, res) => res.json(await svc.getApproval(req.principal, req.valid.params.id)));
router.post('/cases/:id/signatures/valuer', ...auth, limiters.auth, validate({ params: caseParam, body: signBody }), async (req, res) => res.json(await svc.sign(req.principal, req.valid.params.id, req.valid.body, req)));
router.post('/signatures/:id/refresh', ...auth, validate({ params: caseParam }), async (req, res) => {
  const s = await prisma.digitalSignature.findFirst({ where: { id: req.valid.params.id, firmId: req.principal.firmId } });
  if (!s) throw NotFound('Signature not found');
  await findVisibleCase(req.principal, s.caseId);
  await svc.syncSignature(s.id);
  res.json(await svc.getApproval(req.principal, s.caseId));
});
router.post('/signatures/:id/verify', ...auth, validate({ params: caseParam }), async (req, res) => res.json(await svc.verifySignature(req.principal, req.valid.params.id)));

const tag = 'Approvals & signatures';
[
  ['get', '/cases/:id/approval', 'Final report status, signatures and allowed actions (client: after completion)'],
  ['post', '/cases/:id/signatures/valuer', 'Valuer signs the final report (password + consent); completes the case'],
  ['post', '/signatures/:id/refresh', 'Poll the signature provider for a pending signature'],
  ['post', '/signatures/:id/verify', 'Re-verify a signature against the stored files'],
].forEach(([method, path, summary]) => documentRoute({ method, path, tag, summary, permission: ['case.view', 'portal.access'] }));

export default router;
