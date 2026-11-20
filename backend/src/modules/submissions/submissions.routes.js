import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { requireAnyPermission, requireFirmContext } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { optionalFile } from '../../middleware/upload.js';
import { limiters } from '../../middleware/rate-limit.js';
import { documentRoute } from '../../docs/registry.js';
import { str } from '../organizations/organizations.schema.js';
import * as svc from './submissions.service.js';

/** Bank submission, sanction and disbursement (multipart: fields + optional supporting "file"). */
const router = Router();
const auth = [authenticate, requireFirmContext, requireAnyPermission('case.view', 'portal.access')];
const caseParam = z.strictObject({ id: z.uuid() });
const blank = (s) => z.preprocess((v) => (v === '' ? undefined : v), s);
const notFuture = (d) => d <= new Date(Date.now() + 86_400_000);
const day = z.coerce.date().refine(notFuture, 'The date cannot be in the future');
const amount = z.coerce.number().positive().max(1e13);

const submissionBody = z.strictObject({ mode: z.enum(['DIGITAL', 'PHYSICAL', 'BOTH']), submittedOn: day, submittedTo: blank(str(150).optional()), ackNumber: blank(str(80).optional()), remarks: blank(str(1000).optional()) });
const sanctionBody = z.strictObject({ outcome: z.enum(['SANCTIONED', 'DECLINED']), amount: blank(amount.optional()), sanctionDate: day, referenceNo: blank(str(80).optional()), remarks: blank(str(1000).optional()) });
const disbursementBody = z.strictObject({ amount, disbursedOn: day, referenceNo: blank(str(80).optional()), isFinal: z.preprocess((v) => v === true || v === 'true', z.boolean()), remarks: blank(str(1000).optional()) });

router.get('/cases/:id/bank', ...auth, validate({ params: caseParam }), async (req, res) => res.json(await svc.getBankAndLoan(req.principal, req.valid.params.id)));
router.post('/cases/:id/bank/submissions', ...auth, limiters.upload, validate({ params: caseParam }), optionalFile('file'), validate({ body: submissionBody }), async (req, res) =>
  res.status(201).json(await svc.submit(req.principal, req.valid.params.id, req.valid.body, req.file, req)),
);
router.post('/cases/:id/bank/sanction', ...auth, limiters.upload, validate({ params: caseParam }), optionalFile('file'), validate({ body: sanctionBody }), async (req, res) =>
  res.status(201).json(await svc.recordSanction(req.principal, req.valid.params.id, req.valid.body, req.file, req)),
);
router.post('/cases/:id/bank/disbursements', ...auth, limiters.upload, validate({ params: caseParam }), optionalFile('file'), validate({ body: disbursementBody }), async (req, res) =>
  res.status(201).json(await svc.recordDisbursement(req.principal, req.valid.params.id, req.valid.body, req.file, req)),
);

const tag = 'Bank & loan';
[
  ['get', '/cases/:id/bank', 'Submissions, lender decision, disbursements and totals', ['case.view', 'portal.access']],
  ['post', '/cases/:id/bank/submissions', 'Record bank submission (ack number and / or ack file); first one → SUBMITTED_TO_BANK', 'bank.submit'],
  ['post', '/cases/:id/bank/sanction', 'Record sanction (amount, date, letter) or decline (reason)', 'loan.update'],
  ['post', '/cases/:id/bank/disbursements', 'Record a disbursement tranche; the final tranche → DISBURSED', 'loan.update'],
].forEach(([method, path, summary, permission]) => documentRoute({ method, path, tag, summary, permission }));

export default router;
