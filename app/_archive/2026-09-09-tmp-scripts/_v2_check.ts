// _v2_check.ts — 编译校验 v2.0 管线（事后删除）
import { scoreDay } from '../tools/score.js';
(async () => {
  const rows = await scoreDay('2026-09-08', 1);
  console.log('scored:', rows.length);
  for (const r of rows.slice(0, 14)) {
    const d = r.analysis?.dims;
    console.log(`${r.num} ${(r.home + '-' + r.away).padEnd(16)} ${(r.dir + '@' + r.odds).padEnd(20)} ${String(r.total).padStart(3)} ${r.band} ${r.dropNote} [降水${r.drop}/确认${r.confirm}/模型${r.model}/历史${r.history}/风险${r.risk}/价值${r.value}] ${r.betNote || ''}`);
    if (d) console.log(`    note: ${d.drop.note} | ${d.confirm.note} | ${d.model.note} | ${d.history.note} | ${d.risk.note} | ${d.value.note}`);
  }
  process.exit(0);
})().catch(e => { console.error('v2 check fail:', e); process.exit(1); });