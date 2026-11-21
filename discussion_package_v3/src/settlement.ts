/**
 * settlement.ts — 盘口结算纯函数（含运行时输入校验）
 * 非法输入一律返回 outcome='uncomputable'，绝不判赢/判输。
 * 约定：
 *  - line 以主队视角：-1 主让1，+0.5 主受让0.5；合法值必须是 0.25 的整数倍且 ∈[-10,10]
 *  - margin = 主队得分 - 客队得分；比分必须是非负整数
 *  - 整数盘：adj>0 赢 / =0 走水 / <0 输；半球无走水；quarter 拆两半
 */
export type Outcome = 'win' | 'half-win' | 'push' | 'half-loss' | 'lose' | 'uncomputable';
export type Side = 'H' | 'A';

export interface Result {
  outcome: Outcome;
  /** 每 1 单位本金的净盈亏；不可计算时为 null */
  pnlPerUnit: number | null;
  reason?: string;
}

const MAX_ABS_LINE = 10;

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}
function isNonNegInt(x: unknown): x is number {
  return isFiniteNumber(x) && Number.isInteger(x) && x >= 0;
}
/** 合法盘口：0.25 的整数倍，|line| ≤ 10 */
export function isValidLine(line: unknown): line is number {
  if (!isFiniteNumber(line)) return false;
  if (Math.abs(line) > MAX_ABS_LINE) return false;
  const quarters = line * 4;
  return Math.abs(quarters - Math.round(quarters)) < 1e-9;
}
function isValidOdds(odds: unknown): odds is number {
  return isFiniteNumber(odds) && odds > 1 && odds < 1000;
}

const uncomputable = (reason: string): Result => ({ outcome: 'uncomputable', pnlPerUnit: null, reason });

function singleOutcome(adjusted: number): 'win' | 'push' | 'lose' {
  if (adjusted > 0) return 'win';
  if (adjusted === 0) return 'push';
  return 'lose';
}
function outcomeToPnl(outcome: Outcome, odds: number): number | null {
  const profit = odds - 1;
  switch (outcome) {
    case 'win': return profit;
    case 'half-win': return profit / 2;
    case 'push': return 0;
    case 'half-loss': return -0.5;
    case 'lose': return -1;
    default: return null;
  }
}

function combineHalfOutcomes(o1: 'win' | 'push' | 'lose', o2: 'win' | 'push' | 'lose', odds: number): Result {
  const wins = [o1, o2].filter((x) => x === 'win').length;
  const pushes = [o1, o2].filter((x) => x === 'push').length;
  const losses = [o1, o2].filter((x) => x === 'lose').length;
  let outcome: Outcome;
  if (wins === 2) outcome = 'win';
  else if (wins === 1 && pushes === 1) outcome = 'half-win';
  else if (pushes === 2) outcome = 'push';
  else if (losses === 1 && pushes === 1) outcome = 'half-loss';
  else outcome = 'lose';
  return { outcome, pnlPerUnit: outcomeToPnl(outcome, odds) };
}

/** 亚盘让球（整数/半球/quarter） */
export function settleHandicap(side: Side, line: number, homeScore: number, awayScore: number, odds: number): Result {
  if (side !== 'H' && side !== 'A') return uncomputable(`方向非法:${String(side)}`);
  if (!isValidLine(line)) return uncomputable(`盘口非法:${String(line)}`);
  if (!isNonNegInt(homeScore) || !isNonNegInt(awayScore)) return uncomputable('比分非法（需非负整数）');
  if (!isValidOdds(odds)) return uncomputable(`赔率非法:${String(odds)}`);

  const margin = side === 'H' ? homeScore - awayScore : awayScore - homeScore;
  const L = side === 'H' ? line : -line;
  const adj = margin + L;

  const isQuarter = Math.abs(L * 2 - Math.round(L * 2)) > 1e-9;
  if (!isQuarter) {
    const o = singleOutcome(adj);
    return { outcome: o, pnlPerUnit: outcomeToPnl(o, odds) };
  }
  const l1 = +(L - 0.25).toFixed(10);
  const l2 = +(L + 0.25).toFixed(10);
  return combineHalfOutcomes(singleOutcome(margin + l1), singleOutcome(margin + l2), odds);
}

/** 大小球（整数/半球/quarter） */
export function settleTotal(side: 'over' | 'under', line: number, homeScore: number, awayScore: number, odds: number): Result {
  if (side !== 'over' && side !== 'under') return uncomputable(`方向非法:${String(side)}`);
  if (!isValidLine(line)) return uncomputable(`盘口非法:${String(line)}`);
  if (!isNonNegInt(homeScore) || !isNonNegInt(awayScore)) return uncomputable('比分非法（需非负整数）');
  if (!isValidOdds(odds)) return uncomputable(`赔率非法:${String(odds)}`);

  const total = homeScore + awayScore;
  const adj = side === 'over' ? total - line : line - total;
  const isQuarter = Math.abs(line * 2 - Math.round(line * 2)) > 1e-9;
  if (!isQuarter) {
    const o = singleOutcome(adj);
    return { outcome: o, pnlPerUnit: outcomeToPnl(o, odds) };
  }
  const l1 = +(line - 0.25).toFixed(10);
  const l2 = +(line + 0.25).toFixed(10);
  const o1 = singleOutcome(side === 'over' ? total - l1 : l1 - total);
  const o2 = singleOutcome(side === 'over' ? total - l2 : l2 - total);
  return combineHalfOutcomes(o1, o2, odds);
}

/** 竞彩胜平负 */
export function settleMoneyline(pick: 'H' | 'D' | 'A', homeScore: number, awayScore: number, odds: number): Result {
  if (!['H', 'D', 'A'].includes(pick)) return uncomputable(`方向非法:${String(pick)}`);
  if (!isNonNegInt(homeScore) || !isNonNegInt(awayScore)) return uncomputable('比分非法（需非负整数）');
  if (!isValidOdds(odds)) return uncomputable(`赔率非法:${String(odds)}`);
  const actual: 'H' | 'D' | 'A' = homeScore > awayScore ? 'H' : homeScore === awayScore ? 'D' : 'A';
  const won = pick === actual;
  return { outcome: won ? 'win' : 'lose', pnlPerUnit: won ? odds - 1 : -1 };
}

/** 竞彩让球胜平负（让平算输，不是走水） */
export function settleJcHandicap(pick: 'H' | 'D' | 'A', goalLine: number, homeScore: number, awayScore: number, odds: number): Result {
  if (!['H', 'D', 'A'].includes(pick)) return uncomputable(`方向非法:${String(pick)}`);
  if (!isValidLine(goalLine) || Math.abs(goalLine - Math.round(goalLine)) > 1e-9) return uncomputable(`竞彩让球线必须为整数:${String(goalLine)}`);
  if (!isNonNegInt(homeScore) || !isNonNegInt(awayScore)) return uncomputable('比分非法（需非负整数）');
  if (!isValidOdds(odds)) return uncomputable(`赔率非法:${String(odds)}`);
  const adjHome = homeScore + goalLine;
  const actual: 'H' | 'D' | 'A' = adjHome > awayScore ? 'H' : adjHome === awayScore ? 'D' : 'A';
  const won = pick === actual;
  return { outcome: won ? 'win' : 'lose', pnlPerUnit: won ? odds - 1 : -1 };
}
