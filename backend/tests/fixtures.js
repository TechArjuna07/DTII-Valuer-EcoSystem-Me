import { acceptInvite, api, app, as, createEmployee, createFirm, createSuperadmin, login, PASSWORD, request, uniq } from './helpers.js';

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

/** Field officer completes and submits the inspection (optionally handing over to a junior reviewer). */
export async function completeInspection(fx, caseId, { nextAssigneeId } = {}) {
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
  return fo.post(`/cases/${caseId}/inspection/submit`, nextAssigneeId ? { nextAssigneeId } : {});
}

export const LB_INPUTS = {
  land: { area: 12000, unit: 'sq.ft', ratePerUnit: 2500, guidelineRatePerUnit: 2000 },
  building: { builtUpArea: 8000, unit: 'sq.ft', replacementRatePerUnit: 1800, ageYears: 14, totalLifeYears: 60, salvagePct: 10 },
  amenities: [{ description: 'Compound wall', amount: 250000 }],
};

/** Junior reviewer prepares and submits the preliminary valuation (case must be INSPECTION_COMPLETED). */
export async function completePreliminary(fx, caseId, inputs = LB_INPUTS, { nextAssigneeId } = {}) {
  const jr = as(fx.jr.token);
  await jr.post(`/cases/${caseId}/transitions`, { action: 'START_PRELIMINARY' });
  const v = await jr.post(`/cases/${caseId}/valuations/preliminary/versions`, { inputs, summary: 'Preliminary assessment based on site inspection.' });
  if (v.status !== 201) throw new Error(`preliminary version failed: ${JSON.stringify(v.body)}`);
  return jr.post(`/cases/${caseId}/valuations/preliminary/submit`, nextAssigneeId ? { nextAssigneeId } : {});
}

/** Senior reviewer approves the preliminary, issues the final report and approves it (→ FINAL_APPROVED). */
export async function completeFinal(fx, caseId, { templateId } = {}) {
  const sr = as(fx.sr.token);
  await sr.post(`/cases/${caseId}/transitions`, { action: 'START_FINAL_REVIEW' });
  await sr.post(`/cases/${caseId}/valuations/review`, { decision: 'APPROVED', comments: 'Calculations verified' });
  const v = await sr.post(`/cases/${caseId}/valuations/final/versions`, { inputs: LB_INPUTS, summary: 'Final valuation for lending purposes.', ...(templateId ? { templateId } : {}) });
  if (v.status !== 201) throw new Error(`final version failed: ${JSON.stringify(v.body)}`);
  return sr.post(`/cases/${caseId}/valuations/final/approve`, { comments: 'Approved for issue' });
}

/**
 * Valuer signs the approved final report and it reaches the client (→ CLIENT_APPROVAL_PENDING): automatically
 * on signing by default, or by an explicit release when the firm switched auto-release off.
 */
export async function signAndRelease(fx, caseId) {
  const s = await as(fx.sr.token).post(`/cases/${caseId}/signatures/valuer`, { password: PASSWORD, consent: true });
  if (s.status !== 200) throw new Error(`valuer signature failed: ${JSON.stringify(s.body)}`);
  if (s.body.caseStatus === 'CLIENT_APPROVAL_PENDING') return s;
  return as(fx.sr.token).post(`/cases/${caseId}/approval/release`);
}

/** Client approves and signs (→ CLIENT_SIGNED). */
export async function clientApproveAndSign(fx, caseId) {
  await as(fx.client.token).post(`/cases/${caseId}/approval/decision`, { decision: 'APPROVED' });
  return as(fx.client.token).post(`/cases/${caseId}/signatures/client`, { password: PASSWORD, consent: true });
}
