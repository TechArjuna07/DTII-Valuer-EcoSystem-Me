import { Prisma } from '@prisma/client';
import { logger } from '../config/logger.js';
import { HttpError, statusName } from '../utils/errors.js';

/** Maps any error to a safe, stable JSON body. Clients never see stack traces, SQL or constraint values. */
function toBody(err) {
  if (err instanceof HttpError) {
    return { statusCode: err.status, error: statusName(err.status), message: err.publicMessage, ...(err.extra || {}) };
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return { statusCode: 409, error: statusName(409), message: 'A record with the same unique value already exists' };
    if (err.code === 'P2025') return { statusCode: 404, error: statusName(404), message: 'Resource not found' };
    if (err.code === 'P2003') return { statusCode: 400, error: statusName(400), message: 'Referenced resource does not exist' };
  }
  // body-parser errors (oversized / malformed JSON)
  const st = err && (err.status || err.statusCode);
  if (typeof st === 'number' && st >= 400 && st < 500 && err.expose !== false) {
    const message = err.type === 'entity.too.large' ? 'Request body too large' : err.type === 'entity.parse.failed' ? 'Malformed request body' : 'Bad request';
    return { statusCode: st, error: statusName(st), message };
  }
  // Raised by the append-only / immutability triggers in PostgreSQL.
  if (/append-only|immutable/i.test(String(err?.message || ''))) {
    return { statusCode: 409, error: statusName(409), message: 'This record is immutable' };
  }
  return { statusCode: 500, error: statusName(500), message: 'An unexpected error occurred' };
}

// Express recognises error handlers by their 4-argument signature.
function errorHandler(err, req, res, _next) {
  const body = toBody(err);
  body.requestId = req.id ? String(req.id) : undefined;
  if (body.statusCode >= 500) {
    logger.error({ err: { name: err?.name, message: err?.message, stack: err?.stack }, requestId: body.requestId }, 'Unhandled error');
  }
  if (res.headersSent) return;
  res.status(body.statusCode).json(body);
}

function notFound(req, res) {
  res.status(404).json({ statusCode: 404, error: 'NOT_FOUND', message: 'Route not found', requestId: req.id ? String(req.id) : undefined });
}

export { errorHandler, notFound, toBody };
