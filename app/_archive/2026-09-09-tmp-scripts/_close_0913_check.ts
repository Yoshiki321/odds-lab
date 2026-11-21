import { pool } from '../../src/server/db/pool.js';
// 在途虚拟注（09-13 及跨日）
const v = await pool().query(`
  SELECT v.id, v.confidence, v.pick, v.status, r.score, r.had, r.fetched_at settled_at
  FROM virtual_bets v
  LEFT JOIN results r ON r.match_id = v.match_id
  WHERE v.status != 'settled' OR v.placed_at >= '2026-09-13'
  ORDER BY v.id`);
console.log('=== 在途/今日虚拟注 ===');
for (const x of v.rows) console.log(`${x.id}  ${String(x.confidence).padStart(3)}  ${x.pick.padEnd(12)} ${x.status}  ${x.score ? 'score=' + x.score : '无赛果'}`);
// 当日已开奖赛果
const r = await pool().query(`
  SELECT m.num, m.league, m.home, m.away, res.score, res.had, res.hhad, res.fetched_at
  FROM results res JOIN matches m ON m.match_id = res.match_id
  WHERE res.fetched_at >= '2026-09-13' ORDER BY m.num`);
console.log('=== 当日已开奖 ===');
for (const x of r.rows) console.log(`${x.num} ${x.league}/${x.home}-${x.away} ${x.score} had=${x.had} hhad=${x.hhad} @${String(x.fetched_at).slice(11,16)}`);
await pool().end();