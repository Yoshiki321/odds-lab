import { query, pool } from '../../src/server/db/pool.js';
(async () => {
  const p = pool();
  const r = await p.query(
    `SELECT m.num, m.home, m.away, s.total, s.band, s.value, s.dims->'value'->>'note' vnote
       FROM scores s JOIN matches m USING (match_id)
      WHERE m.match_date='2026-09-10' AND s.scan_round=1
        AND s.analyzed_at > '2026-09-10 22:50:00'
      ORDER BY m.num`);
  for (const x of r.rows) console.log(x.num, `${x.home}-${x.away}`.padEnd(18), String(x.total).padStart(3), x.band.padEnd(6), `val${x.value}`, x.vnote ?? '');
  await p.end();
})().catch(e => { console.error(e.message); process.exit(1); });