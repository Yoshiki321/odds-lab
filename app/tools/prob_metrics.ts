/**
 * prob_metrics.ts — 概率评估工具（Brier / LogLoss / Wilson / 基线对比）
 * 用途：开云侧"只用市场基线，不冒充优势"的量化检查；样本不足时明确返回 insufficient。
 * 用法: node app/tools/prob_metrics.ts
 */
export interface Pair { p: number; y: 0 | 1 }

const isValidP = (p: unknown): p is number => typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1;
const isValidY = (y: unknown): y is 0 | 1 => y === 0 || y === 1;

export type MetricError = 'empty' | 'invalid';

/** 明确区分：空样本 vs 输入非法（原来都返回 null，无法分辨） */
export function validatePairs(pairs: Pair[]): MetricError | null {
  if (!Array.isArray(pairs) || !pairs.length) return 'empty';
  for (const x of pairs) if (!isValidP(x?.p) || !isValidY(x?.y)) return 'invalid';
  return null;
}
export function brierEx(pairs: Pair[]): { value: number | null; error: MetricError | null } {
  const err = validatePairs(pairs);
  if (err) return { value: null, error: err };
  const v = brier(pairs)!;
  return { value: v, error: null };
}
export function logLossEx(pairs: Pair[]): { value: number | null; error: MetricError | null } {
  const err = validatePairs(pairs);
  if (err) return { value: null, error: err };
  const v = logLoss(pairs)!;
  return { value: v, error: null };
}

export function brier(pairs: Pair[]): number | null {
  if (!Array.isArray(pairs) || !pairs.length) return null;
  let s = 0;
  for (const x of pairs) {
    if (!isValidP(x?.p) || !isValidY(x?.y)) return null;
    s += (x.p - x.y) ** 2;
  }
  return s / pairs.length;
}

export function logLoss(pairs: Pair[], eps = 1e-12): number | null {
  if (!Array.isArray(pairs) || !pairs.length) return null;
  let s = 0;
  for (const x of pairs) {
    if (!isValidP(x?.p) || !isValidY(x?.y)) return null;
    const q = Math.min(1 - eps, Math.max(eps, x.p));
    s += -(x.y * Math.log(q) + (1 - x.y) * Math.log(1 - q));
  }
  return s / pairs.length;
}

