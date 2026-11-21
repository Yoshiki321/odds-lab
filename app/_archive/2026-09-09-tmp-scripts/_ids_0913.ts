import { pool } from '../../src/server/db/pool.js';
const r = await pool().query(`
  SELECT s.match_id, m.num, s.total, s.band, s.dir, m.league, m.home, m.away, m.kickoff
  FROM scores s JOIN matches m ON m.match_id = s.match_id
  WHERE s.match_date = '2026-09-13' AND s.scan_round = 1
  ORDER BY s.total DESC LIMIT 14`);
for (const x of r.rows) {
  console.log(`${x.match_id} ${x.num} ${x.total} ${x.band} ${x.dir} ${x.league}/${x.home}-${x.away} ${x.kickoff ? String(x.kickoff).slice(11, 16) : '?'}`);
}
await pool().end();