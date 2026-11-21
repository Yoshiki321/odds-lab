/**
 * pricing.ts — Odds-Lab 统一定价、去水、精确 EV、凯利注码与 CLV 计算内核（SSOT）
 *
 * 覆盖：
 *  1) 幂函数去水（Power Method，消除 1X2 热门-冷门偏差）与两项比例去水
 *  2) 1X2 / 竞彩 HHAD（三项盘，让平算输）、亚盘整/半盘、亚盘四分之一盘（±0.25/±0.75）、大小球精确 EV
 *  3) 1/4 凯利注码管理（含最小 EV 安全垫与硬封顶）
 *  4) CLV（Closing Line Value）收盘价价值计算
 */

export interface DevigResult {
  probs: number[];
  overround: number;
  method: 'power' | 'proportional';
  exponent?: number;
}

/** 校验一组赔率均 > 1 且有限 */
function validOddsList(odds: number[]): boolean {
  return Array.isArray(odds) && odds.length >= 2 && odds.every((o) => Number.isFinite(o) && o > 1);
}

/** 简单比例去水（适用于对称两项盘，如亚盘/大小球） */
export function devigProportional(odds: number[]): DevigResult | null {
  if (!validOddsList(odds)) return null;
  const inv = odds.map((o) => 1 / o);
  const sum = inv.reduce((s, x) => s + x, 0);
  if (!(sum > 0)) return null;
  return {
    probs: inv.map((x) => x / sum),
    overround: +(sum - 1).toFixed(6),
    method: 'proportional',
  };
}

/**
 * 幂函数去水（Power Method）：求 k > 0 使 sum((1 / O_i)^k) = 1。
 * 在 1X2 三项盘上显著优于比例去水，可修正冷门高抽水造成的虚假 +EV。
 */
export function devigPower(odds: number[]): DevigResult | null {
  if (!validOddsList(odds)) return null;
  const inv = odds.map((o) => 1 / o);
  const sum1 = inv.reduce((s, x) => s + x, 0);
  if (Math.abs(sum1 - 1) < 1e-9) {
    return { probs: inv, overround: 0, method: 'power', exponent: 1 };
  }
  // 二分法求解 f(k) = sum(inv_i^k) - 1 = 0（inv_i in (0,1)，f(k) 严格单调递减）
  let lo = 0.01;
  let hi = 20.0;
  const evalSum = (k: number) => inv.reduce((s, x) => s + Math.pow(x, k), 0);
  if (evalSum(lo) < 1 || evalSum(hi) > 1) return devigProportional(odds);
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    if (evalSum(mid) > 1) lo = mid;
    else hi = mid;
  }
  const k = (lo + hi) / 2;
  const raw = inv.map((x) => Math.pow(x, k));
  const norm = raw.reduce((s, x) => s + x, 0);
  return {
    probs: raw.map((x) => x / norm),
    overround: +(sum1 - 1).toFixed(6),
    method: 'power',
    exponent: +k.toFixed(6),
  };
}

export interface ThreeWayOutcomeProb {
  pWin: number;
  pPush: number;
  pLose: number;
}

/**
 * 整/半盘精确 EV（走水退本净盈亏为 0）：
 *   EV = pWin * (odds - 1) - pLose
 */
export function calcThreeStateEV(p: ThreeWayOutcomeProb, execOdds: number): number | null {
  if (!Number.isFinite(execOdds) || execOdds <= 1) return null;
  const sum = p.pWin + p.pPush + p.pLose;
  if (!Number.isFinite(sum) || Math.abs(sum - 1) > 1e-4) return null;
  return p.pWin * (execOdds - 1) - p.pLose;
}

/**
 * 亚盘 / 大小球精确 EV（自动识别四分之一盘 ±0.25 / ±0.75 并按 50/50 拆盘）：
 * 传入 probAtLine(line) 回调，返回该半/整盘下的 { pWin, pPush, pLose }。
 */
export function calcHandicapOrTotalEV(
  line: number,
  execOdds: number,
  probAtLine: (halfOrIntLine: number) => ThreeWayOutcomeProb | null,
): number | null {
  if (!Number.isFinite(line) || !Number.isFinite(execOdds) || execOdds <= 1) return null;
  const scaled = Math.round(line * 4);
  if (Math.abs(line * 4 - scaled) > 1e-6) return null; // 非 0.25 倍数非法

  if (scaled % 2 !== 0) {
    // 四分之一盘：拆成 (line - 0.25) 与 (line + 0.25) 各占 50% 本金
    const lo = probAtLine(line - 0.25);
    const hi = probAtLine(line + 0.25);
    if (!lo || !hi) return null;
    const evLo = calcThreeStateEV(lo, execOdds);
    const evHi = calcThreeStateEV(hi, execOdds);
    if (evLo == null || evHi == null) return null;
    return 0.5 * evLo + 0.5 * evHi;
  }

  const single = probAtLine(line);
  if (!single) return null;
  return calcThreeStateEV(single, execOdds);
}

/** 1X2 / 竞彩 HHAD（三项盘，无走水）精确 EV */
export function calcBinaryEV(modelProb: number, execOdds: number): number | null {
  if (!Number.isFinite(modelProb) || modelProb <= 0 || modelProb >= 1) return null;
  if (!Number.isFinite(execOdds) || execOdds <= 1) return null;
  return modelProb * execOdds - 1;
}

/**
 * 1/4 凯利注码建议（带最小 EV 安全垫与单注资金占比上限）
 * @returns 占总资金比例 [0, maxCap]
 */
export function fractionalKelly(
  ev: number,
  execOdds: number,
  fraction = 0.25,
  minEv = 0.025,
  maxCap = 0.10,
): number {
  if (!Number.isFinite(ev) || !Number.isFinite(execOdds) || execOdds <= 1) return 0;
  if (ev <= minEv) return 0;
  const b = execOdds - 1;
  const raw = (ev / b) * fraction;
  return Math.max(0, Math.min(maxCap, raw));
}

/**
 * CLV（Closing Line Value，收盘价价值）：
 * 给定下注时的可成交赔率 execOdds，与临场收盘去水公平概率 closingFairProb：
 *   CLV = closingFairProb * execOdds - 1
 * CLV > 0 表示拿到了比收盘真实市场价更优的水位（长期盈利的核心领先指标）。
 */
export function calcCLV(execOdds: number, closingFairProb: number): number | null {
  if (!Number.isFinite(execOdds) || execOdds <= 1) return null;
  if (!Number.isFinite(closingFairProb) || closingFairProb <= 0 || closingFairProb >= 1) return null;
  return +(closingFairProb * execOdds - 1).toFixed(6);
}
