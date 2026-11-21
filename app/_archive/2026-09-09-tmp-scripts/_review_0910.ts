import { query, pool } from '../../src/server/db/pool.js';
// 09-10 销售日复盘：官方赛果 vs 主评分方向
(async () => {
  const p = pool();
  const r = await p.query(
    `SELECT DISTINCT ON (m.match_id)
            m.num, m.home, m.away, res.score, res.had AS f_had,
            s.scan_round, s.total, s.band, s.dir, s.pred, s.market, s.odds,
            s.value, s.dims->'value'->>'note' vnote
       FROM matches m
       JOIN results res USING (match_id)
       JOIN scores s USING (match_id)
      WHERE m.match_date = '2026-09-10'
      ORDER BY m.match_id, s.scan_round DESC, s.analyzed_at DESC`);
  let hit = 0, n = 0;
  const label: Record<string, string> = { H: '主胜', D: '平', A: '客胜' };
  for (const x of r.rows) {
    const predHit = x.f_had === x.pred;
    if (predHit) hit++;
    n++;
    console.log(`${x.num} ${x.home} ${x.score ?? '-'}(${label[x.f_had] ?? x.f_had}) ${x.away} | ${x.total}分 ${x.band} | pred=${x.pred}${predHit ? '✅' : '❌'} dir=${x.dir}@${x.odds} ${x.market} val${x.value} [${x.vnote ?? ''}]`);
  }
  console.log(`\n方向命中(09-10主评分): ${hit}/${n} = ${n ? (hit / n * 100).toFixed(0) : '-'}%`);
  await p.end();
})().catch(e => { console.error(e.message); process.exit(1); });