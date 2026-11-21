/**
 * basketball.ts — 篮球市场去水基线 + 盘口结算 + EV 估算（纯函数）
 *
 * 诚实边界（与 ALGORITHMS.md 一致）：
 * - 当前**没有**篮球球队强度模型，也没有篮球历史样本外验证。
 * - 因此本模块**不产生**独立预测概率；所有概率都是「市场去水基线概率」，
 *   即市场赔率去掉水位后的隐含概率，不是真实概率，也不代表模型优势。
 * - 用去水基线概率算出的 EV 恒等于水位劣势（负数），只能用于描述市场定价，
 *   **不构成下注理由**。任何篮球实单在「无独立模型概率」前提下都属于「不可计算」，
 *   不得把本模块的基线 EV 当成正 EV 证据。
 *
 * 术语：去水基线概率 / 市场基线EV；禁止写成「真实EV / 真实概率 / 模型优势」。
 */

export interface DeVig {
  prob: number | null;   // 去水基线概率（该方）
  vig: number | null;    // 水位（overround - 1）
  reason?: string;
}

function finite(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}
function validOdds(x: unknown): x is number {
  return finite(x) && x > 1 && x < 1000;
}

/**
 * 两路市场去水（篮球胜负/让分/大小，均只有两路，无平局）。
 * devig: p_i = (1/o_i) / (1/o_1 + 1/o_2)。
 */
export function devigTwoWay(oddsA: number, oddsB: number): DeVig {
  if (!validOdds(oddsA) || !validOdds(oddsB)) {
    return { prob: null, vig: null, reason: `赔率非法:${String(oddsA)}/${String(oddsB)}` };
  }
  const invA = 1 / oddsA, invB = 1 / oddsB;
  const z = invA + invB;                 // overround，>1 表示有水
  if (z <= 0) return { prob: null, vig: null, reason: '去水分母非正' };
  return { prob: invA / z, vig: z - 1 };
}

/**
 * 市场基线EV = p × odds − 1。
 * p 必须是去水基线概率；返回值恒为负（≈−vig/(1+vig)），仅供描述，不是下注信号。
 * 若试图传入「模型概率」，调用方须自行保证其经过验证；本模块不提供该能力。
 */
export function marketBaselineEv(prob: number, odds: number): number | null {
  if (!finite(prob) || prob <= 0 || prob >= 1) return null;
  if (!validOdds(odds)) return null;
  return prob * odds - 1;
}

/** 篮球让分线合法性：0.5 的倍数，|line| ≤ 60（篮球让分远大于足球，单独限定） */
export function isValidBasketballHandicap(line: unknown): line is number {
  return finite(line) && Math.abs(line) <= 60 && Math.abs(line * 2 - Math.round(line * 2)) < 1e-9;
}

/** 篮球大小分线合法性：0.5 的倍数，|line| ≤ 400（总分可达 200+） */
export function isValidBasketballTotal(line: unknown): line is number {
  return finite(line) && line >= 0 && line <= 400 && Math.abs(line * 2 - Math.round(line * 2)) < 1e-9;
}

export type Outcome = 'win' | 'lose' | 'push' | 'uncomputable';
export interface Result { outcome: Outcome; pnlPerUnit: number | null; reason?: string }

const bad = (reason: string): Result => ({ outcome: 'uncomputable', pnlPerUnit: null, reason });

/**
 * 篮球让分结算。line 为主队视角（-6.5 主让 6.5）。篮球让分为 .5 或整数，无 quarter 拆分。
 */
export function settleBasketballHandicap(
  side: 'H' | 'A', line: number, homeScore: number, awayScore: number, odds: number
): Result {
  if (side !== 'H' && side !== 'A') return bad(`方向非法:${String(side)}`);
  if (!isValidBasketballHandicap(line)) return bad(`让分线非法:${String(line)}`);
  if (!finite(homeScore) || !finite(awayScore) || homeScore < 0 || awayScore < 0 ||
      !Number.isInteger(homeScore) || !Number.isInteger(awayScore)) return bad('比分非法');
  if (!validOdds(odds)) return bad(`赔率非法:${String(odds)}`);
  const margin = side === 'H' ? homeScore - awayScore : awayScore - homeScore;
  const L = side === 'H' ? line : -line;
  const adj = margin + L;
  const outcome: Outcome = adj > 0 ? 'win' : adj === 0 ? 'push' : 'lose';
  return { outcome, pnlPerUnit: outcome === 'win' ? odds - 1 : outcome === 'push' ? 0 : -1 };
}

/** 篮球大小分结算（line 可达 200+，不能用足球 settlement.ts 的 |line|≤10 版本） */
export function settleBasketballTotal(
  side: 'over' | 'under', line: number, homeScore: number, awayScore: number, odds: number
): Result {
  if (side !== 'over' && side !== 'under') return bad(`方向非法:${String(side)}`);
  if (!isValidBasketballTotal(line)) return bad(`大小分线非法:${String(line)}`);
  if (!finite(homeScore) || !finite(awayScore) || homeScore < 0 || awayScore < 0 ||
      !Number.isInteger(homeScore) || !Number.isInteger(awayScore)) return bad('比分非法');
  if (!validOdds(odds)) return bad(`赔率非法:${String(odds)}`);
  const total = homeScore + awayScore;
  const adj = side === 'over' ? total - line : line - total;
  const outcome: Outcome = adj > 0 ? 'win' : adj === 0 ? 'push' : 'lose';
  return { outcome, pnlPerUnit: outcome === 'win' ? odds - 1 : outcome === 'push' ? 0 : -1 };
}

/** 篮球胜负结算（无平局）。复用与足球胜负相同的判定，但独立实现避免 D 路径被误用。 */
export function settleBasketballMoneyline(
  pick: 'H' | 'A', homeScore: number, awayScore: number, odds: number
): Result {
  if (pick !== 'H' && pick !== 'A') return bad(`方向非法:${String(pick)}`);
  if (!finite(homeScore) || !finite(awayScore) || homeScore < 0 || awayScore < 0 ||
      !Number.isInteger(homeScore) || !Number.isInteger(awayScore)) return bad('比分非法');
  if (!validOdds(odds)) return bad(`赔率非法:${String(odds)}`);
  if (homeScore === awayScore) return bad('篮球不应出现平局比分');
  const actual: 'H' | 'A' = homeScore > awayScore ? 'H' : 'A';
  const outcome: Outcome = pick === actual ? 'win' : 'lose';
  return { outcome, pnlPerUnit: outcome === 'win' ? odds - 1 : -1 };
}
