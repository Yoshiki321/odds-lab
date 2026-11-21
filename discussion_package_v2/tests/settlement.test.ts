/**
 * settlement.test.ts — 盘口结算逐项测试（node 24 直跑）
 * 用法: node app/tools/settlement.test.ts
 */
import { settleHandicap, settleTotal, settleMoneyline, settleJcHandicap } from './settlement.ts';

let pass = 0; const fails: string[] = [];
function t(name: string, fn: () => void) {
  try { fn(); pass++; console.log('ok - ' + name); }
  catch (e: any) { fails.push(name + ': ' + e.message); console.error('FAIL - ' + name + '\n' + e.message); }
}
function eq(a: any, b: any, msg: string) { if (a !== b) throw new Error(`${msg}: 实际=${a} 期望=${b}`); }
function near(a: number, b: number, msg: string) { if (Math.abs(a - b) > 1e-9) throw new Error(`${msg}: 实际=${a} 期望=${b}`); }

const O = 1.90; // 赔率，profit=0.9

// ---------------- 整数盘 ----------------
t('整数盘：主让1，净胜2 → 赢', () => eq(settleHandicap('H', -1, 2, 0, O).outcome, 'win', '结果'));
t('整数盘：主让1，净胜1 → 走水退本', () => {
  const r = settleHandicap('H', -1, 1, 0, O);
  eq(r.outcome, 'push', '结果'); near(r.pnlPerUnit, 0, '盈亏');
});
t('整数盘：主让1，净胜0 → 输', () => eq(settleHandicap('H', -1, 0, 0, O).outcome, 'lose', '结果'));
t('整数盘客队视角：主让1，净胜0 → 客赢', () => eq(settleHandicap('A', -1, 0, 0, O).outcome, 'win', '结果'));

// ---------------- 半球盘 ----------------
t('半球：主让0.5，净胜1 → 赢', () => eq(settleHandicap('H', -0.5, 1, 0, O).outcome, 'win', '结果'));
t('半球：主让0.5，平局 → 输', () => eq(settleHandicap('H', -0.5, 0, 0, O).outcome, 'lose', '结果'));
t('半球：主受让0.5，平局 → 赢', () => eq(settleHandicap('H', 0.5, 0, 0, O).outcome, 'win', '结果'));

// ---------------- quarter 盘 ----------------
t('quarter：主让0.75，净胜1 → 赢半', () => {
  const r = settleHandicap('H', -0.75, 1, 0, O);
  eq(r.outcome, 'half-win', '结果'); near(r.pnlPerUnit, 0.45, '盈亏=利润一半');
});
t('quarter：主让0.75，平局 → 全输', () => eq(settleHandicap('H', -0.75, 0, 0, O).outcome, 'lose', '结果'));
t('quarter：主让0.75，净胜2 → 全赢', () => eq(settleHandicap('H', -0.75, 2, 0, O).outcome, 'win', '结果'));
t('quarter：主受让0.25，平局 → 赢半', () => {
  const r = settleHandicap('H', 0.25, 0, 0, O);
  eq(r.outcome, 'half-win', '结果'); near(r.pnlPerUnit, 0.45, '盈亏');
});
t('quarter：主受让0.25，输1球 → 全输', () => eq(settleHandicap('H', 0.25, 0, 1, O).outcome, 'lose', '结果'));
t('quarter：主让0.25，平局 → 输半', () => {
  const r = settleHandicap('H', -0.25, 0, 0, O);
  eq(r.outcome, 'half-loss', '结果'); near(r.pnlPerUnit, -0.5, '盈亏=-半注本金');
});
t('quarter：主让0.25，净胜1 → 全赢', () => eq(settleHandicap('H', -0.25, 1, 0, O).outcome, 'win', '结果'));

// 主客互补：不同结果下两侧盈亏相加应为 0 或 -抽水（同注同赔率时）
t('quarter 主客两侧结果互补（赢/输 对应）', () => {
  const h = settleHandicap('H', -0.75, 1, 0, O);
  const a = settleHandicap('A', -0.75, 1, 0, O);
  eq(h.outcome, 'half-win', '主');
  eq(a.outcome, 'half-loss', '客');
});

// ---------------- 大小球 ----------------
t('大小：大2.5，进3 → 赢', () => eq(settleTotal('over', 2.5, 2, 1, O).outcome, 'win', '结果'));
t('大小：大2.5，进2 → 输', () => eq(settleTotal('over', 2.5, 1, 1, O).outcome, 'lose', '结果'));
t('大小：大3，进3 → 走水', () => {
  const r = settleTotal('over', 3, 2, 1, O);
  eq(r.outcome, 'push', '结果'); near(r.pnlPerUnit, 0, '盈亏');
});
t('大小：大2.75，进3 → 赢半', () => {
  const r = settleTotal('over', 2.75, 2, 1, O);
  eq(r.outcome, 'half-win', '结果'); near(r.pnlPerUnit, 0.45, '盈亏');
});
t('大小：小2.75，进3 → 输半', () => {
  const r = settleTotal('under', 2.75, 2, 1, O);
  eq(r.outcome, 'half-loss', '结果'); near(r.pnlPerUnit, -0.5, '盈亏');
});

// ---------------- 竞彩玩法 ----------------
t('竞彩胜平负：选主，2-1 → 赢', () => eq(settleMoneyline('H', 2, 1, O).outcome, 'win', '结果'));
t('竞彩胜平负：选平，2-1 → 输', () => eq(settleMoneyline('D', 2, 1, O).outcome, 'lose', '结果'));
t('竞彩让球：主让1，净胜1 → 让平=输（不是走水）', () => {
  const r = settleJcHandicap('H', -1, 1, 0, O);
  eq(r.outcome, 'lose', '结果'); near(r.pnlPerUnit, -1, '盈亏');
});
t('竞彩让球：主让1，净胜1，选平 → 赢', () => eq(settleJcHandicap('D', -1, 1, 0, O).outcome, 'win', '结果'));

// ---------------- 边界 ----------------
t('边界：0-0 大0.5 → 输；小0.5 → 赢', () => {
  eq(settleTotal('over', 0.5, 0, 0, O).outcome, 'lose', '大');
  eq(settleTotal('under', 0.5, 0, 0, O).outcome, 'win', '小');
});
t('边界：负盘口（客让）方向不反', () => eq(settleHandicap('A', -1, 0, 2, O).outcome, 'win', '客让1净胜2'));

console.log(`\nPASS ${pass} 组, FAIL ${fails.length}`);
if (fails.length) { console.error(fails.join('\n')); process.exit(1); }
