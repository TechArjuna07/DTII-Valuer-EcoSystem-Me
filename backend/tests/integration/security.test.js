import { redis } from '../../src/database/redis.js';
import { closeRenderer } from '../../src/services/pdf/pdf-renderer.js';
import { api, app, as, prisma, request } from '../helpers.js';
import { completeFinal, completeInspection, completePreliminary, createCaseWithTeam, PDF, setupFirm, signFinalReport } from '../fixtures.js';

/**
 * VAPT-style regression suite: cross-tenant IDOR sweep, injection, XSS storage, traversal, information
 * leakage, request limits. Each test maps to an item of docs/VAPT_CHECKLIST.md.
 */
let A;
let B;
let c;
const ids = {};

beforeAll(async () => {
  [A, B] = await Promise.all([setupFirm(), setupFirm()]);
  c = await createCaseWithTeam(A);
  await completeInspection(A, c.id);
  await completePreliminary(A, c.id);
  await completeFinal(A, c.id);
  const req = await as(A.mk.token).post(`/cases/${c.id}/document-requests`, { title: 'PAN copy' }); // before completion
  await signFinalReport(A, c.id);
  const doc = await prisma.caseDocument.findFirst({ where: { caseId: c.id } });
  const sig = await prisma.digitalSignature.findFirst({ where: { caseId: c.id } });
  Object.assign(ids, { caseId: c.id, documentId: doc.id, signatureId: sig.id, requestId: req.body.id, clientId: A.client.id, bankId: A.bank.id, employeeId: A.fo.employee.id });
}, 300_000);

afterAll(async () => {
  await closeRenderer();
  await prisma.$disconnect();
  await redis.quit();
});

describe('IDOR / tenant isolation sweep (VAPT AC-01..AC-04)', () => {
  test('every firm-A resource is invisible (404) to firm B — reads and writes', async () => {
    const b = as(B.admin);
    const probes = [
      b.get(`/cases/${ids.caseId}`),
      b.get(`/cases/${ids.caseId}/timeline`),
      b.get(`/cases/${ids.caseId}/documents`),
      b.get(`/cases/${ids.caseId}/property`),
      b.get(`/cases/${ids.caseId}/inspection`),
      b.get(`/cases/${ids.caseId}/valuations`),
      b.get(`/cases/${ids.caseId}/approval`),
      b.get(`/cases/${ids.caseId}/bank`),
      b.get(`/documents/${ids.documentId}`),
      b.post(`/documents/${ids.documentId}/link`, {}),
      b.post(`/signatures/${ids.signatureId}/verify`),
      b.post(`/document-requests/${ids.requestId}/cancel`),
      b.get(`/clients/${ids.clientId}`),
      b.get(`/masters/banks/${ids.bankId}`),
      b.get(`/employees/${ids.employeeId}`),
      b.post(`/cases/${ids.caseId}/transitions`, { action: 'HOLD', remarks: 'cross-tenant' }),
      b.post(`/cases/${ids.caseId}/assignments`, { stage: 'FIELD', employeeId: B.fo.employee.id }),
      b.put(`/cases/${ids.caseId}/property`, { data: {} }),
      b.get(`/cases/${ids.caseId}/approval`),
      b.post(`/cases/${ids.caseId}/signatures/valuer`, { password: 'x', consent: true }),
    ];
    const results = await Promise.all(probes);
    results.forEach((r) => expect(r.status).toBe(404));
    // firm B's own lists never contain firm A rows
    expect((await b.get('/cases').query({ search: c.caseNumber })).body.items).toHaveLength(0);
    expect((await b.get('/reports/cases')).body.rows.every((r) => r.caseNumber.includes(B.firm.firm.firmCode))).toBe(true);
  }, 60_000);

  test('a client of firm A cannot read another client’s case of the same firm', async () => {
    const other = (await as(A.admin).post('/clients', { clientType: 'INDIVIDUAL', name: 'Other Client' })).body.client;
    const theirs = (await as(A.mk.token).post('/cases', { clientId: other.id, bankId: A.bank.id, categoryId: A.land.id })).body;
    expect((await as(A.client.token).get(`/cases/${theirs.id}`)).status).toBe(404);
    expect((await as(A.client.token).get(`/cases/${theirs.id}/documents`)).status).toBe(404);
    expect((await as(A.client.token).get('/cases')).body.items.every((x) => x.client.id === A.client.id)).toBe(true);
  });
});

