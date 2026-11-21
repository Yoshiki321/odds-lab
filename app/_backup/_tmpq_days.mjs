import { pool } from '../src/server/db/pool.js';
const p = pool();
const r = await p.query(`SELECT match_date, num, league, home, away, kickoff FROM matches ORDER BY match_date, num`);
const f = d => new Date(d + 8 * 3600_000).toISOString();
for (const x of r.rows) {
  console.log(String(x.match_date).slice(0, 10), String(x.num).padEnd(6), String(x.league).padEnd(5), String(x.home).padEnd(8), String(x.away).padEnd(8), f(x.kickoff).slice(5, 16));
}
const rr = await p.query(`SELECT match_date, count(*) c, min(num) mn, max(num) mx FROM matches GROUP BY match_date ORDER BY match_date`);
for (const x of rr.rows) console.log('--', String(x.match_date).slice(0, 10), x.c, x.mn, x.mx);
await p.end(); process.exit(0);
