import { query } from './src/server/db/pool.js';
const r = await query(`SELECT match_id, num, home, away, league FROM matches WHERE match_date='2026-09-07' ORDER BY num`);
for (const x of r.rows) console.log(x.match_id, x.num, x.league, x.home+'-'+x.away);
process.exit(0);
