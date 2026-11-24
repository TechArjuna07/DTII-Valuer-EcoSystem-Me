import { redis } from '../../src/database/redis.js';
import { MOUNTS } from '../../src/routes.js';
import { buildOpenApi, scanRoutes } from '../../src/docs/openapi.js';
import { registeredRoutes } from '../../src/docs/registry.js';
import { prisma } from '../helpers.js';

/**
 * Swagger must let a tester call every endpoint: each real route is documented with its path / query parameters,
 * JSON body or multipart upload exactly as the API validates them, and the registry never lists routes that no
 * longer exist.
 */

const docPath = (p) => p.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
let spec;
let routes;

beforeAll(() => {
  spec = buildOpenApi(MOUNTS);
  routes = scanRoutes(MOUNTS);
});

afterAll(async () => {
  await prisma.$disconnect();
  await redis.quit();
});

describe('OpenAPI / Swagger completeness', () => {
  test('every real route is documented, with a summary', () => {
    expect(routes.length).toBeGreaterThan(100);
    for (const r of routes) {
      const op = spec.paths[docPath(r.path)]?.[r.method];
      expect({ route: `${r.method} ${r.path}`, documented: !!op }).toEqual({ route: `${r.method} ${r.path}`, documented: true });
      expect(op.summary.startsWith(r.method.toUpperCase())).toBe(false); // has a real summary from the registry
    }
  });

  test('parameters and bodies match what each route validates', () => {
    for (const r of routes) {
      const op = spec.paths[docPath(r.path)][r.method];
      const params = op.parameters ?? [];
      const label = `${r.method} ${r.path}`;
      const pathNames = [...r.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
      expect({ label, path: params.filter((p) => p.in === 'path').map((p) => p.name) }).toEqual({ label, path: pathNames });
      if (r.schemas.query) expect({ label, hasQuery: params.some((p) => p.in === 'query') }).toEqual({ label, hasQuery: true });
      if (r.schemas.body && !['get', 'delete'].includes(r.method)) expect({ label, hasBody: !!op.requestBody }).toEqual({ label, hasBody: true });
      if (r.upload) expect(op.requestBody.content['multipart/form-data'].schema.properties[r.upload.field]).toMatchObject({ type: 'string', format: 'binary' });
    }
  });

  test('the registry only describes routes that exist', () => {
    const real = new Set(routes.map((r) => `${r.method} ${docPath(r.path)}`));
    expect(registeredRoutes().filter((r) => !real.has(`${r.method} ${docPath(r.path)}`)).map((r) => `${r.method} ${r.path}`)).toEqual([]);
  });

  test('key endpoints show their fields, examples, security and CSRF header', () => {
    const login = spec.paths['/auth/login'].post;
    expect(login.security).toEqual([]);
    expect(login.requestBody.content['application/json'].schema).toMatchObject({ required: ['email', 'password'], properties: { email: { format: 'email' }, password: { type: 'string' } } });
    expect(login.requestBody.content['application/json'].example).toMatchObject({ email: expect.any(String) });

    const cases = spec.paths['/cases'].get;
    expect(cases.security).toEqual([{ bearerAuth: [] }]);
    expect(cases.parameters.map((p) => p.name)).toEqual(expect.arrayContaining(['page', 'search', 'status', 'statusGroup', 'assignedToMe']));
    expect(cases.parameters.find((p) => p.name === 'status').schema.enum).toContain('PAYMENT_PENDING');

    const upload = spec.paths['/cases/{id}/documents'].post.requestBody.content['multipart/form-data'].schema;
    expect(upload.required).toEqual(expect.arrayContaining(['file', 'folder']));
    expect(spec.paths['/cases/{id}'].get.parameters[0]).toMatchObject({ name: 'id', in: 'path', schema: { format: 'uuid' } });

    const versions = spec.paths['/cases/{id}/valuations/{stage}/versions'].post;
    expect(versions.description).toMatch(/LAND_BUILDING/);
    expect(versions.requestBody.content['application/json'].example.inputs).toMatchObject({ builtUpArea: 520, compositeRate: 22500 });

    expect(spec.paths['/auth/refresh'].post.parameters).toEqual([expect.objectContaining({ name: 'X-CSRF-Token', in: 'header' })]);
    expect(spec.paths['/cases/{id}/payments'].post.requestBody.content['application/json'].schema.properties.mode.enum).toContain('UPI');
  });
});
