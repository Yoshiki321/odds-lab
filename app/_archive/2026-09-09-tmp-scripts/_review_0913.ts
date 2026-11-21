import { pool } from '../../src/server/db/pool.js';
// 09-13 复盘：r1 评分 dir + dims + 当日赛果，算方向命中
const r = await pool().query(`
  SELECT s.match_id, m.num, m.league, m.home, m.away, m.kickoff,
         s.total, s.band, s.dir, s.market, s.pred, s.odds, s.drop_amt, s.dims,
         res.score, res.had, res.hhad
  FROM scores s
  JOIN matches m ON m.match_id = s.match_id
  LEFT JOIN results res ON res.match_id = s.match_id
  WHERE s.match_date='2026-09-13' AND s.scan_round=1
  ORDER BY m.num`);
let hit = 0, miss = 0, pending = 0;
for (const x of r.rows) {
  const hrs = x.kickoff ? (((+new Date(x.kickoff)) - Date.now()) / 3600000).toFixed(1) : '?';
  if (!x.score) { pending++; console.log(`${x.num} ${x.total}${x.band} ${x.dir}@${x.odds} ${x.league}/${x.home}-${x.away} 距开${hrs}h 未终场`); continue; }
  // 判定方向命中：HAD dir 对 had；HHAD dir 对 hhad
  const want = x.dir === '主胜' ? 'H' : x.dir === '平' ? 'D' : 'A';
  const got = x.market === 'HHAD' ? (x.hhad || '?') : (x.had || '?');
  const ok = got === want;
  if (ok) hit++; else miss++;
  console.log(`${x.num} ${String(x.total).padStart(3)}${x.band} ${x.dir.padEnd(6)}@${x.odds} ${x.league}/${x.home}-${x.away} ${x.score} → ${ok ? '✅命中' : '❌错杀'}`);
}
console.log(`\n已终场 ${hit + miss} 场：方向命中 ${hit}/${hit + miss} = ${((hit / (hit + miss)) * 100).toFixed(0)}% | 未终场 ${pending}`);
await pool().end();