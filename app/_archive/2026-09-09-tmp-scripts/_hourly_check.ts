import { query, pool } from '../../src/server/db/pool.js';
const now=new Date();
const r=await query(`SELECT m.match_id,m.num,m.home,m.away,to_char(m.kickoff AT TIME ZONE 'Asia/Shanghai','HH24:MI') ko,
 ls.score ls, ls.status ls_status, res.score res_score, res.had
 FROM matches m LEFT JOIN live_scores ls USING(match_id) LEFT JOIN results res USING(match_id)
 WHERE m.kickoff < now() AND m.match_date='2026-09-09' ORDER BY m.kickoff`);
console.log('今日已开场次:',r.rows.length);
for(const x of r.rows) console.log(`  ${x.num} ${x.home} vs ${x.away} [${x.ko}] live:${x.ls||'-'}/${x.ls_status||'-'} result:${x.res_score||'-'}/${x.res_had||'-'}`);
await pool().end();
