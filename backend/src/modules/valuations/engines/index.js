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

const ENGINES = { LAND_BUILDING: landBuilding, PLANT_MACHINERY: plantMachinery, STOCK: stock };

/** @throws {import('zod').ZodError} on invalid inputs */
function calculate(engine, inputs) {
  const fn = ENGINES[engine];
  if (!fn) throw new Error(`Unknown valuation engine ${engine}`);
  return fn(inputs);
}

export { calculate, ENGINES, depreciationPct };