describe('injection & XSS (VAPT IN-01..IN-04)', () => {
  test('SQL metacharacters in search / filters are inert', async () => {
    for (const s of ["' OR 1=1 --", '"; DROP TABLE valuation_cases; --', '%_\\', '\u0000']) {
      const r = await as(A.admin).get('/cases').query({ search: s });
      expect([200, 400]).toContain(r.status);
    }
    expect((await as(A.admin).get('/cases').query({ bankId: "1' OR '1'='1" })).status).toBe(400);
    expect(await prisma.valuationCase.count()).toBeGreaterThan(0);
  });

  test('stored script payloads are returned as inert JSON data, never as HTML', async () => {
    const xss = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const cl = await as(A.admin).post('/clients', { clientType: 'INDIVIDUAL', name: xss });
    expect(cl.status).toBe(201);
    const res = await as(A.admin).get(`/clients/${cl.body.client.id}`);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.body.name).toBe(xss); // stored verbatim; React escapes on render, emails are HTML-escaped
  });

  test('unknown properties are rejected (mass assignment), e.g. setting firmId or status on create', async () => {
    expect((await as(A.mk.token).post('/cases', { clientId: A.client.id, bankId: A.bank.id, categoryId: A.land.id, firmId: B.firm.firm.id })).status).toBe(400);
    expect((await as(A.mk.token).post('/cases', { clientId: A.client.id, bankId: A.bank.id, categoryId: A.land.id, status: 'CASE_COMPLETED' })).status).toBe(400);
    expect((await as(A.admin).patch(`/clients/${A.client.id}`, { firmId: B.firm.firm.id })).status).toBe(400);
  });
});

describe('files & information leakage (VAPT FU-01..FU-05, IL-01..IL-03)', () => {
  test('file links reject traversal and garbage tokens without revealing anything', async () => {
    for (const t of ['..%2f..%2fetc%2fpasswd', 'a.b', 'eyJrIjoiLi4vLi4vLmVudiJ9.x', 'x'.repeat(5000)]) {
      const r = await request(app).get(api(`/files/${t}`));
      expect(r.status).toBe(404);
      expect(JSON.stringify(r.body)).not.toMatch(/stack|storage|\.env|\\/i);
    }
  });

  test('S3 links are pre-signed and expire (no public URLs)', async () => {
    const { presignGet } = await import('../../src/services/storage/s3.driver.js');
    process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'AKIAEXAMPLEEXAMPLE00';
    process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'example-secret-for-offline-signing-only';
    const url = await presignGet('firms/f/cases/c/d/v1', { contentType: 'application/pdf', contentDisposition: 'attachment; filename="a.pdf"', expiresIn: 60, bucket: 'valuers-test-bucket' });
    expect(url).toMatch(/X-Amz-Expires=60/);
    expect(url).toMatch(/X-Amz-Signature=/);
  });

  test('errors never expose stack traces, SQL or internals; oversized bodies are refused', async () => {
    const bad = await as(A.admin).get('/cases/not-a-uuid');
    expect(bad.status).toBe(400);
    const big = await request(app).post(api('/auth/login')).set('Content-Type', 'application/json').send(JSON.stringify({ email: 'a@b.c', password: 'x'.repeat(2 * 1024 * 1024) }));
    expect(big.status).toBe(413);
    for (const r of [bad, big]) expect(JSON.stringify(r.body)).not.toMatch(/at \w+ \(|prisma|SELECT|node_modules/i);
  });

  test('uploads over the size limit are refused with 413 before reaching storage', async () => {
    const huge = Buffer.concat([PDF, Buffer.alloc(26 * 1024 * 1024)]);
    const r = await request(app).post(api(`/cases/${ids.caseId}/documents`)).set('Authorization', `Bearer ${A.admin}`).field('folder', 'SOURCE_FILES').attach('file', huge, 'huge.pdf');
    expect(r.status).toBe(413);
  }, 60_000);
});
