/**
 * OpenAPI 3.1 document served by Swagger UI at /api/docs (when SWAGGER_ENABLED=true).
 * Each module contributes its paths here as it is implemented, so the API documentation stays current.
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
  return {
    openapi: '3.1.0',
    info: {
      title: 'Valuers Ecosystem API',
      version: '0.1.0',
      description: 'Multi-tenant valuation firm management & digital workflow platform. All endpoints are prefixed with /api/v1.',
    },
    servers: [{ url: '/api/v1' }],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: { Error: errorSchema },
    },
    tags: [{ name: 'Health', description: 'Liveness and readiness probes' }],
    paths: {
      '/health/live': {
        get: { tags: ['Health'], summary: 'Liveness probe', responses: { 200: { description: 'Process is running' } } },
      },
      '/health/ready': {
        get: {
          tags: ['Health'],
          summary: 'Readiness probe (PostgreSQL, Redis)',
          responses: {
            200: { description: 'All dependencies are up' },
            503: { description: 'A dependency is down', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
    },
  };
}

export { buildOpenApi };
