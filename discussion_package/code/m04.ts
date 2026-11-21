/** M-04: 竞彩负 EV 时，只有欧亚结算价格仍为正 EV 才允许改投。
 *  欧亚结算按亚盘规则：整数让球走盘退本金，EV = p_win×odds + p_push − 1
 *  （竞彩侧让平=输，保持 p×odds−1 不变；半球/quarter 盘无全额走水，沿用旧式）。 */
import { fairProbForPick, fairPushProb } from './ev-fit.js';

export interface M04Input {
  score: number;
  line: number;
  market: 'HAD' | 'HHAD';
  side: 'H' | 'A';
  jcOdds: number;
  europe: { home: number; draw: number; away: number } | null;
  settleOdds: number | null;
  hoursToKickoff: number | null;
}

export interface M04Decision {
  eligible: boolean;
  reason: string;
  jcEv: number | null;
  settleEv: number | null;
  fairProb: number | null;
  pushProb: number | null;
}

const valid = (n: number | null): n is number => n != null && Number.isFinite(n) && n > 1;

/** Pure gate shared by open/close workflows; it never places a bet. */
export function evaluateM04(i: M04Input): M04Decision {
  const noPush = { jcEv: null, settleEv: null, fairProb: null, pushProb: null } as const;
  if (i.score < 48) return { eligible: false, reason: 'score<48', ...noPush };
  if (i.hoursToKickoff == null || i.hoursToKickoff < 0.5 || i.hoursToKickoff > 8)
    return { eligible: false, reason: 'R5时间窗外', ...noPush };
  if (!valid(i.jcOdds)) return { eligible: false, reason: '竞彩赔率缺失', ...noPush };
  if (!i.europe || !valid(i.europe.home) || !valid(i.europe.draw) || !valid(i.europe.away))
    return { eligible: false, reason: '独立欧赔缺失', ...noPush };

  const raw = { home: 1 / i.europe.home, draw: 1 / i.europe.draw, away: 1 / i.europe.away };
  const z = raw.home + raw.draw + raw.away;
  const fair = { home: raw.home / z, draw: raw.draw / z, away: raw.away / z };
  const p = fairProbForPick(fair, i.side, i.market, i.line);
  if (p == null) return { eligible: false, reason: '公平概率计算失败', ...noPush };
  const jcEv = p * i.jcOdds - 1;
  // 亚盘整数盘走盘退本金：EV 加回 p_push；竞彩侧让平=输，不加
  const push = i.market === 'HHAD' ? fairPushProb(fair, i.line) : null;
  // 2026-11-19 审计：整数盘 push 不可计算时不得当作 0（会把走水算成输），一律判不可计算
  if (i.market === 'HHAD' && push == null)
    return { eligible: false, reason: '走水概率不可计算(拟合失败或非整数盘)', jcEv, settleEv: null, fairProb: p, pushProb: null };
  const settleEv = valid(i.settleOdds) ? p * i.settleOdds + (push ?? 0) - 1 : null;
  if (jcEv >= 0) return { eligible: false, reason: '竞彩本身非负EV，无需M-04改投', jcEv, settleEv, fairProb: p, pushProb: push };
  if (settleEv == null) return { eligible: false, reason: '欧亚结算赔率缺失', jcEv, settleEv, fairProb: p, pushProb: push };
  if (settleEv < 0) return { eligible: false, reason: '欧亚结算仍为负EV', jcEv, settleEv, fairProb: p, pushProb: push };
  return { eligible: true, reason: 'M-04欧亚改投通过', jcEv, settleEv, fairProb: p, pushProb: push };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('m04.ts')) {
  const d = evaluateM04({ score: 48, line: 0, market: 'HAD', side: 'A', jcOdds: 1.36,
    europe: { home: 6.5, draw: 4, away: 1.53 }, settleOdds: 1.8, hoursToKickoff: 4 });
  if (!d.eligible || d.jcEv == null || d.jcEv >= 0 || d.settleEv == null || d.settleEv < 0) throw new Error(JSON.stringify(d));
  console.log(`M-04 self-check OK: jcEV=${((d.jcEv as number) * 100).toFixed(1)}%, settleEV=${((d.settleEv as number) * 100).toFixed(1)}%`);
  // 让+1 亚盘走水回归：旧式 p×odds−1 显示 −23% 关闸，加回走水项后应转正开闸
  const g = evaluateM04({ score: 55, line: 1, market: 'HHAD', side: 'A', jcOdds: 1.75,
    europe: { home: 3.4, draw: 3.3, away: 2.1 }, settleOdds: 3.9, hoursToKickoff: 4 });
  const legacy = (g.fairProb ?? 0) * 3.9 - 1;
  if (!g.eligible || g.pushProb == null || g.pushProb <= 0 || legacy >= 0 || (g.settleEv ?? -1) < 0)
    throw new Error('M-04 push regression failed: ' + JSON.stringify(g));
  console.log(`M-04 push regression OK: legacy=${(legacy * 100).toFixed(1)}% → fixed=${((g.settleEv ?? 0) * 100).toFixed(1)}% (push=${g.pushProb})`);
}