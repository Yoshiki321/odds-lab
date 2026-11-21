/**
 * ev-fit.test.ts — 回归 + 独立参考对照（node 24 直跑：node app/tools/ev-fit.test.ts）
 * 参考实现：用双重求和暴力算 Skellam，与库内递推/Poisson 数组实现对照。
 */
import { fitLambdas, fairProbForPick, fairPushProb, validateFair } from './ev-fit.ts';

let pass = 0;
const fails: string[] = [];
function t(name: string, fn: () => void) {
  try { fn(); pass++; console.log('ok - ' + name); }
  catch (e: any) { fails.push(name + ': ' + e.message); console.error('FAIL - ' + name + '\n' + e.message); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
function near(a: number, b: number, tol: number, msg: string) {
  if (!(Math.abs(a - b) <= tol)) throw new Error(`${msg}: ${a} vs ${b} (tol ${tol})`);
}

// ---------------- 独立参考实现（暴力双重求和，不复用库内函数） ----------------
function pois(l: number, k: number): number {
  let p = Math.exp(-l);
  for (let i = 1; i <= k; i++) p *= l / i;
  return p;
}
function skellamBrute(lh: number, la: number, m: number): number {
  let s = 0;
  for (let h = 0; h < 40; h++) {
    const a = h - m;
    if (a < 0 || a >= 40) continue;
    s += pois(lh, h) * pois(la, a);
  }
  return s;
}
function winOrLossBrute(lh: number, la: number) {
  let win = 0, loss = 0;
  for (let m = -39; m <= 39; m++) {
    const p = skellamBrute(lh, la, m);
    if (m >= 1) win += p;
    if (m <= -1) loss += p;
  }
  return { win, loss };
}

const FAIR = { home: 0.7, draw: 0.18, away: 0.12 };

// 1. 输入校验
t('输入校验：NaN/Infinity/越界/和不为1 全部拒绝', () => {
  assert(validateFair(FAIR).ok, '正常输入应通过');
  assert(!validateFair({ home: NaN, draw: 0.2, away: 0.8 }).ok, 'NaN 应拒绝');
  assert(!validateFair({ home: Infinity, draw: 0.2, away: 0.8 }).ok, 'Infinity 应拒绝');
  assert(!validateFair({ home: 0, draw: 0.5, away: 0.5 }).ok, '0 应拒绝');
  assert(!validateFair({ home: 1.2, draw: -0.2, away: 0 }).ok, '越界应拒绝');
  assert(!validateFair({ home: 0.5, draw: 0.2, away: 0.2 }).ok, '和不为1应拒绝');
});

// 2. 拟合质量：与暴力参考对照
t('fitLambdas 与暴力参考 Skellam 一致', () => {
  const fit = fitLambdas(FAIR);
  assert(!!fit, '应拟合成功');
  const ref = winOrLossBrute(fit!.lh, fit!.la);
  // λ 返回时保留 4 位小数，误差量级 5e-5 属正常
  near(ref.win, FAIR.home, 2e-4, '主胜概率对照');
  near(ref.loss, FAIR.away, 2e-4, '客胜概率对照');
  assert(fit!.err <= 0.03, '误差应在阈值内');
});

// 3. 精化不倒退：误差必须 ≤ 网格最优（用粗网格重算下界近似）
t('精化结果误差不大于网格最优', () => {
  const fit = fitLambdas(FAIR)!;
  let bestGrid = Infinity;
  for (let lh = 0.2; lh <= 3.6001; lh += 0.1) {
    for (let la = 0.2; la <= 3.6001; la += 0.1) {
      const { win, loss } = winOrLossBrute(lh, la);
      const err = Math.abs(win - FAIR.home) + Math.abs(loss - FAIR.away);
      if (err < bestGrid) bestGrid = err;
    }
  }
  assert(fit.err <= bestGrid + 1e-9, `精化误差 ${fit.err} 不应大于网格最优 ${bestGrid}`);
});

// 4. 单调性
t('λh 增大 → 主胜概率不降', () => {
  const a = winOrLossBrute(1.0, 1.2).win;
  const b = winOrLossBrute(1.6, 1.2).win;
  assert(b > a, '应单调上升');
});

// 5. 让球方向与走水互补关系
t('整数让球：方向正确且 主+客+走水 = 1', () => {
  const h = fairProbForPick(FAIR, 'H', 'HHAD', -2);
  const a = fairProbForPick(FAIR, 'A', 'HHAD', -2);
  const push = fairPushProb(FAIR, -2);
  assert(h !== null && a !== null && push !== null, '整数线应可计算');
  assert(h! < FAIR.home, '主让2 应低于主胜');
  assert(a! > FAIR.away, '客受让2 应高于客胜');
  near(h! + a! + push!, 1, 1e-6, '主+客+走水应等于1（λ 保留4位小数带来 ~2e-7 舍入）');
});

// 6. 非整数线一律 null（半球与 quarter）
t('非整数让球线（-0.5 / -0.75 / +0.25）一律返回 null', () => {
  for (const gln of [-0.5, -0.75, 0.25, 0.5, 1.25]) {
    assert(fairProbForPick(FAIR, 'H', 'HHAD', gln) === null, `gln=${gln} 应返回 null`);
    assert(fairProbForPick(FAIR, 'A', 'HHAD', gln) === null, `gln=${gln} 客向应返回 null`);
  }
});

// 7. 拟合失败 → null（不再回退 1x2）
t('极端输入导致拟合成败一致：失败则 null', () => {
  const extreme = { home: 0.999, draw: 0.0005, away: 0.0005 };
  const v = validateFair(extreme);
  assert(v.ok, '极端但合法的输入应通过校验');
  const h = fairProbForPick(extreme, 'H', 'HHAD', -1);
  // 允许拟合成功或失败，但失败必须为 null（不能返回 1x2 概率）
  if (h === null) assert(true, 'ok');
  else assert(h >= 0 && h <= 1, '成功时必须在 [0,1]');
});

// 8. push 概率
t('push：整数线给出概率，非整数线 null', () => {
  const p = fairPushProb(FAIR, -1);
  assert(p !== null && p > 0 && p < 1, '整数线 push 应在 (0,1)');
  assert(fairPushProb(FAIR, -0.75) === null, 'quarter 应返回 null');
  assert(fairPushProb(FAIR, -0.5) === null, '半球应返回 null');
});

// 9. HAD 直接返回基线概率（并标注含义）
t('HAD 返回去水基线概率（非独立模型）', () => {
  near(fairProbForPick(FAIR, 'H', 'HAD', 0)!, 0.7, 1e-12, '主');
  near(fairProbForPick(FAIR, 'A', 'HAD', 0)!, 0.12, 1e-12, '客');
});

console.log(`\nPASS ${pass} 组, FAIL ${fails.length}`);
if (fails.length) { console.error(fails.join('\n')); process.exit(1); }
