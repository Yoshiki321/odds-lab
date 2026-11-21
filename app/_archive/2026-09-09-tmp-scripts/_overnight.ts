import { query, pool } from '../../src/server/db/pool.js';
const r = await query(
  `SELECT m.match_id, m.num, m.home, m.away, m.league,
          to_char(m.kickoff AT TIME ZONE 'Asia/Shanghai', 'MM-DD HH24:MI') ko,
          res.score, res.had, res.hhad, live.status
     FROM matches m
     LEFT JOIN results res USING (match_id)
     LEFT JOIN live_scores live USING (match_id)
    WHERE m.match_date = '2026-09-09'
    ORDER BY m.kickoff`);
for (const x of r.rows) {
  const st = x.score ? `终场 ${x.score} (${x.had})` : (x.status ? `live ${x.status}` : '未开');
  console.log(`  ${x.num} ${x.home} vs ${x.away} [${x.ko}] ${st}`);
}
await pool().end();