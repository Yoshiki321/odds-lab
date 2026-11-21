import { query, pool } from '../../src/server/db/pool.js';
const r = await query(
  `SELECT DISTINCT ON (m.match_id) m.num, m.home, m.away, m.league,
          to_char(m.kickoff AT TIME ZONE 'Asia/Shanghai','HH24:MI') ko,
          s.scan_round, s.total, s.band, s.dir, s.pred, s.market, s.odds, s.drop_amt,
          s.confirm, s.model, s.history, s.risk, s.value, s.drop_note,
          (s.dims->'value'->>'note') val_note,
          m.support
     FROM scores s JOIN matches m USING(match_id)
    WHERE m.match_date='2026-09-09' AND m.kickoff > now()
    ORDER BY m.match_id, s.scan_round DESC`);
for (const x of r.rows) {
  let sup = ''; try { const o = typeof x.support==='string'?JSON.parse(x.support):x.support; if(o) sup = `${o.had?.home ?? ''}/${o.had?.tie ?? ''}/${o.had?.away ?? ''}`; } catch {}
  console.log(`${x.num} ${x.home} vs ${x.away} [${x.ko} ${x.league}] r${x.scan_round} ${x.total}分 ${x.band} | ${x.dir}@${x.odds} 预测${x.pred} ${x.market} 降水${x.drop_amt ?? 0} | 六维 ${x.confirm}/${x.model}/${x.history}/${x.risk}/${x.value} ${x.drop_note ?? ''} | 价值:${x.val_note} | 支持${sup}`);
}
await pool().end();
