import { redis } from '../../src/database/redis.js';
import { currentFinancialYear } from '../../src/utils/financial-year.js';
import { as, createEmployee, createFirm, createSuperadmin, prisma, uniq } from '../helpers.js';

let A;
let B;
let mk;
let fo;
let fo2;
let jr;
let sr;
let bank;
let client;
let landCategory;

const newCase = (token, extra = {}) => as(token).post('/cases', { clientId: client.id, bankId: bank.id, categoryId: landCategory.id, loanAmount: 5000000, propertyCity: 'Pune', ...extra });

beforeAll(async () => {
  const sa = await createSuperadmin();
  A = await createFirm(sa.token, `Case Valuers ${uniq()}`);
  B = await createFirm(sa.token, `Other Valuers ${uniq()}`);
  [mk, fo, fo2, jr, sr] = await Promise.all([
    createEmployee(A.adminToken, ['MARKETING'], 'Meera Marketing'),
    createEmployee(A.adminToken, ['FIELD_OFFICER'], 'Farhan Field'),
    createEmployee(A.adminToken, ['FIELD_OFFICER'], 'Second Field'),
    createEmployee(A.adminToken, ['JUNIOR_REVIEWER'], 'Juhi Junior'),
    createEmployee(A.adminToken, ['SENIOR_REVIEWER'], 'Sanjay Senior'),
  ]);
  bank = (await as(A.adminToken).post('/masters/banks', { institutionType: 'BANK', name: 'HDFC Bank', shortCode: 'HDFC', branch: 'FC Road, Pune', ifsc: 'HDFC0000123' })).body;
  client = (await as(A.adminToken).post('/clients', { clientType: 'PRIVATE_LIMITED', name: 'ABC Industries Pvt Ltd' })).body.client;
  landCategory = (await as(A.adminToken).get('/masters/categories')).body.items.find((c) => c.code === 'LAND_BUILDING');
});

afterAll(async () => {
  await prisma.$disconnect();
  await redis.quit();
});

describe('masters', () => {
  test('platform categories come with configurable fields; firms can add their own but not edit platform ones', async () => {
    expect(landCategory.fields.map((f) => f.key)).toEqual(expect.arrayContaining(['propertyType', 'landArea', 'builtUpArea']));
    expect((await as(A.adminToken).put(`/masters/categories/${landCategory.id}/fields`, { key: 'hack', section: 'X', label: 'X', type: 'TEXT' })).status).toBe(400);
    const own = await as(A.adminToken).post('/masters/categories', { code: 'SOLAR_PLANT', name: 'Solar Plant', engine: 'PLANT_MACHINERY' });
    expect(own.status).toBe(201);
    const withField = await as(A.adminToken).put(`/masters/categories/${own.body.id}/fields`, { key: 'panelCount', section: 'Plant', label: 'Number of panels', type: 'NUMBER', required: true });
    expect(withField.body.fields.map((f) => f.key)).toEqual(['panelCount']);
    expect(withField.body.fieldsVersion).toBe(2);
    expect((await as(B.adminToken).get(`/masters/categories/${own.body.id}`)).status).toBe(404);
  });

  test('bank master is firm-scoped and duplicate branches are rejected', async () => {
    expect((await as(A.adminToken).post('/masters/banks', { institutionType: 'BANK', name: 'hdfc bank', shortCode: 'HDFC', branch: 'fc road, pune' })).status).toBe(409);
    expect((await as(B.adminToken).get(`/masters/banks/${bank.id}`)).status).toBe(404);
    expect((await as(mk.token).post('/masters/banks', { institutionType: 'NBFC', name: 'X', shortCode: 'XX' })).status).toBe(403);
    expect((await as(mk.token).get('/masters/banks')).status).toBe(200);
  });
});

