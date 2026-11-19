import { Forbidden } from '../utils/errors.js';

/**
 * Route-level permission gates. Data scope (own firm, assigned cases, own client record) is enforced again
 * in each service, so a missing route check can never expose another tenant's data.
 */

/** Requires ALL of the listed permissions. */
const requirePermission =
  (...codes) =>
  (req, _res, next) => {
    const perms = req.principal?.permissions || [];
    return codes.every((c) => perms.includes(c)) ? next() : next(Forbidden());
  };

/** Requires AT LEAST ONE of the listed permissions. */
const requireAnyPermission =
  (...codes) =>
  (req, _res, next) => {
    const perms = req.principal?.permissions || [];
    return codes.some((c) => perms.includes(c)) ? next() : next(Forbidden());
  };

/** The request must run in a firm context (not the platform context). */
const requireFirmContext = (req, _res, next) => (req.principal?.firmId ? next() : next(Forbidden()));

/** The request must run in the platform (Superadmin) context. */
const requireSuperadmin = (req, _res, next) => (req.principal?.isSuperadmin && !req.principal.firmId ? next() : next(Forbidden()));

const hasPermission = (principal, code) => !!principal?.permissions?.includes(code);

export { requirePermission, requireAnyPermission, requireFirmContext, requireSuperadmin, hasPermission };
