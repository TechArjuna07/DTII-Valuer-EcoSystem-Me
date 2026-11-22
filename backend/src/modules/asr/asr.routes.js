import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { documentRoute } from '../../docs/registry.js';
import * as svc from './asr.service.js';

/**
 * /asr — IGR Maharashtra eASR (Annual Statement of Rates / ready reckoner), shared platform data.
 * Any firm employee with asr.view (and the Superadmin) can look up rates; data is fetched from the government site
 * only the first time it is needed and then served to every firm from our database.
 */
const router = Router();
router.use(authenticate);

const view = requirePermission('asr.view');
const manage = requirePermission('asr.manage');
const id = z.strictObject({ id: z.uuid() });
const yearQuery = z.strictObject({ year: z.coerce.number().int().min(1).max(999).optional() });

router.get('/districts', view, async (_req, res) => res.json(await svc.listDistricts()));
router.get('/districts/:id/talukas', view, validate({ params: id }), async (req, res) => res.json(await svc.listTalukas(req.valid.params.id)));
router.get('/talukas/:id/villages', view, validate({ params: id }), async (req, res) => res.json(await svc.listVillages(req.valid.params.id)));
router.get('/years', view, async (_req, res) => res.json(await svc.listYears()));
router.get('/villages/:id/rates', view, validate({ params: id, query: yearQuery }), async (req, res) => {
  const out = await svc.getRates(req.valid.params.id, req.valid.query.year);
  res.status(out.status === 'READY' ? 200 : 202).json(out);
});
router.post('/villages/:id/refresh', manage, validate({ params: id, body: yearQuery }), async (req, res) => res.status(202).json(await svc.refreshRates(req.principal, req.valid.params.id, req.valid.body.year, req)));
router.get('/status', manage, async (_req, res) => res.json(await svc.status()));

const tag = 'IGR eASR rates';
[
  ['get', '/asr/districts', 'eASR districts', 'asr.view'],
  ['get', '/asr/districts/:id/talukas', 'Talukas of a district (fetched from eASR on first use)', 'asr.view'],
  ['get', '/asr/talukas/:id/villages', 'Villages of a taluka (fetched from eASR on first use)', 'asr.view'],
  ['get', '/asr/years', 'eASR statement years', 'asr.view'],
  ['get', '/asr/villages/:id/rates', 'Village rates for a year: 200 when stored, 202 while being fetched (poll)', 'asr.view'],
  ['post', '/asr/villages/:id/refresh', 'Re-fetch a village statement from eASR', 'asr.manage'],
  ['get', '/asr/status', 'Cache coverage and government-site traffic', 'asr.manage'],
].forEach(([method, path, summary, permission]) => documentRoute({ method, path, tag, summary, permission }));

export default router;
