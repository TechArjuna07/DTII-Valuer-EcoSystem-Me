const STATUS_NAMES = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'UNPROCESSABLE_ENTITY',
  423: 'LOCKED',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_SERVER_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};

/**
 * Expected, user-safe error. `publicMessage` is returned to the client verbatim, so it must never contain
 * secrets, tokens, PAN or internal identifiers. Any other error becomes a generic 500.
 */
class HttpError extends Error {
  constructor(status, message, extra) {
    super(Array.isArray(message) ? message.join('; ') : message);
    this.status = status;
    this.publicMessage = message;
    this.extra = extra;
  }
}

const statusName = (s) => STATUS_NAMES[s] || 'ERROR';

const BadRequest = (m = 'Bad request', extra) => new HttpError(400, m, extra);
const Unauthorized = (m = 'Authentication required') => new HttpError(401, m);
const Forbidden = (m = 'You do not have permission to perform this action') => new HttpError(403, m);
const NotFound = (m = 'Resource not found') => new HttpError(404, m);
const Conflict = (m = 'Conflict', extra) => new HttpError(409, m, extra);
const Unprocessable = (m, extra) => new HttpError(422, m, extra);
const ServiceUnavailable = (m = 'Service unavailable', extra) => new HttpError(503, m, extra);

export { HttpError, statusName, BadRequest, Unauthorized, Forbidden, NotFound, Conflict, Unprocessable, ServiceUnavailable };