/** 校准分箱：返回每箱 (预测均值, 实际频率, 样本数)；非法输入返回空数组并附 reason */
export function calibration(pairs: Pair[], bins = 10): { bin: string; n: number; pred: number; act: number }[] {
  if (!Array.isArray(pairs) || !pairs.length || !Number.isInteger(bins) || bins < 1) return [];
  for (const x of pairs) if (!isValidP(x?.p) || !isValidY(x?.y)) return [];
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

/** 配对观测：同一场比赛、同一玩法方向、同一预测时点，模型与基线各给概率，结果只有一个 */
export interface PairedObs {
  matchId: string;
  /** 开赛时间（ISO，含时区） */
  kickoffAt: string;
  /** 预测作出时刻（ISO）；必须早于开赛 */
  predictAt: string;
  /** 预测所用数据的可获得时刻（ISO）；必须早于等于 predictAt */
  dataAt: string;
  market: string;
  /** 预测方向：同一场比赛不同方向是不同样本，不能混算 */
  side: string;
  /** 盘口线（独赢用 null，让球/大小用数值或字符串）；参与配对键 */
  line: number | string | null;
  outcome: 0 | 1;
  pModel: number;
  pBaseline: number;
}

export interface Verdict {
  status: 'insufficient' | 'inconclusive' | 'worse-than-baseline' | 'better-than-baseline';
  n: number;
  meanDiff: number | null;
  ci95: [number, number] | null;
  alpha: number;
  note: string;
  problems: string[];
}

/** alpha → 双侧正态分位数（数值键，避免 0.10 与 0.1 的字符串差异） */
const Z_BY_ALPHA: Record<number, number> = {
  0.1: 1.6448536269514722,
  0.05: 1.959963984540054,
  0.01: 2.5758293035489004,
};

/**
 * 配对比较（Brier 差值）。
 * 规则：
 *  - 时点一律转成绝对毫秒后去重，键 = matchId|kickoffMs|market|side|predictMs
 *  - predictAt 必须早于 kickoffAt；dataAt 必须早于等于 predictAt（否则视为未来信息，拒绝比较）
 *  - 样本 < max(minN, 30) 一律 insufficient
 *  - 方差无法可靠估计（sd=0 且 n<100）判 insufficient
 *  - 只报区间：CI 全负 → better，全正 → worse，跨 0 → inconclusive
 *  - 输出注明：未调整相关性与多重比较；结论仅统计意义，不代表可盈利
 */
export function compareToBaseline(obs: PairedObs[], opts?: { minN?: number; alpha?: number }): Verdict {
  const alphaKey = Number(opts?.alpha ?? 0.05);
  const zc = Z_BY_ALPHA[alphaKey];
  const alpha = alphaKey;
  const minN = opts?.minN ?? MIN_SAMPLE_FOR_CONCLUSION;
  const effectiveMin = Math.max(minN, 30);
  const problems: string[] = [];

  const base = { n: 0, meanDiff: null, ci95: null, alpha, problems: [] as string[] };
  if (!Array.isArray(obs) || !obs.length)
    return { ...base, status: 'insufficient', note: '无样本', problems: ['空输入'] };
  if (!zc)
    return { ...base, status: 'insufficient', note: `alpha=${opts?.alpha} 不支持（仅 0.10/0.05/0.01）`, problems: ['alpha 非法'] };

  const seen = new Set<string>();
  const diffs: number[] = [];
  for (const o of obs) {
    if (!o || !o.matchId || !o.market || !o.side) { problems.push('缺 matchId/market/side'); continue; }
    const kick = Date.parse(o.kickoffAt);
    const pred = Date.parse(o.predictAt);
    const data = Date.parse(o.dataAt);
    if (!Number.isFinite(kick) || !Number.isFinite(pred) || !Number.isFinite(data)) { problems.push('时间字段非法'); continue; }
    if (pred >= kick) { problems.push(`预测不早于开赛:${o.matchId}`); continue; }
    if (data > pred) { problems.push(`使用未来数据:${o.matchId}`); continue; }
    if (!isValidP(o.pModel) || !isValidP(o.pBaseline)) { problems.push(`概率非法:${o.matchId}`); continue; }
    if (!isValidY(o.outcome)) { problems.push(`结果标签非法:${o.matchId}`); continue; }
    const key = `${o.matchId}|${kick}|${o.market}|${o.side}|${o.line ?? 'null'}|${pred}`;
    if (seen.has(key)) { problems.push(`重复配对:${key}`); continue; }
    seen.add(key);
    diffs.push((o.pModel - o.outcome) ** 2 - (o.pBaseline - o.outcome) ** 2);
  }

  const n = diffs.length;
  if (problems.length)
    return { ...base, n, status: 'insufficient', note: `存在 ${problems.length} 个问题，拒绝比较`, problems };
  if (n < effectiveMin)
    return { ...base, n, status: 'insufficient', note: `样本 ${n} < ${effectiveMin}，不作结论`, problems: [] };

  const mean = diffs.reduce((s, x) => s + x, 0) / n;
  const sd = n > 1 ? Math.sqrt(diffs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : 0;
  if (sd === 0)
    return { ...base, n, meanDiff: +mean.toFixed(6), status: 'insufficient', note: `配对差值方差为 0 (n=${n})，退化样本不可作显著性检验`, problems: [] };
  const se = sd / Math.sqrt(n);
  const lo = mean - zc * se;
  const hi = mean + zc * se;
  const degenerate = sd === 0;

  let status: Verdict['status'] = 'inconclusive';
  if (hi < 0) status = 'better-than-baseline';
  else if (lo > 0) status = 'worse-than-baseline';

  return {
    status, n, meanDiff: +mean.toFixed(6), ci95: [+lo.toFixed(6), +hi.toFixed(6)], alpha,
    note: `配对 Brier 差均值 ${mean.toFixed(6)}，${(1 - alpha) * 100}%CI [${lo.toFixed(6)}, ${hi.toFixed(6)}]；` +
      `未调整相关性（同场多市场/同队多场）与多重比较；结论仅统计意义，不代表可盈利` +
      (degenerate ? `；警告：配对差值方差为0，区间退化，不可解释为显著性` : ''),
    problems: [],
  };
}

// ---------------- 自检 ----------------
if (process.argv[1]?.replace(/\\/g, '/').endsWith('prob_metrics.ts')) {
  const assert = (c: boolean, m: string) => { if (!c) throw new Error(m); };

  // 基础指标 + 非法标签
  assert(brier([{ p: 1, y: 1 }, { p: 0, y: 0 }]) === 0, 'brier 完美预测应为 0');
  assert(brierEx([]).error === 'empty', '空样本应标记 empty');
  assert(brierEx([{ p: 0.5, y: 2 as any }]).error === 'invalid', 'y=2 应标记 invalid');
  assert(logLossEx([{ p: NaN, y: 1 }]).error === 'invalid', 'p=NaN 应标记 invalid');
  assert(logLossEx([{ p: 0.5, y: 1 }]).error === null, '合法输入不应报错');
  assert(brier([{ p: 0.5, y: 2 as any }]) === null, 'y=2 应拒绝');
  assert(logLoss([{ p: 0.5, y: -1 as any }]) === null, 'y=-1 应拒绝');
  assert(logLoss([{ p: NaN, y: 1 }]) === null, 'p=NaN 应拒绝');
  assert(calibration([{ p: 0.5, y: 3 as any }]).length === 0, 'calibration 非法标签应返回空');
  assert(wilson(6, 9)[0] > 0.3 && wilson(6, 9)[1] < 0.9, 'wilson 6/9 区间异常');

  const obs = (i: number, pm: number, pb: number, y: 0 | 1, over: Partial<PairedObs> = {}): PairedObs => ({
    matchId: 'M' + i,
    kickoffAt: '2026-09-02T12:00:00Z',
    predictAt: '2026-09-01T10:00:00Z',
    dataAt: '2026-09-01T09:00:00Z',
    market: '1X2',
    side: 'H',
    line: null,
    outcome: y,
    pModel: pm,
    pBaseline: pb,
    ...over,
  });

  // 明显更好
  const better: PairedObs[] = [];
  for (let i = 0; i < 120; i++) better.push(obs(i, i % 2 ? 0.8 : 0.2, 0.5, i % 2 ? 1 : 0));
  const vb = compareToBaseline(better);
  console.log('paired-better =', JSON.stringify(vb));
  assert(vb.status === 'better-than-baseline', '模型明显更好时应判 better');

  // 样本不足
  assert(compareToBaseline(better.slice(0, 30)).status === 'insufficient', '30 样本应 insufficient');
  // minN=1 也不得直接给结论
  assert(compareToBaseline(better.slice(0, 1), { minN: 1 }).status === 'insufficient', '单样本必须 insufficient');

  // 时区等价去重：同一绝对时刻不同写法
  const tzDup = [
    obs(1, 0.8, 0.5, 1, { predictAt: '2026-09-01T10:00:00Z' }),
    obs(1, 0.8, 0.5, 1, { predictAt: '2026-09-01T18:00:00+08:00' }),
  ];
  const vTz = compareToBaseline(tzDup, { minN: 1 });
  console.log('tz-dup =', JSON.stringify(vTz));
  assert(vTz.problems.some((p) => /重复配对/.test(p)), '同一时刻不同时区写法应判重复');

  // 未来信息：dataAt 晚于 predictAt
  const future = [obs(2, 0.8, 0.5, 1, { dataAt: '2026-09-01T11:00:00Z' })];
  assert(compareToBaseline(future, { minN: 1 }).problems.some((p) => /未来数据/.test(p)), 'dataAt 晚于 predict 应拒绝');

  // 赛后预测
  const afterKick = [obs(3, 0.8, 0.5, 1, { predictAt: '2026-09-02T13:00:00Z' })];
  assert(compareToBaseline(afterKick, { minN: 1 }).problems.some((p) => /不早于开赛/.test(p)), '赛后预测应拒绝');

  // alpha 生效（需要非退化方差数据）
  const varied: PairedObs[] = [];
  for (let i = 0; i < 120; i++) varied.push(obs(i, 0.45 + 0.4 * ((i % 7) / 6), 0.5, i % 3 === 0 ? 1 : 0));
  const v90 = compareToBaseline(varied, { alpha: 0.10 });
  const v99 = compareToBaseline(varied, { alpha: 0.01 });
  console.log('alpha0.10 =', JSON.stringify(v90.ci95), 'alpha0.01 =', JSON.stringify(v99.ci95));
  const w90 = v90.ci95![1] - v90.ci95![0];
  const w99 = v99.ci95![1] - v99.ci95![0];
  assert(w90 > 0 && w99 > 0, '区间宽度应为正（非退化）');
  assert(w90 < w99, `alpha=0.10 的区间应比 0.01 更窄（${w90} vs ${w99}）`);
  assert(compareToBaseline(varied, { alpha: 0.2 }).status === 'insufficient', '非法 alpha 应拒绝');

  const cal = calibration([{ p: 0.15, y: 0 }, { p: 0.15, y: 1 }, { p: 0.85, y: 1 }], 5);
  console.log('calibration=', cal);
  console.log('self-check OK');
}
