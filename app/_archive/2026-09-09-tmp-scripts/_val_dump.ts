import { query, pool } from '../../src/server/db/pool.js';
const r = await query(
  `SELECT s.match_id, m.home, s.scan_round, s.total, s.value,
          s.dims->'value'->>'note' note,
          s.dims->'value'->>'prob' prob
     FROM scores s JOIN matches m USING(match_id)
    WHERE s.scan_round IN (1,2) AND s.total >= 48
    ORDER BY s.total DESC`);
for (const x of r.rows) console.log(`${x.home} r${x.scan_round} ${x.total}分 value=${x.value} note="${x.note}" prob=${x.prob}`);
await pool().end();
