import { query, pool } from '../../src/server/db/pool.js';
(async () => {
  const p = pool();
  const r = await p.query(
    `SELECT m.num, m.home, m.away, e.home_odds, e.draw_odds, e.away_odds, to_char(e.observed_at,'HH24:MI') t,
            (SELECT count(*) FROM europe_odds_history h WHERE h.match_id=m.match_id) hist
       FROM matches m JOIN europe_odds e USING (match_id)
      WHERE m.home IN ('萨巴赫','科莫','德尔瓦耶') OR m.away IN ('萨巴赫','科莫','德尔瓦耶')
      ORDER BY m.num`);
  for (const x of r.rows) console.log(`${x.num} ${x.home}-${x.away} euro=${x.home_odds}/${x.draw_odds}/${x.away_odds}@${x.t} hist=${x.hist}`);
  await p.end();
})().catch(e => { console.error(e.message); process.exit(1); });