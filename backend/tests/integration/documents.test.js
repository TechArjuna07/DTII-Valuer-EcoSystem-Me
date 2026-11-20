import { createHash } from 'node:crypto';
import { redis } from '../../src/database/redis.js';
import { signedUrl } from '../../src/services/storage/storage.service.js';
import { acceptInvite, api, app, as, createEmployee, createFirm, createSuperadmin, login, prisma, request, uniq } from '../helpers.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);

let A;
let B;
let mk;
let fo;
let jr;
let c;
let clientUser;

const upload = (token, caseId, buffer, name, fields = {}) => {
  let r = request(app).post(api(`/cases/${caseId}/documents`)).set('Authorization', `Bearer ${token}`);
  for (const [k, v] of Object.entries({ folder: 'SOURCE_FILES', ...fields })) r = r.field(k, v);
  return r.attach('file', buffer, name);
};

beforeAll(async () => {
  const sa = await createSuperadmin();
  A = await createFirm(sa.token, `Doc Valuers ${uniq()}`);
  B = await createFirm(sa.token, `Doc Other ${uniq()}`);
  [mk, fo, jr] = await Promise.all([createEmployee(A.adminToken, ['MARKETING']), createEmployee(A.adminToken, ['FIELD_OFFICER']), createEmployee(A.adminToken, ['JUNIOR_REVIEWER'])]);
  const bank = (await as(A.adminToken).post('/masters/banks', { institutionType: 'BANK', name: 'State Bank of India', shortCode: 'SBI' })).body;
  const clientEmail = `cl-${uniq()}@mail.test`;
  const client = (await as(A.adminToken).post('/clients', { clientType: 'INDIVIDUAL', name: 'Ravi Kumar', email: clientEmail, createPortalLogin: true })).body;
  await acceptInvite(client.portal.devInviteUrl);
  clientUser = await login(clientEmail);
  const cat = (await as(A.adminToken).get('/masters/categories')).body.items.find((x) => x.code === 'LAND_BUILDING');
  c = (await as(mk.token).post('/cases', { clientId: client.client.id, bankId: bank.id, categoryId: cat.id, fieldOfficerId: fo.employee.id })).body;
  await as(A.adminToken).post(`/cases/${c.id}/assignments`, { stage: 'JUNIOR', employeeId: jr.employee.id });
});

afterAll(async () => {
  await prisma.$disconnect();
  await redis.quit();
});

describe('upload, versions and integrity', () => {
  test('stores a validated file under an id-only key with its SHA-256; new uploads become versions', async () => {
    const res = await upload(mk.token, c.id, PDF, 'Loan Application - Ravi Kumar.pdf', { title: 'Loan application' });
    expect(res.status).toBe(201);
    expect(res.body.current).toMatchObject({ version: 1, mimeType: 'application/pdf', sha256: createHash('sha256').update(PDF).digest('hex'), scanStatus: 'SKIPPED' });
    const v1 = await prisma.documentVersion.findUnique({ where: { id: res.body.current.id } });
    expect(v1.storageKey).toBe(`firms/${A.firm.id}/cases/${c.id}/${res.body.id}/v1`);
    expect(v1.storageKey).not.toMatch(/Ravi|Loan/);

    const v2 = await upload(mk.token, c.id, Buffer.concat([PDF, Buffer.from('% revised\n')]), 'Loan Application v2.pdf', { documentId: res.body.id });
    expect(v2.body.versionCount).toBe(2);
    expect(v2.body.versions.map((v) => v.version)).toEqual([2, 1]);
    await expect(prisma.documentVersion.update({ where: { id: v1.id }, data: { sha256: 'f'.repeat(64) } })).rejects.toThrow();
    await expect(prisma.documentVersion.delete({ where: { id: v1.id } })).rejects.toThrow();
    const tl = await as(mk.token).get(`/cases/${c.id}/timeline`);
    expect(tl.body.items.map((i) => i.action)).toEqual(expect.arrayContaining(['DOCUMENT_UPLOADED', 'DOCUMENT_VERSION_ADDED']));
  });

  test('rejects spoofed types, disallowed extensions and path tricks in names', async () => {
    expect((await upload(mk.token, c.id, PNG, 'statement.pdf')).status).toBe(400); // PNG bytes named .pdf
    expect((await upload(mk.token, c.id, Buffer.from('MZ\x90\x00'), 'setup.exe')).status).toBe(400);
    expect((await upload(mk.token, c.id, Buffer.from('<svg onload=alert(1)>'), 'logo.svg')).status).toBe(400);
    expect((await upload(mk.token, c.id, Buffer.from('<script>x</script>'), 'page.html')).status).toBe(400);
    const tricky = await upload(mk.token, c.id, PDF, '..\\..\\windows\\system32\\evil.pdf');
    expect(tricky.status).toBe(201);
    expect(tricky.body.current.originalName).not.toMatch(/[\\/]|\.\./);
  });

  test('photographs folder accepts images only', async () => {
    expect((await upload(fo.token, c.id, PDF, 'notes.pdf', { folder: 'PROPERTY_PHOTOGRAPHS' })).status).toBe(400);
    expect((await upload(fo.token, c.id, JPG, 'front-elevation.jpg', { folder: 'PROPERTY_PHOTOGRAPHS' })).status).toBe(201);
  });
});

describe('folder access control', () => {
  test('each role reads and writes only its folders', async () => {
    expect((await upload(fo.token, c.id, PDF, 'x.pdf', { folder: 'SOURCE_FILES' })).status).toBe(403);
    expect((await upload(fo.token, c.id, PDF, 'inspection.pdf', { folder: 'INSPECTION_DOCUMENTS' })).status).toBe(201);
    expect((await upload(mk.token, c.id, PDF, 'x.pdf', { folder: 'INSPECTION_DOCUMENTS' })).status).toBe(403);
    expect((await upload(jr.token, c.id, PDF, 'prelim.pdf', { folder: 'PRELIMINARY_VALUATION' })).status).toBe(201);

    const foTree = await as(fo.token).get(`/cases/${c.id}/documents`);
    expect(foTree.body.folders.map((f) => f.code)).toEqual(['SOURCE_FILES', 'INSPECTION_DOCUMENTS', 'PROPERTY_PHOTOGRAPHS']);
    const prelim = (await as(jr.token).get(`/cases/${c.id}/documents`)).body.folders.find((f) => f.code === 'PRELIMINARY_VALUATION').documents[0];
    expect((await as(fo.token).get(`/documents/${prelim.id}`)).status).toBe(404);
    expect((await as(fo.token).post(`/documents/${prelim.id}/link`, {})).status).toBe(404);
    const mkTree = await as(mk.token).get(`/cases/${c.id}/documents`);
    expect(mkTree.body.path).toEqual(['Ravi Kumar', expect.stringMatching(/^FY \d{4}-\d{2}$/), `${c.caseNumber}_SBI`]);
    expect(mkTree.body.folders.find((f) => f.code === 'BANK_SUBMISSION').canWrite).toBe(true);
  });

  test('another firm cannot see or download documents', async () => {
    const doc = (await upload(mk.token, c.id, PDF, 'private.pdf')).body;
    expect((await as(B.adminToken).get(`/documents/${doc.id}`)).status).toBe(404);
    expect((await as(B.adminToken).post(`/documents/${doc.id}/link`, {})).status).toBe(404);
    expect((await as(B.adminToken).get(`/cases/${c.id}/documents`)).status).toBe(404);
    expect((await upload(B.adminToken, c.id, PDF, 'inject.pdf')).status).toBe(404);
  });
});

describe('signed download links', () => {
  test('a link works once issued, returns identical bytes, and cannot be tampered with or reused after expiry', async () => {
    const doc = (await upload(mk.token, c.id, PDF, 'Sale Deed.pdf')).body;
    const link = await as(mk.token).post(`/documents/${doc.id}/link`, { disposition: 'attachment' });
    expect(link.status).toBe(200);
    expect(new Date(link.body.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(60_000);
    const file = await request(app).get(link.body.url).buffer(true).parse((res, cb) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(file.status).toBe(200);
    expect(Buffer.compare(file.body, PDF)).toBe(0);
    expect(file.headers['content-disposition']).toMatch(/^attachment; filename="Sale Deed.pdf"/);
    expect(file.headers['x-content-type-options']).toBe('nosniff');

    const [payload, mac] = link.body.url.split('/').pop().split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), k: 'firms/other/secret' })).toString('base64url');
    expect((await request(app).get(`/api/v1/files/${forged}.${mac}`)).status).toBe(404);
    const v = await prisma.documentVersion.findUnique({ where: { id: doc.current.id } });
    const expired = await signedUrl(v.storageKey, { fileName: 'x.pdf', contentType: 'application/pdf', ttlSeconds: -5 });
    expect((await request(app).get(expired.url)).status).toBe(404);
    expect(await prisma.auditLog.count({ where: { action: 'DOCUMENT_DOWNLOAD_LINK_ISSUED', entityId: v.id } })).toBe(1);
  });
});

describe('client portal & document requests', () => {
  test('requesting a document flags the case; the client sees only client-visible items and fulfils it by uploading', async () => {
    const internal = (await upload(mk.token, c.id, PDF, 'internal-note.pdf')).body;
    const req = await as(mk.token).post(`/cases/${c.id}/document-requests`, { title: 'Latest property tax receipt', requestedFrom: 'CLIENT' });
    expect(req.status).toBe(201);
    expect((await as(mk.token).get(`/cases/${c.id}`)).body.awaitingDocuments).toBe(true);

    const reqs = await as(clientUser.token).get(`/cases/${c.id}/document-requests`);
    expect(reqs.body.items.map((r) => r.title)).toContain('Latest property tax receipt');
    const tree = await as(clientUser.token).get(`/cases/${c.id}/documents`);
    expect(tree.body.folders.map((f) => f.code)).toEqual(['SOURCE_FILES', 'FINAL_VALUATION_REPORT', 'CLIENT_SIGNED_FILES']);
    expect(tree.body.folders[0].documents.find((d) => d.id === internal.id)).toBeUndefined();
    expect((await as(clientUser.token).get(`/documents/${internal.id}`)).status).toBe(404);

    expect((await upload(clientUser.token, c.id, PDF, 'tax.pdf', { folder: 'INSPECTION_DOCUMENTS' })).status).toBe(403);
    const up = await upload(clientUser.token, c.id, PDF, 'tax-receipt-2026.pdf', { requestId: req.body.id });
    expect(up.status).toBe(201);
    expect(up.body.visibility).toBe('CLIENT');
    const after = await as(mk.token).get(`/cases/${c.id}/document-requests`);
    expect(after.body.items.find((r) => r.id === req.body.id).status).toBe('FULFILLED');
    expect((await as(mk.token).get(`/cases/${c.id}`)).body.awaitingDocuments).toBe(false);
    const mine = await as(clientUser.token).get('/repository/me');
    expect(mine.body.years[0].cases[0]).toMatchObject({ caseNumber: c.caseNumber });
  });

  test('only the Firm Admin can archive; archived documents keep their versions; closed cases are read-only', async () => {
    const doc = (await upload(mk.token, c.id, PDF, 'duplicate.pdf')).body;
    expect((await as(mk.token).post(`/documents/${doc.id}/archive`, { reason: 'Duplicate upload' })).status).toBe(403);
    expect((await as(A.adminToken).post(`/documents/${doc.id}/archive`, { reason: 'Duplicate upload' })).status).toBe(204);
    expect((await as(mk.token).get(`/documents/${doc.id}`)).status).toBe(404);
    expect(await prisma.documentVersion.count({ where: { documentId: doc.id } })).toBe(1);

    await as(A.adminToken).post(`/cases/${c.id}/transitions`, { action: 'CANCEL', remarks: 'Applicant withdrew' });
    expect((await upload(mk.token, c.id, PDF, 'late.pdf')).status).toBe(409);
    const tree = await as(mk.token).get(`/cases/${c.id}/documents`);
    expect(tree.body.readOnly).toBe(true);
  });
});
