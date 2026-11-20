import { Router } from 'express';
import { documentRoute } from '../../docs/registry.js';
import { NotFound } from '../../utils/errors.js';
import { contentDisposition, localGetStream, verifyLocalToken } from '../../services/storage/storage.service.js';

/**
 * GET /files/:token — serves a document from LOCAL storage for a short-lived, HMAC-signed link issued by
 * POST /documents/:id/link. The token is the authorisation (it binds key, file name, type, disposition and expiry);
 * expired or tampered tokens are 404. In production (S3) links point to pre-signed S3 URLs instead.
 */
const router = Router();

router.get('/:token', async (req, res) => {
  const t = verifyLocalToken(req.params.token);
  if (!t) throw NotFound('This link has expired');
  let file;
  try {
    file = await localGetStream(t.key);
  } catch {
    throw NotFound('File not found');
  }
  res.setHeader('Content-Type', t.contentType);
  res.setHeader('Content-Length', file.size);
  res.setHeader('Content-Disposition', contentDisposition(t.fileName, t.disposition));
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  file.stream.on('error', () => res.destroy());
  file.stream.pipe(res);
});

documentRoute({ method: 'get', path: '/files/:token', tag: 'Documents', summary: 'Download via a signed, expiring link (local storage)', auth: false });

export default router;
