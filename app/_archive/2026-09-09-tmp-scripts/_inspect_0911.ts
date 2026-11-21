import { query, pool } from '../../src/server/db/pool.js';
(async () => {
  const r = await query(
    `SELECT m.num, m.league, m.home, m.away, to_char(m.kickoff,'MM-DD HH24:MI') ko,
            s.scan_round, s.total, s.band, s.dir, s.pred, s.odds, s.value,
            s.dims->'value'->>'note' vnote, s.drop_note, to_char(s.analyzed_at,'HH24:MI') at
       FROM scores s JOIN matches m USING (match_id)
      WHERE s.match_date='2026-09-11' AND s.scan_round=1
      ORDER BY m.kickoff`);
  for (const x of r.rows)
    console.log(
      x.num, x.league.padEnd(6), `${x.home}-${x.away}`.padEnd(20), 'ko', x.ko,
      String(x.total).padStart(3), x.band.padEnd(10), `${x.dir}@${x.odds}`.padEnd(14),
      'val' + x.value, x.vnote ?? '', '|', x.drop_note ?? '', '@' + x.at);
  await pool().end();
})().catch(e => { console.error(e.message); process.exit(1); });