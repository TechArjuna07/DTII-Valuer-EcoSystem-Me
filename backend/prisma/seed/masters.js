/**
 * Platform reference masters (idempotent): valuation categories with their configurable field definitions,
 * and default document types. Firms may add their own categories / document types on top.
 */

const S = (section, key, label, type, extra = {}) => ({ section, key, label, type, ...extra });
const opts = (...values) => ({ options: values });

const CATEGORIES = [
  {
    code: 'LAND_BUILDING',
    name: 'Land and Building',
    engine: 'LAND_BUILDING',
    description: 'Residential, commercial and industrial land and buildings, flats and open plots.',
    fields: [
      S('Property identification', 'propertyType', 'Property type', 'SELECT', {
        required: true,
        ...opts('Residential Flat', 'Independent House / Bungalow', 'Commercial Shop / Office', 'Industrial Building', 'Open Plot', 'Agricultural Land', 'Mixed Use'),
      }),
      S('Property identification', 'ownerName', 'Owner name(s) as per title', 'TEXT', { required: true }),
      S('Property identification', 'titleDocument', 'Title document', 'SELECT', opts('Sale Deed', 'Gift Deed', 'Lease Deed', 'Partition Deed', 'Allotment Letter', 'Other')),
      S('Property identification', 'surveyNo', 'Survey / Gat no.', 'TEXT'),
      S('Property identification', 'ctsNo', 'CTS / City survey no.', 'TEXT'),
      S('Property identification', 'plotNo', 'Plot / Flat no.', 'TEXT'),
      S('Property identification', 'village', 'Village / Locality', 'TEXT'),
      S('Property identification', 'taluka', 'Taluka', 'TEXT'),
      S('Property identification', 'district', 'District', 'TEXT'),
      S('Land', 'landArea', 'Land / plot area', 'AREA', { required: true }),
      S('Land', 'landAreaUnit', 'Land area unit', 'SELECT', { required: true, ...opts('sq.ft', 'sq.m', 'acre', 'hectare', 'guntha') }),
      S('Building', 'builtUpArea', 'Built-up area', 'AREA', { unit: 'sq.ft' }),
      S('Building', 'carpetArea', 'Carpet area', 'AREA', { unit: 'sq.ft' }),
      S('Building', 'floors', 'Number of floors', 'NUMBER'),
      S('Building', 'yearOfConstruction', 'Year of construction', 'NUMBER'),
      S('Building', 'constructionType', 'Construction type', 'SELECT', opts('RCC Framed', 'Load Bearing', 'Steel Structure', 'Other')),
      S('Building', 'occupancy', 'Occupancy', 'SELECT', opts('Self Occupied', 'Tenanted', 'Vacant', 'Under Construction')),
      S('Approvals', 'sanctionedPlan', 'Sanctioned building plan available', 'BOOLEAN'),
      S('Approvals', 'occupancyCertificate', 'Occupancy / completion certificate available', 'BOOLEAN'),
      S('Approvals', 'approvingAuthority', 'Approving authority', 'TEXT'),
      S('Boundaries', 'boundaryNorth', 'North', 'TEXT'),
      S('Boundaries', 'boundarySouth', 'South', 'TEXT'),
      S('Boundaries', 'boundaryEast', 'East', 'TEXT'),
      S('Boundaries', 'boundaryWest', 'West', 'TEXT'),
    ],
  },
  {
    code: 'PLANT_MACHINERY',
    name: 'Plant and Machinery',
    engine: 'PLANT_MACHINERY',
    description: 'Industrial plant, machinery and equipment.',
    fields: [
      S('Unit', 'unitName', 'Unit / factory name', 'TEXT', { required: true }),
      S('Unit', 'industryType', 'Industry type', 'TEXT'),
      S('Unit', 'factoryAddress', 'Factory address', 'TEXTAREA'),
      S('Unit', 'installedCapacity', 'Installed capacity', 'TEXT'),
      S('Unit', 'yearOfCommencement', 'Year of commencement', 'NUMBER'),
      S('Unit', 'powerLoadKw', 'Connected power load', 'NUMBER', { unit: 'kW' }),
      S('Unit', 'machineryCount', 'Number of machines', 'NUMBER'),
      S('Unit', 'operationalStatus', 'Operational status', 'SELECT', { required: true, ...opts('Operational', 'Partially Operational', 'Idle', 'Closed') }),
      S('Unit', 'maintenanceRecords', 'Maintenance records available', 'BOOLEAN'),
    ],
  },
  {
    code: 'STOCK',
    name: 'Stock',
    engine: 'STOCK',
    description: 'Inventory: raw material, work in progress, finished and trading goods.',
    fields: [
      S('Stock', 'stockType', 'Stock type', 'SELECT', { required: true, ...opts('Raw Material', 'Work in Progress', 'Finished Goods', 'Trading Goods', 'Mixed') }),
      S('Stock', 'stockLocation', 'Stock location(s)', 'TEXTAREA', { required: true }),
      S('Stock', 'storageCondition', 'Storage condition', 'SELECT', opts('Good', 'Average', 'Poor')),
      S('Stock', 'lastStockStatementDate', 'Last stock statement date', 'DATE'),
      S('Stock', 'hypothecatedTo', 'Hypothecated to', 'TEXT'),
      S('Insurance', 'insurancePolicyNo', 'Insurance policy no.', 'TEXT'),
      S('Insurance', 'insuredValue', 'Insured value', 'CURRENCY'),
    ],
  },
];

