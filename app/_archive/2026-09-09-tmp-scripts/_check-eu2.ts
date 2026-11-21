import { query } from '../../src/server/db/pool.js';
async function main(){
  const r=await query(`SELECT m.num, m.league, m.home, m.away, e.home_odds, e.draw_odds, e.away_odds, to_char(e.observed_at,'HH24:MI') t
    FROM europe_odds e JOIN matches m USING(match_id) WHERE m.match_date='2026-09-09' ORDER BY m.kickoff`);
  console.log('09-09 欧赔行数:', r.rows.length);
  for(const x of r.rows) console.log(`${x.num} ${x.home} vs ${x.away} | ${x.home_odds}/${x.draw_odds}/${x.away_odds} @${x.t}`);
  await (await import('../../src/server/db/pool.js')).pool().end();
}
main();
