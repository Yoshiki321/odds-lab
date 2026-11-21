import { query, pool } from '../../src/server/db/pool.js';
// 明日 09-10 盘评分
const r = await query(
  `SELECT DISTINCT ON (m.match_id) m.num, m.home, m.away, m.league,
          to_char(m.kickoff AT TIME ZONE 'Asia/Shanghai','HH24:MI') ko,
          s.scan_round, s.total, s.band, s.dir, s.pred, s.market, s.odds,
          s.value, s.dims->'value'->>'note' valnote
     FROM scores s JOIN matches m USING(match_id)
    WHERE m.match_date='2026-09-10' AND m.kickoff > now()
    ORDER BY m.match_id, s.scan_round DESC`);
for (const x of r.rows) console.log(`${x.num} ${x.home} vs ${x.away} [${x.ko} ${x.league}] ${x.total}分 ${x.band} ${x.dir}@${x.odds} ${x.market} value=${x.value} "${x.valnote}"`);
await pool().end();
