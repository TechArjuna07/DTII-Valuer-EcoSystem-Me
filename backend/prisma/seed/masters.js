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
    // SBI / IBA bank format for flats: sections I-III of the valuation report. The calculation, rates and narrative
    // (sections IV-VI, declaration) are entered with the valuation by the junior / senior reviewer.
    code: 'FLAT',
    name: 'Residential Flat / Apartment',
    engine: 'FLAT',
    description: 'Flats and apartments in a building - bank (SBI / IBA) flat report format, composite rate method.',
    fields: [
      S('Owner & title', 'ownerName', 'Name of the owner(s)', 'TEXT', { required: true }),
      S('Owner & title', 'ownershipNote', 'Share of each owner (joint ownership)', 'TEXT', { helpText: 'e.g. Joint ownership' }),
      S('Owner & title', 'saleDeedName', 'Sale deed / agreement executed in the name of', 'TEXT'),
      S('Owner & title', 'tenure', 'Freehold or leasehold (lessor, lessee, lease terms)', 'TEXTAREA'),
      S('Location', 'postalAddress', 'Postal address of the property', 'TEXTAREA', { required: true }),
      S('Location', 'surveyNo', 'Plot no. / Survey no. / CTS no.', 'TEXT'),
      S('Location', 'landmark', 'Nearest landmark', 'TEXT'),
      S('Location', 'doorNo', 'Door no.', 'TEXT'),
      S('Location', 'tsNoVillage', 'T.S. no. / Village', 'TEXT'),
      S('Location', 'wardTaluka', 'Ward / Taluka', 'TEXT'),
      S('Location', 'district', 'Mandal / District', 'TEXT'),
      S('Location', 'pincode', 'Pin code', 'TEXT'),
      S('Location', 'cityTown', 'City / Town', 'TEXT'),
      S('Approved plan', 'planApproval', 'Date of issue and validity of approved map / plan', 'TEXTAREA', { helpText: 'e.g. Full Occupation Certificate no. ... issued by MCGM dated ...' }),
      S('Approved plan', 'planAuthority', 'Approved map / plan issuing authority', 'TEXT'),
      S('Approved plan', 'planVerified', 'Genuineness of approved map / plan verified', 'SELECT', opts('Yes', 'No', 'Not verified')),
      S('Approved plan', 'planComments', 'Other comments on the approved plan', 'TEXTAREA'),
      S('Area & classification', 'residentialArea', 'Residential area', 'BOOLEAN'),
      S('Area & classification', 'commercialArea', 'Commercial area', 'BOOLEAN'),
      S('Area & classification', 'industrialArea', 'Industrial area', 'BOOLEAN'),
      S('Area & classification', 'areaClass', 'Classification: high / middle / poor', 'SELECT', opts('High Class', 'Upper Middle and Higher Class', 'Middle Class', 'Lower Middle Class', 'Poor')),
      S('Area & classification', 'urbanRural', 'Urban / semi urban / rural', 'SELECT', opts('Urban', 'Semi Urban', 'Rural')),
      S('Area & classification', 'localAuthority', 'Corporation limit / village panchayat / municipality', 'TEXT'),
      S('Area & classification', 'enactments', 'Covered under State / Central Govt. enactments (ULC, scheduled area, cantonment)', 'TEXT'),
      S('Boundaries', 'flatNorth', 'Flat - North', 'TEXT'),
      S('Boundaries', 'flatSouth', 'Flat - South', 'TEXT'),
      S('Boundaries', 'flatEast', 'Flat - East', 'TEXT'),
      S('Boundaries', 'flatWest', 'Flat - West', 'TEXT'),
      S('Boundaries', 'plotNorth', 'Plot - North', 'TEXT'),
      S('Boundaries', 'plotSouth', 'Plot - South', 'TEXT'),
      S('Boundaries', 'plotEast', 'Plot - East', 'TEXT'),
      S('Boundaries', 'plotWest', 'Plot - West', 'TEXT'),
      S('Site extent & occupancy', 'dimensionsAsPerDocs', 'Dimensions / area as per documents', 'TEXTAREA'),
      S('Site extent & occupancy', 'dimensionsActual', 'Dimensions / area - actuals', 'TEXTAREA'),
      S('Site extent & occupancy', 'extentOfSite', 'Extent of the site', 'TEXTAREA'),
      S('Site extent & occupancy', 'extentConsidered', 'Extent considered for valuation (least of documents / actuals)', 'TEXTAREA'),
      S('Site extent & occupancy', 'occupancy', 'Occupied by owner / tenant', 'SELECT', { required: true, ...opts('Owner Occupied', 'Tenant Occupied', 'Vacant') }),
      S('Site extent & occupancy', 'monthlyRent', 'Monthly rent (if let out)', 'CURRENCY'),
      S('Apartment building', 'buildingNature', 'Nature of the apartment', 'TEXT', { helpText: 'e.g. Residential Building' }),
      S('Apartment building', 'buildingName', 'Building / society name', 'TEXT'),
      S('Apartment building', 'blockNo', 'Block no.', 'TEXT'),
      S('Apartment building', 'wardNo', 'Ward no.', 'TEXT'),
      S('Apartment building', 'municipality', 'Village / municipality / corporation', 'TEXT'),
      S('Apartment building', 'streetPin', 'Door no., street or road (pin code)', 'TEXT'),
      S('Apartment building', 'localityDescription', 'Description of the locality (residential / commercial / mixed)', 'TEXTAREA'),
      S('Apartment building', 'yearOfConstruction', 'Year of construction', 'NUMBER'),
      S('Apartment building', 'numberOfFloors', 'Number of floors', 'TEXT', { helpText: 'e.g. G+7' }),
      S('Apartment building', 'structureType', 'Type of structure', 'TEXT', { helpText: 'e.g. RCC frame structure with brick masonry' }),
      S('Apartment building', 'dwellingUnits', 'Number of dwelling units in the building', 'TEXT'),
      S('Apartment building', 'constructionQuality', 'Quality of construction', 'SELECT', opts('Excellent', 'Good', 'Average', 'Poor')),
      S('Apartment building', 'buildingAppearance', 'Appearance of the building', 'SELECT', opts('Excellent', 'Good', 'Average', 'Poor')),
      S('Apartment building', 'buildingMaintenance', 'Maintenance of the building', 'SELECT', opts('Excellent', 'Good', 'Average', 'Poor')),
      S('Apartment building', 'lift', 'Lift', 'TEXT'),
      S('Apartment building', 'waterSupply', 'Protected water supply', 'TEXT'),
      S('Apartment building', 'sewerage', 'Underground sewerage', 'TEXT'),
      S('Apartment building', 'carParking', 'Car parking - open / covered', 'TEXT'),
      S('Apartment building', 'compoundWall', 'Compound wall', 'TEXT'),
      S('Flat', 'floor', 'Floor on which the flat is situated', 'TEXT', { required: true }),
      S('Flat', 'flatNo', 'Door no. of the flat', 'TEXT', { required: true }),
      S('Flat', 'accommodation', 'Brief description (e.g. 1 BHK: living, bedroom, kitchen, 2 toilets)', 'TEXTAREA'),
      S('Flat', 'roof', 'Roof', 'TEXT'),
      S('Flat', 'flooring', 'Flooring', 'TEXT'),
      S('Flat', 'doors', 'Doors', 'TEXT'),
      S('Flat', 'windows', 'Windows', 'TEXT'),
      S('Flat', 'fittings', 'Fittings', 'TEXT'),
      S('Flat', 'finishing', 'Finishing', 'TEXT'),
      S('Flat', 'houseTaxAssessmentNo', 'House tax - assessment no.', 'TEXT'),
      S('Flat', 'houseTaxAmount', 'House tax - amount', 'TEXT'),
      S('Flat', 'houseTaxPaidMonth', 'House tax - paid in the month of', 'TEXT'),
      S('Flat', 'electricityConnectionNo', 'Electricity service connection no.', 'TEXT'),
      S('Flat', 'meterName', 'Meter card is in the name of', 'TEXT'),
      S('Flat', 'flatMaintenance', 'Maintenance of the flat', 'SELECT', opts('Excellent', 'Good', 'Average', 'Poor')),
      S('Flat', 'undividedLandArea', 'Undivided area of land as per sale deed', 'TEXT'),
      S('Flat', 'plinthArea', 'Plinth area of the flat', 'TEXT'),
      S('Flat', 'fsi', 'Floor space index (approx.)', 'TEXT'),
      S('Flat', 'carpetArea', 'Carpet area of the flat', 'TEXT'),
      S('Flat', 'flatClass', 'Posh / I class / medium / ordinary', 'SELECT', opts('Posh', 'I Class', 'Medium', 'Ordinary')),
      S('Flat', 'usage', 'Used for residential or commercial purpose', 'SELECT', opts('Residential purpose only', 'Commercial purpose', 'Mixed use')),
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
  // Annexures appended to the final flat report, in this order.
  ['LOCATION_MAP', 'Location map (annexure)', 'SENIOR_REVIEW'],
  ['READY_RECKONER_EVIDENCE', 'Ready reckoner / eASR evidence (annexure)', 'SENIOR_REVIEW'],
  ['MARKET_COMPARABLES', 'Market comparables / listings (annexure)', 'SENIOR_REVIEW'],
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