describe('case creation and Case ID', () => {
  test('generates VAL-<firm>-FY<yy><yy>-000001 and links client, bank, FY and category', async () => {
    const res = await newCase(mk.token);
    expect(res.status).toBe(201);
    const fy = currentFinancialYear();
    expect(res.body.caseNumber).toBe(`VAL-${A.firm.firmCode}-FY${fy.shortCode}-000001`);
    expect(res.body.status).toBe('CASE_RECEIVED');
    expect(res.body.financialYear.code).toBe(fy.code);
    expect(res.body.assignees.MARKETING.name).toBe('Meera Marketing');
    expect(res.body.repositoryLabel).toBe(`${res.body.caseNumber}_HDFC`);
    const tl = await as(mk.token).get(`/cases/${res.body.id}/timeline`);
    expect(tl.body.items.map((i) => i.action)).toEqual(['CASE_CREATED', 'CASE_ID_GENERATED', 'EMPLOYEE_ASSIGNED']);
  });

  test('50 concurrent creations get 50 unique, consecutive Case IDs; the same client may have many cases', async () => {
    const results = await Promise.all(Array.from({ length: 50 }, () => newCase(A.adminToken)));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const seqs = results.map((r) => Number(r.body.caseNumber.split('-').pop())).sort((a, b) => a - b);
    expect(new Set(seqs).size).toBe(50);
    expect(seqs[49] - seqs[0]).toBe(49);
    const count = await prisma.valuationCase.count({ where: { clientId: client.id } });
    expect(count).toBeGreaterThanOrEqual(51);
  });

  test('Case ID is permanent: the database rejects edits and deletes', async () => {
    const c = (await newCase(A.adminToken)).body;
    await expect(prisma.valuationCase.update({ where: { id: c.id }, data: { caseNumber: 'VAL-FIRM999-FY2627-000999' } })).rejects.toThrow();
    await expect(prisma.valuationCase.delete({ where: { id: c.id } })).rejects.toThrow();
    await expect(prisma.caseActivity.updateMany({ where: { caseId: c.id }, data: { action: 'TAMPERED' } })).rejects.toThrow();
  });

  test("references from another firm are rejected, and other firms cannot see the case", async () => {
    const bClient = (await as(B.adminToken).post('/clients', { clientType: 'INDIVIDUAL', name: 'B client' })).body.client;
    expect((await newCase(A.adminToken, { clientId: bClient.id })).status).toBe(400);
    const c = (await newCase(A.adminToken)).body;
    expect((await as(B.adminToken).get(`/cases/${c.id}`)).status).toBe(404);
    expect((await as(B.adminToken).post(`/cases/${c.id}/transitions`, { action: 'HOLD', remarks: 'x x x' })).status).toBe(404);
    expect((await as(fo.token).post('/cases', { clientId: client.id, bankId: bank.id, categoryId: landCategory.id })).status).toBe(403);
  });
});

