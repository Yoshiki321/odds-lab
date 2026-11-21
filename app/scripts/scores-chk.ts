// scores-chk.ts - 核对 09-07 scores 行 vs matches 场上架场次
import { query } from '../src/server/db/pool.js';
async function run() {
  const a = await query(`SELECT m.num, m.home, m.away, sc.total, sc.scan_round, sc.analyzed_at FROM scores sc JOIN matches m ON m.match_id=sc.match_id WHERE sc.match_date='2026-09-07' ORDER BY m.num`);
  console.log('scores 09-07:', a.rows.length, '行');
  for (const r of a.rows) console.log(' ', r.num, (r.home+'v'+r.away).padEnd(18), r.total + '分', 'round', r.scan_round, 'upd', (r.analyzed_at || '').toISOString?.().slice(11, 19));
  const b = await query(`SELECT count(*) n FROM matches WHERE match_date='2026-09-07'`);
  console.log('matches 09-07:', b.rows[0].n, '场');
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });