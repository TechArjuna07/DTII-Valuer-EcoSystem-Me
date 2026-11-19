import jwt from 'jsonwebtoken';
import { redis } from '../../src/database/redis.js';
import { PASSWORD, api, app, as, createEmployee, createFirm, createSuperadmin, login, prisma, request, tokenFromUrl, uniq } from '../helpers.js';

let sa;
let firm;

beforeAll(async () => {
  sa = await createSuperadmin();
  firm = await createFirm(sa.token);
});

afterAll(async () => {
  await prisma.$disconnect();
  await redis.quit();
});

describe('login', () => {
  test('sets an HttpOnly, SameSite=Strict refresh cookie scoped to /api/v1/auth, plus a CSRF cookie', async () => {
    const { res } = await login(firm.adminEmail);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    const rt = res.headers['set-cookie'].find((c) => c.startsWith('valuers_rt='));
    expect(rt).toMatch(/HttpOnly/i);
    expect(rt).toMatch(/SameSite=Strict/i);
    expect(rt).toMatch(/Path=\/api\/v1\/auth/);
    const csrf = res.headers['set-cookie'].find((c) => c.startsWith('valuers_csrf='));
    expect(csrf).not.toMatch(/HttpOnly/i);
    expect(JSON.stringify(res.body)).not.toMatch(/refresh/i);
  });

  test('unknown email and wrong password give the identical answer (no enumeration)', async () => {
    const a = await request(app).post(api('/auth/login')).send({ email: `nobody-${uniq()}@x.test`, password: 'Whatever#123' });
    const b = await request(app).post(api('/auth/login')).send({ email: firm.adminEmail, password: 'Wrong#Password1' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.message).toBe(b.body.message);
  });

  test('unknown fields are rejected (mass assignment defence)', async () => {
    const res = await request(app).post(api('/auth/login')).send({ email: firm.adminEmail, password: PASSWORD, isSuperadmin: true });
    expect(res.status).toBe(400);
  });

  test('locks the account after 5 failures — even the right password fails — until an admin unlocks', async () => {
    const emp = await createEmployee(firm.adminToken, ['MARKETING']);
    for (let i = 0; i < 5; i += 1) expect((await login(emp.email, 'Wrong#Password1')).res.status).toBe(401);
    const locked = await login(emp.email);
    expect(locked.res.status).toBe(401);
    expect(locked.res.body.message).toBe('Invalid email or password');

    expect((await as(firm.adminToken).post(`/employees/${emp.employee.id}/unlock`)).status).toBe(200);
    expect((await login(emp.email)).res.status).toBe(200);
    const actions = await prisma.auditLog.findMany({ where: { actorId: (await prisma.user.findUnique({ where: { email: emp.email } })).id }, select: { action: true } });
    expect(actions.map((a) => a.action)).toEqual(expect.arrayContaining(['ACCOUNT_LOCKED', 'LOGIN_BLOCKED_LOCKED']));
  });
});

describe('access token', () => {
  test('/auth/me returns context, roles and permissions', async () => {
    const res = await as(firm.adminToken).get('/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.context.type).toBe('FIRM');
    expect(res.body.context.firm.firmCode).toMatch(/^FIRM\d{3,}$/);
    expect(res.body.context.roles.map((r) => r.code)).toEqual(['FIRM_ADMIN']);
    expect(res.body.context.permissions).toContain('employee.manage');
    expect(res.body.context.permissions).not.toContain('platform.firms.manage');
    expect(res.body.employee.employeeCode).toBe('EMP-000001');
  });

  test('rejects missing, tampered, alg:none and wrongly-signed tokens', async () => {
    expect((await request(app).get(api('/auth/me'))).status).toBe(401);
    const [h, p] = firm.adminToken.split('.');
    const none = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${p}.`;
    expect((await as(none).get('/auth/me')).status).toBe(401);
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    const tampered = `${h}.${Buffer.from(JSON.stringify({ ...claims, fid: null })).toString('base64url')}.${firm.adminToken.split('.')[2]}`;
    expect((await as(tampered).get('/auth/me')).status).toBe(401);
    const forged = jwt.sign({ sid: claims.sid, fid: claims.fid }, 'x'.repeat(64), { subject: claims.sub, issuer: claims.iss, audience: claims.aud });
    expect((await as(forged).get('/auth/me')).status).toBe(401);
  });
});

describe('refresh rotation', () => {
  test('requires the CSRF header and an allowed Origin', async () => {
    const s = await login(firm.adminEmail);
    expect((await request(app).post(api('/auth/refresh')).set('Cookie', s.cookie)).status).toBe(403);
    expect((await request(app).post(api('/auth/refresh')).set('Cookie', s.cookie).set('X-CSRF-Token', 'wrong')).status).toBe(403);
    const evil = await request(app).post(api('/auth/refresh')).set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf).set('Origin', 'https://evil.test');
    expect(evil.status).toBe(403);
  });

  test('rotates the refresh token; replaying the old one after the grace window revokes the whole family', async () => {
    const s = await login(firm.adminEmail);
    const r1 = await request(app).post(api('/auth/refresh')).set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf);
    expect(r1.status).toBe(200);
    const newRefresh = r1.headers['set-cookie'].find((c) => c.startsWith('valuers_rt=')).split(';')[0].slice('valuers_rt='.length);
    expect(newRefresh).not.toBe(s.refresh);

    // Concurrent tab within the grace window: access token, no new cookie, nothing revoked.
    const grace = await request(app).post(api('/auth/refresh')).set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf);
    expect(grace.status).toBe(200);

    // Simulate the attacker replaying the stolen token later.
    await prisma.$executeRaw`UPDATE user_sessions SET rotated_at = now() - interval '5 minutes' WHERE rotated_at IS NOT NULL AND user_id = (SELECT id FROM users WHERE email = ${firm.adminEmail})`;
    const replay = await request(app).post(api('/auth/refresh')).set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf);
    expect(replay.status).toBe(401);
    const victim = await request(app).post(api('/auth/refresh')).set('Cookie', `valuers_rt=${newRefresh}; valuers_csrf=${s.csrf}`).set('X-CSRF-Token', s.csrf);
    expect(victim.status).toBe(401);
    expect(await prisma.auditLog.count({ where: { action: 'TOKEN_REUSE_DETECTED' } })).toBeGreaterThan(0);
  });

  test('logout revokes the session', async () => {
    const s = await login(firm.adminEmail);
    expect((await request(app).post(api('/auth/logout')).set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf)).status).toBe(204);
    expect((await request(app).post(api('/auth/refresh')).set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf)).status).toBe(401);
    expect((await as(s.token).get('/auth/me')).status).toBe(401);
  });
});

describe('password reset & invites', () => {
  test('forgot-password answers identically for unknown emails; reset link works once', async () => {
    const emp = await createEmployee(firm.adminToken, ['FIELD_OFFICER']);
    const unknown = await request(app).post(api('/auth/forgot-password')).send({ email: `ghost-${uniq()}@x.test` });
    const known = await request(app).post(api('/auth/forgot-password')).send({ email: emp.email });
    expect(unknown.status).toBe(202);
    expect(known.status).toBe(202);
    expect(known.body.message).toBe(unknown.body.message);

    const token = tokenFromUrl(known.body.devResetUrl);
    const info = await request(app).get(api('/auth/token-info')).query({ token, purpose: 'PASSWORD_RESET' });
    expect(info.status).toBe(200);
    expect(info.body.email).toMatch(/\*/);

    const weak = await request(app).post(api('/auth/reset-password')).send({ token, password: 'short' });
    expect(weak.status).toBe(400);
    const newPassword = 'Another#Strong2026';
    expect((await request(app).post(api('/auth/reset-password')).send({ token, password: newPassword })).status).toBe(200);
    expect((await request(app).post(api('/auth/reset-password')).send({ token, password: 'Third#Strong2026' })).status).toBe(400);
    expect((await as(emp.token).get('/auth/me')).status).toBe(401); // sessions revoked
    expect((await login(emp.email)).res.status).toBe(401);
    expect((await login(emp.email, newPassword)).res.status).toBe(200);
  });

  test('an invite token cannot be used as a reset token (purpose bound)', async () => {
    const res = await as(firm.adminToken).post('/employees', { fullName: 'Purpose Test', email: `p-${uniq()}@firm.test`, roles: ['MARKETING'] });
    const token = tokenFromUrl(res.body.invite.devInviteUrl);
    expect((await request(app).post(api('/auth/reset-password')).send({ token, password: PASSWORD })).status).toBe(400);
    expect((await request(app).post(api('/auth/accept-invite')).send({ token, password: PASSWORD })).status).toBe(200);
  });

  test('change password keeps this device and signs out the others', async () => {
    const emp = await createEmployee(firm.adminToken, ['MARKETING']);
    const other = await login(emp.email);
    const res = await as(emp.token).post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'Changed#Pass2026' });
    expect(res.status).toBe(200);
    expect((await as(emp.token).get('/auth/me')).status).toBe(200);
    expect((await as(other.token).get('/auth/me')).status).toBe(401);
  });

  test('lists devices and signs one out', async () => {
    const emp = await createEmployee(firm.adminToken, ['MARKETING']);
    const second = await login(emp.email);
    const list = await as(emp.token).get('/auth/sessions');
    expect(list.body.items).toHaveLength(2);
    const target = list.body.items.find((s) => !s.current);
    expect((await as(emp.token).delete(`/auth/sessions/${target.id}`)).status).toBe(204);
    expect((await as(second.token).get('/auth/me')).status).toBe(401);
    expect((await as(emp.token).get('/auth/me')).status).toBe(200);
  });
});
