import { redis } from '../../src/database/redis.js';
import { acceptInvite, as, createEmployee, createFirm, createSuperadmin, login, prisma, uniq } from '../helpers.js';

let sa;
let A;
let B;
let mkA;
let foA;

beforeAll(async () => {
  sa = await createSuperadmin();
  A = await createFirm(sa.token, `Alpha Valuers ${uniq()}`);
  B = await createFirm(sa.token, `Beta Valuers ${uniq()}`);
  mkA = await createEmployee(A.adminToken, ['MARKETING'], 'Alpha Marketing');
  foA = await createEmployee(A.adminToken, ['FIELD_OFFICER'], 'Alpha Field Officer');
});

afterAll(async () => {
  await prisma.$disconnect();
  await redis.quit();
});

describe('platform administration', () => {
  test('firm codes are sequential and permanent; only Superadmin manages firms', async () => {
    const a = Number(A.firm.firmCode.slice(4));
    const b = Number(B.firm.firmCode.slice(4));
    expect(b).toBeGreaterThan(a);
    expect((await as(A.adminToken).get('/platform/firms')).status).toBe(403);
    expect((await as(mkA.token).post('/platform/firms', {})).status).toBe(403);
    const list = await as(sa.token).get('/platform/firms').query({ search: A.firm.firmCode });
    expect(list.body.items[0]).toMatchObject({ firmCode: A.firm.firmCode, counts: { employees: 3 } });
    const patch = await as(sa.token).patch(`/platform/firms/${A.firm.id}`, { firmCode: 'FIRM999' });
    expect(patch.status).toBe(400); // firm code is not an editable field
  });

  test('Superadmin has no firm data access', async () => {
    expect((await as(sa.token).get('/employees')).status).toBe(403);
    expect((await as(sa.token).get('/clients')).status).toBe(403);
    const summary = await as(sa.token).get('/platform/summary');
    expect(summary.status).toBe(200);
    expect(summary.body.firms.total).toBeGreaterThanOrEqual(2);
  });
});

describe('tenant isolation', () => {
  test("firm B cannot read or modify firm A's employees and clients (404, not 403)", async () => {
    const client = await as(A.adminToken).post('/clients', { clientType: 'PRIVATE_LIMITED', name: 'ABC Industries Pvt Ltd' });
    expect(client.status).toBe(201);
    const clientId = client.body.client.id;

    expect((await as(B.adminToken).get(`/clients/${clientId}`)).status).toBe(404);
    expect((await as(B.adminToken).patch(`/clients/${clientId}`, { name: 'Hijacked' })).status).toBe(404);
    expect((await as(B.adminToken).post(`/clients/${clientId}/deactivate`)).status).toBe(404);
    expect((await as(B.adminToken).get(`/employees/${mkA.employee.id}`)).status).toBe(404);
    expect((await as(B.adminToken).post(`/employees/${mkA.employee.id}/deactivate`)).status).toBe(404);

    const bClients = await as(B.adminToken).get('/clients');
    expect(bClients.body.items.find((c) => c.id === clientId)).toBeUndefined();
    const bEmployees = await as(B.adminToken).get('/employees');
    expect(bEmployees.body.items).toHaveLength(1); // only B's own admin
  });

  test('audit logs are firm-scoped', async () => {
    const a = await as(A.adminToken).get('/firm/audit-logs').query({ pageSize: 100 });
    expect(a.status).toBe(200);
    expect(a.body.items.every((r) => r.firmId === A.firm.id)).toBe(true);
    const forced = await as(A.adminToken).get('/firm/audit-logs').query({ firmId: B.firm.id });
    expect(forced.status).toBe(400); // firmId is not accepted from firm users
  });

  test('per-firm codes are independent and gap-free under concurrency', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => as(B.adminToken).post('/clients', { clientType: 'INDIVIDUAL', name: `Concurrent ${i}` })));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const codes = results.map((r) => Number(r.body.client.clientCode.slice(4))).sort((x, y) => x - y);
    expect(new Set(codes).size).toBe(12);
    expect(codes[11] - codes[0]).toBe(11);
  });
});

