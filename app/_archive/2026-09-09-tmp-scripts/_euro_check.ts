import { query, pool } from '../../src/server/db/pool.js';
(async () => {
  const p = pool();
  const r = await p.query(
    `SELECT s.match_id, m.num, m.home, m.away, s.total, s.band, s.value,
            s.dims->'value'->>'note' vnote, s.analyzed_at,
            e.home_odds, e.draw_odds, e.away_odds, e.observed_at
       FROM scores s
       JOIN matches m USING (match_id)
       LEFT JOIN europe_odds e USING (match_id)
      WHERE s.match_date='2026-09-11' AND s.scan_round=1
      ORDER BY m.kickoff`);
  for (const x of r.rows)
    console.log(
      x.num, `${x.home}-${x.away}`.padEnd(18), String(x.total).padStart(3), x.band.padEnd(9),
      'val' + x.value, (x.vnote || '').padEnd(30),
      'euro:', x.home_odds ? `${x.home_odds}/${x.draw_odds}/${x.away_odds}@${x.observed_at?.slice(11,16)}` : '无');
  await p.end();
})().catch(e => { console.error(e.message); process.exit(1); });