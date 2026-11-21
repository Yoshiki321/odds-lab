import { query, pool } from '../../src/server/db/pool.js';
const r = await query(
  `SELECT m.num, m.home, m.away, to_char(m.kickoff AT TIME ZONE 'Asia/Shanghai','HH24:MI') ko, m.league,
          s.total, s.band, s.dir, s.pred, s.market, s.odds, s.drop_amt, s.scan_round
     FROM scores s JOIN matches m USING(match_id)
    WHERE m.match_date='2026-09-09' AND m.kickoff > now()
    ORDER BY s.total DESC`);
console.log('未开场次评分:');
for (const x of r.rows) console.log(`  ${x.num} ${x.home} vs ${x.away} [${x.ko} ${x.league}] ${x.total}分 ${x.band} dir=${x.dir}@${x.odds} 预测${x.pred} 盘口${x.market} 降水${x.drop_amt ?? 0} 评分于${x.scored}`);
await pool().end();
