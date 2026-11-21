import { query, pool } from '../../src/server/db/pool.js';
const r = await query(`SELECT m.num, m.home, m.away, to_char(m.kickoff AT TIME ZONE 'Asia/Shanghai','HH24:MI') ko,
  ls.score ls, res.score res, res.had
  FROM matches m LEFT JOIN live_scores ls USING(match_id) LEFT JOIN results res USING(match_id)
  WHERE m.match_date='2026-09-09' ORDER BY m.kickoff`);
for (const x of r.rows) console.log(`${x.num} ${x.home} vs ${x.away} [${x.ko}] live=${x.ls ?? '-'} result=${x.res ?? '-'}/${x.had ?? '-'}`);
await pool().end();
