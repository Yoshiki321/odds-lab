import { query, pool } from '../../src/server/db/pool.js';
async function main(){
 const join=`FROM scores s JOIN results r USING(match_id) WHERE s.match_date < '2026-09-09' AND r.had IS NOT NULL AND ((s.market='HAD' AND s.pred=r.had) OR (s.market='HHAD' AND s.pred=r.hhad))`;
 const all=`FROM scores s JOIN results r USING(match_id) WHERE s.match_date < '2026-09-09' AND r.had IS NOT NULL`;
 for (const [label,src] of [['all snapshots',all],['round 1 only',all+' AND s.scan_round=1']] as const) {
  const r=await query(`SELECT CASE WHEN s.total>=58 THEN '58+' WHEN s.total>=48 THEN '48-57' WHEN s.total>=40 THEN '40-47' WHEN s.total>=30 THEN '30-39' ELSE '<30' END band, COUNT(*)::int n, COUNT(*) FILTER (WHERE ((s.market='HAD' AND s.pred=r.had) OR (s.market='HHAD' AND s.pred=r.hhad)))::int wins, ROUND(100.0*COUNT(*) FILTER (WHERE ((s.market='HAD' AND s.pred=r.had) OR (s.market='HHAD' AND s.pred=r.hhad)))/COUNT(*),1) pct FROM scores s JOIN results r USING(match_id) WHERE s.match_date < '2026-09-09' AND r.had IS NOT NULL ${label==='round 1 only'?'AND s.scan_round=1':''} GROUP BY 1 ORDER BY MIN(s.total) DESC`);
  console.log('\n'+label); for(const x of r.rows) console.log(JSON.stringify(x));
 }
 const q=await query(`SELECT COUNT(*)::int n, COUNT(*) FILTER(WHERE s.scan_round=1)::int r1, MIN(s.total)::int min, MAX(s.total)::int max, ROUND(AVG(s.total),1) avg FROM scores s JOIN results r USING(match_id) WHERE s.match_date < '2026-09-09' AND r.had IS NOT NULL`); console.log('\nsummary',JSON.stringify(q.rows[0]));
 await pool().end();
}
main();
