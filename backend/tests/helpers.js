import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/database/prisma.js';
import { hashPassword } from '../src/services/password.js';

export const app = createApp();
export const PASSWORD = 'Valuer#Strong2026';
export const uniq = () => randomUUID().slice(0, 8);
export const api = (path) => `/api/v1${path}`;

/** Extracts a cookie value from a Set-Cookie header list. */
export function cookieValue(res, name) {
  const c = (res.headers['set-cookie'] || []).find((x) => x.startsWith(`${name}=`));
  return c ? decodeURIComponent(c.split(';')[0].slice(name.length + 1)) : null;
}

/** Logs in and returns tokens plus a cookie header usable for refresh / logout. */
export async function login(email, password = PASSWORD, extra = {}) {
  const res = await request(app).post(api('/auth/login')).send({ email, password, ...extra });
  if (res.status !== 200) return { res };
  const refresh = cookieValue(res, 'valuers_rt');
  const csrf = cookieValue(res, 'valuers_csrf');
  return { res, token: res.body.accessToken, refresh, csrf, cookie: `valuers_rt=${refresh}; valuers_csrf=${csrf}` };
}

/** Authenticated request helper: as(token).get('/path') */
export const as = (token) => ({
  get: (p) => request(app).get(api(p)).set('Authorization', `Bearer ${token}`),
  post: (p, body) => request(app).post(api(p)).set('Authorization', `Bearer ${token}`).send(body),
  patch: (p, body) => request(app).patch(api(p)).set('Authorization', `Bearer ${token}`).send(body),
  put: (p, body) => request(app).put(api(p)).set('Authorization', `Bearer ${token}`).send(body),
  delete: (p) => request(app).delete(api(p)).set('Authorization', `Bearer ${token}`),
});

/** Token from a dev invite / reset URL (MAIL_PROVIDER=log in tests). */
export const tokenFromUrl = (url) => new URL(url).searchParams.get('token');

/** Direct DB bootstrap of an active Superadmin (the seed script path is exercised separately). */
export async function createSuperadmin() {
  const email = `sa-${uniq()}@platform.test`;
  await prisma.user.create({ data: { email, fullName: 'Test Superadmin', isSuperadmin: true, status: 'ACTIVE', passwordHash: await hashPassword(PASSWORD) } });
  const { token } = await login(email);
  return { email, token };
}

/** Accepts an invite with the standard test password. */
export async function acceptInvite(devInviteUrl) {
  return request(app).post(api('/auth/accept-invite')).send({ token: tokenFromUrl(devInviteUrl), password: PASSWORD });
}

/** Superadmin registers a firm; its admin accepts the invite and logs in. */
export async function createFirm(saToken, name = `Valuers ${uniq()}`) {
  const adminEmail = `admin-${uniq()}@firm.test`;
  const res = await as(saToken).post('/platform/firms', { name, email: `office-${uniq()}@firm.test`, city: 'Pune', admin: { fullName: 'Firm Admin', email: adminEmail } });
  if (res.status !== 201) throw new Error(`createFirm failed: ${res.status} ${JSON.stringify(res.body)}`);
  await acceptInvite(res.body.invite.devInviteUrl);
  const { token } = await login(adminEmail);
  return { firm: res.body.firm, adminEmail, adminToken: token };
}

/** Firm admin registers an employee with roles; the employee activates and logs in. */
export async function createEmployee(adminToken, roles, name = 'Employee') {
  const email = `emp-${uniq()}@firm.test`;
  const res = await as(adminToken).post('/employees', { fullName: name, email, roles });
  if (res.status !== 201) throw new Error(`createEmployee failed: ${res.status} ${JSON.stringify(res.body)}`);
  await acceptInvite(res.body.invite.devInviteUrl);
  const { token } = await login(email);
  return { employee: res.body.employee, email, token };
}

export { prisma, request };
