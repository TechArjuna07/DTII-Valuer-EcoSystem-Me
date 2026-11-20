import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { requireAnyPermission, requireFirmContext } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { singleFile } from '../../middleware/upload.js';
import { limiters } from '../../middleware/rate-limit.js';
import { documentRoute } from '../../docs/registry.js';
import { FOLDER_CODES } from '../../config/folders.js';
import { opt, str } from '../organizations/organizations.schema.js';
import * as svc from './documents.service.js';

/**
 * Case document repository. Mounted at /api/v1 with per-route auth (paths span /cases, /documents, /repository).
 * Every handler re-checks case visibility and folder ACL in the service.
 */
const router = Router();
const auth = [authenticate, requireFirmContext, requireAnyPermission('document.view', 'document.upload')];
const caseParam = z.strictObject({ id: z.uuid() });
const uuidOrEmpty = z.preprocess((v) => (v === '' ? undefined : v), z.uuid().optional());

const uploadBody = z.strictObject({
  folder: z.enum(FOLDER_CODES),
  title: z.preprocess((v) => (v === '' ? undefined : v), str(200).min(1).optional()),
  documentTypeId: uuidOrEmpty,
  documentId: uuidOrEmpty,
  requestId: uuidOrEmpty,
  visibility: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['INTERNAL', 'CLIENT']).optional()),
  note: z.preprocess((v) => (v === '' ? undefined : v), str(500).optional()),
});
const requestBody = z.strictObject({
  title: str(200).min(2, 'Describe the document'),
  description: opt(str(1000)),
  documentTypeId: z.uuid().optional(),
  requestedFrom: z.enum(['CLIENT', 'BANK', 'INTERNAL']).default('CLIENT'),
  dueDate: opt(z.coerce.date()),
});
const linkBody = z.strictObject({ versionId: z.uuid().optional(), disposition: z.enum(['inline', 'attachment']).default('attachment') });
const updateBody = z.strictObject({ title: str(200).min(1).optional(), visibility: z.enum(['INTERNAL', 'CLIENT']).optional(), documentTypeId: z.uuid().nullable().optional() });

router.get('/cases/:id/documents', ...auth, validate({ params: caseParam }), async (req, res) => res.json(await svc.caseRepository(req.principal, req.valid.params.id)));
router.post('/cases/:id/documents', ...auth, limiters.upload, validate({ params: caseParam }), singleFile('file'), validate({ body: uploadBody }), async (req, res) =>
  res.status(201).json(await svc.upload(req.principal, req.valid.params.id, req.file, req.valid.body, req)),
);
router.get('/cases/:id/document-requests', ...auth, validate({ params: caseParam }), async (req, res) => res.json(await svc.listRequests(req.principal, req.valid.params.id)));
router.post('/cases/:id/document-requests', ...auth, validate({ params: caseParam, body: requestBody }), async (req, res) =>
  res.status(201).json(await svc.createRequest(req.principal, req.valid.params.id, req.valid.body, req)),
);
router.post('/document-requests/:id/cancel', ...auth, validate({ params: caseParam }), async (req, res) => {
  await svc.cancelRequest(req.principal, req.valid.params.id, req);
  res.status(204).end();
});
router.get('/documents/:id', ...auth, validate({ params: caseParam }), async (req, res) => res.json(await svc.getDocument(req.principal, req.valid.params.id)));
router.patch('/documents/:id', ...auth, validate({ params: caseParam, body: updateBody }), async (req, res) => res.json(await svc.updateDocument(req.principal, req.valid.params.id, req.valid.body, req)));
router.post('/documents/:id/archive', ...auth, validate({ params: caseParam, body: z.strictObject({ reason: str(500).min(3, 'A reason is required') }) }), async (req, res) => {
  await svc.archiveDocument(req.principal, req.valid.params.id, req.valid.body.reason, req);
  res.status(204).end();
});
router.post('/documents/:id/link', ...auth, validate({ params: caseParam, body: linkBody }), async (req, res) =>
  res.json(await svc.downloadLink(req.principal, req.valid.params.id, req.valid.body.versionId, req.valid.body.disposition, req)),
);
router.get('/repository/clients/:id', ...auth, validate({ params: caseParam }), async (req, res) => res.json(await svc.clientRepository(req.principal, req.valid.params.id)));
router.get('/repository/me', authenticate, requireFirmContext, requireAnyPermission('portal.access'), async (req, res) => res.json(await svc.clientRepository(req.principal, req.principal.clientId)));

const tag = 'Documents';
const perm = ['document.view', 'document.upload'];
[
  ['get', '/cases/:id/documents', 'Case repository: readable folders, documents and current versions'],
  ['post', '/cases/:id/documents', 'Upload a document or a new version (multipart "file"; type sniffed, size-limited, scanned)'],
  ['get', '/cases/:id/document-requests', 'Requested documents / clarifications'],
  ['post', '/cases/:id/document-requests', 'Request a document from the client, bank or team'],
  ['post', '/document-requests/:id/cancel', 'Cancel an open request'],
  ['get', '/documents/:id', 'Document with full version history'],
  ['patch', '/documents/:id', 'Rename, re-classify or change client visibility'],
  ['post', '/documents/:id/archive', 'Archive (Firm Admin; versions are retained)'],
  ['post', '/documents/:id/link', 'Short-lived signed download / preview link (audited)'],
  ['get', '/repository/clients/:id', 'Client-wise repository: financial years → cases → folder counts'],
  ['get', '/repository/me', 'Client portal: own repository tree'],
].forEach(([method, path, summary]) => documentRoute({ method, path, tag, summary, permission: perm }));

export default router;
