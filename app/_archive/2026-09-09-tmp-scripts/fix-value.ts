import { pool } from '../../src/server/db/pool.js';
import { scoreMatch } from '../../tools/score.js';
import { getOddsHistory, loadBaseRates, getRollingDrawRate } from '../../src/server/db/store.js';

async function main() {
  const db = pool();
  const r = await db.query("select * from matches where match_date in ('2026-09-08','2026-09-09') order by match_date, num");
  const baseRates = await loadBaseRates();
  let wins = 0, total = 0;
  for (const m of r.rows) {
    const history = await getOddsHistory(m.match_id);
    const rolling = await getRollingDrawRate(m.match_date);
    const sup = m.support || {};
    const sym = await import('../../src/shared/rundown.js').catch(() => null);
    let fair = 0;
    // 针对引擎拿到的最终方向做扰动对照（引擎内部逻辑）
    const plain = scoreMatch(m, { support: sup, oddsHistory: history, baseRates, rollingDrawRate: rolling, now: m.match_date + 'T18:00:00+08:00' });
    if ('note' in plain) continue;
    // 我方下注赔率 = plain.odds
    // 欧洲公平概率近似：用 HAD 块去水(h/a) 与 HHAD 块去水(h/a) 无偏估计——取支持率块中的「去水概率」跨市场交叉
    const probBlockHAD = sup.HAD || sup.HHAD;
    const probBlockHHAD = sup.HHAD || sup.HAD;
    total++;
    const p = plain.pred === 'H' ? Number(String(probBlockHAD.hProbability).replace('%', '')) / 100 : Number(String(probBlockHAD.aProbability).replace('%', '')) / 100;
    const phh = plain.pred === 'H' ? Number(String(probBlockHHAD.hProbability).replace('%', '')) / 100 : Number(String(probBlockHHAD.aProbability).replace('%', '')) / 100;
    const ev_had = p * plain.odds - 1;
    const ev_hhad = phh * plain.odds - 1;
    console.log(`${m.num} ${plain.dir}@${plain.odds} market=${plain.market} pred=${plain.pred} pHAD=${(p * 100).toFixed(0)}% pHHAD=${(phh * 100).toFixed(0)}% EV_HAD=${(ev_had * 100).toFixed(1)}% EV_HHAD=${(ev_hhad * 100).toFixed(1)}%`);
    if (ev_had > -0.02) wins++;
  }
  console.log(`HAD探针 EV>-2% 命中暗示: ${wins}/${total}`);
  await db.end();
}
main().catch(e => { console.error(e); process.exit(1); });