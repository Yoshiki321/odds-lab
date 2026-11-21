import { query } from './src/server/db/pool.js';
const r = await query(`SELECT m.num, s.dir, s.odds, s.total, s.band FROM scores s JOIN matches m USING (match_id) WHERE s.match_date='2026-09-07' AND s.scan_round=1 ORDER BY s.total DESC`);
for (const x of r.rows) console.log(x.num, x.dir, '@'+x.odds, x.total, x.band);
process.exit(0);
