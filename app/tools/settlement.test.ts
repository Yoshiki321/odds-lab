/**
 * settlement.test.ts — 结算测试（正常用例 + 非法输入 + 性质测试）
 * 用法: node app/tools/settlement.test.ts
 */
import { settleHandicap, settleTotal, settleMoneyline, settleJcHandicap, isValidLine } from './settlement.ts';

let pass = 0; const fails: string[] = [];
function t(name: string, fn: () => void) {
  try { fn(); pass++; console.log('ok - ' + name); }
  catch (e: any) { fails.push(name + ': ' + e.message); console.error('FAIL - ' + name + '\n' + e.message); }
}
function eq(a: any, b: any, msg: string) { if (a !== b) throw new Error(`${msg}: 实际=${a} 期望=${b}`); }
function near(a: number, b: number, msg: string) { if (Math.abs(a - b) > 1e-9) throw new Error(`${msg}: 实际=${a} 期望=${b}`); }
const O = 1.90;

// ================= 正常用例 =================
t('整数盘：主让1，净胜2 → 赢', () => eq(settleHandicap('H', -1, 2, 0, O).outcome, 'win', '结果'));
t('整数盘：主让1，净胜1 → 走水', () => {
  const r = settleHandicap('H', -1, 1, 0, O);
  eq(r.outcome, 'push', '结果'); near(r.pnlPerUnit!, 0, '盈亏');
});
t('整数盘：主让1，净胜0 → 输', () => eq(settleHandicap('H', -1, 0, 0, O).outcome, 'lose', '结果'));
t('整数盘客队：主让1，平局 → 客赢', () => eq(settleHandicap('A', -1, 0, 0, O).outcome, 'win', '结果'));
t('半球：主让0.5，净胜1 → 赢', () => eq(settleHandicap('H', -0.5, 1, 0, O).outcome, 'win', '结果'));
t('半球：主让0.5，平局 → 输', () => eq(settleHandicap('H', -0.5, 0, 0, O).outcome, 'lose', '结果'));
t('半球：主受让0.5，平局 → 赢', () => eq(settleHandicap('H', 0.5, 0, 0, O).outcome, 'win', '结果'));
t('quarter：主让0.75，净胜1 → 赢半', () => {
  const r = settleHandicap('H', -0.75, 1, 0, O);
  eq(r.outcome, 'half-win', '结果'); near(r.pnlPerUnit!, 0.45, '盈亏');
});
t('quarter：主让0.75，平局 → 全输', () => eq(settleHandicap('H', -0.75, 0, 0, O).outcome, 'lose', '结果'));
t('quarter：主让0.75，净胜2 → 全赢', () => eq(settleHandicap('H', -0.75, 2, 0, O).outcome, 'win', '结果'));
t('quarter：主受让0.25，平局 → 赢半', () => eq(settleHandicap('H', 0.25, 0, 0, O).outcome, 'half-win', '结果'));
t('quarter：主受让0.25，输1球 → 全输', () => eq(settleHandicap('H', 0.25, 0, 1, O).outcome, 'lose', '结果'));
t('quarter：主让0.25，平局 → 输半', () => {
  const r = settleHandicap('H', -0.25, 0, 0, O);
  eq(r.outcome, 'half-loss', '结果'); near(r.pnlPerUnit!, -0.5, '盈亏');
});
t('quarter：主让0.25，净胜1 → 全赢', () => eq(settleHandicap('H', -0.25, 1, 0, O).outcome, 'win', '结果'));
t('quarter 主客互补：主赢半 ↔ 客输半', () => {
  eq(settleHandicap('H', -0.75, 1, 0, O).outcome, 'half-win', '主');
  eq(settleHandicap('A', -0.75, 1, 0, O).outcome, 'half-loss', '客');
});
t('大小：大2.5进3 → 赢', () => eq(settleTotal('over', 2.5, 2, 1, O).outcome, 'win', '结果'));
t('大小：大2.5进2 → 输', () => eq(settleTotal('over', 2.5, 1, 1, O).outcome, 'lose', '结果'));
t('大小：大3进3 → 走水', () => eq(settleTotal('over', 3, 2, 1, O).outcome, 'push', '结果'));
t('大小：大2.75进3 → 赢半', () => eq(settleTotal('over', 2.75, 2, 1, O).outcome, 'half-win', '结果'));
t('大小：小2.75进3 → 输半', () => eq(settleTotal('under', 2.75, 2, 1, O).outcome, 'half-loss', '结果'));
t('竞彩胜平负：主 2-1 → 赢', () => eq(settleMoneyline('H', 2, 1, O).outcome, 'win', '结果'));
t('竞彩胜平负：平 2-1 → 输', () => eq(settleMoneyline('D', 2, 1, O).outcome, 'lose', '结果'));
t('竞彩让球：主让1净胜1 → 让平=输', () => eq(settleJcHandicap('H', -1, 1, 0, O).outcome, 'lose', '结果'));
t('竞彩让球：主让1净胜1选平 → 赢', () => eq(settleJcHandicap('D', -1, 1, 0, O).outcome, 'win', '结果'));
t('边界：0-0 大0.5 输 / 小0.5 赢', () => {
  eq(settleTotal('over', 0.5, 0, 0, O).outcome, 'lose', '大');
  eq(settleTotal('under', 0.5, 0, 0, O).outcome, 'win', '小');
});
t('边界：客让1净胜2 → 客赢（方向不反）', () => eq(settleHandicap('A', -1, 0, 2, O).outcome, 'win', '结果'));

// ================= 非法输入：必须 uncomputable =================
t('非法盘口 -0.3 → uncomputable', () => eq(settleHandicap('H', -0.3, 1, 0, O).outcome, 'uncomputable', '结果'));
t('非法盘口 0.1 → uncomputable', () => eq(settleHandicap('H', 0.1, 1, 0, O).outcome, 'uncomputable', '结果'));
t('非法盘口 11 → uncomputable', () => eq(settleHandicap('H', 11, 1, 0, O).outcome, 'uncomputable', '结果'));
t('比分 NaN → uncomputable', () => eq(settleHandicap('H', -1, NaN, 0, O).outcome, 'uncomputable', '结果'));
t('比分负数 → uncomputable', () => eq(settleHandicap('H', -1, -1, 0, O).outcome, 'uncomputable', '结果'));
t('比分小数 → uncomputable', () => eq(settleHandicap('H', -1, 1.5, 0, O).outcome, 'uncomputable', '结果'));
t('赔率 NaN → uncomputable（不判赢）', () => {
  const r = settleHandicap('H', -1, 2, 0, NaN);
  eq(r.outcome, 'uncomputable', '结果'); eq(r.pnlPerUnit, null, '盈亏');
});
t('赔率 ≤1 / Infinity → uncomputable', () => {
  eq(settleHandicap('H', -1, 2, 0, 1).outcome, 'uncomputable', '≤1');
  eq(settleHandicap('H', -1, 2, 0, Infinity).outcome, 'uncomputable', 'Infinity');
});
t('方向非法 → uncomputable', () => {
  eq(settleHandicap('X' as any, -1, 1, 0, O).outcome, 'uncomputable', '让球');
  eq(settleTotal('both' as any, 2.5, 1, 1, O).outcome, 'uncomputable', '大小');
  eq(settleMoneyline('Q' as any, 1, 0, O).outcome, 'uncomputable', '胜平负');
});
t('竞彩让球非整数线 → uncomputable', () => eq(settleJcHandicap('H', -0.5, 1, 0, O).outcome, 'uncomputable', '结果'));
t('不可计算时 pnlPerUnit 必须为 null', () => {
  const r = settleTotal('over', 2.5, NaN, 0, O);
  eq(r.pnlPerUnit, null, '盈亏');
  if (!r.reason) throw new Error('应给出原因');
});

// ================= 性质测试 =================
t('性质：同一输入重复结算结果一致', () => {
  const a = settleHandicap('H', -0.75, 1, 0, O);
  const b = settleHandicap('H', -0.75, 1, 0, O);
  eq(JSON.stringify(a), JSON.stringify(b), '确定性');
});
t('性质：同一盘口线下主客结果互补', () => {
  for (const line of [-1, -0.5, -0.75, 0, 0.25, 1]) {
    const h = settleHandicap('H', line, 1, 0, O);
    const a = settleHandicap('A', line, 1, 0, O);
    const map: Record<string, string> = { win: 'lose', 'half-win': 'half-loss', push: 'push', lose: 'win', 'half-loss': 'half-win' };
    eq(a.outcome, map[h.outcome], `line=${line} 主=${h.outcome}`);
  }
});
t('性质：大小球 over/under 同线互斥或走水', () => {
  for (const line of [2.5, 3, 2.75]) {
    const o = settleTotal('over', line, 2, 1, O);
    const u = settleTotal('under', line, 2, 1, O);
    if (o.outcome === 'push') eq(u.outcome, 'push', '双走水');
    else if (o.outcome === 'win') eq(u.outcome, 'lose', '一赢一输');
    else if (o.outcome === 'lose') eq(u.outcome, 'win', '一输一赢');
  }
});
t('isValidLine：0.25 倍数通过，其它拒绝', () => {
  for (const l of [-2, -1.5, -1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 1, 1.5, 2]) if (!isValidLine(l)) throw new Error(`应通过:${l}`);
  for (const l of [-0.3, 0.1, 0.33, NaN, Infinity, 11]) if (isValidLine(l)) throw new Error(`应拒绝:${l}`);
});

// ================= 浮点边界（评审指出） =================
t('精度：-1 与 -0.99999999999 结果必须一致（走水不能变赢）', () => {
  const a = settleHandicap('H', -1, 1, 0, O);
  const b = settleHandicap('H', -0.99999999999, 1, 0, O);
  eq(a.outcome, 'push', '-1');
  eq(b.outcome, a.outcome, '-0.99999999999 应与 -1 一致');
  eq(b.outcome, 'push', '规范化后应为走水');
});
t('精度：-0.75 与 -0.75000000001 结果一致', () => {
  const a = settleHandicap('H', -0.75, 1, 0, O);
  const b = settleHandicap('H', -0.75000000001, 1, 0, O);
  eq(a.outcome, 'half-win', '-0.75');
  eq(b.outcome, a.outcome, '近似值应一致');
});
t('精度：竞彩让球 -1 与 -0.99999999999 都判让平=输（选主）', () => {
  eq(settleJcHandicap('H', -1, 1, 0, O).outcome, 'lose', '-1');
  eq(settleJcHandicap('H', -0.99999999999, 1, 0, O).outcome, 'lose', '近似值');
});
t('大小球：负盘口一律 uncomputable', () => {
  eq(settleTotal('over', -2.5, 1, 1, O).outcome, 'uncomputable', '大球负线');
  eq(settleTotal('under', -0.5, 0, 0, O).outcome, 'uncomputable', '小球负线');
});
t('大小球：精度 3 与 2.99999999999 一致（走水不变赢）', () => {
  const a = settleTotal('over', 3, 2, 1, O);
  const b = settleTotal('over', 2.99999999999, 2, 1, O);
  eq(a.outcome, 'push', '3');
  eq(b.outcome, 'push', '近似值');
});

console.log(`\nPASS ${pass} 组, FAIL ${fails.length}`);
if (fails.length) { console.error(fails.join('\n')); process.exit(1); }