describe('role-based access', () => {
  test('marketing manages clients but not employees, RBAC or audit', async () => {
    expect((await as(mkA.token).post('/clients', { clientType: 'INDIVIDUAL', name: 'Ravi Kumar' })).status).toBe(201);
    expect((await as(mkA.token).get('/employees')).status).toBe(403);
    expect((await as(mkA.token).post('/employees', { fullName: 'X', email: `x-${uniq()}@t.test`, roles: ['FIRM_ADMIN'] })).status).toBe(403);
    expect((await as(mkA.token).get('/firm/rbac')).status).toBe(403);
    expect((await as(mkA.token).get('/firm/audit-logs')).status).toBe(403);
  });

  test('field officer sees no clients until cases are assigned, and cannot create any', async () => {
    const res = await as(foA.token).get('/clients');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
    expect((await as(foA.token).post('/clients', { clientType: 'INDIVIDUAL', name: 'Nope' })).status).toBe(403);
  });

  test('admin cannot lock themselves out; the firm keeps at least one admin', async () => {
    const me = await as(A.adminToken).get('/auth/me');
    const self = me.body.employee.id;
    expect((await as(A.adminToken).post(`/employees/${self}/deactivate`)).status).toBe(400);
    expect((await as(A.adminToken).patch(`/employees/${self}`, { roles: ['MARKETING'] })).status).toBe(400);
  });

  test('a firm can revoke a non-critical permission; critical ones are fixed; other firms unaffected', async () => {
    const mkB = await createEmployee(B.adminToken, ['MARKETING']);
    const off = await as(A.adminToken).put('/firm/rbac', { roleCode: 'MARKETING', permissionCode: 'client.manage', granted: false });
    expect(off.status).toBe(200);
    expect((await as(mkA.token).post('/clients', { clientType: 'INDIVIDUAL', name: 'Blocked' })).status).toBe(403);
    expect((await as(mkB.token).post('/clients', { clientType: 'INDIVIDUAL', name: 'Allowed' })).status).toBe(201);
    expect((await as(A.adminToken).put('/firm/rbac', { roleCode: 'JUNIOR_REVIEWER', permissionCode: 'valuation.approve', granted: true })).status).toBe(400);
    expect((await as(A.adminToken).put('/firm/rbac', { roleCode: 'MARKETING', permissionCode: 'client.manage', granted: true })).status).toBe(200);
    expect((await as(mkA.token).post('/clients', { clientType: 'INDIVIDUAL', name: 'Allowed again' })).status).toBe(201);
  });

  test('deactivating an employee cuts off their access immediately', async () => {
    const emp = await createEmployee(A.adminToken, ['JUNIOR_REVIEWER']);
    expect((await as(emp.token).get('/auth/me')).status).toBe(200);
    expect((await as(A.adminToken).post(`/employees/${emp.employee.id}/deactivate`)).status).toBe(200);
    expect((await as(emp.token).get('/auth/me')).status).toBe(401);
    expect((await login(emp.email)).res.status).toBe(401);
    expect((await as(A.adminToken).post(`/employees/${emp.employee.id}/reactivate`)).status).toBe(200);
    expect((await login(emp.email)).res.status).toBe(200);
  });

  test('suspending a firm signs out all of its users', async () => {
    const C = await createFirm(sa.token, `Gamma Valuers ${uniq()}`);
    expect((await as(sa.token).post(`/platform/firms/${C.firm.id}/status`, { status: 'SUSPENDED', reason: 'Subscription unpaid' })).status).toBe(200);
    expect((await as(C.adminToken).get('/auth/me')).status).toBe(401);
    expect((await login(C.adminEmail)).res.status).toBe(401);
  });
});

describe('clients: PAN protection & portal', () => {
  test('PAN is encrypted, masked in responses, unique per firm and searchable by exact value', async () => {
    const pan = 'ABCDE1234F';
    const res = await as(A.adminToken).post('/clients', { clientType: 'INDIVIDUAL', name: 'Pan Holder', pan: pan.toLowerCase() });
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toContain(pan);
    expect(res.body.client.panMasked).toBe('XXXXXX234F');
    const row = await prisma.client.findUnique({ where: { id: res.body.client.id } });
    expect(row.panEnc.toString('utf8')).not.toContain(pan);

    const dup = await as(A.adminToken).post('/clients', { clientType: 'INDIVIDUAL', name: 'Dup', pan });
    expect(dup.status).toBe(409);
    expect((await as(B.adminToken).post('/clients', { clientType: 'INDIVIDUAL', name: 'Same PAN other firm', pan })).status).toBe(201);
    const found = await as(A.adminToken).get('/clients').query({ search: pan });
    expect(found.body.items.map((c) => c.id)).toEqual([res.body.client.id]);
  });

  test('client portal login sees only its own record', async () => {
    const email = `client-${uniq()}@mail.test`;
    const created = await as(A.adminToken).post('/clients', { clientType: 'PROPRIETORSHIP', name: 'Portal Client', email, createPortalLogin: true });
    expect(created.status).toBe(201);
    await acceptInvite(created.body.portal.devInviteUrl);
    const { token } = await login(email);
    const me = await as(token).get('/auth/me');
    expect(me.body.context.roles.map((r) => r.code)).toEqual(['CLIENT']);
    expect(me.body.context.permissions).toContain('portal.access');
    expect((await as(token).get('/employees')).status).toBe(403);
    expect((await as(token).get('/clients')).status).toBe(403);
  });
});
