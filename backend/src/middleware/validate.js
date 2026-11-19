import { HttpError } from '../utils/errors.js';

function formatIssues(error, location) {
  return error.issues.map((i) => {
    const field = i.path.length ? i.path.join('.') : location;
    if (i.code === 'unrecognized_keys') return `property ${i.keys.join(', ')} should not exist`;
    return i.message.startsWith(field) ? i.message : `${field}: ${i.message}`;
  });
}

/**
 * Validates and normalises request input with zod schemas.
 * Use `.strict()` object schemas so unknown properties are rejected (mass-assignment defence).
 * Parsed values are exposed as `req.valid.body|query|params` (Express 5 makes req.query read-only).
 *
 * @param {{ body?: import('zod').ZodType, query?: import('zod').ZodType, params?: import('zod').ZodType }} schemas
 */
function validate(schemas) {
  return (req, _res, next) => {
    req.valid = req.valid || {};
    const errors = [];
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
