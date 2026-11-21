/**
 * prob_metrics.ts — 概率评估工具（Brier / LogLoss / Wilson / 基线对比）
 * 用途：开云侧"只用市场基线，不冒充优势"的量化检查；样本不足时明确返回 insufficient。
 * 用法: node app/tools/prob_metrics.ts
 */
export interface Pair { p: number; y: 0 | 1 }

export function brier(pairs: Pair[]): number | null {
  if (!pairs.length) return null;
  let s = 0;
  for (const { p, y } of pairs) {
    if (!Number.isFinite(p) || p < 0 || p > 1) return null;
    s += (p - y) ** 2;
  }
  return s / pairs.length;
}

export function logLoss(pairs: Pair[], eps = 1e-12): number | null {
  if (!pairs.length) return null;
  let s = 0;
  for (const { p, y } of pairs) {
    if (!Number.isFinite(p) || p < 0 || p > 1) return null;
    const q = Math.min(1 - eps, Math.max(eps, p));
    s += -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
  }
  return s / pairs.length;
}

/** 校准分箱：返回每箱 (预测均值, 实际频率, 样本数) */
export function calibration(pairs: Pair[], bins = 10): { bin: string; n: number; pred: number; act: number }[] {
  const out: { bin: string; n: number; pred: number; act: number }[] = [];
  for (let b = 0; b < bins; b++) {
    const lo = b / bins, hi = (b + 1) / bins;
    const sel = pairs.filter((x) => x.p >= lo && (b === bins - 1 ? x.p <= hi : x.p < hi));
    if (!sel.length) continue;
    const pred = sel.reduce((s, x) => s + x.p, 0) / sel.length;
    const act = sel.reduce((s, x) => s + x.y, 0) / sel.length;
    out.push({ bin: `${lo.toFixed(1)}-${hi.toFixed(1)}`, n: sel.length, pred: +pred.toFixed(4), act: +act.toFixed(4) });
  }
  return out;
}

export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n <= 0) return [0, 1];
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(center - margin) / denom, (center + margin) / denom];
}

export const MIN_SAMPLE_FOR_CONCLUSION = 100;

/** 配对观测：同一场比赛、同一预测时点、同一市场，模型与基线各自给概率，结果只有一个 */
export interface PairedObs {
  matchId: string;
  predictAt: string;   // ISO 时间，必须早于开赛（由调用方保证）
  market: string;      // 如 '1X2' | 'AH-0.5' | 'OU2.5'
  outcome: 0 | 1;
  pModel: number;
  pBaseline: number;
}

export interface Verdict {
  status: 'insufficient' | 'inconclusive' | 'worse-than-baseline' | 'better-than-baseline';
  n: number;
  meanDiff: number | null;       // Σ[(model)²-(baseline)²]/n，负值表示模型更好
  ci95: [number, number] | null;
  note: string;
  problems: string[];
}

/**
 * 配对比较（Brier 差值）。
 * 规则：
 *  - 必须按 (matchId, predictAt, market) 唯一配对；重复或缺字段直接判 insufficient
 *  - 样本 < minN 一律 insufficient（不设"自动定论"）
 *  - 用配对差值的均值与正态近似 95%CI；CI 完全在 0 以下才算 better，完全在 0 以上算 worse，跨 0 判 inconclusive
 *  - 不做多重比较校正，输出里注明
 */
