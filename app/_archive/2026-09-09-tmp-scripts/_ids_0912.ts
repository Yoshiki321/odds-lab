import { pool } from '../../src/server/db/pool.js';
(async () => {
  const p = pool();
  const r = await p.query(`
    SELECT m.match_id, m.num, m.home, m.away, m.kickoff, s.total, s.band, s.dir, s.odds, s.pred
    FROM matches m JOIN scores s ON s.match_id = m.match_id AND s.scan_round = 1
    WHERE m.match_date = '2026-09-12'
    ORDER BY s.total DESC`);
  for (const row of r.rows) {
    console.log(`${row.match_id} ${row.num} ${row.home} vs ${row.away} ko=${row.kickoff ? row.kickoff.toISOString() : ''} ${row.total} ${row.band} ${row.dir} @${row.odds} (${row.pred})`);
  }
  await p.end();
})().catch(e => { console.error(e); process.exit(1); });
