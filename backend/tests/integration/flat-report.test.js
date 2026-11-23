import QRCode from 'qrcode';
import { PDFDocument } from 'pdf-lib';
import { redis } from '../../src/database/redis.js';
import { closeRenderer } from '../../src/services/pdf/pdf-renderer.js';
import { getBuffer } from '../../src/services/storage/storage.service.js';
import { api, app, as, prisma, request } from '../helpers.js';
import { createCaseWithTeam, setupFirm, signFinalReport } from '../fixtures.js';

/**
 * Residential flat in the bank (SBI / IBA) format, end to end: flat property particulars → junior preliminary →
 * senior final with invoice fee and annexures → signature. Figures follow the SBI sample report
 * (520 sq.ft @ ₹22,500, construction ₹2,500, age 24 → FMV ₹1,12,32,000).
 */

let fx;
let flat;

const FLAT_DATA = {
  ownerName: 'Ms. Nishita Sample and Mrs. Shobha Sample',
  ownershipNote: 'Joint Ownership',
  postalAddress: 'Flat No - 702, 7th Floor, Building No. 3-A, Sample CHS Ltd, CTS No. 477/D, Chunabhatti, Mumbai 400022',
  surveyNo: 'CTS No. 477/D',
  district: 'Mumbai Sub',
  residentialArea: true,
  commercialArea: false,
  areaClass: 'Upper Middle and Higher Class',
  urbanRural: 'Urban',
  flatNorth: 'Open to Sky',
  plotNorth: 'Sudarshan CHS',
  occupancy: 'Tenant Occupied',
  monthlyRent: 35000,
  yearOfConstruction: 2002,
  numberOfFloors: 'G+7th floor',
  constructionQuality: 'Good',
  floor: '7th Floor',
  flatNo: 'Flat No - 702',
  flooring: 'Vitrified flooring tiles',
  flatClass: 'Medium',
  usage: 'Residential purpose only',
};

const INPUTS = {
  builtUpArea: 520,
  compositeRate: 22500,
  constructionCostPerUnit: 2500,
  ageYears: 24,
  bookValue: 8500000,
  guidelineRatePerSqM: 137690,
  readyReckonerValue: 6987261,
  extras: [{ description: 'Wardrobes', amount: 0 }],
  report: {
    purpose: 'To avail Housing Loan',
    appointmentDate: '17/11/2026',
    appointingAuthority: 'The Asst. General Manager, State Bank Of India, Home Loan Center Chinchpokali, Mumbai',
    documents: ['Copy of Agreement For Sale dated 13/11/2026', 'Copy of Full Occupation Certificate issued by MCGM dated 24/06/2002'],
    marketability: 'Good',
    comparableAnalysis: 'Sale instances in the same complex range from Rs. 20,000/- to Rs. 30,000/- per Sq. Ft.',
    place: 'Andheri, Mumbai',
  },
};

const pageCount = async (versionId) => {
  const v = await prisma.documentVersion.findUnique({ where: { id: versionId } });
  return (await PDFDocument.load(await getBuffer(v.storageKey))).getPageCount();
};

beforeAll(async () => {
  fx = await setupFirm();
  flat = fx.categories.find((x) => x.code === 'FLAT');
}, 60_000);

afterAll(async () => {
  await closeRenderer();
  await prisma.$disconnect();
  await redis.quit();
});

