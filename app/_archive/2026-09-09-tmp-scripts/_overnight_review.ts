import { query, pool } from '../../src/server/db/pool.js';
const r = await query(
  `SELECT DISTINCT ON (m.match_id)
          m.num, m.home, m.away, m.league,
          res.score AS f_score, res.had AS f_had, res.hhad AS f_hhad,
          s.scan_round, s.total, s.band, s.dir, s.pred, s.market, s.odds,
          s.value, s.dims->'value'->>'note' valnote
     FROM matches m
     JOIN results res USING (match_id)
     JOIN scores s USING (match_id)
    WHERE m.match_date = '2026-09-09'
    ORDER BY m.match_id, s.scan_round DESC`);
let hit = 0, n = 0;
const label = { H: '主胜', D: '平', A: '客胜' } as Record<string, string>;
for (const x of r.rows) {
  const predHit = x.f_had === x.pred ? '✅' : '❌';
  if (x.f_had === x.pred) hit++;
  n++;
  console.log(`${x.num} ${x.home} ${x.f_score ?? '-'}(${label[x.f_had]}) ${x.away} | ${x.total}分 ${x.band} | pred=${x.pred}${predHit} dir=${x.dir}@${x.odds} ${x.market} value=${x.value} [${x.valnote}]`);
}
console.log(`\n方向命中(末帧): ${hit}/${n} = ${(hit / n * 100).toFixed(0)}%`);
await pool().end();