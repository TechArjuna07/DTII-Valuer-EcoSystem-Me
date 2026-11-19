import { Unauthorized } from '../utils/errors.js';
import { verifyAccessToken } from '../services/token.service.js';
import { loadPrincipal } from '../services/principal.service.js';

/**
 * Requires a valid Bearer access token and a still-valid session/membership. Sets req.principal.
 * The firm (tenant) of every request comes ONLY from here — never from the request body or query.
 */
async function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : null;
    if (!token) return next(Unauthorized());
    const claims = verifyAccessToken(token);
    if (!claims) return next(Unauthorized('Session expired or invalid'));
    const principal = await loadPrincipal(claims);
    if (!principal) return next(Unauthorized('Session expired or invalid'));
    req.principal = principal;
    next();
  } catch (e) {
    next(e);
  }
}

export { authenticate };
