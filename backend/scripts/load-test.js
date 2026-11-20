/**
 * Load / performance test against a RUNNING API (no extra dependencies).
 *
 *   LOAD_EMAIL=admin@firm.test LOAD_PASSWORD='…' node scripts/load-test.js [--base http://localhost:4100] \
 *       [--seconds 15] [--concurrency 20] [--create 0]
 *
 * Read phase: GET /cases, /dashboard and /reports/cases for --seconds with --concurrency workers.
 * Write phase (--create N, opt-in because it creates real cases): N concurrent case creations, then verifies that
 * every Case ID is unique and the sequence has no gaps. Run it against a staging database, not production.
 * Note: the API rate limits per IP (THROTTLE_LIMIT_PER_MINUTE); raise it on the target for meaningful numbers.
 */
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const BASE = `${arg('base', 'http://localhost:4100')}/api/v1`;
const SECONDS = Number(arg('seconds', 15));
const CONCURRENCY = Number(arg('concurrency', 20));
const CREATE = Number(arg('create', 0));

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;

async function login() {
  const res = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: process.env.LOAD_EMAIL, password: process.env.LOAD_PASSWORD }) });
  if (!res.ok) throw new Error(`Login failed (${res.status})`);
  return (await res.json()).accessToken;
}

async function timed(fn) {
  const t = performance.now();
  const res = await fn();
  await res.arrayBuffer();
  return { ms: performance.now() - t, status: res.status };
}

async function readPhase(token) {
  const paths = ['/cases?pageSize=20', '/cases?statusGroup=ACTIVE&pageSize=20', '/dashboard', '/reports/cases'];
  const results = Object.fromEntries(paths.map((p) => [p, []]));
  const errors = {};
  const end = Date.now() + SECONDS * 1000;
  let i = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (Date.now() < end) {
        const p = paths[i++ % paths.length];
        const r = await timed(() => fetch(`${BASE}${p}`, { headers: { Authorization: `Bearer ${token}` } }));
        if (r.status === 200) results[p].push(r.ms);
        else errors[r.status] = (errors[r.status] ?? 0) + 1;
      }
    }),
  );
  console.log(`\nRead phase: ${SECONDS}s, ${CONCURRENCY} concurrent workers`);
  console.table(
    Object.fromEntries(
      Object.entries(results).map(([p, arr]) => {
        const s = arr.sort((a, b) => a - b);
        return [p, { requests: s.length, 'req/s': Math.round(s.length / SECONDS), p50: Math.round(pct(s, 50)), p95: Math.round(pct(s, 95)), p99: Math.round(pct(s, 99)) }];
      }),
    ),
  );
  if (Object.keys(errors).length) console.log('Non-200 responses by status:', errors);
}

async function writePhase(token) {
  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const [clients, banks, cats] = await Promise.all(['/clients?pageSize=1&status=ACTIVE', '/masters/banks?pageSize=1&status=ACTIVE', '/masters/categories'].map((p) => fetch(`${BASE}${p}`, { headers: h }).then((r) => r.json())));
  const body = JSON.stringify({ clientId: clients.items[0].id, bankId: banks.items[0].id, categoryId: cats.items[0].id, description: 'load-test' });
  const t = performance.now();
  const res = await Promise.all(Array.from({ length: CREATE }, () => fetch(`${BASE}/cases`, { method: 'POST', headers: h, body }).then(async (r) => ({ status: r.status, body: await r.json() }))));
  const elapsed = performance.now() - t;
  const ok = res.filter((r) => r.status === 201);
  const seqs = ok.map((r) => Number(r.body.caseNumber.split('-').pop())).sort((a, b) => a - b);
  const unique = new Set(ok.map((r) => r.body.caseNumber)).size;
  console.log(`\nWrite phase: ${CREATE} concurrent case creations in ${Math.round(elapsed)} ms`);
  console.table({ created: ok.length, failed: res.length - ok.length, uniqueCaseIds: unique, gapFree: seqs.length ? seqs[seqs.length - 1] - seqs[0] === seqs.length - 1 : true });
}

(async () => {
  if (!process.env.LOAD_EMAIL || !process.env.LOAD_PASSWORD) throw new Error('Set LOAD_EMAIL and LOAD_PASSWORD (a Firm Admin account on the target)');
  const token = await login();
  await readPhase(token);
  if (CREATE > 0) await writePhase(token);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
