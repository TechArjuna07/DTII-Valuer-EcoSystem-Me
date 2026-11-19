/**
 * Lightweight route documentation registry. Each module registers its endpoints as it mounts them, and
 * openapi.js turns the registry into the OpenAPI document — so Swagger always matches the real routes.
 */
const routes = [];

/**
 * @param {{ method: 'get'|'post'|'patch'|'put'|'delete', path: string, tag: string, summary: string,
 *           auth?: boolean, permission?: string|string[], description?: string }} entry  path relative to /api/v1
 */
function documentRoute(entry) {
  routes.push({ auth: true, ...entry });
}

const registeredRoutes = () => routes;

export { documentRoute, registeredRoutes };
