/**
 * ev-fit.ts — 由欧洲公平 1x2 概率拟合独立泊松强度 (λh, λa)，Skellam 边差分得让球线公平概率。
 * v2.1 value 维度：HAD/让球胜平负 的「方向公平概率」都从欧赔独立源出，再 × 竞彩赔率 − 1 得真 EV。
 * 独立泊松假设对主流联赛边差分是常用近似（Dixon-Coles 未启用时的基线）。
 */
export interface Fair1x2 { home: number; draw: number; away: number }

const MAX_K = 34;              // 进球截断（λ ≤ 3.6 时截断误差 < 1e-12）
const LAM_MIN = 0.2, LAM_MAX = 3.6, GRID = 0.1, REFINE = 0.01;

function poisPmf(l: number, k: number): number {
  let p = Math.exp(-l);
  for (let i = 1; i <= k; i++) p *= l / i;
  return p;
}
function poissonArr(l: number): number[] {
  const a = new Array(MAX_K + 1);
  for (let k = 0; k <= MAX_K; k++) a[k] = poisPmf(l, k);
  return a;
}

/** P(M = m)，M = 主进球 − 客进球 ~ Skellam(λh, λa)；ph/pa 为预计算泊松数组 */
function skellamProb(m: number, ph: number[], pa: number[]): number {
  let s = 0;
  for (let j = 0; j <= MAX_K; j++) {
    const pk = j - m;
    if (pk < 0 || pk > MAX_K) continue;
    const p = ph[j];
    if (p < 1e-13) continue;
    s += p * pa[pk];
  }
  return s;
}

/** P(M ≤ hi)，截断求和，一次调用计算两组泊松数组 */
function skellamLe(lh: number, la: number, hi: number): number {
  const ph = poissonArr(lh), pa = poissonArr(la);
  let s = 0;
  const mMax = Math.min(hi, MAX_K);
  for (let m = -MAX_K; m <= mMax; m++) s += skellamProb(m, ph, pa);
  return s;
}
const PWinGe = (lh: number, la: number) => 1 - skellamLe(lh, la, 0);   // P(M ≥ 1)
const PLossLe = (lh: number, la: number) => skellamLe(lh, la, -1);     // P(M ≤ −1)

/** 网格+局部精化 拟合 (λh,λa)：最小化 |Pwin−h|+|Ploss−a| */
export function fitLambdas(fair: Fair1x2): { lh: number; la: number; err: number } | null {
  if (!(fair.home > 0 && fair.draw > 0 && fair.away > 0)) return null;
  const errFor = (lh: number, la: number): number =>
    Math.abs(PWinGe(lh, la) - fair.home) + Math.abs(PLossLe(lh, la) - fair.away);
  let best: { lh: number; la: number; err: number } | null = null;
  for (let lh = LAM_MIN; lh <= LAM_MAX + 1e-9; lh += GRID) {
    for (let la = LAM_MIN; la <= LAM_MAX + 1e-9; la += GRID) {
      const err = errFor(lh, la);
      if (!best || err < best.err) best = { lh, la, err };
    }
  }
  if (!best) return null;
  for (let it = 0; it < 2; it++) {
    let improved = false;
    const start: { lh: number; la: number; err: number } = { lh: best.lh, la: best.la, err: best.err };
    for (const dl of [-REFINE, 0, REFINE]) for (const dr of [-REFINE, 0, REFINE]) {
      const nlh: number = start.lh + dl;
      const nla: number = start.la + dr;
      if (nlh < LAM_MIN || nlh > LAM_MAX || nla < LAM_MIN || nla > LAM_MAX) continue;
      const err = errFor(nlh, nla);
      if (err < start.err) { best = { lh: nlh, la: nla, err }; improved = true; }
    }
    if (!improved) break;
  }
  return { lh: +best.lh.toFixed(4), la: +best.la.toFixed(4), err: best.err };
}

const MAX_FIT_ERR = 0.03;

/**
 * 方向公平概率：
 *  HAD  → P(主胜/客胜)（即 fair.home / fair.away）
 *  HHAD → 以“主队让球线”统一计算边界：M + gln > 0（主方向）或
 *          M + gln < 0（客方向），M=主进球−客进球。
 *  走盘不计入任一方向的赢盘概率；拟合质量差时回退 1x2 侧概率。
 */
export function fairProbForPick(fair: Fair1x2, dropSide: 'H' | 'A', market: 'HAD' | 'HHAD', gln: number): number | null {
  if (!(fair.home > 0 && fair.draw > 0 && fair.away > 0)) return null;
  if (market === 'HAD') return dropSide === 'H' ? fair.home : fair.away;
  if (!Number.isFinite(gln)) return null;
  const lam = fitLambdas(fair);
  if (lam && lam.err <= MAX_FIT_ERR) {
    const line = -gln;
    // 2026-11-19 审计：quarter/非整数盘必须完整拆分结算后才能计算，否则返回 null（安全失败）
    if (Math.abs(line - Math.round(line)) > 1e-9) return null;
    if (dropSide === 'H') return 1 - skellamLe(lam.lh, lam.la, Math.floor(line)); // M > line
    return skellamLe(lam.lh, lam.la, Math.ceil(line) - 1); // M < line
  }
  // 2026-11-19 审计：拟合失败不再回退 1x2 概率（会把让球概率算成胜平负，高估 EV）
  return null;
}

/**
 * 走水概率 P(M + gln == 0)（主队让球线视角的整数盘；亚盘走盘退本金用）。
 * 仅整数让球线有全额走水：返回拟合 Skellam 下 P(M == -gln)，供欧亚结算 EV 加回。
 * 半球盘无走水、quarter 盘需分拆——此处一律返回 null，调用方沿用保守旧式。
 * 拟合质量差同样返回 null（宁缺毋滥）。
 */
export function fairPushProb(fair: Fair1x2, gln: number): number | null {
  if (!Number.isFinite(gln)) return null;
  const r = gln - Math.floor(gln);
  if (!(r < 1e-9 || r > 1 - 1e-9)) return null;
  if (!(fair.home > 0 && fair.draw > 0 && fair.away > 0)) return null;
  const lam = fitLambdas(fair);
  if (!lam || lam.err > MAX_FIT_ERR) return null;
  const m = Math.round(-gln);
  if (m < -MAX_K || m > MAX_K) return 0;
  return +skellamProb(m, poissonArr(lam.lh), poissonArr(lam.la)).toFixed(6);
}

/** Small executable regression check for handicap-line sign handling. */
export function assertFairProbHandicapDirection(): void {
  const fair = { home: 0.70, draw: 0.18, away: 0.12 };
  const hostGiving = fairProbForPick(fair, 'H', 'HHAD', -2);
  const guestReceiving = fairProbForPick(fair, 'A', 'HHAD', -2);
  if (hostGiving == null || guestReceiving == null || hostGiving >= fair.home || guestReceiving <= fair.away) {
    throw new Error(`让球公平概率方向回归失败: home-2=${hostGiving}, away+2=${guestReceiving}`);
  }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('ev-fit.ts')) assertFairProbHandicapDirection();