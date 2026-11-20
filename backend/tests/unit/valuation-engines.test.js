import { calculate, depreciationPct } from '../../src/modules/valuations/engines/index.js';
import { amountInWords } from '../../src/modules/valuations/engines/money.js';

describe('valuation engines', () => {
  test('land & building: land + depreciated building + amenities, with realisable / distress / guideline / insurable', () => {
    const r = calculate('LAND_BUILDING', {
      land: { area: 2000, ratePerUnit: 3000, guidelineRatePerUnit: 2500 },
      building: { builtUpArea: 1500, replacementRatePerUnit: 2000, ageYears: 15, totalLifeYears: 60, salvagePct: 10 },
      amenities: [{ description: 'Compound wall & gate', amount: 150000 }],
    });
    // land 60,00,000; building RCN 30,00,000 − 22.5% (15/60 × 90) = 23,25,000; amenities 1,50,000
    expect(r.totals.marketValue).toBe(8475000);
    expect(r.totals.realisableValue).toBe(7628000); // 90% rounded to ₹1,000
    expect(r.totals.distressValue).toBe(6780000);
    expect(r.totals.guidelineValue).toBe(5000000);
    expect(r.totals.insurableValue).toBe(3000000);
    expect(r.lines.find((l) => l.label === 'Depreciated building value').amount).toBe(2325000);
  });

  test('depreciation is capped at (100 − salvage) once the life is exhausted', () => {
    expect(depreciationPct(80, 60, 10)).toBe(90);
    expect(depreciationPct(-2, 60, 10)).toBe(0);
  });

  test('plant & machinery: depreciated replacement cost × condition factor per machine', () => {
    const r = calculate('PLANT_MACHINERY', {
      valuationYear: 2026,
      items: [
        { description: 'CNC lathe', quantity: 2, yearOfPurchase: 2016, replacementCostNew: 1000000, usefulLifeYears: 20, conditionFactor: 1 },
        { description: 'Compressor', quantity: 1, yearOfPurchase: 2021, replacementCostNew: 200000, usefulLifeYears: 10, conditionFactor: 0.9 },
      ],
    });
    // lathe: 20,00,000 × (1 − 47.5%) = 10,50,000; compressor: 2,00,000 × (1 − 47.5%) × 0.9 = 94,500
    expect(r.lines.map((l) => l.amount)).toEqual([1050000, 94500]);
    expect(r.totals.marketValue).toBe(1145000);
    expect(r.totals.insurableValue).toBe(2200000);
  });

  test('stock: quantity × rate less obsolescence', () => {
    const r = calculate('STOCK', {
      items: [
        { description: 'Steel coils', category: 'RAW_MATERIAL', quantity: 50, unit: 'MT', ratePerUnit: 60000 },
        { description: 'Finished brackets', category: 'FINISHED_GOODS', quantity: 10000, unit: 'nos', ratePerUnit: 120, obsolescencePct: 10 },
      ],
      roundTo: 1,
    });
    expect(r.totals.marketValue).toBe(3000000 + 1080000);
    expect(r.totals.distressValue).toBe(2448000);
  });

  test('rejects invalid inputs instead of computing nonsense', () => {
    expect(() => calculate('LAND_BUILDING', { land: { area: -1, ratePerUnit: 10 } })).toThrow();
    expect(() => calculate('STOCK', { items: [] })).toThrow();
    expect(() => calculate('LAND_BUILDING', { land: { area: 1, ratePerUnit: 1 }, marketValue: 999 })).toThrow(); // no client totals
  });

  test('amounts in words use Indian numbering', () => {
    expect(amountInWords(8475000)).toBe('Rupees Eighty Four Lakh Seventy Five Thousand Only');
    expect(amountInWords(125000000)).toBe('Rupees Twelve Crore Fifty Lakh Only');
    expect(amountInWords(0)).toBe('Rupees Zero Only');
  });
});
