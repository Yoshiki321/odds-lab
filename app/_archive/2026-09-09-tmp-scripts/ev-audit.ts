import { pool } from '../../src/server/db/pool.js';
const pct = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const f = parseFloat(String(v).replace('%', ''));
  return isNaN(f) ? null : f / 100;
};
async function main() {
  const db = pool();
  const r = await db.query("select m.num, m.match_date, m.league, m.home, m.away, m.had, m.hhad, m.support, s.odds, s.market, s.dir, s.total from matches m join scores s on s.match_id = m.match_id and s.scan_round = 1 where s.analyzed_at >= '2026-09-09' order by m.match_date, s.total desc");
  console.log('场次 市场方向 方向赔率 EV 去水p 支持块');
  for (const x of r.rows) {
    const sup = x.support || {};
    const block = x.market === 'HHAD' ? (sup.HHAD || sup.HAD) : (sup.HAD || sup.HHAD);
    if (!block) { console.log(x.num, x.dir + '@' + x.odds, '无support'); continue; }
    const isH = x.dir.includes('胜') && !x.dir.includes('负');
    const p = isH ? pct(block.hProbability) : pct(block.aProbability);
    if (p == null) { console.log(x.num, x.dir + '@' + x.odds, 'prob缺失', JSON.stringify(block).slice(0, 120)); continue; }
    const ev = +(p * x.odds - 1).toFixed(3);
    console.log(`${x.match_date} ${x.num} ${x.league} ${x.home}-${x.away} ${x.dir}@${x.odds} EV=${ev} p=${p.toFixed(3)} (${x.market}) total=${x.total}`);
  }
  const evs = [];
  for (const x of r.rows) {
    const sup = x.support || {};
    const block = x.market === 'HHAD' ? (sup.HHAD || sup.HAD) : (sup.HAD || sup.HHAD);
    if (!block) continue;
    const isH = x.dir.includes('胜') && !x.dir.includes('负');
    const p = isH ? pct(block.hProbability) : pct(block.aProbability);
    if (p != null) evs.push(p * x.odds - 1);
  }
  evs.sort((a, b) => a - b);
  console.log('EV 分布: min', evs[0]?.toFixed(3), 'p25', evs[Math.floor(evs.length * 0.25)]?.toFixed(3), 'median', evs[Math.floor(evs.length / 2)]?.toFixed(3), 'p75', evs[Math.floor(evs.length * 0.75)]?.toFixed(3), 'max', evs[evs.length - 1]?.toFixed(3), 'n=', evs.length);
  console.log('EV≥-0.05 次数:', evs.filter(e => e >= -0.05).length, 'EV≥0:', evs.filter(e => e >= 0).length, 'EV≥0.05:', evs.filter(e => e >= 0.05).length, 'EV≥0.10:', evs.filter(e => e >= 0.10).length);
  await db.end();
}
main().catch(e => { console.error(e); process.exit(1); });