import { acceptInvite, api, app, as, createEmployee, createFirm, createSuperadmin, login, request, uniq } from './helpers.js';

/** Minimal valid files (magic bytes). */
export const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
export const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(128, 7)]);

/** A firm with the full team, a bank, a portal client and the Land & Building category. */
export async function setupFirm({ requiresClientApproval = true } = {}) {
  const sa = await createSuperadmin();
  const firm = await createFirm(sa.token, `Workflow Valuers ${uniq()}`);
  const [mk, fo, jr, sr] = await Promise.all([
    createEmployee(firm.adminToken, ['MARKETING'], 'Meera Marketing'),
    createEmployee(firm.adminToken, ['FIELD_OFFICER'], 'Farhan Field'),
    createEmployee(firm.adminToken, ['JUNIOR_REVIEWER'], 'Juhi Junior'),
    createEmployee(firm.adminToken, ['SENIOR_REVIEWER'], 'Sanjay Senior'),
  ]);
  const bank = (await as(firm.adminToken).post('/masters/banks', { institutionType: 'BANK', name: 'HDFC Bank', shortCode: 'HDFC', branch: `Branch ${uniq()}`, requiresClientApproval })).body;
  const clientEmail = `client-${uniq()}@mail.test`;
  const created = (await as(firm.adminToken).post('/clients', { clientType: 'PRIVATE_LIMITED', name: 'ABC Industries Pvt Ltd', email: clientEmail, createPortalLogin: true })).body;
  await acceptInvite(created.portal.devInviteUrl);
  const client = { ...created.client, email: clientEmail, token: (await login(clientEmail)).token };
  const categories = (await as(firm.adminToken).get('/masters/categories')).body.items;
  return { sa, firm, admin: firm.adminToken, mk, fo, jr, sr, bank, client, categories, land: categories.find((c) => c.code === 'LAND_BUILDING') };
}

/** Case with marketing owner, field officer, junior and senior reviewers assigned. */
export async function createCaseWithTeam(fx, { categoryId } = {}) {
  const c = (await as(fx.mk.token).post('/cases', { clientId: fx.client.id, bankId: fx.bank.id, categoryId: categoryId ?? fx.land.id, loanAmount: 7500000, fieldOfficerId: fx.fo.employee.id })).body;
  await as(fx.admin).post(`/cases/${c.id}/assignments`, { stage: 'JUNIOR', employeeId: fx.jr.employee.id });
  await as(fx.admin).post(`/cases/${c.id}/assignments`, { stage: 'SENIOR', employeeId: fx.sr.employee.id });
  return c;
}

export const uploadPhoto = (token, caseId, kind = 'PROPERTY') =>
  request(app).post(api(`/cases/${caseId}/inspection/photos`)).set('Authorization', `Bearer ${token}`).field('kind', kind).field('caption', `${kind} view`).attach('file', JPG, `${kind.toLowerCase()}-${uniq()}.jpg`);

export const LAND_PROPERTY = { propertyType: 'Industrial Building', ownerName: 'ABC Industries Pvt Ltd', landArea: 12000, landAreaUnit: 'sq.ft', builtUpArea: 8000, yearOfConstruction: 2012 };

/** Field officer completes and submits the inspection. */
export async function completeInspection(fx, caseId) {
  const fo = as(fx.fo.token);
  await fo.post(`/cases/${caseId}/inspection/start`);
  await fo.put(`/cases/${caseId}/property`, { data: LAND_PROPERTY });
  await fo.put(`/cases/${caseId}/inspection`, {
    propertyType: 'Industrial Building',
    propertyAddress: 'Plot 14, MIDC Bhosari, Pune 411026',
    landArea: 12000,
    landAreaUnit: 'sq.ft',
    buildingArea: 8000,
    buildingAreaUnit: 'sq.ft',
    condition: 'GOOD',
    gpsConsent: true,
    gpsLat: 18.6298,
    gpsLng: 73.8478,
    gpsAccuracyM: 12,
    construction: { structure: 'RCC framed', yearOfConstruction: 2012, floors: 2, estimatedLifeYears: 60 },
    landmarks: [{ name: 'Bhosari bus depot', distance: '500 m', direction: 'North' }],
  });
  for (const kind of ['PROPERTY', 'PROPERTY', 'LOCATION']) await uploadPhoto(fx.fo.token, caseId, kind);
  return fo.post(`/cases/${caseId}/inspection/submit`);
}
