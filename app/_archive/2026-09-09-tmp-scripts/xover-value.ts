import { pool } from '../../src/server/db/pool.js';
import { scoreMatch, type EngineRow } from '../../tools/score.js';
import { getOddsHistory, loadBaseRates, getRollingDrawRate } from '../../src/server/db/store.js';
const pct = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const f = parseFloat(String(v).replace('%', ''));
  return isNaN(f) ? null : f / 100;
};
async function main() {
  const db = pool();
  const baseRates = await loadBaseRates();
  const r = await db.query("select * from matches where match_date between '2026-09-04' and '2026-09-08' order by match_date, num");
  const rows: { m: any; sc: EngineRow; pO: number | null; pOAlt: number | null }[] = [];
  for (const m of r.rows) {
    const sup = m.support || {};
    const history = await getOddsHistory(m.match_id);
    const rolling = await getRollingDrawRate(m.match_date);
    const sc = await scoreMatch(m, { support: sup, oddsHistory: history, baseRates, rollingDrawRate: rolling, now: m.match_date + 'T18:00:00+08:00' });
    if ('note' in sc) continue;
    if (sc.dir === '') continue;
    const HAD = sup.HAD, HHAD = sup.HHAD;
    if (!HAD || !HHAD) continue;
    const block = sc.market === 'HHAD' ? HHAD : HAD;
    const alt = sc.market === 'HHAD' ? HAD : HHAD;
    const pO = (sc.pred === 'H' ? pct(block?.hProbability) : pct(block?.aProbability));
    const pOAlt = (sc.pred === 'H' ? pct(alt?.hProbability) : pct(alt?.aProbability));
    if (pO == null || pOAlt == null) continue;
    rows.push({ m, sc, pO, pOAlt });
    const evAlt = pOAlt * sc.odds - 1;
    console.log(`${m.num} ${sc.dir}@${sc.odds} (${sc.market}) p=${(pO * 100).toFixed(0)}% cross=其它盘${(pOAlt * 100).toFixed(0)}% 跨盘EV=${(evAlt * 100).toFixed(1)}% ${evAlt > 0 ? '★' : ''}`);
  }
  const results = await db.query("select match_id, score from results");
  const resMap = new Map(results.rows.map((x: any) => [x.match_id, String(x.score)]));
  let n = 0, nHit = 0, nPos = 0, nPosHit = 0, nPosEven = 0, nPosEvenHit = 0;
  for (const { m, sc, pOAlt } of rows) {
    const score = resMap.get(m.match_id);
    if (!score) continue;
    const [hs, as] = score.split(':').map(Number);
    if (isNaN(hs)) continue;
    const side = sc.pred === 'H' ? hs : as;
    const opp = sc.pred === 'H' ? as : hs;
    let win = false;
    if (sc.dir.includes('+')) { const nv = parseInt(sc.dir.match(/\+(\d+)/)?.[1] || '1'); win = side + nv > opp; }
    else if (sc.dir.includes('-')) { const nv = parseInt(sc.dir.match(/-(\d+)/)?.[1] || '1'); win = side - nv > opp; }
    else win = side > opp;
    const evAlt = pOAlt! * sc.odds - 1;
    n++; if (win) nHit++;
    if (evAlt > 0) { nPos++; if (win) nPosHit++; }
    if (evAlt > -0.03) { nPosEven++; if (win) nPosEvenHit++; }
  }
  const rp = (h: number, t: number) => t ? ((h / t * 100).toFixed(0) + '%') : '-';
  console.log(`\n已结算 ${n} 整体胜率 ${rp(nHit, n)}`);
  console.log(`跨盘EV>0 ${nPos} 胜率 ${rp(nPosHit, nPos)}`);
  console.log(`跨盘EV>-3% ${nPosEven} 胜率 ${rp(nPosEvenHit, nPosEven)}`);
  await db.end();
}
main().catch(e => { console.error(e); process.exit(1); });