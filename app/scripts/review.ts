import { query } from '../src/server/db/pool.js';
async function run() {
  const v = await query(`SELECT id, match_num, league, home, away, pick, odds, status, result, confidence FROM virtual_bets ORDER BY id`);
  console.log('==== virtual_bets 全部', v.rows.length, '条 ====');
  for (const r of v.rows) console.log(String(r.id).padEnd(7), r.match_num, (r.home+'v'+r.away).padEnd(16), '方向', String(r.pick||'').padEnd(8), '信', r.confidence, '@', r.odds, '|', r.status, '|', r.result ? JSON.stringify(r.result).slice(0,120) : '');
  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });
