import { pool } from '../../src/server/db/pool.js';
import { scoreMatch } from '../../tools/score.js';
import { getOddsHistory, loadBaseRates, getRollingDrawRate } from '../../src/server/db/store.js';
const pct = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const f = parseFloat(String(v).replace('%', ''));
  return isNaN(f) ? null : f / 100;
};
async function main() {
  const db = pool();
  const baseRates = await loadBaseRates();
  const r = await db.query("select m.*, r.score from matches m join results r on r.match_id = m.match_id where m.match_date between '2026-09-04' and '2026-09-08' order by m.match_date, m.num");
  console.log('已结算场次:', r.rows.length);
  let n = 0, nHit = 0, nCold = 0, nColdHit = 0, nHot = 0, nHotHit = 0, nFav = 0, nFavHit = 0;
  for (const m of r.rows) {
    const sup = m.support || {};
    const HAD = sup.HAD, HHAD = sup.HHAD;
    if (!HAD) continue;
    const history = await getOddsHistory(m.match_id);
    const rolling = await getRollingDrawRate(m.match_date);
    const sc = await scoreMatch(m, { support: sup, oddsHistory: history, baseRates, rollingDrawRate: rolling, now: m.match_date + 'T18:00:00+08:00' });
    if ('note' in sc) continue;
    if (sc.dir === '') continue;
    const score = String(m.score ?? '');
    const [hs, as] = score.split(':').map(Number);
    if (isNaN(hs)) continue;
    // 引擎方向结算判定
    let win = false;
    const side = sc.pred === 'H' ? hs : as;
    const opp = sc.pred === 'H' ? as : hs;
    if (sc.dir.includes('+')) {
      // 受让方：+N 胜 = 本方 +N > 对方
      const nv = parseInt(sc.dir.match(/\+(\d+)/)?.[1] || '1');
      win = side + nv > opp;
    } else if (sc.dir.includes('-')) {
      const nv = parseInt(sc.dir.match(/-(\d+)/)?.[1] || '1');
      win = side - nv > opp;
    } else win = side > opp;
    // 去水 vs 大众（我方方向，HAD块）
    const block = sc.market === 'HHAD' ? (HHAD || HAD) : HAD;
    const pO = (sc.pred === 'H' ? pct(block?.hProbability) : pct(block?.aProbability));
    const pC = (sc.pred === 'H' ? pct(block?.hSupportRate) : pct(block?.aSupportRate));
    if (pO == null || pC == null) continue;
    const diff = pO - pC; // + = 市场比大众更看好我方方向
    n++;
    if (win) nHit++;
    if (sc.odds < 1.6) { nFav++; if (win) nFavHit++; }
    else if (diff >= 0.05) { nCold++; if (win) nColdHit++; }       // 大众明显冷我侧
    else { nHot++; if (win) nHotHit++; }                           // 大众持平或更热
    console.log(`${m.num} ${m.league} ${sc.dir}@${sc.odds} ${score} ${win ? 'W' : 'L'} pO=${(pO * 100).toFixed(0)}% 大众=${(pC * 100).toFixed(0)}% diff=${(diff * 100).toFixed(0)}pp${sc.odds < 1.6 ? ' 低赔' : ''}`);
  }
  const rp = (h: number, t: number) => t ? (h / t * 100).toFixed(0) + '%' : '-';
  console.log(`\n总 ${n} 胜率 ${rp(nHit, n)}`);
  console.log(`低赔大热(<1.6) ${nFav} 胜率 ${rp(nFavHit, nFav)}`);
  console.log(`大众冷我侧(diff≥5pp, 赔率≥1.6) ${nCold} 胜率 ${rp(nColdHit, nCold)}`);
  console.log(`大众持平/更热 ${nHot} 胜率 ${rp(nHotHit, nHot)}`);
  await db.end();
}
main().catch(e => { console.error(e); process.exit(1); });