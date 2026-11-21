import { pool } from '../../src/server/db/pool.js';
async function main() {
  const p = pool();
  const e = await p.query(`SELECT home_odds, draw_odds, away_odds, odds_type, source, to_char(observed_at,'HH24:MI:SS') t FROM europe_odds_history WHERE match_id='2041414' ORDER BY observed_at LIMIT 20`);
  for (const r of e.rows) console.log(`${r.t} ${r.odds_type} ${r.home_odds}/${r.draw_odds}/${r.away_odds}`);
  if (e.rows.length===0) console.log('europe_odds_history 无 2041414 行');
  await p.end();
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
