import { z } from 'zod';
import { pct, round2, roundTo } from './money.js';

/**
 * Valuation calculation engines (pure functions, unit-tested). Each engine validates its inputs and returns
 *   { lines: [{ section, label, quantity, unit, rate, amount, note }], totals: { marketValue, realisableValue,
 *     distressValue, guidelineValue?, insurableValue? }, assumptions: [] }
 * The API always recomputes from inputs; client-sent totals are never trusted.
 */

const n = (max = 1e13) => z.coerce.number().min(0).max(max);
const percent = (def) => z.coerce.number().min(0).max(100).default(def);
const common = { realisablePct: percent(90), distressPct: percent(80), roundTo: z.coerce.number().int().min(1).max(1_000_000).default(1000) };

/** Straight-line depreciation % with a salvage floor: min(age / life, 1) × (100 − salvage). */
const depreciationPct = (age, life, salvage) => (life > 0 ? Math.min(Math.max(age, 0) / life, 1) * (100 - salvage) : 0);

// ───────────── Land & building ─────────────
const landBuildingInputs = z.strictObject({
  land: z.strictObject({ area: n(1e10), unit: z.enum(['sq.ft', 'sq.m', 'acre', 'hectare', 'guntha']).default('sq.ft'), ratePerUnit: n(), guidelineRatePerUnit: n().optional() }),
  building: z
    .strictObject({
      builtUpArea: n(1e10),
      unit: z.enum(['sq.ft', 'sq.m']).default('sq.ft'),
      replacementRatePerUnit: n(),
      ageYears: n(300),
      totalLifeYears: z.coerce.number().min(1).max(300).default(60),
      salvagePct: percent(10),
    })
    .optional(),
  amenities: z.array(z.strictObject({ description: z.string().trim().min(1).max(200), amount: n() })).max(50).default([]),
  ...common,
});

function landBuilding(raw) {
  const i = landBuildingInputs.parse(raw);
  const lines = [];
  const landValue = round2(i.land.area * i.land.ratePerUnit);
  lines.push({ section: 'Land', label: 'Land value', quantity: i.land.area, unit: i.land.unit, rate: i.land.ratePerUnit, amount: landValue });
  let buildingValue = 0;
  let insurableValue = null;
  if (i.building) {
    const b = i.building;
    const replacement = round2(b.builtUpArea * b.replacementRatePerUnit);
    const dep = round2(depreciationPct(b.ageYears, b.totalLifeYears, b.salvagePct));
    buildingValue = round2(replacement - pct(replacement, dep));
    insurableValue = replacement;
    lines.push({ section: 'Building', label: 'Replacement cost (new)', quantity: b.builtUpArea, unit: b.unit, rate: b.replacementRatePerUnit, amount: replacement });
    lines.push({ section: 'Building', label: `Less depreciation ${dep}% (age ${b.ageYears} of ${b.totalLifeYears} yrs, salvage ${b.salvagePct}%)`, amount: -pct(replacement, dep) });
    lines.push({ section: 'Building', label: 'Depreciated building value', amount: buildingValue });
  }
  const amenities = i.amenities.reduce((s, a) => s + a.amount, 0);
  i.amenities.forEach((a) => lines.push({ section: 'Amenities', label: a.description, amount: round2(a.amount) }));
  const marketValue = roundTo(landValue + buildingValue + amenities, i.roundTo);
  return {
    lines,
    totals: {
      marketValue,
      realisableValue: roundTo(pct(marketValue, i.realisablePct), i.roundTo),
      distressValue: roundTo(pct(marketValue, i.distressPct), i.roundTo),
      guidelineValue: i.land.guidelineRatePerUnit != null ? roundTo(i.land.area * i.land.guidelineRatePerUnit, i.roundTo) : null,
      insurableValue: insurableValue != null ? roundTo(insurableValue, i.roundTo) : null,
    },
    assumptions: [`Realisable value ${i.realisablePct}% and distress value ${i.distressPct}% of market value`, `Values rounded to the nearest ₹${i.roundTo.toLocaleString('en-IN')}`],
    inputs: i,
  };
}

// ───────────── Plant & machinery ─────────────
const plantInputs = z.strictObject({
  valuationYear: z.coerce.number().int().min(1950).max(2200),
  items: z
    .array(
      z.strictObject({
        description: z.string().trim().min(1).max(200),
        make: z.string().trim().max(100).optional(),
        quantity: z.coerce.number().min(0).max(1e7).default(1),
        yearOfPurchase: z.coerce.number().int().min(1900).max(2200),
        replacementCostNew: n(),
        usefulLifeYears: z.coerce.number().min(1).max(100).default(15),
        conditionFactor: z.coerce.number().min(0.1).max(1.2).default(1),
      }),
    )
    .min(1, 'Add at least one machine')
    .max(500),
  salvagePct: percent(5),
  ...common,
  realisablePct: percent(85),
  distressPct: percent(70),
});