const DOCUMENT_TYPES = [
  ['LOAN_APPLICATION', 'Loan application', 'SOURCE_FILES'],
  ['TITLE_DEED', 'Title / sale deed', 'SOURCE_FILES'],
  ['PROPERTY_TAX', 'Property tax receipt', 'SOURCE_FILES'],
  ['APPROVED_PLAN', 'Approved building plan', 'SOURCE_FILES'],
  ['LAND_RECORD', '7/12 extract / property card', 'SOURCE_FILES'],
  ['ENCUMBRANCE', 'Encumbrance / search report', 'SOURCE_FILES'],
  ['KYC', 'KYC documents', 'SOURCE_FILES'],
  ['MACHINERY_INVOICE', 'Machinery invoices', 'SOURCE_FILES'],
  ['STOCK_STATEMENT', 'Stock statement', 'SOURCE_FILES'],
  ['INSPECTION_REPORT', 'Inspection report', 'INSPECTION_DOCUMENTS'],
  ['SITE_PHOTO', 'Site photograph', 'PROPERTY_PHOTOGRAPHS'],
  ['PRELIMINARY_REPORT', 'Preliminary valuation report', 'PRELIMINARY_VALUATION'],
  ['REVIEW_NOTE', 'Senior review note', 'SENIOR_REVIEW'],
  ['FINAL_REPORT', 'Final valuation report', 'FINAL_VALUATION_REPORT'],
  ['SIGNED_REPORT', 'Signed valuation report', 'CLIENT_SIGNED_FILES'],
  ['BANK_ACKNOWLEDGEMENT', 'Bank acknowledgement', 'BANK_SUBMISSION'],
  ['SANCTION_LETTER', 'Sanction letter', 'SANCTION_DOCUMENTS'],
  ['DISBURSEMENT_PROOF', 'Disbursement confirmation', 'DISBURSEMENT_DOCUMENTS'],
  ['OTHER', 'Other', 'SOURCE_FILES'],
];

async function seedMasters(prisma) {
  let fields = 0;
  for (const [i, c] of CATEGORIES.entries()) {
    const existing = await prisma.valuationCategory.findFirst({ where: { firmId: null, code: c.code } });
    const cat = existing
      ? await prisma.valuationCategory.update({ where: { id: existing.id }, data: { name: c.name, description: c.description, engine: c.engine, sortOrder: i } })
      : await prisma.valuationCategory.create({ data: { code: c.code, name: c.name, description: c.description, engine: c.engine, sortOrder: i } });
    for (const [j, f] of c.fields.entries()) {
      const data = { section: f.section, label: f.label, type: f.type, required: !!f.required, options: f.options ?? null, unit: f.unit ?? null, helpText: f.helpText ?? null, sortOrder: j };
      await prisma.categoryFieldDefinition.upsert({ where: { categoryId_key: { categoryId: cat.id, key: f.key } }, update: data, create: { ...data, categoryId: cat.id, key: f.key } });
      fields += 1;
    }
  }
  for (const [i, [code, name, defaultFolder]] of DOCUMENT_TYPES.entries()) {
    const existing = await prisma.documentType.findFirst({ where: { firmId: null, code } });
    if (existing) await prisma.documentType.update({ where: { id: existing.id }, data: { name, defaultFolder, sortOrder: i } });
    else await prisma.documentType.create({ data: { code, name, defaultFolder, sortOrder: i } });
  }
  return { categories: CATEGORIES.length, categoryFields: fields, documentTypes: DOCUMENT_TYPES.length };
}

export { seedMasters, CATEGORIES, DOCUMENT_TYPES };
