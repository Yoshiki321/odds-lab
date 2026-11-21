// review2.ts - 09-06 周日场评分 round1 vs 赛果 命中分析
import { query } from '../src/server/db/pool.js';
async function run() {
  const r = await query(`
    SELECT m.num, m.home, m.away, sc.total, sc.pred, sc.market, sc.band, sc.dir,
           res.score, res.had, res.hhad, res.goal_line,
           CASE WHEN sc.market='HAD' THEN
             (sc.pred = res.had) WHEN sc.market='HHAD' THEN
             (sc.pred = res.hhad) ELSE NULL END hit
    FROM scores sc JOIN matches m ON m.match_id=sc.match_id
    LEFT JOIN results res ON res.match_id=sc.match_id
    WHERE sc.match_date='2026-09-06' AND sc.scan_round=1
    ORDER BY sc.total DESC`);
  let hit = 0, miss = 0, pending = 0;
  for (const x of r.rows) {
    const h = x.hit === true; const p = x.hit === null;
    if (p) pending++; else h ? hit++ : miss++;
    const mark = p ? '…' : h ? '✅' : '❌';
    console.log(mark, x.num, (x.home+'v'+x.away).padEnd(16), String(x.total)+'分', 'dir', String(x.dir||'').padEnd(5), 'pred', x.pred, String(x.market||'').padEnd(4), '| res', x.score, 'had', x.had, x.goal_line ? 'gl'+x.goal_line : '');
  }
  console.log(`\n命中 ${hit} / 未中 ${miss} / 未终场 ${pending}`);
  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });