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

export interface Verdict {
  status: 'insufficient' | 'not-better-than-baseline' | 'better-than-baseline';
  n: number;
  brierModel: number | null;
  brierBaseline: number | null;
  delta: number | null;
  note: string;
}

/**
 * 与市场基线对比：基线是同一时点的去水概率。
 * 规则：样本 < 100 一律 insufficient；Brier 不显著优于基线也判 not-better。
 */
export function compareToBaseline(model: Pair[], baseline: Pair[]): Verdict {
  const n = Math.min(model.length, baseline.length);
  if (n < MIN_SAMPLE_FOR_CONCLUSION)
    return { status: 'insufficient', n, brierModel: null, brierBaseline: null, delta: null, note: `样本 ${n} < ${MIN_SAMPLE_FOR_CONCLUSION}，不作结论` };
  const bm = brier(model), bb = brier(baseline);
  if (bm == null || bb == null)
    return { status: 'insufficient', n, brierModel: bm, brierBaseline: bb, delta: null, note: '输入概率非法' };
  const delta = bm - bb;
  return {
    status: delta < -0.005 ? 'better-than-baseline' : 'not-better-than-baseline',
    n, brierModel: +bm.toFixed(6), brierBaseline: +bb.toFixed(6), delta: +delta.toFixed(6),
    note: delta < -0.005 ? 'Brier 优于基线 0.005 以上（仍需样本外复现）' : '未能优于基线',
  };
}

// ---------------- 自检 ----------------
if (process.argv[1]?.replace(/\\/g, '/').endsWith('prob_metrics.ts')) {
  const ok1: Pair[] = [{ p: 0.9, y: 1 }, { p: 0.1, y: 0 }];
  console.log('brier(完美)=', brier([{ p: 1, y: 1 }, { p: 0, y: 0 }]));
  console.log('brier(示例)=', brier(ok1));
  console.log('logloss(示例)=', logLoss(ok1));
  console.log('wilson(6/9)=', wilson(6, 9));
  console.log('compare(小样本)=', compareToBaseline([{ p: 0.5, y: 1 }], [{ p: 0.5, y: 1 }]));
  const cal = calibration([{ p: 0.15, y: 0 }, { p: 0.15, y: 1 }, { p: 0.85, y: 1 }], 5);
  console.log('calibration=', cal);
  if (brier([{ p: 1, y: 1 }]) !== 0) throw new Error('brier 完美预测应为 0');
  if (compareToBaseline([{ p: 0.5, y: 1 }], [{ p: 0.5, y: 1 }]).status !== 'insufficient') throw new Error('小样本应判 insufficient');
  console.log('self-check OK');
}
