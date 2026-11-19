import request from 'supertest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/database/prisma.js';
import { redis } from '../../src/database/redis.js';
import { seedReferenceData } from '../../prisma/seed/index.js';
import { PERMISSION_DEFINITIONS, ROLE_DEFINITIONS } from '../../src/config/rbac.js';

const app = createApp();

afterAll(async () => {
  await prisma.$disconnect();
  await redis.quit();
});

describe('health & HTTP hardening', () => {
  test('GET /health/live', async () => {
    const res = await request(app).get('/api/v1/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  test('GET /health/ready reports PostgreSQL and Redis up', async () => {
    const res = await request(app).get('/api/v1/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', checks: { database: 'up', redis: 'up' } });
  });

  test('security headers, no caching, request id, no x-powered-by', async () => {
    const res = await request(app).get('/api/v1/health/live');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('a well-formed incoming request id is echoed; a malicious one is replaced', async () => {
    expect((await request(app).get('/api/v1/health/live').set('X-Request-Id', 'trace-12345678')).headers['x-request-id']).toBe('trace-12345678');
    const bad = await request(app).get('/api/v1/health/live').set('X-Request-Id', '<script>alert(1)</script>');
    expect(bad.headers['x-request-id']).not.toContain('<');
  });

  test('unknown routes return a JSON 404 without internals', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ statusCode: 404, error: 'NOT_FOUND', message: 'Route not found' });
  });

  test('malformed JSON is a clean 400', async () => {
    const res = await request(app).post('/api/v1/health/live').set('Content-Type', 'application/json').send('{"broken":');
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Malformed request body');
  });

  test('CORS allows only configured origins', async () => {
    const ok = await request(app).get('/api/v1/health/live').set('Origin', 'http://localhost:3100');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3100');
    const evil = await request(app).get('/api/v1/health/live').set('Origin', 'https://evil.example');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('database baseline', () => {
  test('reference seed is complete and idempotent', async () => {
    await seedReferenceData(prisma);
    await seedReferenceData(prisma);
    expect(await prisma.role.count()).toBe(ROLE_DEFINITIONS.length);
    expect(await prisma.permission.count()).toBe(PERMISSION_DEFINITIONS.length);
    const links = PERMISSION_DEFINITIONS.reduce((n, p) => n + p.roles.length, 0);
    expect(await prisma.rolePermission.count()).toBe(links);
    expect(await prisma.financialYear.findUnique({ where: { code: '2026-27' } })).toMatchObject({ shortCode: '2627' });
  });

  test('audit_logs is append-only for the runtime role', async () => {
    const row = await prisma.auditLog.create({ data: { action: 'TEST_APPEND_ONLY', meta: { test: true } } });
    await expect(prisma.auditLog.update({ where: { id: row.id }, data: { action: 'TAMPERED' } })).rejects.toThrow();
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe('TRUNCATE audit_logs')).rejects.toThrow();
    expect((await prisma.auditLog.findUnique({ where: { id: row.id } })).action).toBe('TEST_APPEND_ONLY');
  });

  test('firm code is generated from a sequence, format-checked and immutable', async () => {
    const [{ n }] = await prisma.$queryRaw`SELECT nextval('organization_code_seq')::int AS n`;
    const firmCode = `FIRM${String(n).padStart(3, '0')}`;
    const org = await prisma.organization.create({ data: { firmCode, name: 'Integration Test Valuers', email: `it-${n}@example.com` } });
    await expect(prisma.organization.update({ where: { id: org.id }, data: { firmCode: 'FIRM999999' } })).rejects.toThrow();
    await expect(prisma.organization.create({ data: { firmCode: 'ABC', name: 'Bad', email: 'bad@example.com' } })).rejects.toThrow();
    const ok = await prisma.organization.update({ where: { id: org.id }, data: { name: 'Renamed Valuers' } });
    expect(ok.firmCode).toBe(firmCode);
  });

  test('emails are case-insensitive (citext)', async () => {
    const email = `Case.Test.${Date.now()}@Example.com`;
    await prisma.user.create({ data: { email, fullName: 'Case Test' } });
    expect(await prisma.user.findUnique({ where: { email: email.toLowerCase() } })).not.toBeNull();
    await expect(prisma.user.create({ data: { email: email.toUpperCase(), fullName: 'Dup' } })).rejects.toThrow();
  });
});

describe('rate limiting', () => {
  test('a Redis-backed limiter answers 429 with a JSON body once the budget is spent', async () => {
    const { default: express } = await import('express');
    const { createLimiter } = await import('../../src/middleware/rate-limit.js');
    const mini = express();
    mini.get('/x', createLimiter(`test-${Date.now()}`, 2), (_req, res) => res.json({ ok: true }));
    expect((await request(mini).get('/x')).status).toBe(200);
    expect((await request(mini).get('/x')).status).toBe(200);
    const blocked = await request(mini).get('/x');
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ statusCode: 429, error: 'TOO_MANY_REQUESTS' });
    expect(blocked.headers.ratelimit).toBeDefined();
  });
});
