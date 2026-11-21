import { query, pool } from '../../src/server/db/pool.js';
// 09-09 盘 欧冠/荷甲场当前 europe_odds 快照是否存在
const r = await query(
  `SELECT m.num, m.home, m.away, eo.home_odds, eo.draw_odds, eo.away_odds,
          eo.observed_at AS eu_updated
     FROM matches m LEFT JOIN europe_odds eo USING (match_id)
    WHERE m.match_date = '2026-09-09' AND m.num IN ('周三003','周三005','周三007','周三009','周三011')
    ORDER BY m.num`);
for (const x of r.rows) console.log(`${x.num} ${x.home} vs ${x.away} euro=${x.home_odds}/${x.draw_odds}/${x.away_odds} @${x.eu_updated ?? 'NULL(已丢失)'}`);
// 历史轨迹里这些场是否还有记录
const h = await query(
  `SELECT m.num, COUNT(*) n, MAX(observed_at) last
     FROM europe_odds_history h JOIN matches m USING (match_id)
    WHERE m.match_date='2026-09-09'
    GROUP BY m.num ORDER BY m.num`);
console.log('--- europe_odds_history ---');
for (const x of h.rows) console.log(`${x.num} 轨迹${x.n}条 最后${String(x.last).slice(0, 19)}`);
await pool().end();