import { redis } from '../../src/database/redis.js';
import { testJobs } from '../../src/jobs/queues.js';
import { runSlaSweep } from '../../src/jobs/maintenance.js';
import { processMailJob } from '../../src/modules/notifications/notifications.service.js';
import { closeRenderer } from '../../src/services/pdf/pdf-renderer.js';
import { as, prisma } from '../helpers.js';
import { completeInspection, createCaseWithTeam, setupFirm } from '../fixtures.js';

let fx;
const userId = async (email) => (await prisma.user.findUnique({ where: { email } })).id;

/** Event listeners run after the response; wait until the expected notification appears. */
async function waitFor(fn, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 100));
  }
}

beforeAll(async () => {
  fx = await setupFirm();
}, 60_000);

afterAll(async () => {
  await closeRenderer();
  await prisma.$disconnect();
  await redis.quit();
});

describe('workflow notifications', () => {
  test('case events notify the right people (in-app + queued email), never the actor', async () => {
    const c = await createCaseWithTeam(fx);
    const foId = await userId(fx.fo.email);
    const assigned = await waitFor(() => prisma.notification.findFirst({ where: { recipientId: foId, caseId: c.id, event: 'ASSIGNED_FIELD' } }));
    expect(assigned.title).toBe('Inspection assigned');
    expect(assigned.link).toBe(`/cases/${c.id}?tab=inspection`);
    const adminId = await userId(fx.firm.adminEmail);
    await waitFor(() => prisma.notification.findFirst({ where: { recipientId: adminId, caseId: c.id, event: 'CASE_RECEIVED' } }));
    expect(await prisma.notification.count({ where: { recipientId: await userId(fx.mk.email), event: 'CASE_RECEIVED', caseId: c.id } })).toBe(0); // the creator

    await as(fx.fo.token).post(`/cases/${c.id}/inspection/schedule`, { scheduledAt: new Date(Date.now() + 86_400_000).toISOString() });
    const clientUserId = (await prisma.client.findUnique({ where: { id: fx.client.id } })).userId;
    await waitFor(() => prisma.notification.findFirst({ where: { recipientId: clientUserId, caseId: c.id, event: 'INSPECTION_SCHEDULED' } }));

    await completeInspection(fx, c.id);
    const jrId = await userId(fx.jr.email);
    const jr = await waitFor(() => prisma.notification.findFirst({ where: { recipientId: jrId, caseId: c.id, event: 'INSPECTION_COMPLETED' } }));
    expect(jr.body).toMatch(c.caseNumber);

    // Emails are queued with a delivery log; the processor delivers and records the outcome.
    const log = await prisma.emailLog.findFirst({ where: { notificationId: jr.id } });
    expect(log).toMatchObject({ status: 'QUEUED', template: 'INSPECTION_COMPLETED' });
    expect(log.toMasked).toMatch(/\*/);
    const job = testJobs.find((j) => j.queue === 'mail' && j.data.emailLogId === log.id);
    expect(job.data.html).toContain(c.caseNumber);
    await processMailJob(job.data, 0);
    expect((await prisma.emailLog.findUnique({ where: { id: log.id } })).status).toBe('SENT');
  }, 120_000);

  test('the notifications API lists, counts and marks read only my own notifications', async () => {
    const c = await createCaseWithTeam(fx);
    const foId = await userId(fx.fo.email);
    await waitFor(() => prisma.notification.findFirst({ where: { recipientId: foId, caseId: c.id } }));
    const count = await as(fx.fo.token).get('/notifications/unread-count');
    expect(count.body.unread).toBeGreaterThan(0);
    const list = await as(fx.fo.token).get('/notifications');
    expect(list.body.items.every((n) => n.recipientId === foId)).toBe(true);
    const someoneElse = await prisma.notification.findFirst({ where: { recipientId: { not: foId } } });
    expect((await as(fx.fo.token).post(`/notifications/${someoneElse.id}/read`)).status).toBe(404);
    expect((await as(fx.fo.token).post('/notifications/read-all')).status).toBe(204);
    expect((await as(fx.fo.token).get('/notifications/unread-count')).body.unread).toBe(0);
  }, 60_000);
});

