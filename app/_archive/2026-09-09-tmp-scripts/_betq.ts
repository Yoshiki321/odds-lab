import { query, pool } from '../../src/server/db/pool.js';
async function main(){
  const r = await query("SELECT bet_id, match_num, pick, odds, stake, status, placed_at FROM bets WHERE placed_at::date = date '2026-09-09' ORDER BY placed_at");
  console.log('今日已投:', r.rows.length);
  for (const x of r.rows) console.log(x.bet_id, x.match_num, x.pick, 'stake=' + x.stake, x.status, String(x.placed_at));
  const b = await query("SELECT * FROM bankroll ORDER BY id DESC LIMIT 2");
  for (const x of b.rows) console.log('bankroll:', JSON.stringify(x));
  await pool().end();
}
main();
