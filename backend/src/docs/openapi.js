import { z } from 'zod';
import { registeredRoutes } from './registry.js';

/**
 * OpenAPI 3.1 document served by Swagger UI at /api/docs (SWAGGER_ENABLED=true).
 *
 * Generated from the real Express routes (src/routes.js MOUNTS), so every endpoint is listed, and from the very zod
 * schemas each route validates with (validate() tags its middleware with docSchemas; uploads are tagged with
 * docUpload). Path, query, JSON body and multipart parameters therefore always match what the API enforces.
 * Summaries, tags and required permissions come from the route registry (src/docs/registry.js).
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

/** Endpoints reachable without a bearer token. */
const PUBLIC = new Set([
  'get /health/live',
  'get /health/ready',
  'post /auth/login',
  'post /auth/refresh',
  'post /auth/logout',
  'post /auth/forgot-password',
  'get /auth/token-info',
  'post /auth/accept-invite',
  'post /auth/reset-password',
  'get /files/{token}',
  'get /verify/{code}',
]);

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

/** Cookie-authenticated endpoints: they also need the double-submit CSRF header. */
const CSRF = new Set(['post /auth/refresh', 'post /auth/logout', 'post /auth/switch-context']);
const csrfHeader = { name: 'X-CSRF-Token', in: 'header', required: true, description: 'Value of the `valuers_csrf` cookie set by /auth/login', schema: { type: 'string' } };

/** Ready-to-run request bodies for endpoints whose shape is not obvious from the schema alone. */
const FLAT_INPUTS = {
  builtUpArea: 520,
  areaUnit: 'sq.ft',
  compositeRate: 22500,
  constructionCostPerUnit: 2500,
  ageYears: 24,
  totalLifeYears: 60,
  salvagePct: 10,
  realisablePct: 98,
  distressPct: 75,
  bookValue: 8500000,
  guidelineRatePerSqM: 137690,
  readyReckonerValue: 6987261,
  extras: [],
  report: { purpose: 'To avail Housing Loan', documents: ['Copy of Agreement for Sale'], marketability: 'Good' },
  invoice: { fee: 2500, bankOfficer: 'Mr. Yogesh' },
};
const EXAMPLES = {
  'post /auth/login': { email: 'user@example.com', password: 'YourPassword@123' },
  'post /cases/{id}/valuations/{stage}/versions': { inputs: FLAT_INPUTS, summary: 'Composite rate method', changeNote: 'First version' },
  'post /cases/{id}/transitions': { action: 'START_PRELIMINARY' },
  'post /cases/{id}/assignments': { stage: 'JUNIOR', employeeId: '00000000-0000-0000-0000-000000000000' },
  'post /cases/{id}/signatures/valuer': { password: 'YourPassword@123', consent: true },
  'post /cases/{id}/payments': { amount: 2950, receivedOn: '2026-11-24', mode: 'UPI', reference: 'UTR123456' },
  'post /cases/{id}/valuations/review': { decision: 'APPROVED', comments: 'Calculations verified' },
};
const DESCRIPTIONS = {
  'post /cases/{id}/valuations/{stage}/versions': [
    '`stage` is `preliminary` (junior) or `final` (senior). `inputs` depends on the case category engine:',
    '- **FLAT** (residential flat, bank composite-rate format): see the example.',
    '- **LAND_BUILDING**: `{ land: { area, unit, ratePerUnit, guidelineRatePerUnit? }, building?: { builtUpArea, unit, replacementRatePerUnit, ageYears, totalLifeYears, salvagePct }, amenities: [{ description, amount }], realisablePct, distressPct, roundTo }`',
    '- **PLANT_MACHINERY**: `{ valuationYear, items: [{ description, make?, quantity, yearOfPurchase, replacementCostNew, usefulLifeYears, conditionFactor }], salvagePct, realisablePct, distressPct, roundTo }`',
    '- **STOCK**: `{ items: [{ description, category, quantity, unit, ratePerUnit, obsolescencePct }], realisablePct, distressPct, roundTo }`',
    '',
  ].join(String.fromCharCode(10)) +
    String.fromCharCode(10) +
    '`GET /cases/{id}/valuations` returns `engine` and pre-filled `defaults` for the case. The server recomputes every value.',
  'post /cases/{id}/transitions': 'Generic workflow actions. `GET /cases/{id}` lists the actions the caller may perform now in `allowedActions` (e.g. START_INSPECTION is done via /inspection/start; START_PRELIMINARY, START_FINAL_REVIEW, REQUEST_REINSPECTION, HOLD, RESUME, CANCEL, CLOSE_CASE here).',
};

/** Removes generator noise (huge integer bounds, the long UUID regex) so Swagger stays readable. */
function tidy(node) {
  if (Array.isArray(node)) return node.map(tidy);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === '$schema') continue;
    if ((k === 'maximum' && v === MAX_SAFE) || (k === 'minimum' && v === -MAX_SAFE)) continue;
    if (k === 'pattern' && ['uuid', 'email'].includes(node.format)) continue;
    out[k] = tidy(v);
  }
  return out;
}

/** zod → JSON Schema of what a client may SEND (input side: before coercion / defaults). */
function toJsonSchema(schema) {
  try {
    return tidy(
      z.toJSONSchema(schema, {
        io: 'input',
        unrepresentable: 'any',
        override: (ctx) => {
          const t = ctx.zodSchema?._zod?.def?.type;
          if (t === 'date') Object.assign(ctx.jsonSchema, { type: 'string', format: 'date', description: ctx.jsonSchema.description ?? 'Date (YYYY-MM-DD) or ISO date-time' });
          if (t === 'bigint') Object.assign(ctx.jsonSchema, { type: 'integer' });
        },
      }),
    );
  } catch {
    return { type: 'object' };
  }
}

const docPath = (p) => p.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
const joinPath = (prefix, p) => (`${prefix}${p === '/' ? '' : p}` || '/').replace(/\/{2,}/g, '/');

/** Every route of the given routers: { method, path, schemas: { params, query, body }, upload }. */
function scanRoutes(mounts) {
  const out = [];
  for (const [prefix, router] of mounts) {
    for (const layer of router.stack ?? []) {
      if (!layer.route) continue;
      const handles = layer.route.stack.map((s) => s.handle);
      const schemas = {};
      for (const h of handles) if (h.docSchemas) Object.assign(schemas, h.docSchemas);
      const upload = handles.find((h) => h.docUpload)?.docUpload ?? null;
      for (const method of Object.keys(layer.route.methods)) {
        if (method === '_all') continue;
        out.push({ method, path: joinPath(prefix, layer.route.path), schemas, upload });
      }
    }
  }
  return out;
}

function parametersFor(route) {
  const params = [];
  const pathNames = [...route.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
  const pathSchema = route.schemas.params ? toJsonSchema(route.schemas.params) : null;
  for (const name of pathNames) params.push({ name, in: 'path', required: true, schema: pathSchema?.properties?.[name] ?? { type: 'string' } });
  if (route.schemas.query) {
    const q = toJsonSchema(route.schemas.query);
    const required = new Set(q.required ?? []);
    for (const [name, schema] of Object.entries(q.properties ?? {})) {
      params.push({ name, in: 'query', required: required.has(name), schema, ...(schema.description ? { description: schema.description } : {}) });
    }
  }
  return params;
}

function requestBodyFor(route) {
  const body = route.schemas.body ? toJsonSchema(route.schemas.body) : null;
  if (route.upload) {
    const properties = { [route.upload.field]: { type: 'string', format: 'binary', description: 'File to upload' }, ...(body?.properties ?? {}) };
    const required = [...(route.upload.required ? [route.upload.field] : []), ...(body?.required ?? [])];
    return { required: route.upload.required, content: { 'multipart/form-data': { schema: { type: 'object', properties, ...(required.length ? { required } : {}) } } } };
  }
  if (!body || ['get', 'delete'].includes(route.method)) return undefined;
  const hasRequired = (body.required ?? []).length > 0;
  return { required: hasRequired, content: { 'application/json': { schema: body } } };
}

const titleCase = (s) => s.replace(/(^|[-_])(\w)/g, (_m, _d, c) => ` ${c.toUpperCase()}`).trim();

function buildOpenApi(mounts) {
  const registry = new Map(registeredRoutes().map((r) => [`${r.method} ${docPath(r.path)}`, r]));
  const paths = {};
  const tags = new Set();
  for (const route of scanRoutes(mounts)) {
    const path = docPath(route.path);
    const key = `${route.method} ${path}`;
    const doc = registry.get(key);
    const tag = doc?.tag ?? titleCase(path.split('/')[1] || 'General');
    const auth = doc ? doc.auth && !PUBLIC.has(key) : !PUBLIC.has(key);
    const perms = doc?.permission ? [].concat(doc.permission) : [];
    tags.add(tag);
    const parameters = [...parametersFor(route), ...(CSRF.has(key) ? [csrfHeader] : [])];
    const requestBody = requestBodyFor(route);
    const example = EXAMPLES[key];
    if (example && requestBody?.content['application/json']) requestBody.content['application/json'].example = example;
    paths[path] ??= {};
    paths[path][route.method] = {
      tags: [tag],
      summary: doc?.summary ?? `${route.method.toUpperCase()} ${path}`,
      operationId: `${route.method}_${path.replace(/[{}]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')}`,
      description: [doc?.description, DESCRIPTIONS[key], perms.length ? `**Requires permission:** ${perms.map((p) => `\`${p}\``).join(', ')}` : null].filter(Boolean).join('\n\n') || undefined,
      ...(parameters.length ? { parameters } : {}),
      ...(requestBody ? { requestBody } : {}),
      security: auth ? [{ bearerAuth: [] }] : [],
      responses: {
        200: { description: 'Success' },
        ...(route.method === 'post' ? { 201: { description: 'Created' } } : {}),
        400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        ...(auth ? { 401: { description: 'Not authenticated' }, 403: { description: 'Not permitted' }, 404: { description: 'Not found (or belongs to another firm)' } } : {}),
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Valuers Ecosystem API',
      version: '0.4.0',
      description:
        'Multi-tenant valuation firm management & digital workflow platform. All endpoints are prefixed with /api/v1.\n\n' +
        '**Testing in Swagger:** call `POST /auth/login`, copy `accessToken` from the response, click **Authorize** and paste it. ' +
        'The tenant (firm) is always taken from the token. Cookie-based endpoints (`/auth/refresh`, `/auth/logout`, `/auth/switch-context`) ' +
        'also need the `X-CSRF-Token` header with the value of the `valuers_csrf` cookie.',
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

export { buildOpenApi, scanRoutes };
