import Handlebars from 'handlebars';
import QRCode from 'qrcode';
import { env } from '../../config/env.js';
import { amountInWords } from './engines/money.js';

/**
 * Report template engine: a sandboxed Handlebars instance (HTML-escaping on) with formatting helpers, plus the
 * data context every template receives. Templates are rendered to PDF with JavaScript and network disabled.
 */
const hbs = Handlebars.create();
const inr = (v) => (v === null || v === undefined || v === '' ? '' : new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v)));
hbs.registerHelper('inr', inr);
hbs.registerHelper('num', (v) => (v === null || v === undefined ? '' : new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(Number(v))));
hbs.registerHelper('words', (v) => amountInWords(v));
hbs.registerHelper('default', (v, d) => (v === null || v === undefined || v === '' ? d : v));
hbs.registerHelper('eq', (a, b) => a === b);
hbs.registerHelper('upper', (v) => String(v ?? '').toUpperCase());

const date = (d) => (d ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d)) : '—');

/** @throws {Error} with a readable message when the template does not compile. */
function compileTemplate(body) {
  return hbs.compile(body, { strict: false, noEscape: false, knownHelpersOnly: false });
}

function assertTemplateCompiles(body) {
  try {
    hbs.precompile(body);
    compileTemplate(body)({});
  } catch (e) {
    throw new Error(`Template error: ${String(e.message).split('\n')[0]}`);
  }
}

const verificationUrl = (code) => `${env.WEB_APP_URL}/verify/${code}`;

/**
 * Builds the template data context.
 * @param {object} p  { c (case with client, bank, category, financialYear, organization), propertyFields, propertyData,
 *                     inspection, calc, stage, version, summary, people: { preparedBy, valuer, valuerRegistration }, verificationCode }
 */
async function buildReportContext(p) {
  const { c, calc } = p;
  const org = c.organization;
  const i = p.inspection;
  const fieldValue = (f) => {
    const v = p.propertyData?.[f.key];
    if (v === undefined || v === null || v === '') return '—';
    if (f.type === 'BOOLEAN') return v ? 'Yes' : 'No';
    if (f.type === 'CURRENCY') return `₹ ${inr(v)}`;
    return `${v}${f.unit ? ` ${f.unit}` : ''}`;
  };
  const code = p.verificationCode;
  return {
    firm: {
      name: org.name,
      firmCode: org.firmCode,
      address: [org.addressLine1, org.addressLine2, org.city, org.state, org.pincode].filter(Boolean).join(', '),
      registrationNo: org.registrationNo,
      gstin: org.gstin,
      email: org.email,
      phone: org.phone,
    },
    case: {
      caseNumber: c.caseNumber,
      loanReference: c.loanReference,
      loanType: c.loanType,
      loanAmount: c.loanAmount != null ? inr(c.loanAmount) : null,
      receivedOn: date(c.receivedOn),
      financialYear: c.financialYear.label,
    },
    client: { name: c.client.name, type: c.client.clientType.replaceAll('_', ' ').toLowerCase(), address: [c.client.addressLine1, c.client.city].filter(Boolean).join(', ') },
    bank: { name: c.bank.name, branch: c.bank.branch, shortCode: c.bank.shortCode },
    category: { name: c.category.name, code: c.category.code },
    property: { fields: (p.propertyFields || []).map((f) => ({ label: f.label, value: fieldValue(f) })) },
    inspection: i
      ? {
          officer: i.officerName,
          date: date(i.inspectedAt ?? i.submittedAt),
          address: i.propertyAddress ?? '—',
          gps: i.gpsLat != null ? `${Number(i.gpsLat).toFixed(6)}, ${Number(i.gpsLng).toFixed(6)}` : `Not recorded${i.gpsDeclinedReason ? ` (${i.gpsDeclinedReason})` : ''}`,
          landArea: i.landArea != null ? `${Number(i.landArea)} ${i.landAreaUnit ?? ''}` : '—',
          buildingArea: i.buildingArea != null ? `${Number(i.buildingArea)} ${i.buildingAreaUnit ?? ''}` : '—',
          condition: i.condition ? i.condition.toLowerCase() : '—',
          construction: Object.entries(i.construction || {}).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}: ${v}`).join(', ') || '—',
          boundaries: ['north', 'south', 'east', 'west'].map((d) => `${d[0].toUpperCase()}: ${i.boundaries?.[d] || '—'}`).join(' · '),
          landmarks: (i.landmarks || []).map((l) => [l.name, l.distance, l.direction].filter(Boolean).join(' ')).join('; ') || '—',
          photoCount: i.photoCount ?? 0,
        }
      : null,
    valuation: { ...calc.totals, marketValueWords: amountInWords(calc.totals.marketValue), lines: calc.lines, assumptions: calc.assumptions, summary: p.summary },
    report: { title: p.stage === 'FINAL' ? 'VALUATION REPORT' : 'PRELIMINARY VALUATION REPORT', isPreliminary: p.stage !== 'FINAL', version: p.version, issueDate: date(new Date()) },
    people: p.people,
    verification: code ? { code, url: verificationUrl(code), qr: await QRCode.toDataURL(verificationUrl(code), { margin: 0, width: 160 }) } : null,
  };
}

/** Sample context for template previews in the template master. */
async function sampleContext() {
  return buildReportContext({
    c: {
      caseNumber: 'VAL-FIRM001-FY2627-000123',
      loanReference: 'HL/2026/0456',
      loanType: 'Home loan',
      loanAmount: 6500000,
      receivedOn: new Date(),
      financialYear: { label: 'FY 2026-27' },
      client: { name: 'Sample Applicant', clientType: 'INDIVIDUAL', addressLine1: 'Kothrud', city: 'Pune' },
      bank: { name: 'Sample Bank', branch: 'Main Branch', shortCode: 'SMPL' },
      category: { name: 'Land and Building', code: 'LAND_BUILDING' },
      organization: { name: 'Your Firm', firmCode: 'FIRM001', addressLine1: 'Office address', city: 'Pune', email: 'office@example.com' },
    },
    propertyFields: [
      { key: 'propertyType', label: 'Property type', type: 'TEXT' },
      { key: 'landArea', label: 'Land area', type: 'AREA', unit: 'sq.ft' },
    ],
    propertyData: { propertyType: 'Independent House / Bungalow', landArea: 2000 },
    inspection: { officerName: 'Field Officer', inspectedAt: new Date(), propertyAddress: 'Plot 7, Sample Society, Pune', gpsLat: 18.5, gpsLng: 73.8, landArea: 2000, landAreaUnit: 'sq.ft', buildingArea: 1500, buildingAreaUnit: 'sq.ft', condition: 'GOOD', construction: { structure: 'RCC' }, boundaries: {}, landmarks: [], photoCount: 6 },
    calc: {
      lines: [
        { section: 'Land', label: 'Land value', quantity: 2000, unit: 'sq.ft', rate: 3000, amount: 6000000 },
        { section: 'Building', label: 'Depreciated building value', amount: 2325000 },
      ],
      totals: { marketValue: 8325000, realisableValue: 7493000, distressValue: 6660000, guidelineValue: 5000000, insurableValue: 3000000 },
      assumptions: ['Sample assumption'],
    },
    stage: 'FINAL',
    version: 1,
    summary: 'Sample summary.',
    people: { preparedBy: 'Junior Reviewer', valuer: 'Senior Reviewer', valuerRegistration: 'IBBI/RV/00/0000/00000' },
    verificationCode: 'SAMPLE-CODE',
  });
}

export { compileTemplate, assertTemplateCompiles, buildReportContext, sampleContext, verificationUrl };
