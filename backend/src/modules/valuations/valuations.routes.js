import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { requireAnyPermission, requireFirmContext, requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { singleFile } from '../../middleware/upload.js';
import { limiters } from '../../middleware/rate-limit.js';
import { documentRoute } from '../../docs/registry.js';
import { opt, str } from '../organizations/organizations.schema.js';
import * as svc from './valuations.service.js';
import * as tpl from './templates.service.js';

/** Valuation reports, the report template master, and public report verification. */
const router = Router();
const staff = [authenticate, requireFirmContext, requireAnyPermission('valuation.prepare', 'valuation.review', 'case.view')];
const caseParam = z.strictObject({ id: z.uuid() });
const stageParam = z.strictObject({ id: z.uuid(), stage: z.enum(['preliminary', 'final']) });
const versionBody = z.strictObject({ inputs: z.record(z.string(), z.any()), summary: opt(str(5000)), changeNote: opt(str(1000)), templateId: z.uuid().optional() });
const STAGE = { preliminary: 'PRELIMINARY', final: 'FINAL' };
const templates = [authenticate, requireFirmContext, requirePermission('template.manage')];
const templateBody = z.strictObject({ name: str(150).min(2), description: opt(str(500)), bankId: z.uuid().nullable().optional(), categoryId: z.uuid().nullable().optional(), bodyHtml: z.string().min(20).max(500_000).optional() });

router.get('/cases/:id/valuations', ...staff, validate({ params: caseParam }), async (req, res) => res.json(await svc.getValuations(req.principal, req.valid.params.id)));
router.post('/cases/:id/valuations/:stage/versions', ...staff, validate({ params: stageParam, body: versionBody }), async (req, res) =>
  res.status(201).json(await svc.createVersion(req.principal, req.valid.params.id, STAGE[req.valid.params.stage], req.valid.body, req)),
);
router.post('/cases/:id/valuations/:stage/attachments', ...staff, limiters.upload, validate({ params: stageParam }), singleFile('file'), async (req, res) =>
  res.status(201).json(await svc.attachReport(req.principal, req.valid.params.id, STAGE[req.valid.params.stage], req.file, req)),
);
router.post('/cases/:id/valuations/preliminary/submit', ...staff, validate({ params: caseParam, body: z.strictObject({ nextAssigneeId: z.uuid().optional() }) }), async (req, res) =>
  res.json(await svc.submitPreliminary(req.principal, req.valid.params.id, req, req.valid.body)),
);
router.post('/cases/:id/valuations/review', ...staff, validate({ params: caseParam, body: z.strictObject({ decision: z.enum(['APPROVED', 'RETURNED', 'REJECTED']), comments: opt(str(3000)) }) }), async (req, res) =>
  res.json(await svc.review(req.principal, req.valid.params.id, req.valid.body, req)),
);
router.post('/cases/:id/valuations/final/approve', ...staff, validate({ params: caseParam, body: z.strictObject({ comments: opt(str(3000)) }) }), async (req, res) =>
  res.json(await svc.approveFinal(req.principal, req.valid.params.id, req.valid.body, req)),
);

router.get('/report-templates', ...templates, async (req, res) => res.json(await tpl.list(req.principal)));
router.post('/report-templates', ...templates, validate({ body: templateBody }), async (req, res) => res.status(201).json(await tpl.create(req.principal, req.valid.body, req)));
router.post('/report-templates/preview', ...templates, validate({ body: z.strictObject({ bodyHtml: z.string().min(1).max(500_000) }) }), async (req, res) => res.json(await tpl.preview(req.valid.body.bodyHtml)));
router.get('/report-templates/:id', ...templates, validate({ params: caseParam }), async (req, res) => res.json(await tpl.get(req.principal, req.valid.params.id)));
router.patch('/report-templates/:id', ...templates, validate({ params: caseParam, body: templateBody.omit({ bodyHtml: true }).partial().extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() }) }), async (req, res) =>
  res.json(await tpl.update(req.principal, req.valid.params.id, req.valid.body, req)),
);
router.post('/report-templates/:id/versions', ...templates, validate({ params: caseParam, body: z.strictObject({ bodyHtml: z.string().min(20).max(500_000), changeNote: opt(str(500)) }) }), async (req, res) =>
  res.json(await tpl.addVersion(req.principal, req.valid.params.id, req.valid.body, req)),
);

router.get('/verify/:code', limiters.auth, validate({ params: z.strictObject({ code: z.string().regex(/^[A-Z0-9-]{8,40}$/) }) }), async (req, res) => res.json(await svc.verify(req.valid.params.code)));

const tag = 'Valuations';
[
  ['get', '/cases/:id/valuations', 'Preliminary and final reports with versions, reviews, defaults and allowed actions'],
  ['post', '/cases/:id/valuations/:stage/versions', 'New report version: server-side calculation + PDF (preliminary by junior, final by senior)'],
  ['post', '/cases/:id/valuations/:stage/attachments', 'Attach an externally prepared report PDF as a new version'],
  ['post', '/cases/:id/valuations/preliminary/submit', 'Submit the preliminary valuation to the senior reviewer'],
  ['post', '/cases/:id/valuations/review', 'Senior review: APPROVED / RETURNED (for correction) / REJECTED'],
  ['post', '/cases/:id/valuations/final/approve', 'Approve the final bank-format report'],
].forEach(([method, path, summary]) => documentRoute({ method, path, tag, summary, permission: ['valuation.prepare', 'valuation.review', 'valuation.approve'] }));
[
  ['get', '/report-templates', 'Report templates (bank / NBFC-specific formats) and the built-in default'],
  ['post', '/report-templates', 'Create a template (Handlebars HTML; compiled and validated)'],
  ['post', '/report-templates/preview', 'Render a template body with sample data'],
  ['get', '/report-templates/:id', 'Template with version history'],
  ['patch', '/report-templates/:id', 'Edit template name, scope or status'],
  ['post', '/report-templates/:id/versions', 'Save a new template version'],
].forEach(([method, path, summary]) => documentRoute({ method, path, tag: 'Report templates', summary, permission: 'template.manage' }));
documentRoute({ method: 'get', path: '/verify/:code', tag: 'Public', summary: 'Verify a valuation report by the code / QR printed on it (provenance only)', auth: false });

export default router;
