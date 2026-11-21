import { query } from '../src/server/db/pool.js';
async function main() {
  for (const id of ['2041323', '2041327', '2041288', '2041335']) {
    const s = await query("SELECT market, side, odds, observed_at FROM odds_history WHERE match_id = $1 ORDER BY observed_at", [id]);
    console.log(`--- ${id} (${s.rows.length} rows)`);
    for (const r of s.rows) console.log(`   ${r.market} ${r.side} ${r.odds} @ ${r.observed_at}`);
  }
  process.exit(0);
}
main();
