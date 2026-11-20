import { HttpError } from '../utils/errors.js';

function formatIssues(error, location) {
  return error.issues.map((i) => {
    const field = i.path.length ? i.path.join('.') : location;
    if (i.code === 'unrecognized_keys') return `property ${i.keys.join(', ')} should not exist`;
    return i.message.startsWith(field) ? i.message : `${field}: ${i.message}`;
  });
}

/** True if any string (or key) inside `value` contains a NUL byte — PostgreSQL rejects them in text columns. */
function hasNul(value, depth = 0) {
  if (typeof value === 'string') return value.includes('\u0000');
  if (depth > 20 || value === null || typeof value !== 'object') return false;
  return Object.entries(value).some(([k, v]) => k.includes('\u0000') || hasNul(v, depth + 1));
}

/**
 * Validates and normalises request input with zod schemas.
 * Use `.strict()` object schemas so unknown properties are rejected (mass-assignment defence).
 * Input containing NUL bytes is refused up front (400 instead of a database error).
 * Parsed values are exposed as `req.valid.body|query|params` (Express 5 makes req.query read-only).
 *
 * @param {{ body?: import('zod').ZodType, query?: import('zod').ZodType, params?: import('zod').ZodType }} schemas
 */
function validate(schemas) {
  return (req, _res, next) => {
    req.valid = req.valid || {};
    const errors = [];
    if (['params', 'query', 'body'].some((l) => schemas[l] && hasNul(req[l]))) return next(new HttpError(400, 'Request contains invalid characters'));
    for (const location of ['params', 'query', 'body']) {
      const schema = schemas[location];
      if (!schema) continue;
      const result = schema.safeParse(req[location] ?? {});
      if (result.success) req.valid[location] = result.data;
      else errors.push(...formatIssues(result.error, location));
    }
    if (errors.length) return next(new HttpError(400, errors));
    next();
  };
}

export { validate };