describe('firm SMTP settings', () => {
  test('secrets are write-only and encrypted; only the Firm Admin manages them', async () => {
    expect((await as(fx.mk.token).get('/firm/smtp')).status).toBe(403);
    expect((await as(fx.admin).put('/firm/smtp', { provider: 'gmail', user: 'office@gmail.com' })).status).toBe(400); // app password required
    const set = await as(fx.admin).put('/firm/smtp', { provider: 'gmail', user: 'office@gmail.com', from: 'Valuers <office@gmail.com>', secret: 'abcd efgh ijkl mnop' });
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ provider: 'gmail', hasSecret: true });
    expect(JSON.stringify(set.body)).not.toContain('abcd efgh');
    const row = await prisma.organizationSettings.findUnique({ where: { firmId: fx.firm.firm.id } });
    expect(row.smtpSecretEnc.toString('utf8')).not.toContain('abcd');
    expect((await as(fx.admin).put('/firm/smtp', { provider: 'platform' })).body.hasSecret).toBe(false);
  });
});

describe('SLA / overdue sweep', () => {
  test('flags cases past their due date or TAT once, and notifies the firm admin', async () => {
    const c = await createCaseWithTeam(fx);
    const saved = await as(fx.admin).put('/masters/workflow-settings', { slaHours: { INSPECTION_ASSIGNED: 1 }, options: { autoAssign: 'MANUAL', requireSourceDocument: false, minInspectionPhotos: 3 } });
    expect(saved.status).toBe(200);
    expect(saved.body.slaHours).toEqual({ INSPECTION_ASSIGNED: 1 });
    expect(await runSlaSweep(new Date(Date.now() + 2 * 3_600_000))).toBeGreaterThanOrEqual(1);
    expect((await prisma.valuationCase.findUnique({ where: { id: c.id } })).isOverdue).toBe(true);
    expect(await runSlaSweep(new Date(Date.now() + 2 * 3_600_000))).toBe(0); // only once
    await waitFor(() => prisma.notification.findFirst({ where: { caseId: c.id, event: 'CASE_OVERDUE' } }));
    const list = await as(fx.admin).get('/cases').query({ overdue: 'true', pageSize: 100 });
    expect(list.body.items.map((x) => x.id)).toContain(c.id);
    await as(fx.admin).put('/masters/workflow-settings', { slaHours: {}, options: { autoAssign: 'MANUAL', requireSourceDocument: false, minInspectionPhotos: 3 } });
  }, 60_000);
});

describe('dashboards & reports', () => {
  test('dashboards are role-specific and scoped; the CSV export neutralises spreadsheet formulas', async () => {
    const admin = await as(fx.admin).get('/dashboard');
    expect(admin.body.role).toBe('FIRM_ADMIN');
    expect(admin.body.tiles.total).toBeGreaterThanOrEqual(3);
    expect(admin.body.workload.length).toBeGreaterThan(0);
    const jr = await as(fx.jr.token).get('/dashboard');
    expect(jr.body.role).toBe('JUNIOR_REVIEWER');
    expect(jr.body.tiles.pendingReviews).toBeGreaterThanOrEqual(1);
    expect((await as(fx.mk.token).get('/dashboard')).body.role).toBe('MARKETING');
    expect((await as(fx.client.token).get('/dashboard')).status).toBe(403);
    const sa = await as(fx.sa.token).get('/platform/case-stats');
    expect(sa.body.total).toBeGreaterThan(0);
    expect(JSON.stringify(sa.body)).not.toMatch(/ABC Industries/);

    await as(fx.admin).patch(`/clients/${fx.client.id}`, { name: '=HYPERLINK("http://evil.test","x")' });
    const csv = await as(fx.admin).get('/reports/cases').query({ format: 'csv' });
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain("'=HYPERLINK");
    expect(csv.text.split('\r\n')[0]).toContain('Case ID');
    const json = await as(fx.jr.token).get('/reports/cases');
    expect(json.body.rows.every((r) => r.juniorReviewer === 'Juhi Junior')).toBe(true);
  }, 60_000);
});
