import { query, pool } from '../../src/server/db/pool.js';
const r = await query(
  `SELECT s.scan_round, s.total, s.band, s.dir, s.odds, s.value, s.dims->'value' AS vd, s.analysis->>'raw' raw
     FROM scores s WHERE s.match_id='2041362' ORDER BY s.scan_round`);
for (const x of r.rows) console.log(`r${x.scan_round} ${x.total}分 ${x.band} value维=${x.value} | ${x.vd}`);
const eu = await query(`SELECT home_odds, draw_odds, away_odds, source, observed_at FROM europe_odds WHERE match_id='2041362'`);
console.log('europe_odds 2041362:', JSON.stringify(eu.rows));
const snap = await query(`SELECT value_ev FROM score_snapshots WHERE match_id='2041362' ORDER BY snapshot_at DESC LIMIT 2`);
console.log('快照最近 value_ev:', JSON.stringify(snap.rows));
await pool().end();
