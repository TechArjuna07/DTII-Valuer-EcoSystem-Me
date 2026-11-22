import QRCode from 'qrcode';
import { prisma } from '../../database/prisma.js';
import { logger } from '../../config/logger.js';
import { getBuffer } from '../../services/storage/storage.service.js';
import { getReportSettings } from '../firm/report-settings.js';
import { amountInWords } from './engines/money.js';
import { buildReportContext } from './report-context.js';

/**
 * Data context of the bank-format (SBI / IBA) flat valuation report. Rows are laid out here, numbered as in the
 * bank's format (I General … VI Composite rate), so the template only loops; empty values print blank, as banks
 * expect on paper. Text is escaped by Handlebars; photographs and the UPI QR code are embedded as data URIs (the
 * renderer blocks every network request).
 */

const inr0 = (v) => (v === null || v === undefined || v === '' ? '' : new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Number(v)));
const rs = (v) => (v === null || v === undefined ? '' : `Rs. ${inr0(v)}/-`);
const longDate = (d) => (d ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(d)) : '');
const shortDate = (d) => (d ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d)) : '');
const words = (v) => amountInWords(v).replace(/^Rupees /, '');
const MAX_PHOTOS = 12;
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

/** Inspection photographs of the latest submitted round, as data URIs with captions. */
async function photos(caseId) {
  const round = await prisma.propertyInspection.findFirst({ where: { caseId, status: 'SUBMITTED' }, orderBy: { round: 'desc' }, select: { id: true } });
  if (!round) return [];
  const list = await prisma.inspectionPhoto.findMany({ where: { inspectionId: round.id }, orderBy: { createdAt: 'asc' }, take: MAX_PHOTOS });
  const out = [];
  for (const p of list) {
    const doc = await prisma.caseDocument.findUnique({ where: { id: p.documentId }, select: { currentVersionId: true } });
    const ver = doc?.currentVersionId ? await prisma.documentVersion.findUnique({ where: { id: doc.currentVersionId } }) : null;
    if (!ver || !/^image\/(jpeg|png|webp)$/.test(ver.mimeType) || Number(ver.sizeBytes) > MAX_PHOTO_BYTES || ['INFECTED', 'PENDING', 'ERROR'].includes(ver.scanStatus)) continue;
    try {
      const buf = await getBuffer(ver.storageKey);
      out.push({ src: `data:${ver.mimeType};base64,${buf.toString('base64')}`, caption: p.caption || p.kind.replaceAll('_', ' ').toLowerCase() });
    } catch (e) {
      logger.warn({ err: e.message, photoId: p.id }, 'Report photo could not be read');
    }
  }
  return out;
}

const pairs = (rows) => rows.filter(Boolean).map(([no, label, value]) => ({ no, label, value: value ?? '' }));

/**
 * @param {object} p  { c, src: { fields, data, inspection }, calc, stage, version, summary, people, verificationCode }
 */
