/**
 * eASR districts, exactly as linked from https://igreval.maharashtra.gov.in/eASR2.0/frmMap.aspx
 * (eASRCommon.aspx?hDistName=<key>). Talukas, villages, years and rates are fetched from eASR on first use.
 * Mumbai City and Mumbai Suburban share the eASR key "Bombaymains".
 */
const ASR_DISTRICT_KEYS = [
  'Ahmednagar', 'Akola', 'Amravati', 'Aurangabad', 'Beed', 'Bhandara', 'Bombaymains', 'Buldhana', 'Chandrapur', 'Dhule',
  'Gadchiroli', 'Gondia', 'Hingoli', 'Jalgaon', 'Jalna', 'Kolhapur', 'Latur', 'Nagpur', 'Nanded', 'Nandurbar', 'Nashik',
  'Osmanabad', 'Palghar', 'Parbhani', 'Pune', 'Raigad', 'Ratnagiri', 'Sangli', 'Satara', 'Sindhudurg', 'Solapur', 'Thane',
  'Wardha', 'Washim', 'Yavatmal',
];
const DISPLAY_NAME = { Bombaymains: 'Mumbai (City & Suburban)' };

async function seedAsrDistricts(prisma) {
  for (const key of ASR_DISTRICT_KEYS) {
    const name = DISPLAY_NAME[key] ?? key;
    await prisma.asrDistrict.upsert({ where: { key }, update: { name }, create: { key, name } });
  }
  return { asrDistricts: ASR_DISTRICT_KEYS.length };
}

export { seedAsrDistricts, ASR_DISTRICT_KEYS };
