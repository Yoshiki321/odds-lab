/**
 * settlement.ts — 盘口结算纯函数（不含任何账户/账本逻辑）
 * 约定：
 *  - line 以主队视角给出：-1 表示主让1球，+0.5 表示主受让0.5
 *  - margin = 主队得分 - 客队得分
 *  - 盘口调整后 adjusted = margin + line
 *  - 整数盘：adjusted>0 赢 / =0 走水 / <0 输
 *  - 半球：无走水
 *  - quarter（.25/.75）：拆成相邻两个半球/整数盘，各半注，合并为 赢半/输半
 */
export type Outcome = 'win' | 'half-win' | 'push' | 'half-loss' | 'lose';
export type Side = 'H' | 'A';

export interface Result {
  outcome: Outcome;
  /** 每 1 单位本金的净盈亏（赢 +0.9 表示赔率1.90时；由调用方传 odds 计算） */
  pnlPerUnit: number;
}

function singleOutcome(adjusted: number): 'win' | 'push' | 'lose' {
  if (adjusted > 0) return 'win';
  if (adjusted === 0) return 'push';
  return 'lose';
}

function outcomeToPnl(outcome: Outcome, odds: number): number {
  const profit = odds - 1;
  switch (outcome) {
    case 'win': return profit;
    case 'half-win': return profit / 2;
    case 'push': return 0;
    case 'half-loss': return -0.5;
    case 'lose': return -1;
  }
}

/** 亚盘让球（整数/半球/quarter） */
export function settleHandicap(side: Side, line: number, homeScore: number, awayScore: number, odds: number): Result {
  const margin = side === 'H' ? homeScore - awayScore : awayScore - homeScore;
  const L = side === 'H' ? line : -line;
  const adj = margin + L;

  // quarter 判定：L*2 不是整数（如 -0.75*2=-1.5）
  const isQuarter = Math.abs(L * 2 - Math.round(L * 2)) > 1e-9;
  if (!isQuarter) {
    const o = singleOutcome(adj);
    return { outcome: o, pnlPerUnit: outcomeToPnl(o, odds) };
  }

  // 拆两半：L-0.25 与 L+0.25（-0.75 → -1.0 与 -0.5）
  const l1 = +(L - 0.25).toFixed(10);
  const l2 = +(L + 0.25).toFixed(10);
  const o1 = singleOutcome(margin + l1);
  const o2 = singleOutcome(margin + l2);
  return combineHalfOutcomes(o1, o2, odds);
}

/** 大小球（整数/半球/quarter 同理，无主客方向） */
export function settleTotal(side: 'over' | 'under', line: number, homeScore: number, awayScore: number, odds: number): Result {
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

/** 两个子盘口合并：赢赢=全赢，赢走=赢半，走走=走水，输走=输半，输输=全输 */
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
  const pnl = outcome === 'half-win' ? (odds - 1) / 2 : outcome === 'half-loss' ? -0.5 : outcomeToPnl(outcome, odds);
  return { outcome, pnlPerUnit: pnl };
}

/** 竞彩胜平负（三项，含平局；让球胜平负同理，line 由调用方给出） */
export function settleMoneyline(pick: 'H' | 'D' | 'A', homeScore: number, awayScore: number, odds: number): Result {
  const actual: 'H' | 'D' | 'A' = homeScore > awayScore ? 'H' : homeScore === awayScore ? 'D' : 'A';
  const won = pick === actual;
  return { outcome: won ? 'win' : 'lose', pnlPerUnit: won ? odds - 1 : -1 };
}

/** 竞彩让球胜平负：让平算输（不是走水） */
export function settleJcHandicap(pick: 'H' | 'D' | 'A', goalLine: number, homeScore: number, awayScore: number, odds: number): Result {
  const adjHome = homeScore + goalLine;
  const actual: 'H' | 'D' | 'A' = adjHome > awayScore ? 'H' : adjHome === awayScore ? 'D' : 'A';
  const won = pick === actual;
  return { outcome: won ? 'win' : 'lose', pnlPerUnit: won ? odds - 1 : -1 };
}
