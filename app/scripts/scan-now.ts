// scan-now.ts - 手动触发某天的扫描计划（测试/补跑调度；幂等：done 跳过）
// 用法: npx tsx scripts/scan-now.ts [YYYY-MM-DD]
import { listPendingScans, getDayMatches, saveScanResult, getScanPlan } from '../src/server/db/store.js';
import { analyzeBatch } from '../src/server/llm/analyzer.js';
import { markChange } from '../src/server/db/pool.js';

async function main() {
  const arg = process.argv[2];
  const bj = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const date = arg && /^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : bj();
  const due = (await listPendingScans('2099-12-31T00:00:00.000Z'))
    .filter(p => p.matchDate === date);
  if (!due.length) { console.log(`${date} 无待执行计划`); return; }

  for (const plan of due) {
    const existing = await getScanPlan(plan.id);
    if (existing && existing.status !== 'pending') { console.log(`${plan.id} 已执行(${existing.status}) 跳过`); continue; }
    const matches = await getDayMatches(date);
    const batch = matches.filter(m => plan.batch.includes(m.matchId));
    const scores = await analyzeBatch(batch, plan.scanRound ?? 1);
    await saveScanResult(plan.id, { status: 'done', scores: scores.map(s => s.matchId), runAt: new Date().toISOString() });
    await markChange('day', date);
    console.log(`${plan.id} ${plan.labels?.[0]} 分析 ${scores.length}/${batch.length} 场 (round ${plan.scanRound})`);
  }
}
main().catch(e => { console.error('scan-now 失败:', e); process.exit(1); });