describe('assignments and workflow rules', () => {
  test('field officer sees only cases assigned to them; assigning moves the case to INSPECTION_ASSIGNED', async () => {
    const c = (await newCase(mk.token)).body;
    expect((await as(fo.token).get(`/cases/${c.id}`)).status).toBe(404);
    const assigned = await as(mk.token).post(`/cases/${c.id}/assignments`, { stage: 'FIELD', employeeId: fo.employee.id });
    expect(assigned.status).toBe(200);
    expect(assigned.body.status).toBe('INSPECTION_ASSIGNED');
    const seen = await as(fo.token).get(`/cases/${c.id}`);
    expect(seen.status).toBe(200);
    expect(seen.body.allowedActions.map((a) => a.action)).toContain('START_INSPECTION');
    expect((await as(fo2.token).get(`/cases/${c.id}`)).status).toBe(404);
    const foList = await as(fo.token).get('/cases');
    expect(foList.body.items.every((x) => x.assignees.FIELD?.id === fo.employee.id)).toBe(true);
    expect((await as(fo.token).get(`/clients/${client.id}`)).status).toBe(200); // client of an assigned case

    // Reassignment ends the old assignment and moves visibility.
    await as(mk.token).post(`/cases/${c.id}/assignments`, { stage: 'FIELD', employeeId: fo2.employee.id });
    expect((await as(fo.token).get(`/cases/${c.id}`)).status).toBe(404);
    expect((await as(fo2.token).get(`/cases/${c.id}`)).status).toBe(200);
  });

  test('only staff with the right role can be assigned; marketing cannot assign reviewers', async () => {
    const c = (await newCase(A.adminToken)).body;
    expect((await as(A.adminToken).post(`/cases/${c.id}/assignments`, { stage: 'FIELD', employeeId: jr.employee.id })).status).toBe(400);
    expect((await as(mk.token).post(`/cases/${c.id}/assignments`, { stage: 'JUNIOR', employeeId: jr.employee.id })).status).toBe(403);
    expect((await as(A.adminToken).post(`/cases/${c.id}/assignments`, { stage: 'JUNIOR', employeeId: jr.employee.id })).status).toBe(200);
  });

  test('maker-checker: one person cannot be junior and senior on the same case', async () => {
    const both = await createEmployee(A.adminToken, ['JUNIOR_REVIEWER', 'SENIOR_REVIEWER'], 'Dual Reviewer');
    const c = (await newCase(A.adminToken)).body;
    expect((await as(A.adminToken).post(`/cases/${c.id}/assignments`, { stage: 'JUNIOR', employeeId: both.employee.id })).status).toBe(200);
    const res = await as(A.adminToken).post(`/cases/${c.id}/assignments`, { stage: 'SENIOR', employeeId: both.employee.id });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/junior and senior/);
  });

  test('illegal transitions are rejected; hold/resume restores the previous status; cancel needs remarks', async () => {
    const c = (await newCase(mk.token)).body;
    expect((await as(mk.token).post(`/cases/${c.id}/transitions`, { action: 'CLOSE_CASE' })).status).toBe(409);
    expect((await as(mk.token).post(`/cases/${c.id}/transitions`, { action: 'HOLD', remarks: 'Waiting for client' })).status).toBe(403); // marketing lacks case.hold
    expect((await as(A.adminToken).post(`/cases/${c.id}/transitions`, { action: 'SUBMIT_INSPECTION' })).status).toBe(400); // not generic
    await as(mk.token).post(`/cases/${c.id}/assignments`, { stage: 'FIELD', employeeId: fo.employee.id });
    const held = await as(A.adminToken).post(`/cases/${c.id}/transitions`, { action: 'HOLD', remarks: 'Client travelling' });
    expect(held.body.status).toBe('CASE_ON_HOLD');
    expect((await as(fo.token).post(`/cases/${c.id}/transitions`, { action: 'START_PRELIMINARY' })).status).toBe(409);
    const resumed = await as(A.adminToken).post(`/cases/${c.id}/transitions`, { action: 'RESUME' });
    expect(resumed.body.status).toBe('INSPECTION_ASSIGNED');
    expect((await as(A.adminToken).post(`/cases/${c.id}/transitions`, { action: 'CANCEL' })).status).toBe(400);
    const cancelled = await as(A.adminToken).post(`/cases/${c.id}/transitions`, { action: 'CANCEL', remarks: 'Loan withdrawn by applicant' });
    expect(cancelled.body.status).toBe('CASE_CANCELLED');
    expect((await as(mk.token).patch(`/cases/${c.id}`, { loanAmount: 1 })).status).toBe(409);
    const history = await prisma.caseStatusHistory.findMany({ where: { caseId: c.id }, orderBy: { createdAt: 'asc' } });
    expect(history.map((h) => h.toStatus)).toEqual(['CASE_RECEIVED', 'INSPECTION_ASSIGNED', 'CASE_ON_HOLD', 'INSPECTION_ASSIGNED', 'CASE_CANCELLED']);
  });

  test('list filters: status group, assigned to me, search by Case ID', async () => {
    const c = (await newCase(mk.token, { loanReference: `LN-${uniq()}` })).body;
    const byNumber = await as(A.adminToken).get('/cases').query({ search: c.caseNumber });
    expect(byNumber.body.items.map((x) => x.id)).toEqual([c.id]);
    const byRef = await as(A.adminToken).get('/cases').query({ search: c.loanReference });
    expect(byRef.body.items).toHaveLength(1);
    const newOnes = await as(A.adminToken).get('/cases').query({ statusGroup: 'NEW', pageSize: 100 });
    expect(newOnes.body.items.every((x) => x.status === 'CASE_RECEIVED')).toBe(true);
    const mine = await as(fo2.token).get('/cases').query({ assignedToMe: 'true' });
    expect(mine.body.items.every((x) => x.assignees.FIELD?.id === fo2.employee.id)).toBe(true);
  });
});
