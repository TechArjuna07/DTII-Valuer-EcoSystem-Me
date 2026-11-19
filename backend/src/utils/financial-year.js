/**
 * Indian financial year helpers (1 April – 31 March), evaluated in IST.
 *   FY starting 2026 → code "2026-27", shortCode "2627", label "FY 2026-27".
 */

const IST = 'Asia/Kolkata';

/** Calendar date in IST as { y, m, d } (m is 1-12). */
function istParts(date = new Date()) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(date)
    .split('-')
    .map(Number);
  return { y, m, d };
}

/** Start year of the financial year containing `date` (IST). */
function fyStartYear(date = new Date()) {
  const { y, m } = istParts(date);
  return m >= 4 ? y : y - 1;
}

/** Financial year descriptor for a start year. Dates are UTC midnight (stored as SQL DATE). */
function fyFromStartYear(startYear) {
  if (!Number.isInteger(startYear) || startYear < 2000 || startYear > 2098) throw new RangeError('Invalid financial year');
  const next2 = String((startYear + 1) % 100).padStart(2, '0');
  const cur2 = String(startYear % 100).padStart(2, '0');
  return {
    code: `${startYear}-${next2}`,
    shortCode: `${cur2}${next2}`,
    label: `FY ${startYear}-${next2}`,
    startDate: new Date(Date.UTC(startYear, 3, 1)),
    endDate: new Date(Date.UTC(startYear + 1, 2, 31)),
  };
}

const currentFinancialYear = (date = new Date()) => fyFromStartYear(fyStartYear(date));

export { fyStartYear, fyFromStartYear, currentFinancialYear, istParts };
