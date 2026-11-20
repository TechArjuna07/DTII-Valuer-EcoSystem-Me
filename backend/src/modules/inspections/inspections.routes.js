import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { requireFirmContext, requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { singleFile } from '../../middleware/upload.js';
import { limiters } from '../../middleware/rate-limit.js';
import { documentRoute } from '../../docs/registry.js';
import { opt, str } from '../organizations/organizations.schema.js';
import * as svc from './inspections.service.js';

/** Property details and the field inspection of a case. */
const router = Router();
const staff = [authenticate, requireFirmContext, requirePermission('case.view')];
const caseParam = z.strictObject({ id: z.uuid() });
const num = (min, max) => z.coerce.number().min(min).max(max);
const blank = (schema) => z.preprocess((v) => (v === '' ? undefined : v), schema);

const draftBody = z.strictObject({
  propertyType: opt(str(80)),
  propertyAddress: opt(str(500)),
  landArea: opt(num(0, 1e10)),
  landAreaUnit: opt(z.enum(['sq.ft', 'sq.m', 'acre', 'hectare', 'guntha'])),
  buildingArea: opt(num(0, 1e10)),
  buildingAreaUnit: opt(z.enum(['sq.ft', 'sq.m'])),
  condition: opt(z.enum(['EXCELLENT', 'GOOD', 'AVERAGE', 'POOR', 'DILAPIDATED'])),
  inspectedAt: opt(z.coerce.date()),
  gpsLat: opt(num(-90, 90)),
  gpsLng: opt(num(-180, 180)),
  gpsAccuracyM: opt(num(0, 100000)),
  gpsConsent: z.boolean().optional(),
  gpsDeclinedReason: opt(str(300)),
  construction: z
    .strictObject({
      structure: opt(str(100)),
      yearOfConstruction: opt(z.coerce.number().int().min(1800).max(2100)),
      floors: opt(z.coerce.number().int().min(0).max(200)),
      roofing: opt(str(100)),
      flooring: opt(str(100)),
      walls: opt(str(100)),
      estimatedLifeYears: opt(z.coerce.number().int().min(0).max(150)),
      maintenance: opt(str(100)),
    })
    .optional(),
  landmarks: z.array(z.strictObject({ name: str(150).min(1), distance: opt(str(50)), direction: opt(str(30)) })).max(20).optional(),
  boundaries: z.strictObject({ north: opt(str(200)), south: opt(str(200)), east: opt(str(200)), west: opt(str(200)) }).optional(),
  observations: z
    .strictObject({
      occupancy: opt(str(100)),
      accessRoad: opt(str(200)),
      amenities: opt(str(500)),
      deviations: opt(str(1000)),
      neighbourhood: opt(str(500)),
    })
    .optional(),
  officerRemarks: opt(str(3000)),
});
const photoBody = z.strictObject({
  kind: z.enum(['PROPERTY', 'LOCATION', 'LANDMARK', 'OTHER']).default('PROPERTY'),
  caption: blank(str(300).optional()),
  gpsLat: blank(num(-90, 90).optional()),
  gpsLng: blank(num(-180, 180).optional()),
  capturedAt: blank(z.coerce.date().optional()),
});

router.get('/cases/:id/property', ...staff, validate({ params: caseParam }), async (req, res) => res.json(await svc.getProperty(req.principal, req.valid.params.id)));
router.put('/cases/:id/property', ...staff, validate({ params: caseParam, body: z.strictObject({ data: z.record(z.string().max(60), z.any()) }) }), async (req, res) =>
  res.json(await svc.saveProperty(req.principal, req.valid.params.id, req.valid.body.data, req)),
);
router.get('/cases/:id/inspection', ...staff, validate({ params: caseParam }), async (req, res) => res.json(await svc.getInspection(req.principal, req.valid.params.id)));
router.post('/cases/:id/inspection/schedule', ...staff, validate({ params: caseParam, body: z.strictObject({ scheduledAt: z.coerce.date() }) }), async (req, res) =>
  res.json(await svc.schedule(req.principal, req.valid.params.id, req.valid.body, req)),
);
router.post('/cases/:id/inspection/start', ...staff, validate({ params: caseParam }), async (req, res) => res.json(await svc.start(req.principal, req.valid.params.id, req)));
router.put('/cases/:id/inspection', ...staff, validate({ params: caseParam, body: draftBody }), async (req, res) => res.json(await svc.saveDraft(req.principal, req.valid.params.id, req.valid.body, req)));
router.post('/cases/:id/inspection/photos', ...staff, limiters.upload, validate({ params: caseParam }), singleFile('file'), validate({ body: photoBody }), async (req, res) =>
  res.status(201).json(await svc.addPhoto(req.principal, req.valid.params.id, req.file, req.valid.body, req)),
);
router.post('/cases/:id/inspection/photos/:photoId/remove', ...staff, validate({ params: z.strictObject({ id: z.uuid(), photoId: z.uuid() }) }), async (req, res) =>
  res.json(await svc.removePhoto(req.principal, req.valid.params.id, req.valid.params.photoId, req)),
);
router.post('/cases/:id/inspection/submit', ...staff, validate({ params: caseParam, body: z.strictObject({ nextAssigneeId: z.uuid().optional() }) }), async (req, res) =>
  res.json(await svc.submit(req.principal, req.valid.params.id, req, req.valid.body)),
);
router.get('/inspections/mine', authenticate, requireFirmContext, requirePermission('inspection.perform'), async (req, res) => res.json(await svc.myInspections(req.principal)));

const tag = 'Inspections';
[
  ['get', '/cases/:id/property', 'Category-specific property details with field definitions', 'case.view'],
  ['put', '/cases/:id/property', 'Save property details (validated against the category fields)', 'case.view'],
  ['get', '/cases/:id/inspection', 'Current inspection round, photos, previous rounds and submission readiness', 'case.view'],
  ['post', '/cases/:id/inspection/schedule', 'Schedule / reschedule the site visit (starts the inspection stage)', 'inspection.perform'],
  ['post', '/cases/:id/inspection/start', 'Start the site visit now', 'inspection.perform'],
  ['put', '/cases/:id/inspection', 'Save inspection findings (draft): areas, condition, construction, landmarks, GPS with consent', 'inspection.perform'],
  ['post', '/cases/:id/inspection/photos', 'Add a photograph (multipart "file"; stored in 03_Property_Photographs)', 'inspection.perform'],
  ['post', '/cases/:id/inspection/photos/:photoId/remove', 'Detach a photograph from the draft (the file is kept)', 'inspection.perform'],
  ['post', '/cases/:id/inspection/submit', 'Submit the inspection report (server-side completeness checks)', 'inspection.submit'],
  ['get', '/inspections/mine', 'Field officer: today, pending and completed inspections', 'inspection.perform'],
].forEach(([method, path, summary, permission]) => documentRoute({ method, path, tag, summary, permission }));

export default router;
