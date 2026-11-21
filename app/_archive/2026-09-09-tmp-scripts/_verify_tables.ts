import { query, pool } from '../../src/server/db/pool.js';
async function main(){
  const r = await query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`);
  const want = ['europe_odds_history','handicap_odds_history','score_snapshots','team_elo','match_lineups'];
  for (const w of want) console.log(w, r.rows.some(x => x.table_name === w) ? 'OK' : 'MISSING');
  await pool().end();
}
main();
