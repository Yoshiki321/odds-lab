import { query } from './src/server/db/pool.js';
const r = await query(`SELECT num, home, away, had, hhad FROM matches WHERE match_date='2026-09-06' AND (home LIKE '%伯明翰%' OR home LIKE '%埃弗顿%' OR home LIKE '%尤文%' OR home LIKE '%帕尔马%')`);
for (const x of r.rows) console.log(x.num, x.home+'-'+x.away, '| had h/d/a:', x.had?.h, x.had?.d, x.had?.a, '| hhad gl:', x.hhad?.goalLine, 'h:', x.hhad?.h, 'a:', x.hhad?.a);
process.exit(0);
