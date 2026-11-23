/**
 * Diagnostic: reads one eASR statement live from igreval.maharashtra.gov.in and prints it — nothing is stored.
 * Use it to check the government site is reachable and that our parser still understands its pages.
 *
 *   pnpm --filter @valuers/backend asr:probe -- <DistrictKey> [talukaCode] [villageCode] [yearCode] [--survey]
 *   e.g. asr:probe -- Pune            (lists talukas and years)
 *        asr:probe -- Pune 58         (lists villages of Khed)
 *        asr:probe -- Pune 58 295     (rates of Chakan; add --survey for survey numbers too)
 */
import 'dotenv/config';
import { fetchDistrict, fetchVillages, crawlRates } from '../src/services/igr/easr.crawler.js';
import { redis } from '../src/database/redis.js';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const survey = process.argv.includes('--survey');
const [districtKey, taluka, village, year] = args;
if (!districtKey) {
  console.error('Usage: asr:probe -- <DistrictKey> [talukaCode] [villageCode] [yearCode] [--survey]');
  process.exit(1);
}
const t0 = Date.now();
try {
  if (!taluka) {
    const d = await fetchDistrict(districtKey);
    console.log(`District code ${d.districtCode}; current year ${d.currentYear}; years: ${d.years.map((y) => `${y.code}=${y.label}`).join(', ')}`);
    for (const t of d.talukas) console.log(`  ${t.code}\t${t.name}`);
  } else if (!village) {
    const v = await fetchVillages({ districtKey, talukaCode: Number(taluka) });
    console.log(`${v.villages.length} villages`);
    for (const x of v.villages) console.log(`  ${x.code}\t${x.name}`);
  } else {
    let surveyed = 0;
    const r = await crawlRates(
      { districtKey, talukaCode: Number(taluka), villageCode: Number(village), yearCode: year ? Number(year) : undefined },
      {
        onRates: async (res) => {
          console.log(`Area type ${res.areaType}${res.vibhagNo ? `, vibhag ${res.vibhagNo}` : ''}; ${res.rows.length} rate rows${res.locations.length ? ` in ${res.locations.length} land categories` : ''}`);
          for (const row of res.rows.slice(0, 8)) console.log('  ', JSON.stringify(row));
          if (res.rows.length > 8) console.log(`   … ${res.rows.length - 8} more`);
        },
        onSurvey: survey
          ? async (seq, n) => {
              surveyed += 1;
              if (surveyed <= 3) console.log(`   survey numbers of row ${seq}: ${n.slice(0, 15).join(', ')}${n.length > 15 ? ` … (${n.length})` : ''}`);
            }
          : undefined,
      },
    );
    console.log(`Done: ${r.requests} requests${survey ? `, survey numbers for ${surveyed} rows` : ''}`);
  }
  console.log(`Elapsed ${((Date.now() - t0) / 1000).toFixed(1)} s`);
} catch (e) {
  console.error(`eASR probe failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await redis.quit();
}
