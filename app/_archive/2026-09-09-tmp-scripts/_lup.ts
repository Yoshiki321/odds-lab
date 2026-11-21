import { query } from '../../src/server/db/pool.js';
const now=Date.now();
const r=await query(`SELECT match_id,num,home,away,league,to_char(kickoff AT TIME ZONE 'Asia/Shanghai','HH24:MI') ko
 FROM matches WHERE kickoff BETWEEN to_timestamp($1/1000.0) - interval '45 minutes' AND to_timestamp($1/1000.0) + interval '2 hours'`, [now]);
console.log('now(北京):', new Date(now+8*3600_000).toISOString().slice(11,16));
console.log('≤2h窗口场次:', r.rows.length);
for(const m of r.rows) console.log(`  ${m.num} ${m.home} vs ${m.away} [${m.ko}] ${m.match_id}`);
