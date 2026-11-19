import { registeredRoutes } from './registry.js';

/**
 * OpenAPI 3.1 document served by Swagger UI at /api/docs (SWAGGER_ENABLED=true).
 * Paths come from the route registry (src/docs/registry.js) that every module populates.
 */
const errorSchema = {
  type: 'object',
  properties: {
    statusCode: { type: 'integer' },
    error: { type: 'string' },
    message: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
    requestId: { type: 'string' },
  },
};

function buildOpenApi() {
  const paths = {};
  const tags = new Set();
  for (const r of registeredRoutes()) {
    const path = r.path.replace(/:([A-Za-z]+)/g, '{$1}');
    const params = [...r.path.matchAll(/:([A-Za-z]+)/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));
    const perms = r.permission ? [].concat(r.permission) : [];
    tags.add(r.tag);
    paths[path] ??= {};
    paths[path][r.method] = {
      tags: [r.tag],
      summary: r.summary,
      description: [r.description, perms.length ? `**Requires permission:** ${perms.map((p) => `\`${p}\``).join(', ')}` : null].filter(Boolean).join('\n\n') || undefined,
      parameters: params.length ? params : undefined,
      security: r.auth ? [{ bearerAuth: [] }] : [],
      responses: {
        200: { description: 'Success' },
        ...(r.auth ? { 401: { description: 'Not authenticated' }, 403: { description: 'Not permitted' } } : {}),
        400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Valuers Ecosystem API',
      version: '0.3.0',
      description:
        'Multi-tenant valuation firm management & digital workflow platform. All endpoints are prefixed with /api/v1. ' +
        'Authenticate with `POST /auth/login`, then send `Authorization: Bearer <accessToken>`. The tenant (firm) is always taken from the token.',
    },
    servers: [{ url: '/api/v1' }],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: { Error: errorSchema },
    },
    tags: [...tags].map((name) => ({ name })),
    paths,
  };
}

export { buildOpenApi };
