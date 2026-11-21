import { query } from './src/server/db/pool.js';
const r = await query(`SELECT num, home, away, match_time FROM matches WHERE match_date='2026-09-07' ORDER BY match_time`);
for (const x of r.rows) console.log(x.num, x.home+'-'+x.away, '开赛', String(x.match_time).slice(0,5));
process.exit(0);