function plantMachinery(raw) {
  const i = plantInputs.parse(raw);
  let total = 0;
  let rcnTotal = 0;
  const lines = i.items.map((it) => {
    const age = i.valuationYear - it.yearOfPurchase;
    const dep = depreciationPct(age, it.usefulLifeYears, i.salvagePct);
    const rcn = it.quantity * it.replacementCostNew;
    const amount = round2(rcn * (1 - dep / 100) * it.conditionFactor);
    total += amount;
    rcnTotal += rcn;
    return { section: 'Plant & machinery', label: `${it.description}${it.make ? ` (${it.make})` : ''}`, quantity: it.quantity, unit: 'nos', rate: it.replacementCostNew, amount, note: `Age ${age} yrs / life ${it.usefulLifeYears} · depreciation ${round2(dep)}% · condition ×${it.conditionFactor}` };
  });
  const marketValue = roundTo(total, i.roundTo);
  return {
    lines,
    totals: { marketValue, realisableValue: roundTo(pct(marketValue, i.realisablePct), i.roundTo), distressValue: roundTo(pct(marketValue, i.distressPct), i.roundTo), guidelineValue: null, insurableValue: roundTo(rcnTotal, i.roundTo) },
    assumptions: [`Depreciated replacement cost method, salvage ${i.salvagePct}%`, `Realisable ${i.realisablePct}%, distress ${i.distressPct}% of fair market value`],
    inputs: i,
  };
}

// ───────────── Stock ─────────────
const stockInputs = z.strictObject({
  items: z
    .array(
      z.strictObject({
        description: z.string().trim().min(1).max(200),
        category: z.enum(['RAW_MATERIAL', 'WORK_IN_PROGRESS', 'FINISHED_GOODS', 'TRADING_GOODS', 'OTHER']).default('OTHER'),
        quantity: z.coerce.number().min(0).max(1e10),
        unit: z.string().trim().min(1).max(20),
        ratePerUnit: n(),
        obsolescencePct: percent(0),
      }),
    )
    .min(1, 'Add at least one stock line')
    .max(1000),
  ...common,
  realisablePct: percent(75),
  distressPct: percent(60),
});

function stock(raw) {
  const i = stockInputs.parse(raw);
  let total = 0;
  const lines = i.items.map((it) => {
    const gross = it.quantity * it.ratePerUnit;
    const amount = round2(gross - pct(gross, it.obsolescencePct));
    total += amount;
    return { section: it.category.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()), label: it.description, quantity: it.quantity, unit: it.unit, rate: it.ratePerUnit, amount, note: it.obsolescencePct ? `less ${it.obsolescencePct}% obsolescence` : undefined };
  });
  const marketValue = roundTo(total, i.roundTo);
  return {
    lines,
    totals: { marketValue, realisableValue: roundTo(pct(marketValue, i.realisablePct), i.roundTo), distressValue: roundTo(pct(marketValue, i.distressPct), i.roundTo), guidelineValue: null, insurableValue: marketValue },
    assumptions: ['Stock valued at the lower of cost and net realisable value as per physical verification', `Realisable ${i.realisablePct}%, distress ${i.distressPct}% of stock value`],
    inputs: i,
  };
}

// ───────────── Residential flat (composite rate method, SBI / IBA flat format) ─────────────
const SQFT_PER_SQM = 10.7639;
const text = (max) => z.string().trim().max(max).optional();
/** Narrative sections of the flat report (versioned with the calculation; printed verbatim). */
const flatReport = z
  .strictObject({
    purpose: text(300),
    appointmentDate: text(30),
    appointingAuthority: text(300),
    documents: z.array(z.string().trim().min(1).max(600)).max(30).default([]),
    marketability: text(100),
    positiveFactors: text(1000),
    negativeFactors: text(1000),
    comparableAnalysis: text(3000),
    adoptedRateNote: text(1500),
    rateBreakupNote: text(1000),
    methodology: text(3000),
    deviationJustification: text(3000),
    inspectedBy: text(200),
    place: text(100),
  })
  .default({});

const flatInputs = z.strictObject({
  builtUpArea: z.coerce.number().positive().max(1e7),
  areaUnit: z.enum(['sq.ft', 'sq.m']).default('sq.ft'),
  areaBasis: z.string().trim().max(200).default('Built up area'),
  compositeRate: n(1e8),
  constructionCostPerUnit: n(1e7),
  ageYears: n(300),
  totalLifeYears: z.coerce.number().min(1).max(300).default(60),
  salvagePct: percent(10),
  extras: z.array(z.strictObject({ description: z.string().trim().min(1).max(200), amount: n() })).max(20).default([]),
  realisablePct: percent(98),
  distressPct: percent(75),
  bookValue: n().optional(),
  guidelineRatePerSqM: n().optional(),
  readyReckonerValue: n().optional(),
  roundTo: z.coerce.number().int().min(1).max(1_000_000).default(1),
  report: flatReport,
  /** Proforma invoice printed as the first page of the report when a fee is entered. */
  invoice: z.strictObject({ fee: n(1e8).optional(), bankOfficer: text(120) }).default({}),
});

/**
 * Flat value = area × (composite market rate − depreciation per unit), where depreciation applies to the
 * construction cost only: (100 − salvage) / life % per year × age (e.g. 90 / 60 = 1.5 % per year).
 * Insurance value = construction cost × area; depreciated building value (WDV) = insurance value × remaining ratio.
 */
function flat(raw) {
  const i = flatInputs.parse(raw);
  const yearlyPct = round2((100 - i.salvagePct) / i.totalLifeYears);
  const depPct = round2(Math.min(i.ageYears * yearlyPct, 100 - i.salvagePct));
  const depPerUnit = round2((i.constructionCostPerUnit * depPct) / 100);
  const netRate = round2(i.compositeRate - depPerUnit);
  const gross = round2(i.builtUpArea * i.compositeRate);
  const depAmount = round2(i.builtUpArea * depPerUnit);
  const extras = i.extras.reduce((sum, e) => sum + e.amount, 0);
  const marketValue = roundTo(gross - depAmount + extras, i.roundTo);
  const replacementCost = round2(i.builtUpArea * i.constructionCostPerUnit);
  const areaSqM = i.areaUnit === 'sq.m' ? i.builtUpArea : round2(i.builtUpArea / SQFT_PER_SQM);
  const guidelineValue = i.readyReckonerValue ?? (i.guidelineRatePerSqM != null ? roundTo(areaSqM * i.guidelineRatePerSqM, i.roundTo) : null);
  const lines = [
    { section: 'Flat', label: `Fair market value with present composite rate — ${i.areaBasis} × market rate`, quantity: i.builtUpArea, unit: i.areaUnit, rate: i.compositeRate, amount: gross },
    { section: 'Flat', label: `Less: depreciation @ ${yearlyPct}% for ${i.ageYears} years on construction cost @ ₹${i.constructionCostPerUnit.toLocaleString('en-IN')} per ${i.areaUnit}`, rate: depPerUnit, amount: -depAmount },
    { section: 'Flat', label: 'Fair market value of the flat', rate: netRate, amount: round2(gross - depAmount) },
    ...i.extras.map((e) => ({ section: 'Extras', label: e.description, amount: round2(e.amount) })),
  ];
  return {
    lines,
    totals: {
      marketValue,
      realisableValue: roundTo(pct(marketValue, i.realisablePct), i.roundTo),
      distressValue: roundTo(pct(marketValue, i.distressPct), i.roundTo),
      guidelineValue,
      insurableValue: roundTo(replacementCost, i.roundTo),
    },
    flat: {
      yearlyDepreciationPct: yearlyPct,
      depreciationPct: depPct,
      depreciatedRatioPct: round2(100 - depPct),
      remainingLifeYears: Math.max(i.totalLifeYears - i.ageYears, 0),
      depreciationPerUnit: depPerUnit,
      netRate,
      replacementCost,
      depreciatedBuildingValue: round2(replacementCost * (1 - depPct / 100)),
      areaSqM,
      bookValue: i.bookValue ?? null,
      guidelineRatePerSqM: i.guidelineRatePerSqM ?? null,
      deviationFromGuidelinePct: guidelineValue ? round2(((marketValue - guidelineValue) / guidelineValue) * 100) : null,
    },
    assumptions: [
      `Composite rate method: ₹${i.compositeRate.toLocaleString('en-IN')} per ${i.areaUnit} on ${i.areaBasis.toLowerCase()}, inclusive of land and building`,
      `Depreciation ${yearlyPct}% per year (salvage ${i.salvagePct}%, life ${i.totalLifeYears} years) on construction cost only`,
      `Realisable value ${i.realisablePct}% and distress value ${i.distressPct}% of fair market value`,
    ],
    inputs: i,
  };
}

const ENGINES = { LAND_BUILDING: landBuilding, PLANT_MACHINERY: plantMachinery, STOCK: stock, FLAT: flat };

/** @throws {import('zod').ZodError} on invalid inputs */
function calculate(engine, inputs) {
  const fn = ENGINES[engine];
  if (!fn) throw new Error(`Unknown valuation engine ${engine}`);
  return fn(inputs);
}

export { calculate, ENGINES, depreciationPct };
