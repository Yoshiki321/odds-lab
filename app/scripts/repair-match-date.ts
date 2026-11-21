// repair-match-date.ts — 一次性修复：match_date 从编号前缀（周日/周一…）推导
// 背景：sporttery 接口 matchDate = 北京自然开赛日，跨午夜场（周日024 → 周一 05:30）被归到次日
//       用户规则：比赛日 = 竞彩编号日，周日晚场整组归周日，过 12 点也是周日的场次
// 动作：1) 重推导 matches.match_date   2) 同步 scores.match_date   3) 旧日期 pending 计划置 skipped
import { query } from '../src/server/db/pool.js';
import { salesDateOf } from '../src/server/db/store.js';

const { rows } = await query(`SELECT match_id, num, kickoff, match_date FROM matches`);
let moved = 0;
const movedBy: Record<string, string[]> = {};
const fmt = (d: unknown) => d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : String(d).slice(0, 10);
for (const m of rows) {
  const nd = salesDateOf(String(m.num), m.kickoff ? new Date(m.kickoff) : null);
  if (!nd) continue;
  const od = fmt(m.match_date);
  if (nd !== od) {
    await query(`UPDATE matches SET match_date=$1::date WHERE match_id=$2`, [nd, m.match_id]);
    (movedBy[`${od}→${nd}`] = movedBy[`${od}→${nd}`] || []).push(String(m.num));
    moved++;
  }
}
console.log(`matches 归位 ${moved} 场`);
for (const [k, v] of Object.entries(movedBy)) console.log(`  ${k}: ${v.join(',')}`);

// scores.match_date 同步（scores 独立列，不自动跟随）
const rs = await query(`UPDATE scores s SET match_date = m.match_date
  FROM matches m WHERE s.match_id = m.match_id AND s.match_date <> m.match_date`);
console.log(`scores 同步 ${rs.rowCount} 行`);

// 旧日期（已无场次）的 pending 计划置 skipped
const rd = await query(`UPDATE scan_plans sp SET status='skipped'
  WHERE sp.status='pending' AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.match_date = sp.match_date)`);
console.log(`scan_plans 作废 ${rd.rowCount} 条过期 pending`);

// 结果输出新分组
const rg = await query(`SELECT to_char(match_date,'YYYY-MM-DD') d, count(*) c, min(num) mn, max(num) mx FROM matches GROUP BY match_date ORDER BY match_date`);
for (const x of rg.rows) console.log(`组 ${x.d}: ${x.c} 场 (${x.mn}~${x.mx})`);
await (await import('../src/server/db/pool.js')).pool().end();
process.exit(0);