describe('residential flat — bank (SBI) report format', () => {
  test('flat category, firm letterhead, preliminary + final with invoice and annexures, then signature', async () => {
    expect(flat).toMatchObject({ engine: 'FLAT' });
    const settings = await as(fx.admin).put('/firm/report-settings', {
      letterhead: { title: 'SAMPLE VALUERS', qualifications: 'B.E. (Civil), F.I.V.', subtitle: 'Engineers & Valuation Consultants', pan: 'ABCDE1234F' },
      billing: { invoicePrefix: 'MUM/JM', gstRatePct: 18, accountHolder: 'Sample Valuers', accountNumber: '43987133686', ifsc: 'SBIN0060278', upiId: 'sample@sbi' },
    });
    expect(settings.status).toBe(200);
    expect(settings.body.letterhead).toMatchObject({ pan: 'ABCDE1234F', sacCode: '997224' });
    expect((await as(fx.admin).put('/firm/report-settings', { billing: { ifsc: 'bad' } })).status).toBe(400);

    const c = await createCaseWithTeam(fx, { categoryId: flat.id });
    const fo = as(fx.fo.token);
    await fo.post(`/cases/${c.id}/inspection/start`);
    expect((await fo.put(`/cases/${c.id}/property`, { data: FLAT_DATA })).status).toBe(200);
    await fo.put(`/cases/${c.id}/inspection`, { propertyType: 'Residential Flat', propertyAddress: FLAT_DATA.postalAddress, buildingArea: 520, buildingAreaUnit: 'sq.ft', condition: 'GOOD', gpsConsent: true, gpsLat: 19.0567691, gpsLng: 72.8727024, gpsAccuracyM: 10 });
    for (const [k, kind] of ['PROPERTY', 'PROPERTY', 'LOCATION'].entries()) {
      const photo = await QRCode.toBuffer(`photo ${k}`, { width: 400 });
      const r = await request(app).post(api(`/cases/${c.id}/inspection/photos`)).set('Authorization', `Bearer ${fx.fo.token}`).field('kind', kind).field('caption', ['View of building', 'Living room', 'Location'][k]).attach('file', photo, `photo-${k}.png`);
      expect(r.status).toBe(201);
    }
    expect((await fo.post(`/cases/${c.id}/inspection/submit`, {})).body.caseStatus).toBe('INSPECTION_COMPLETED');

    // Junior: defaults come from the flat particulars; the preliminary uses the bank format too (no invoice).
    const jr = as(fx.jr.token);
    await jr.post(`/cases/${c.id}/transitions`, { action: 'START_PRELIMINARY' });
    const vals = await jr.get(`/cases/${c.id}/valuations`);
    expect(vals.body.engine).toBe('FLAT');
    expect(vals.body.defaults).toMatchObject({ builtUpArea: 520, ageYears: new Date().getFullYear() - 2002, realisablePct: 98, distressPct: 75 });
    // The junior may complete property particulars while preparing the report.
    expect((await jr.put(`/cases/${c.id}/property`, { data: { ...FLAT_DATA, landmark: 'Near Chunabhatti Police Station' } })).status).toBe(200);
    const pre = await jr.post(`/cases/${c.id}/valuations/preliminary/versions`, { inputs: INPUTS });
    expect(pre.status).toBe(201);
    const preV = pre.body.preliminary.versions[0];
    expect(preV).toMatchObject({ marketValue: 11232000, realisableValue: 11007360, distressValue: 8424000 });
    expect(preV.documentVersionId).toBeTruthy();
    await jr.post(`/cases/${c.id}/valuations/preliminary/submit`, {});

    // Senior: annexures uploaded with the annexure document types, then the final report.
    const sr = as(fx.sr.token);
    await sr.post(`/cases/${c.id}/transitions`, { action: 'START_FINAL_REVIEW' });
    await sr.post(`/cases/${c.id}/valuations/review`, { decision: 'APPROVED', comments: 'Checked' });
    const types = await prisma.documentType.findMany({ where: { firmId: null, code: { in: ['READY_RECKONER_EVIDENCE', 'MARKET_COMPARABLES'] } } });
    const typeId = (code) => types.find((t) => t.code === code).id;
    const png = await QRCode.toBuffer('ready reckoner evidence');
    const annexPdf = await PDFDocument.create();
    annexPdf.addPage();
    annexPdf.addPage();
    const pdfBytes = Buffer.from(await annexPdf.save());
    const up = (buffer, name, code) =>
      request(app).post(api(`/cases/${c.id}/documents`)).set('Authorization', `Bearer ${fx.sr.token}`).field('folder', 'SENIOR_REVIEW').field('documentTypeId', typeId(code)).attach('file', buffer, name);
    expect((await up(png, 'rr.png', 'READY_RECKONER_EVIDENCE')).status).toBe(201);
    expect((await up(pdfBytes, 'listings.pdf', 'MARKET_COMPARABLES')).status).toBe(201);

    const fin = await sr.post(`/cases/${c.id}/valuations/final/versions`, { inputs: { ...INPUTS, invoice: { fee: 2500, bankOfficer: 'Mr. Yogesh' } } });
    expect(fin.status).toBe(201);
    const finV = fin.body.final.versions[0];
    expect(finV).toMatchObject({ marketValue: 11232000, guidelineValue: 6987261, insurableValue: 1300000 });
    const stored = await prisma.valuationReportVersion.findFirst({ where: { documentVersionId: finV.documentVersionId } });
    expect(stored.calculation.flat).toMatchObject({ depreciationPct: 36, netRate: 21600, depreciatedBuildingValue: 832000, deviationFromGuidelinePct: 60.75 });
    expect(stored.inputs.report.documents).toHaveLength(2);
    // Final = invoice page + report + annexures (1 image page + 2 PDF pages); preliminary has neither.
    const [prePages, finPages] = [await pageCount(preV.documentVersionId), await pageCount(finV.documentVersionId)];
    expect(finPages).toBe(prePages + 1 + 3);

    await sr.post(`/cases/${c.id}/valuations/final/approve`, { comments: 'Approved' });
    const signed = await signFinalReport(fx, c.id);
    expect(signed.body.caseStatus).toBe('PAYMENT_PENDING');
    // The expected amount comes from the invoice: 2,500 + 9% CGST + 9% SGST.
    expect((await as(fx.mk.token).get(`/cases/${c.id}/approval`)).body.payment.expectedAmount).toBe(2950);
    expect(await pageCount(signed.body.signatures[0].signedVersionId)).toBe(finPages + 1); // + signature page
  }, 300_000);
});