async function buildFlatContext(p) {
  const { c, src, calc } = p;
  const base = await buildReportContext({ ...p, propertyFields: src.fields, propertyData: src.data, inspection: src.inspection });
  const settings = await getReportSettings(c.firmId);
  const d = src.data ?? {};
  const yesNo = (k) => (d[k] === true ? 'Yes' : d[k] === false ? 'No' : '');
  const v = (k) => (d[k] === undefined || d[k] === null ? '' : String(d[k]));
  const i = calc.inputs;
  const r = i.report ?? {};
  const f = calc.flat;
  const t = calc.totals;
  const insp = src.inspection;
  const org = c.organization;
  const unit = i.areaUnit === 'sq.m' ? 'Sq. Mtr.' : 'Sq. Ft.';
  const areaText = `${i.areaBasis} of subject flat is ${inr0(i.builtUpArea)} ${unit}`;
  const issueDate = new Date();
  const inspectionDate = insp?.inspectedAt ?? insp?.submittedAt ?? null;
  const ref = c.caseNumber;
  const bankLine = [c.bank.name, c.bank.branch, c.bank.address].filter(Boolean).join(', ');
  const owner = v('ownerName') || c.client.name;
  const address = v('postalAddress') || insp?.propertyAddress || '';
  const gps = insp?.gpsLat != null ? `Latitude - ${Number(insp.gpsLat)}, Longitude - ${Number(insp.gpsLng)}` : '';

  const general = pairs([
    ['1', 'Purpose for which the valuation is made', r.purpose],
    ['2 a)', 'Date of inspection', longDate(inspectionDate)],
    ['b)', 'Date on which the valuation is made', longDate(issueDate)],
    ['4', 'Name of the owner(s) and his / their address(es) with phone no. (details of share of each owner in case of joint ownership)', [owner, v('ownershipNote')].filter(Boolean).join('. ')],
    ['5', 'Brief description of property', [v('accommodation'), areaText].filter(Boolean).join('. ')],
  ]);
  const documents = r.documents?.length ? r.documents : [];
  general.splice(3, 0, { no: '3', label: 'List of documents produced for perusal', value: '', list: documents });

  const location = pairs([
    ['a)', 'Plot No. / Survey No.', v('surveyNo')],
    ['b)', 'Nearest Landmark', v('landmark')],
    ['c)', 'Door No.', v('doorNo') || v('flatNo')],
    ['d)', 'T. S. No. / Village', v('tsNoVillage')],
    ['e)', 'Ward / Taluka', v('wardTaluka')],
    ['f)', 'Mandal / District', v('district')],
    ['g)', 'Date of issue and validity of layout of approved map / plan', v('planApproval')],
    ['h)', 'Approved map / plan issuing authority', v('planAuthority')],
    ['i)', 'Whether genuineness or authenticity of approved map / plan is verified', v('planVerified')],
    ['j)', 'Any other comments by our empanelled valuers on authentic of approved plan', v('planComments')],
  ]);
  const site = pairs([
    ['7', 'Postal address of the property', address],
    ['8', 'City / Town', v('cityTown')],
    ['', 'Residential Area', yesNo('residentialArea')],
    ['', 'Commercial Area', yesNo('commercialArea')],
    ['', 'Industrial Area', yesNo('industrialArea')],
    ['9 i)', 'Classification of the area — High / Middle / Poor', v('areaClass')],
    ['ii)', 'Urban / Semi Urban / Rural', v('urbanRural')],
    ['10', 'Coming under Corporation limit / Village Panchayat / Municipality', v('localAuthority')],
    ['11', 'Whether covered under any State / Central Govt. enactments (e.g. Urban Land Ceiling Act) or notified under agency area / scheduled area / cantonment area', v('enactments')],
  ]);
  const boundaries = ['North', 'South', 'East', 'West'].map((dir) => ({ dir, flat: v(`flat${dir}`), plot: v(`plot${dir}`) }));
  const extent = pairs([
    ['13', 'Dimensions of the site — A: as per documents', v('dimensionsAsPerDocs') || areaText],
    ['', 'B: actuals', v('dimensionsActual')],
    ['14', 'Extent of the site', v('extentOfSite') || areaText],
    ['14.1', 'Latitude, Longitude & Co-ordinates of flat', gps],
    ['15', 'Extent of the site considered for valuation (least of 13 A & 13 B)', v('extentConsidered') || areaText],
    ['16', 'Whether occupied by the owner / tenant? If occupied by tenant, since how long? Rent received per month', [v('occupancy'), d.monthlyRent ? `Rent ${rs(d.monthlyRent)} per month` : ''].filter(Boolean).join('. ')],
  ]);
  const building = pairs([
    ['1', 'Nature of the Apartment', v('buildingNature')],
    ['2', 'Location — T.S. No.', v('surveyNo')],
    ['', 'Block No.', v('blockNo')],
    ['', 'Ward No.', v('wardNo')],
    ['', 'Village / Municipality / Corporation', v('municipality') || v('localAuthority')],
    ['', 'Door No., Street or Road (Pin Code)', v('streetPin') || (v('pincode') ? `Pin - ${v('pincode')}` : '')],
    ['3', 'Description of the locality Residential / Commercial / Mixed', v('localityDescription')],
    ['4', 'Year of Construction', v('yearOfConstruction')],
    ['5', 'Number of Floors', v('numberOfFloors')],
    ['6', 'Type of Structure', v('structureType')],
    ['7', 'Number of Dwelling units in the building', v('dwellingUnits')],
    ['8', 'Quality of Construction', v('constructionQuality')],
    ['9', 'Appearance of the Building', v('buildingAppearance')],
    ['10', 'Maintenance of the Building', v('buildingMaintenance')],
    ['11', 'Facilities Available — Lift', v('lift')],
    ['', 'Protected Water Supply', v('waterSupply')],
    ['', 'Underground Sewerage', v('sewerage')],
    ['', 'Car Parking - Open / Covered', v('carParking')],
    ['', 'Is Compound wall existing', v('compoundWall')],
  ]);
  const flatRows = pairs([
    ['1', 'The floor on which the flat is situated', v('floor')],
    ['2', 'Door No. of the flat', v('flatNo')],
    ['3', 'Specification of the flat — Roof', v('roof')],
    ['', 'Flooring', v('flooring')],
    ['', 'Doors', v('doors')],
    ['', 'Windows', v('windows')],
    ['', 'Fittings', v('fittings')],
    ['', 'Finishing', v('finishing')],
    ['4', 'House Tax — Assessment No.', v('houseTaxAssessmentNo')],
    ['', 'Tax paid in the month of', v('houseTaxPaidMonth')],
    ['', 'Tax amount', v('houseTaxAmount')],
    ['5', 'Electricity Service Connection No.', v('electricityConnectionNo')],
    ['', 'Meter card is in the name of', v('meterName')],
    ['6', 'How is the maintenance of the flat', v('flatMaintenance')],
    ['7', 'Sale Deed executed in the name of', v('saleDeedName')],
    ['8', 'What is the undivided area of land as per Sale Deed', v('undividedLandArea')],
    ['9', 'Is it freehold or leasehold, the name of Lessor, Lessee, nature of Lease and terms of renewal of lease', v('tenure')],
    ['10', 'What is the plinth area of the flat', v('plinthArea') || `${inr0(i.builtUpArea)} ${unit}`],
    ['11', 'What is the floor space index (app.)', v('fsi')],
    ['12', 'What is the Carpet area of the flat', v('carpetArea')],
    ['13', 'Is it Posh / I class / Medium / Ordinary', v('flatClass')],
    ['14', 'Is it being used for Residential or Commercial purpose', v('usage')],
    ['15', 'Is it Owner-occupied or let out', v('occupancy')],
    ['16', 'If rented, what is the monthly rent', d.monthlyRent ? `Approx. ${rs(d.monthlyRent)} per month` : ''],
  ]);
  const marketability = pairs([
    ['1', 'How is the marketability', r.marketability],
    ['2', 'What are the factors favouring for an extra Potential Value', r.positiveFactors],
    ['3', 'Any negative factors are observed which affect the market value in general', r.negativeFactors],
  ]);
  const rate = pairs([
    ['1', 'After analyzing the comparable sale instances, what is the composite rate for a similar flat with same specifications in the adjoining locality? (Along with details / reference of at least two latest deals / transactions with respect to adjacent properties in the areas)', r.comparableAnalysis],
    ['2', 'Assuming it is a new construction, what is the adopted basic composite rate of the flat under valuation after comparing with the specifications and other factors with the flat under comparison (give details)', r.adoptedRateNote || `${rs(i.compositeRate)} per ${unit} on ${i.areaBasis} has been considered as prevailing market rate of that area.`],
    ['3', 'Break-up for the rate — i) Building + Services, ii) Land + Others', r.rateBreakupNote || 'The rate mentioned above is inclusive of all and can be called as composite rate.'],
    ['4', "Guideline rate obtained from the Registrar's office (an evidence thereof to be enclosed)", f.guidelineRatePerSqM != null ? `${rs(f.guidelineRatePerSqM)} per Sq. Mtr.` : ''],
  ]);
  const composite = pairs([
    ['a', 'Depreciated building rate (WDV) in Rupee (Insurance Value)', inr0(f.depreciatedBuildingValue)],
    ['', 'Replacement cost of the flat with Services (V (3) i) - Current Const. Cost in Rupees', inr0(f.replacementCost)],
    ['', 'Age of the building', `${inr0(i.ageYears)} Years`],
    ['', 'Estimated future life', `${inr0(f.remainingLifeYears)} years`],
    ['', `Depreciation percentage assuming the salvage value as ${inr0(i.salvagePct)}%`, `${inr0(f.yearlyDepreciationPct)}`],
    ['', 'Depreciated ratio of the building', `${inr0(f.depreciatedRatioPct)}%`],
    ['b', 'Total Composite rate arrived for valuation', `${rs(i.compositeRate)} per ${unit} on the ${i.areaBasis}`],
    ['', 'Depreciated building rate', `${rs(f.depreciationPerUnit)} per ${unit} on ${i.areaBasis}`],
    ['', 'Rate for Land & other V (3) ii', 'Not Applicable'],
    ['', 'Total Composite rate (Net of depreciation)', `${rs(f.netRate)} per ${unit} on the ${i.areaBasis}`],
  ]);
  const STANDARD_EXTRAS = ['Wardrobes', 'Showcases', 'Kitchen Arrangements', 'Superfine Finish', 'Interior Decorations', 'Electricity deposits / electrical fittings etc.', 'Extra collapsible gates / grill works etc.', 'Potential value, if any', 'Other'];
  const extrasByName = new Map(i.extras.map((e) => [e.description.toLowerCase(), e.amount]));
  const extraRows = [
    ...STANDARD_EXTRAS.map((label, k) => ({ no: String(k + 2), label, amount: inr0(extrasByName.get(label.toLowerCase()) ?? 0) })),
    ...i.extras.filter((e) => !STANDARD_EXTRAS.some((s) => s.toLowerCase() === e.description.toLowerCase())).map((e, k) => ({ no: String(STANDARD_EXTRAS.length + 2 + k), label: e.description, amount: inr0(e.amount) })),
  ];
  const fmvFlat = t.marketValue - i.extras.reduce((s, e) => s + e.amount, 0);
  const summaryRows = [
    ['Fair Market Value', t.marketValue],
    ['Realisable Value of subject property', t.realisableValue],
    [`Distress Value at ${inr0(100 - i.distressPct)}% deduction`, t.distressValue],
    f.bookValue != null ? ['Book Value', f.bookValue] : null,
    t.guidelineValue != null ? ["Market Value of the Unit as per 'Government Ready Reckoner'", t.guidelineValue] : null,
    ['Insurance value of the Residential unit', t.insurableValue],
  ]
    .filter(Boolean)
    .map(([label, amount], k) => ({ no: k + 1, label, amount: inr0(amount), inWords: `(${words(amount)})` }));

  // Proforma invoice (first page) when a fee is entered.
  let invoice = null;
  const fee = i.invoice?.fee;
  if (fee > 0) {
    const gstRate = Number(settings.billing.gstRatePct ?? 18);
    const half = Math.round(((fee * gstRate) / 100 / 2) * 100) / 100;
    const total = Math.round((fee + half * 2) * 100) / 100;
    const fy = c.financialYear.shortCode ? `${c.financialYear.shortCode.slice(0, 2)}-${c.financialYear.shortCode.slice(2)}` : '';
    const upi = settings.billing.upiId;
    invoice = {
      number: [settings.billing.invoicePrefix || org.firmCode, fy, c.seq].filter(Boolean).join('/'),
      date: shortDate(issueDate),
      branch: bankLine,
      customer: owner,
      officer: i.invoice.bankOfficer ?? '',
      property: address,
      fee: inr0(fee),
      halfRate: inr0(gstRate / 2),
      halfTax: inr0(half),
      gstTotal: inr0(half * 2),
      total: inr0(total),
      totalWords: words(total),
      sac: settings.letterhead.sacCode,
      account: settings.billing.accountNumber ? settings.billing : null,
      upi: upi ? { id: upi, qr: await QRCode.toDataURL(`upi://pay?pa=${encodeURIComponent(upi)}&pn=${encodeURIComponent(settings.billing.accountHolder || org.name)}&am=${total.toFixed(2)}&cu=INR&tn=${encodeURIComponent(ref)}`, { margin: 0, width: 220 }) } : null,
    };
  }

  const lh = settings.letterhead;
  return {
    ...base,
    ref,
    letterhead: {
      title: lh.title || org.name,
      qualifications: lh.qualifications ?? '',
      subtitle: lh.subtitle ?? '',
      designations: lh.designations ?? '',
      empanelment: lh.empanelment ?? '',
      address: base.firm.address,
      phone: org.phone ?? '',
      email: org.email ?? '',
      gstin: org.gstin ?? '',
      pan: lh.pan ?? '',
      sac: lh.sacCode ?? '',
    },
    invoice,
    to: r.appointingAuthority || bankLine,
    owner,
    address,
    general,
    documents,
    location,
    site,
    boundaries,
    extent,
    building,
    flatRows,
    marketability,
    rate,
    composite,
    details: {
      area: inr0(i.builtUpArea),
      compositeRate: inr0(i.compositeRate),
      gross: inr0(i.builtUpArea * i.compositeRate),
      depLabel: `Less: Depreciation @ ${inr0(f.yearlyDepreciationPct)}% for ${inr0(i.ageYears)} years on Construction cost @ Rs. ${inr0(i.constructionCostPerUnit)} per ${unit}`,
      depPerUnit: inr0(f.depreciationPerUnit),
      depAmount: inr0(-i.builtUpArea * f.depreciationPerUnit),
      netRate: inr0(f.netRate),
      fmvFlat: inr0(fmvFlat),
      extras: extraRows,
      total: inr0(t.marketValue),
      basis: `${i.areaBasis} X Market Rate`,
    },
    methodology: r.methodology || 'Market value of land is not readily available as very few plots are available for sale. Hence, to arrive at the property value we relied upon property dealers, agents, internet advertisements, recent transactions, local people and newspapers, and that information has been validated.',
    conclusion: `Considering all aspects regarding specifications, location, other facilities available in & around the site and the recent transaction instances in the same locality for sale of residential units, we can conclude that the aforesaid flat will fetch around ${rs(i.compositeRate)} per ${unit} on the ${i.areaBasis}.`,
    deviation:
      f.deviationFromGuidelinePct != null && Math.abs(f.deviationFromGuidelinePct) > 20
        ? r.deviationJustification || 'Govt. determines the property value rates for collecting revenue at the time of transfer / sale of properties. While doing so, Govt. needs to keep in mind the interest of all the different classes of people residing in that locality. Accordingly, Govt. rates of properties for registration purpose are generally lower than market rates prevailing in the area.'
        : null,
    summaryRows,
    place: r.place || [c.organization.city].filter(Boolean).join(''),
    dates: { report: shortDate(issueDate), inspection: shortDate(inspectionDate), appointment: r.appointmentDate ?? '' },
    declaration: {
      purpose: r.purpose ?? '',
      authority: r.appointingAuthority || bankLine,
      inspectedBy: r.inspectedBy || insp?.officerName || '',
      valuer: p.people.valuer,
      firm: lh.title || org.name,
    },
    photos: await photos(c.id),
  };
}

export { buildFlatContext };
