import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { requireFirmContext, requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { documentRoute } from '../../docs/registry.js';
import { listQuery } from '../../utils/pagination.js';
import { FOLDER_CODES } from '../../config/folders.js';
import { ALL_STATUSES } from '../workflow/workflow.definition.js';
import { email, opt, phone, str } from '../organizations/organizations.schema.js';
import * as svc from './masters.service.js';

/** /masters — firm masters. Read: master.view; write: master.manage; workflow settings: workflow.config.manage. */
const router = Router();
router.use(authenticate, requireFirmContext);

const view = requirePermission('master.view');
const manage = requirePermission('master.manage');
const idParam = z.strictObject({ id: z.uuid() });
const code = str(40).toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,39}$/, 'Use capital letters, digits and underscores');

const bankFields = {
  institutionType: z.enum(['BANK', 'NBFC', 'HFC', 'COOPERATIVE_BANK', 'OTHER']),
  name: str(150).min(2, 'Name is required'),
  shortCode: str(20).toUpperCase().regex(/^[A-Z0-9]{2,20}$/, 'Short code: 2–20 letters/digits, e.g. HDFC'),
  branch: opt(str(150)),
  ifsc: opt(str(11).toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC')),
  contactPerson: opt(str(150)),
  email: opt(email),
  phone: opt(phone),
  address: opt(str(400)),
  requiresClientApproval: z.boolean().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
};
const bankList = z.strictObject({ ...listQuery, status: z.enum(['ACTIVE', 'INACTIVE']).optional(), institutionType: bankFields.institutionType.optional() });

const categoryBody = z.strictObject({ code, name: str(100).min(2), description: opt(str(400)), engine: z.enum(['LAND_BUILDING', 'PLANT_MACHINERY', 'STOCK', 'FLAT']), sortOrder: z.number().int().min(0).max(999).optional() });
const categoryUpdate = z.strictObject({ name: str(100).min(2).optional(), description: opt(str(400)), active: z.boolean().optional(), sortOrder: z.number().int().min(0).max(999).optional() });
const fieldBody = z.strictObject({
  key: str(60).regex(/^[a-z][A-Za-z0-9]{1,59}$/, 'Key: camelCase letters/digits'),
  section: str(80).min(1),
  label: str(120).min(1),
  type: z.enum(['TEXT', 'TEXTAREA', 'NUMBER', 'AREA', 'CURRENCY', 'DATE', 'SELECT', 'BOOLEAN']),
  required: z.boolean().optional(),
  options: z.array(str(100).min(1)).max(50).optional().nullable(),
  unit: opt(str(20)),
  helpText: opt(str(300)),
  sortOrder: z.number().int().min(0).max(999).optional(),
});
const docTypeBody = z.strictObject({ code, name: str(120).min(2), defaultFolder: z.enum(FOLDER_CODES), sortOrder: z.number().int().min(0).max(999).optional() });
const docTypeUpdate = z.strictObject({ name: str(120).min(2).optional(), defaultFolder: z.enum(FOLDER_CODES).optional(), active: z.boolean().optional() });
const workflowBody = z.strictObject({
  slaHours: z.partialRecord(z.enum(ALL_STATUSES), z.number().int().min(0).max(24 * 90)).optional(),
  options: z
    .strictObject({ autoAssign: z.enum(['MANUAL', 'LEAST_LOADED']), requireSourceDocument: z.boolean(), minInspectionPhotos: z.number().int().min(0).max(50), autoReleaseToClient: z.boolean().optional() /* retired option, ignored */ })
    .optional(),
});
const inactive = z.strictObject({ includeInactive: z.enum(['true', 'false']).optional() });

router.get('/banks', view, validate({ query: bankList }), async (req, res) => res.json(await svc.listBanks(req.principal, req.valid.query)));
router.post('/banks', manage, validate({ body: z.strictObject(bankFields) }), async (req, res) => res.status(201).json(await svc.createBank(req.principal, req.valid.body, req)));
router.get('/banks/:id', view, validate({ params: idParam }), async (req, res) => res.json(await svc.findBank(req.principal, req.valid.params.id)));
router.patch('/banks/:id', manage, validate({ params: idParam, body: z.strictObject(bankFields).partial() }), async (req, res) =>
  res.json(await svc.updateBank(req.principal, req.valid.params.id, req.valid.body, req)),
);

router.get('/categories', view, validate({ query: inactive }), async (req, res) => res.json(await svc.listCategories(req.principal, { includeInactive: req.valid.query.includeInactive === 'true' })));
router.post('/categories', manage, validate({ body: categoryBody }), async (req, res) => res.status(201).json(await svc.createCategory(req.principal, req.valid.body, req)));
router.get('/categories/:id', view, validate({ params: idParam }), async (req, res) => res.json(await svc.getCategory(req.principal, req.valid.params.id)));
router.patch('/categories/:id', manage, validate({ params: idParam, body: categoryUpdate }), async (req, res) => res.json(await svc.updateCategory(req.principal, req.valid.params.id, req.valid.body, req)));
router.put('/categories/:id/fields', manage, validate({ params: idParam, body: fieldBody }), async (req, res) => res.json(await svc.upsertField(req.principal, req.valid.params.id, req.valid.body, req)));
router.delete('/categories/:id/fields/:key', manage, validate({ params: z.strictObject({ id: z.uuid(), key: str(60) }) }), async (req, res) =>
  res.json(await svc.removeField(req.principal, req.valid.params.id, req.valid.params.key, req)),
);

router.get('/document-types', view, validate({ query: inactive }), async (req, res) => res.json(await svc.listDocumentTypes(req.principal, { includeInactive: req.valid.query.includeInactive === 'true' })));
router.post('/document-types', manage, validate({ body: docTypeBody }), async (req, res) => res.status(201).json(await svc.createDocumentType(req.principal, req.valid.body, req)));
router.patch('/document-types/:id', manage, validate({ params: idParam, body: docTypeUpdate }), async (req, res) =>
  res.json(await svc.updateDocumentType(req.principal, req.valid.params.id, req.valid.body, req)),
);

router.get('/financial-years', async (_req, res) => res.json(await svc.listFinancialYears()));
router.get('/workflow-settings', requirePermission('workflow.config.manage'), async (req, res) => res.json(await svc.getWorkflowSettings(req.principal)));
router.put('/workflow-settings', requirePermission('workflow.config.manage'), validate({ body: workflowBody }), async (req, res) =>
  res.json(await svc.updateWorkflowSettings(req.principal, req.valid.body, req)),
);

const tag = 'Masters';
[
  ['get', '/masters/banks', 'List banks / NBFCs', 'master.view'],
  ['post', '/masters/banks', 'Add bank / NBFC branch', 'master.manage'],
  ['get', '/masters/banks/:id', 'Bank details', 'master.view'],
  ['patch', '/masters/banks/:id', 'Edit / deactivate bank', 'master.manage'],
  ['get', '/masters/categories', 'Valuation categories (platform + firm) with configurable fields', 'master.view'],
  ['post', '/masters/categories', 'Add a firm valuation category', 'master.manage'],
  ['get', '/masters/categories/:id', 'Category with fields', 'master.view'],
  ['patch', '/masters/categories/:id', 'Edit a firm category', 'master.manage'],
  ['put', '/masters/categories/:id/fields', 'Add / edit a configurable field', 'master.manage'],
  ['delete', '/masters/categories/:id/fields/:key', 'Deactivate a configurable field', 'master.manage'],
  ['get', '/masters/document-types', 'Document types', 'master.view'],
  ['post', '/masters/document-types', 'Add a document type', 'master.manage'],
  ['patch', '/masters/document-types/:id', 'Edit a firm document type', 'master.manage'],
  ['get', '/masters/financial-years', 'Financial years (current flagged)'],
  ['get', '/masters/workflow-settings', 'Workflow configuration: SLA hours per status, auto-assignment', 'workflow.config.manage'],
  ['put', '/masters/workflow-settings', 'Update workflow configuration', 'workflow.config.manage'],
].forEach(([method, path, summary, permission]) => documentRoute({ method, path, tag, summary, permission }));

export default router;
