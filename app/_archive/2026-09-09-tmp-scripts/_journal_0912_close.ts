import { pool } from '../../src/server/db/pool.js';
async function main() {
  const p = pool();
  const j = await p.query(`SELECT body FROM docs WHERE name='journal:2026-09-12'`);
  if (!j.rows.length) { console.log('无 09-12 日记'); await p.end(); return; }
  const body = j.rows[0].body;
  const entries = Array.isArray(body.entries) ? body.entries : [];
  const closeEntry = {
    text: `**关盘（23:51）：实单仍空仓。** 当日最终结算：真注 0；虚拟注已结 3 单 = 2赢1走（广岛三箭主胜@1.43✓、蔚山现代主胜@1.95✓、大阪钢巴主+1胜@1.78走盘）。其余 9 虚拟注跨日/待终场。
当日方向复盘（修正让球EV符号后，赛前口径 1/5 命中）：全北现代主+1胜@1.49 1:2 输（客流方向反）、广岛客+1胜@2.18 6:1 反、钢巴主+1胜@1.80 0:2 输、桑坦德主负@2.29 2:1 反——被拦的 5 场 EV 修正后全为负（-3.9%~-16.5%），门禁「负EV不下」站住了：负EV场方向命中确实弱，空仓正确。
评分机制 v2.2 第一个实战日：让球EV符号修复落地，全北/钢巴/广岛/桑坦德 EV 从旧值（-80.4%/-83.7%等失真P%）修正为 -15.0%/-11.2%/-3.9%/-16.5%，不再有 P9%/P13% 极端钳制。全天 46 场上市场次无一正EV，实单 0 合理。`,
    at: new Date().toISOString(),
    tag: 'close',
  };
  entries.push(closeEntry);
  const upd = { ...body, entries, cash: 1079.11, title: body.title ?? '当日研判' };
  await p.query(`UPDATE docs SET body=$1, updated_at=now() WHERE name='journal:2026-09-12'`, [JSON.stringify(upd)]);
  console.log('日记已更新 entries:', entries.length);
  // 台账（data/betting/ledger.json + bankroll.json）保持：真注0 无变化，跳过写
  await p.end();
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