export function compareToBaseline(obs: PairedObs[], opts?: { minN?: number; alpha?: number }): Verdict {
  const minN = opts?.minN ?? MIN_SAMPLE_FOR_CONCLUSION;
  const z = 1.959963984540054;
  const problems: string[] = [];

  if (!Array.isArray(obs) || !obs.length)
    return { status: 'insufficient', n: 0, meanDiff: null, ci95: null, note: '无样本', problems: ['空输入'] };

  const seen = new Set<string>();
  const diffs: number[] = [];
  for (const o of obs) {
    if (!o.matchId || !o.predictAt || !o.market) { problems.push('缺 matchId/predictAt/market'); continue; }
    if (Number.isNaN(Date.parse(o.predictAt))) { problems.push(`predictAt 非法:${o.predictAt}`); continue; }
    if (![0, 1].includes(o.outcome)) { problems.push(`outcome 必须为 0/1:${String(o.outcome)}`); continue; }
    const okP = (p: number) => Number.isFinite(p) && p >= 0 && p <= 1;
    if (!okP(o.pModel) || !okP(o.pBaseline)) { problems.push('概率非法'); continue; }
    const key = `${o.matchId}|${o.predictAt}|${o.market}`;
    if (seen.has(key)) { problems.push(`重复配对:${key}`); continue; }
    seen.add(key);
    diffs.push((o.pModel - o.outcome) ** 2 - (o.pBaseline - o.outcome) ** 2);
  }

  const n = diffs.length;
  if (problems.length)
    return { status: 'insufficient', n, meanDiff: null, ci95: null, note: `存在 ${problems.length} 个问题，拒绝比较`, problems };
  if (n < minN)
    return { status: 'insufficient', n, meanDiff: null, ci95: null, note: `样本 ${n} < ${minN}，不作结论（未做时间切分前也不得下结论）`, problems: [] };

  const mean = diffs.reduce((s, x) => s + x, 0) / n;
  const varSum = diffs.reduce((s, x) => s + (x - mean) ** 2, 0);
  const sd = n > 1 ? Math.sqrt(varSum / (n - 1)) : 0;
  const se = sd / Math.sqrt(n);
  const lo = mean - z * se;
  const hi = mean + z * se;

  let status: Verdict['status'] = 'inconclusive';
  if (hi < 0) status = 'better-than-baseline';
  else if (lo > 0) status = 'worse-than-baseline';

  return {
    status, n, meanDiff: +mean.toFixed(6), ci95: [+lo.toFixed(6), +hi.toFixed(6)],
    note: `配对 Brier 差均值 ${mean.toFixed(6)}，95%CI [${lo.toFixed(6)}, ${hi.toFixed(6)}]；` +
      `未做多重比较校正，且样本相关性（同场多市场/同队多场）未调整`,
    problems: [],
  };
}

// ---------------- 自检 ----------------
if (process.argv[1]?.replace(/\\/g, '/').endsWith('prob_metrics.ts')) {
  const assert = (c: boolean, m: string) => { if (!c) throw new Error(m); };
  assert(brier([{ p: 1, y: 1 }, { p: 0, y: 0 }]) === 0, 'brier 完美预测应为 0');
  assert(wilson(6, 9)[0] > 0.3 && wilson(6, 9)[1] < 0.9, 'wilson 6/9 区间异常');

  // 配对：模型略优于基线
  const mk = (i: number, pm: number, pb: number, y: 0 | 1): PairedObs =>
    ({ matchId: 'M' + i, predictAt: '2026-09-0' + (1 + (i % 9)) + 'T10:00:00Z', market: '1X2', outcome: y, pModel: pm, pBaseline: pb });
  const better: PairedObs[] = [];
  for (let i = 0; i < 120; i++) better.push(mk(i, i % 2 ? 0.8 : 0.2, 0.5, i % 2 ? 1 : 0));
  const vb = compareToBaseline(better);
  console.log('paired-better =', JSON.stringify(vb));
  assert(vb.status === 'better-than-baseline', '模型明显更好时应判 better');

  // 配对：样本不足
  console.log('paired-small =', JSON.stringify(compareToBaseline(better.slice(0, 30))));
  assert(compareToBaseline(better.slice(0, 30)).status === 'insufficient', '30 样本应判 insufficient');

  // 配对：重复键
  const dup = [better[0], { ...better[0] }];
  console.log('paired-dup =', JSON.stringify(compareToBaseline(dup)));
  assert(compareToBaseline(dup).status === 'insufficient', '重复配对应拒绝');

  // 配对：缺字段
  const bad = [{ ...better[0], matchId: '' }];
  assert(compareToBaseline(bad).status === 'insufficient', '缺 matchId 应拒绝');

  // 配对：跨 0
  const mixed: PairedObs[] = [];
  for (let i = 0; i < 120; i++) mixed.push(mk(i, 0.5, 0.5, i % 2 ? 1 : 0));
  console.log('paired-equal =', JSON.stringify(compareToBaseline(mixed)));
  assert(compareToBaseline(mixed).status === 'inconclusive', '相同概率应 inconclusive');

  const cal = calibration([{ p: 0.15, y: 0 }, { p: 0.15, y: 1 }, { p: 0.85, y: 1 }], 5);
  console.log('calibration=', cal);
  console.log('self-check OK');
}
