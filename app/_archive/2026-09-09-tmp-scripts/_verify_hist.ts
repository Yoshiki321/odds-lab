import { query, pool } from '../../src/server/db/pool.js';
async function main(){
  for (const t of ['europe_odds_history','handicap_odds_history']) {
    const r = await query(`SELECT match_id, COUNT(*) n, COUNT(DISTINCT odds_type) types FROM ${t} GROUP BY match_id ORDER BY n DESC LIMIT 3`);
    console.log(t, 'rows:', JSON.stringify(r.rows));
  }
  const ah = await query(`SELECT match_id, market, line, home_odds, away_odds, odds_type FROM handicap_odds_history WHERE market='AH' ORDER BY id DESC LIMIT 3`);
  console.log('AH sample:', JSON.stringify(ah.rows));
  const ou = await query(`SELECT match_id, market, line, home_odds, away_odds, odds_type FROM handicap_odds_history WHERE market='OU' ORDER BY id DESC LIMIT 3`);
  console.log('OU sample:', JSON.stringify(ou.rows));
  await pool().end();
}
main();
