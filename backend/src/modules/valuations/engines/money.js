/** Money helpers for valuation reports (INR). */

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Rounds to the nearest `step` rupees (valuers usually round final values to ₹1,000 or ₹10,000). */
const roundTo = (n, step = 1) => (step > 1 ? Math.round(Number(n) / step) * step : round2(n));

const pct = (value, percent) => round2((Number(value) * Number(percent)) / 100);

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function below1000(n) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (r) parts.push(r < 20 ? ONES[r] : `${TENS[Math.floor(r / 10)]}${r % 10 ? ` ${ONES[r % 10]}` : ''}`);
  return parts.join(' ');
}

/** Indian numbering: "Rupees One Crore Twenty Lakh Fifty Thousand Only". */
function amountInWords(amount) {
  let n = Math.floor(Math.abs(Number(amount) || 0));
  if (n === 0) return 'Rupees Zero Only';
  const parts = [];
  const crore = Math.floor(n / 1e7);
  n %= 1e7;
  const lakh = Math.floor(n / 1e5);
  n %= 1e5;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) parts.push(`${crore >= 1000 ? amountInWords(crore).replace(/^Rupees | Only$/g, '') : below1000(crore)} Crore`);
  if (lakh) parts.push(`${below1000(lakh)} Lakh`);
  if (thousand) parts.push(`${below1000(thousand)} Thousand`);
  if (n) parts.push(below1000(n));
  return `Rupees ${parts.join(' ')} Only`;
}

export { round2, roundTo, pct, amountInWords };
