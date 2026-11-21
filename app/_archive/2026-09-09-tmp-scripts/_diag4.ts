// _diag4.ts — 验证 EV 价值维计算（对照官方去水概率手算）
import { getDayMatches } from '../src/server/db/store.js';
import { scoreMatch } from '../tools/score.js';
import { loadBaseRates } from '../src/server/db/store.js';

(async () => {
  const ms = await getDayMatches('2026-09-08');
  const br = await loadBaseRates();
  // 手算几场的 EV 对照引擎输出
  for (const m of ms.filter(x => ['2041337', '2041346'].includes(x.matchId))) {
    const r = scoreMatch(m, { support: m.support, baseRates: br });
    if ('note' in r) continue;
    const blk = r.market === 'HHAD' ? (m.support as any)?.HHAD : (m.support as any)?.HAD;
    const p = r.pred === 'H' ? parseFloat(String(blk?.hProbability)) / 100 : parseFloat(String(blk?.aProbability)) / 100;
    const ev = p * r.odds - 1;
    console.log(`\n${m.num} ${m.home}-${m.away}`);
    console.log(`  dir=${r.dir} odds=${r.odds} p=${(p * 100).toFixed(1)}% EV=${(ev * 100).toFixed(1)}% 引擎value=${r.value} total=${r.total} band=${r.band}`);
    console.log(`  dims: ${JSON.stringify(r.analysis?.dims ?? null)}`);
  }
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });