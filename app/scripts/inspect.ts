// inspect.ts - 诊断当日数据（评分/视图/信息源状态），不写库
// 用法: npx tsx scripts/inspect.ts [YYYY-MM-DD]
import { getDayScores, buildDayView, getSourceStatus, listDays } from '../src/server/db/store.js';

async function main() {
  const arg = process.argv[2];
  const bj = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const date = arg && /^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : bj();

  const days = await listDays();
  console.log('== 已有比赛日 ==');
  for (const d of days.slice(-6)) console.log(`  ${d.date} matches=${d.matches} scored=${d.scoreFile}`);

  const st = await getSourceStatus();
  console.log(`\n== 信息源状态 == ok=${st?.ok} errors=${JSON.stringify(st?.errors ?? [])}`);

  const rows = await getDayScores(date);
  console.log(`\n== ${date} 评分 ${rows.length} 场 ==`);
  for (const r of rows.sort((a, b) => b.total - a.total)) {
    console.log(`  ${r.num} ${r.league.padEnd(5)} ${r.home}-${r.away} ${r.time} ${r.dir}@${r.odds} ${r.total} ${r.band} ${r.dropNote} [d${r.confirm}/m${r.model}/h${r.history}/r${r.risk}/v${r.value}] ${r.hasBaseMark}`);
  }
  const v: any = await buildDayView(date);
  console.log(`\n== ${date} 视图 ==`);
  console.log('  summary:', JSON.stringify(v.summary));
  for (const t of v.table.slice(0, 3)) {
    console.log('  row:', JSON.stringify({ num: t.num, match: t.match.matchTime, score: t.score && { dir: t.score.dir, total: t.score.total }, result: t.result && { score: t.result.score, text: t.result.text, hit: t.result.hit } }));
  }
}
main().catch(e => { console.error('inspect 失败:', e); process.exit(1); });