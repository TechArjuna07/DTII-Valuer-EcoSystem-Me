import { currentFinancialYear, fyFromStartYear, fyStartYear } from '../../src/utils/financial-year.js';

describe('financial year (IST, April–March)', () => {
  test('builds codes used in Case IDs', () => {
    const fy = fyFromStartYear(2026);
    expect(fy).toMatchObject({ code: '2026-27', shortCode: '2627', label: 'FY 2026-27' });
    expect(fy.startDate.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(fy.endDate.toISOString()).toBe('2027-03-31T00:00:00.000Z');
  });

  test('century rollover keeps two-digit short codes', () => {
    expect(fyFromStartYear(2099 - 1).shortCode).toBe('9899');
  });

  test('31 March belongs to the previous FY, 1 April starts a new one (IST boundaries)', () => {
    // 31 Mar 2027 23:00 IST = 17:30 UTC
    expect(fyStartYear(new Date('2027-03-31T17:30:00Z'))).toBe(2026);
    // 1 Apr 2027 00:10 IST = 31 Mar 18:40 UTC — already the new FY in India
    expect(fyStartYear(new Date('2027-03-31T18:40:00Z'))).toBe(2027);
  });

  test('current FY for 19 Nov 2026 is 2026-27', () => {
    expect(currentFinancialYear(new Date('2026-11-19T06:00:00Z')).code).toBe('2026-27');
  });

  test('rejects nonsense years', () => {
    expect(() => fyFromStartYear(1999)).toThrow(RangeError);
    expect(() => fyFromStartYear(2026.5)).toThrow(RangeError);
  });
});
