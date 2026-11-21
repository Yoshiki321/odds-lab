import { query } from './src/server/db/pool.js';
const r = await query(`SELECT match_id, num, home, away, league, kickoff FROM matches WHERE match_date='2026-09-07' AND home LIKE '%卡尔马%'`);
for (const x of r.rows) console.log(x.match_id, x.num, x.league, x.home+'-'+x.away, 'kickoff:', x.kickoff.toISOString().replace('T',' ').slice(0,19));
process.exit(0);
