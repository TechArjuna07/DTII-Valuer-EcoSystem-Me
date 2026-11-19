import { env } from '../config/env.js';
import { Forbidden } from '../utils/errors.js';
import { safeEqual } from '../services/crypto.js';

const CSRF_COOKIE = 'valuers_csrf';
const CSRF_HEADER = 'x-csrf-token';

/**
 * Double-submit cookie check + Origin allowlist for the COOKIE-authenticated endpoints (refresh, logout,
 * switch-context). Bearer-authenticated endpoints are not CSRF-able (the token is not sent automatically).
 */
function verifyCsrf(req, _res, next) {
  const origin = req.headers.origin;
  if (origin && !env.CORS_ORIGINS.includes(origin)) return next(Forbidden('Origin not allowed'));
  const cookie = String(req.cookies?.[CSRF_COOKIE] || '');
  const header = String(req.headers[CSRF_HEADER] || '');
  if (!cookie || !safeEqual(cookie, header)) return next(Forbidden('CSRF validation failed'));
  next();
}

export { verifyCsrf, CSRF_COOKIE };
