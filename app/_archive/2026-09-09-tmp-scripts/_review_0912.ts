import { pool } from '../../src/server/db/pool.js';
async function main() {
  const p = pool();
  // 09-12 已开奖场次 × 最新评分帧
  const q = `
    SELECT r.match_id, m.num, m.league, m.home, m.away, r.score, r.had AS res_had, r.hhad AS res_hhad,
           s.dir, s.market, s.pred, s.total, s.band, s.odds,
           s.dims->'drop'->>'note' AS drop_note, s.dims->'risk'->>'note' AS risk_note,
           s.dims->'value'->>'note' AS value_note
    FROM results r
    JOIN matches m ON m.match_id = r.match_id
    JOIN scores s ON s.match_id = r.match_id
    AND s.scan_round = 1
    WHERE r.fetched_at >= '2026-09-12' AND s.match_date='2026-09-12'
    ORDER BY m.kickoff NULLS LAST`;
  const r = await p.query(q);
  let hit = 0, n = 0;
  for (const x of r.rows) {
    n++;
    const res = x.res_had; // H/D/A
    const hitStr = x.pred === res ? 'HIT' : (x.pred === 'D' ? 'draw' : 'MISS');
    if (x.pred === res) hit++;
    const note = `${x.drop_note} | ${x.value_note}`;
    console.log(`${x.match_id} ${x.league}/${x.home}-${x.away} ${x.score}  pred=${x.pred}(${x.dir}@${x.odds}) 实=${res} ${hitStr}  ${x.total}${x.band}  ${note}`);
  }
  console.log(`\n命中 ${hit}/${n}`);
  await p.end();
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
