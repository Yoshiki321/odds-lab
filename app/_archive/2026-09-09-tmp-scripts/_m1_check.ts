import { query } from '../src/server/db/pool.js';

async function main() {
  // all v2.0 rows (round=1) for the 4 days: model dims + risk dims detail
  const s = await query(`
    SELECT sc.match_id, m.num, m.home, m.away, m.hhad, m.had, sc.dir, sc.odds, sc.total,
           sc.dims->'model'->>'score' AS model_s, sc.dims->'model'->>'note' AS model_n,
           sc.dims->'risk'->>'score' AS risk_s, sc.dims->'risk'->>'note' AS risk_n,
           sc.dims->'risk'->'details' AS risk_det,
           sc.dims->'value'->>'score' AS value_s
    FROM scores sc JOIN matches m ON m.match_id = sc.match_id
    WHERE sc.scan_round = 1
      AND to_char(sc.match_date,'YYYY-MM-DD') IN ('2026-09-05','2026-09-06','2026-09-07','2026-09-08')
    ORDER BY sc.total DESC
  `);
  for (const r of s.rows) {
    const det = JSON.stringify(r.risk_det ?? {});
    console.log(`${String(r.total).padStart(3)} ${r.num} ${(r.home+'-'+r.away).padEnd(15)} ${(r.dir+'@'+r.odds).padEnd(12)} model=${String(r.model_s).padStart(2)}[${r.model_n}] risk=${String(r.risk_s).padStart(2)}[${r.risk_n}] ${det.length>3?det:''} val=${r.value_s}`);
  }
  process.exit(0);
}
main();
