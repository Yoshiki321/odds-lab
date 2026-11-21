import { query } from '../src/server/db/pool.js';
async function main() {
  const m = await query("SELECT match_id, num, home, away, had, hhad FROM matches WHERE match_id = '2041327'");
  const r = m.rows[0];
  console.log('当前(终盘) had=', JSON.stringify(r.had));
  console.log('当前(终盘) hhad=', JSON.stringify(r.hhad));
  // bet-time from bet-024 note: had a=1.89 d=3.27 h=3.40
  const oh = await query("SELECT market, side, odds, observed_at FROM odds_history WHERE match_id='2041327' ORDER BY observed_at");
  console.log('odds_history rows:', oh.rows.length);
  process.exit(0);
}
main();
