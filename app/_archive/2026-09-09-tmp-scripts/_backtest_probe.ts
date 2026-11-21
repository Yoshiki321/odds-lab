import { query, pool } from '../../src/server/db/pool.js';
async function main(){
  const c = await query(`SELECT COUNT(*)::int n, COUNT(*) FILTER (WHERE r.match_id IS NOT NULL)::int settled, MIN(s.match_date) min_date, MAX(s.match_date) max_date, COUNT(DISTINCT s.scan_round)::int rounds, COUNT(DISTINCT s.from_source)::int sources FROM scores s LEFT JOIN results r USING (match_id)`);
  console.log('counts', JSON.stringify(c.rows[0]));
  const r = await query(`SELECT s.match_date, m.num, m.home, m.away, s.dir, s.market, s.pred, s.total, s.band, s.scan_round, s.from_source, r.score, r.had, r.hhad, r.goal_line FROM scores s JOIN matches m USING(match_id) JOIN results r USING(match_id) ORDER BY s.match_date DESC, s.total DESC LIMIT 25`);
  for (const x of r.rows) console.log(JSON.stringify(x));
  await pool().end();
}
main();
