// calibrate-bands.ts — 档位校准（v2.0 评分 vs 已开奖赛果）
// 用法: npx tsx scripts/calibrate-bands.ts [fromDate] [toDate]
// 对每销售日跑 scoreDay（写库 scan_round=1），JOIN results 判定命中，
// 输出：总分分布 + 各档位命中率 + 前N排名命中，用于设定 80/70/60 档位线。
import { scoreDay } from '../tools/score.js';
import { getDayResults, listDays } from '../src/server/db/store.js';

const bjDate = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

function hitOf(market: string, pred: string, res: { had?: string | null; hhad?: string | null } | undefined): boolean | null {
  if (!res) return null;
  const key = market === 'HHAD' ? res.hhad : res.had;
  if (!key) return null;
  return key === pred;
}

export async function calibrate(from: string, to: string): Promise<void> {
  const days = (await listDays()).map(x => x.date).filter(d => d >= from && d <= to).sort();
  console.log(`档位校准 ${from} ~ ${to}（${days.length} 天）\n`);
  const bandAcc: Record<string, { hit: number; miss: number; pending: number }> = {};
  const rankAcc: Record<string, { hit: number; miss: number; pending: number }> = {};

  for (const d of days) {
    const rows = await scoreDay(d, 1);
    if (!rows.length) continue;
    const results = await getDayResults(d);
    const finished = rows.filter(r => results[r.matchId]?.had || results[r.matchId]?.hhad);
    const hit = rows.filter(r => hitOf(r.market, r.pred, results[r.matchId]) === true).length;
    const miss = rows.filter(r => hitOf(r.market, r.pred, results[r.matchId]) === false).length;
    const pend = finished.length - hit - miss;

    // 按档位累计
    for (const r of rows) {
      const h = hitOf(r.market, r.pred, results[r.matchId]);
      const b = r.band.split('·')[0] as string;
      bandAcc[b] = bandAcc[b] ?? { hit: 0, miss: 0, pending: 0 };
      if (h === true) bandAcc[b].hit++;
      else if (h === false) bandAcc[b].miss++;
      else bandAcc[b].pending++;
    }
    // 按排名档累计（前2/3-5/6-10/其余）
    rows.forEach((r, i) => {
      const h = hitOf(r.market, r.pred, results[r.matchId]);
      const key = i < 2 ? 'TOP2' : i < 5 ? 'TOP3-5' : i < 10 ? 'TOP6-10' : 'REST';
      rankAcc[key] = rankAcc[key] ?? { hit: 0, miss: 0, pending: 0 };
      if (h === true) rankAcc[key].hit++;
      else if (h === false) rankAcc[key].miss++;
      else rankAcc[key].pending++;
    });

    console.log(`\n=== ${d}（${rows.length} 场，已开奖 ${finished.length}）===`);
    rows.slice(0, Math.min(10, rows.length)).forEach((r, i) => {
      const h = hitOf(r.market, r.pred, results[r.matchId]);
      const mark = h === true ? '✅' : h === false ? '❌' : '·';
      const res = results[r.matchId];
      const resStr = res ? `${res.had ?? ''}/${res.hhad ?? ''}(${res.score ?? ''})` : '未开';
      console.log(`  ${String(r.total).padStart(3)} ${mark} ${r.num} ${(r.home + '-' + r.away).padEnd(18)} ${(r.dir + '@' + r.odds).padEnd(20)} ${r.band.padEnd(12)} 实盘${resStr}`);
    });
  }

  console.log(`\n\n===== 按档位命中率 =====`);
  for (const [b, v] of Object.entries(bandAcc)) {
    const done = v.hit + v.miss;
    console.log(`  ${b.padEnd(10)} 命中${v.hit}/${done} = ${done ? Math.round(v.hit / done * 100) : '-'}%  (未开${v.pending})`);
  }
  console.log(`\n===== 按排名命中率 =====`);
  for (const [k, v] of Object.entries(rankAcc)) {
    const done = v.hit + v.miss;
    console.log(`  ${k.padEnd(8)} 命中${v.hit}/${done} = ${done ? Math.round(v.hit / done * 100) : '-'}%  (未开${v.pending})`);
  }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('calibrate-bands.ts')) {
  const from = process.argv[2] || '2026-09-05';
  const to = process.argv[3] || bjDate();
  calibrate(from, to).catch(e => { console.error('校准失败:', e); process.exit(1); });
}