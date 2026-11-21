/**
 * 防泄漏滚动参数优化：只读赛前快照与官方赛果，输出候选，不改生产评分。
 * 用法：npx tsx tools/optimize.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, pool } from '../src/server/db/pool.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(PROJECT_ROOT, 'data', 'betting', 'optimize-last.json');
const OUT_MD = path.join(PROJECT_ROOT, 'data', 'betting', 'optimize-last.md');

const DIM_KEYS = ['drop', 'confirm', 'model', 'history', 'risk', 'value'] as const;
const CURRENT_WEIGHTS = [22, 12, 22, 12, 22, 10] as const;
const MULTIPLIERS = [0.5, 0.75, 1, 1.25, 1.5] as const;
const SINGLE_LINES = [44, 46, 48, 50, 52] as const;
const BOOST_LINES = [54, 56, 58, 60] as const;
const MIN_SETTLED = 50;
const MIN_TEST_BETS = 8;
const MIN_ROI_LIFT = 0.05;

type Market = 'HAD' | 'HHAD';
type DimKey = typeof DIM_KEYS[number];

type Sample = {
  date: string;
  matchId: string;
  market: Market;
  pred: 'H' | 'A';
  odds: number;
  result: 'H' | 'D' | 'A';
  dims: Record<DimKey, { score: number; max: number }>;
};

type Params = {
  multipliers: Record<DimKey, number>;
  singleLine: number;
  boostLine: number;
  label?: string;
};

type Metrics = {
  n: number;
  wins: number;
  pushes: number;
  losses: number;
  pnl: number;
  staked: number;
  roi: number | null;
};

type Fold = {
  testDate: string;
  trainN: number;
  testN: number;
  selected: Params;
  train: Metrics;
  trainBoost: Metrics;
  test: Metrics;
  testBoost: Metrics;
  baselineTrain: Metrics;
  baselineTrainBoost: Metrics;
  baselineTest: Metrics;
  baselineTestBoost: Metrics;
  testNotWorse: boolean;
};

function asNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseDims(raw: unknown): Record<DimKey, { score: number; max: number }> | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const out = {} as Record<DimKey, { score: number; max: number }>;
  for (const key of DIM_KEYS) {
    const item = obj[key];
    if (!item || typeof item !== 'object') return null;
    const x = item as Record<string, unknown>;
    const score = asNum(x.score);
    const max = asNum(x.max);
    if (score == null || max == null || max <= 0) return null;
    out[key] = { score, max };
  }
  return out;
}

function resultOf(market: Market, had: unknown, hhad: unknown): 'H' | 'D' | 'A' | null {
  const value = String(market === 'HHAD' ? hhad ?? '' : had ?? '').trim();
  return value === 'H' || value === 'D' || value === 'A' ? value : null;
}

async function loadSamples(): Promise<Sample[]> {
  const rows = (await query(`
    SELECT DISTINCT ON (s.match_id)
           m.match_date::text AS date, s.match_id, s.market, s.pred, s.odds,
           s.score, r.had, r.hhad
      FROM score_snapshots s
      JOIN matches m ON m.match_id = s.match_id
      JOIN results r ON r.match_id = s.match_id
     WHERE s.hours_to_ko > 0
       AND s.market IN ('HAD', 'HHAD')
       AND r.had IN ('H', 'D', 'A')
     ORDER BY s.match_id, s.snapshot_at DESC
  `)).rows;

  const samples: Sample[] = [];
  for (const row of rows) {
    const market = String(row.market) as Market;
    const pred = String(row.pred) as 'H' | 'A';
    const odds = asNum(row.odds);
    const dims = parseDims(row.score);
    const result = resultOf(market, row.had, row.hhad);
    if ((market !== 'HAD' && market !== 'HHAD') || (pred !== 'H' && pred !== 'A') || odds == null || odds <= 1 || !dims || !result) continue;
    samples.push({ date: row.date, matchId: row.match_id, market, pred, odds, result, dims });
  }
  return samples.sort((a, b) => a.date.localeCompare(b.date) || a.matchId.localeCompare(b.matchId) || a.market.localeCompare(b.market));
}

function weightedScore(sample: Sample, params: Params): number {
  let total = 0;
  let max = 0;
  for (const key of DIM_KEYS) {
    const multiplier = params.multipliers[key];
    total += sample.dims[key].score * multiplier;
    max += sample.dims[key].max * multiplier;
  }
  return max > 0 ? (total / max) * 100 : 0;
}

function onePnl(sample: Sample): number {
  // 竞彩 HHAD 为三项盘，让平(D)不是走水，押胜/负时全输(-1)
  return sample.result === sample.pred ? sample.odds - 1 : -1;
}

function emptyMetrics(): Metrics {
  return { n: 0, wins: 0, pushes: 0, losses: 0, pnl: 0, staked: 0, roi: null };
}

function evaluate(samples: Sample[], params: Params, line: number): Metrics {
  const out = emptyMetrics();
  for (const sample of samples) {
    if (weightedScore(sample, params) < line) continue;
    const pnl = onePnl(sample);
    out.n++;
    out.staked++;
    out.pnl += pnl;
    if (pnl > 0) out.wins++;
    else if (pnl === 0) out.pushes++;
    else out.losses++;
  }
  out.pnl = +out.pnl.toFixed(4);
  out.roi = out.staked ? +(out.pnl / out.staked).toFixed(4) : null;
  return out;
}

function evaluatePair(samples: Sample[], params: Params): { single: Metrics; boost: Metrics } {
  return {
    single: evaluate(samples, params, params.singleLine),
    boost: evaluate(samples, params, params.boostLine),
  };
}

function makeParams(values: readonly number[], singleLine: number, boostLine: number, label?: string): Params {
  return {
    multipliers: Object.fromEntries(DIM_KEYS.map((key, i) => [key, values[i]])) as Record<DimKey, number>,
    singleLine,
    boostLine,
    label,
  };
}

function* parameterGrid(): Generator<Params> {
  const values = Array<number>(DIM_KEYS.length).fill(1);
  function* walk(i: number): Generator<Params> {
    if (i === values.length) {
      for (const single of SINGLE_LINES) {
        for (const boost of BOOST_LINES) {
          if (boost > single) yield makeParams(values, single, boost);
        }
      }
      return;
    }
    for (const multiplier of MULTIPLIERS) {
      values[i] = multiplier;
      yield* walk(i + 1);
    }
  }
  yield makeParams(CURRENT_WEIGHTS.map(() => 1), 48, 58, 'baseline');
  yield* walk(0);
}

function better(a: { metrics: Metrics; params: Params }, b: { metrics: Metrics; params: Params } | null): boolean {
  if (!b) return true;
  const ar = a.metrics.roi ?? -Infinity;
  const br = b.metrics.roi ?? -Infinity;
  if (ar !== br) return ar > br;
  if (a.metrics.n !== b.metrics.n) return a.metrics.n > b.metrics.n;
  const aDist = Math.abs(a.params.singleLine - 48) + Math.abs(a.params.boostLine - 58);
  const bDist = Math.abs(b.params.singleLine - 48) + Math.abs(b.params.boostLine - 58);
  return aDist < bDist;
}

function baselineParams(): Params {
  return makeParams([1, 1, 1, 1, 1, 1], 48, 58, 'baseline');
}

function aggregateMetrics(metrics: Metrics[]): Metrics {
  const out = emptyMetrics();
  for (const x of metrics) {
    out.n += x.n;
    out.wins += x.wins;
    out.pushes += x.pushes;
    out.losses += x.losses;
    out.pnl += x.pnl;
    out.staked += x.staked;
  }
  out.pnl = +out.pnl.toFixed(4);
  out.roi = out.staked ? +(out.pnl / out.staked).toFixed(4) : null;
  return out;
}

function paramsJson(p: Params): Record<string, unknown> {
  return { multipliers: p.multipliers, singleLine: p.singleLine, boostLine: p.boostLine, label: p.label ?? 'candidate' };
}

function pct(v: number | null): string {
  return v == null ? '—' : `${(v * 100).toFixed(1)}%`;
}

function metricsJson(m: Metrics): Metrics { return m; }

function renderMarkdown(out: Record<string, any>): string {
  const b = out.baseline;
  const c = out.latestRecommendation;
  const wf = out.walkForwardCandidate;
  const status = out.promote ? 'PROMOTE' : 'HOLD';
  const lines = [
    '# 评分参数优化候选',
    '',
    `生成时间：${out.generatedAt} · 状态：**${status}**`,
    '',
    '## 结论',
    '',
    `样本：${out.sampleCount} 场（${out.sampleDates.length} 个销售日，严格使用赛前最后快照）；walk-forward 折数：${out.folds.length}。`,
    `当前基线：权重 22/12/22/12/22/10，实单线 48，加注线 58；实单 ROI ${pct(b.test?.roi ?? null)}（N=${b.test?.n ?? 0}），加注 ROI ${pct(b.testBoost?.roi ?? null)}（N=${b.testBoost?.n ?? 0}）。`,
    c ? `最新折推荐：权重 ${Object.values(c.params.multipliers).join('/')}，实单线 ${c.params.singleLine}，加注线 ${c.params.boostLine}；全部折的逐折候选累计实单 ROI ${pct(wf?.test?.roi ?? null)}（N=${wf?.test?.n ?? 0}），加注 ROI ${pct(wf?.testBoost?.roi ?? null)}（N=${wf?.testBoost?.n ?? 0}）。` : '当前没有足够的 walk-forward 测试折，未产生候选。',
    `晋升条件：总已结样本 ≥${MIN_SETTLED}、测试档 N ≥${MIN_TEST_BETS}、ROI 提升 ≥${(MIN_ROI_LIFT * 100).toFixed(0)}pp；当前结论 **${status}**。`,
    '',
    '## 基线 vs 候选',
    '',
    '| 策略 | 实单线 | 加注线 | 测试 N | 测试 ROI |',
    '| --- | ---: | ---: | ---: | ---: |',
    `| baseline | 48 | 58 | ${b.test?.n ?? 0}/${b.testBoost?.n ?? 0} | ${pct(b.test?.roi ?? null)}/${pct(b.testBoost?.roi ?? null)} |`,
    c ? `| walk-forward candidate | — | — | ${wf.test.n}/${wf.testBoost.n} | ${pct(wf.test.roi)}/${pct(wf.testBoost.roi)} |` : '| walk-forward candidate | — | — | 0/0 | —/— |',
    '',
    '## Walk-forward 折',
    '',
    '| 测试日 | 训练 N | 测试 N | 候选实单 ROI | 基线实单 ROI | 候选加注 ROI | 基线加注 ROI | 测试 N 不低于基线 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ];
  if (!out.folds.length) lines.push('| — | — | — | — | — | — | — | — |');
  for (const f of out.folds) {
    lines.push(`| ${f.testDate} | ${f.trainN} | ${f.testN} | ${pct(f.test.roi)} | ${pct(f.baselineTest.roi)} | ${pct(f.testBoost.roi)} | ${pct(f.baselineTestBoost.roi)} | ${f.testNotWorse ? '是' : '否'} |`);
  }
  lines.push('', '## 说明', '', '- 只用开赛前快照；当前 `scores` 表不参与，避免 refresh 覆盖和赛后信息泄漏。', '- `HHAD` 官方结果为 D 时按走盘收益 0 处理；H/A 按快照赔率计算收益。', '- 加注线作为独立统计档报告；候选选择目标是实单档 ROI，加注档不参与选参。', '- 本工具只写本报告，不写 PG、不改 `score.ts`；`PROMOTE` 仍需人工审计后才可落码。', '');
  return lines.join('\n');
}

async function run(): Promise<void> {
  const started = Date.now();
  const samples = await loadSamples();
  const dates = [...new Set(samples.map(x => x.date))].sort();
  const baseline = baselineParams();
  const folds: Fold[] = [];

  for (let i = 1; i < dates.length; i++) {
    const train = samples.filter(x => x.date < dates[i]);
    const test = samples.filter(x => x.date === dates[i]);
    if (!train.length || !test.length) continue;
    const baselineTrain = evaluate(train, baseline, baseline.singleLine);
    const baselineTrainBoost = evaluate(train, baseline, baseline.boostLine);
    const baselineTest = evaluate(test, baseline, baseline.singleLine);
    const baselineTestBoost = evaluate(test, baseline, baseline.boostLine);
    let best: { metrics: Metrics; params: Params } | null = null;
    for (const params of parameterGrid()) {
      const metrics = evaluate(train, params, params.singleLine);
      if (metrics.n < baselineTrain.n || metrics.roi == null || baselineTrain.roi == null || metrics.roi < baselineTrain.roi) continue;
      if (better({ metrics, params }, best)) best = { metrics, params };
    }
    const selected = best?.params ?? baseline;
    const selectedTrain = best?.metrics ?? baselineTrain;
    const selectedTrainBoost = evaluate(train, selected, selected.boostLine);
    const selectedTest = evaluate(test, selected, selected.singleLine);
    const selectedTestBoost = evaluate(test, selected, selected.boostLine);
    folds.push({
      testDate: dates[i], trainN: train.length, testN: test.length, selected,
      train: selectedTrain, trainBoost: selectedTrainBoost, test: selectedTest, testBoost: selectedTestBoost,
      baselineTrain, baselineTrainBoost, baselineTest, baselineTestBoost,
      testNotWorse: selectedTest.n >= baselineTest.n && (selectedTest.roi ?? -Infinity) >= (baselineTest.roi ?? -Infinity),
    });
  }

  const baselineTest = aggregateMetrics(folds.map(f => f.baselineTest));
  const baselineTestBoost = aggregateMetrics(folds.map(f => f.baselineTestBoost));
  const candidateTest = aggregateMetrics(folds.map(f => f.test));
  const candidateTestBoost = aggregateMetrics(folds.map(f => f.testBoost));
  const settled = samples.length;
  const candidate = folds.length ? folds[folds.length - 1].selected : null;
  const lift = candidateTest.roi != null && baselineTest.roi != null ? +(candidateTest.roi - baselineTest.roi).toFixed(4) : null;
  const promote = settled >= MIN_SETTLED
    && candidateTest.n >= MIN_TEST_BETS
    && lift != null && lift >= MIN_ROI_LIFT
    && folds.length > 0
    && folds.every(f => f.testNotWorse);
  const out = {
    generatedAt: new Date().toISOString(),
    elapsedSeconds: +((Date.now() - started) / 1000).toFixed(2),
    status: promote ? 'promote' : 'hold',
    promote,
    sampleCount: settled,
    sampleDates: dates,
    baseline: { params: paramsJson(baseline), test: metricsJson(baselineTest), testBoost: metricsJson(baselineTestBoost) },
    latestRecommendation: candidate ? { params: paramsJson(candidate) } : null,
    walkForwardCandidate: candidate ? {
      // Each fold uses only its training history; these are aggregate out-of-sample metrics.
      test: metricsJson(candidateTest), testBoost: metricsJson(candidateTestBoost), lift,
    } : null,
    folds: folds.map(f => ({ ...f, selected: paramsJson(f.selected) })),
    gates: { minSettled: MIN_SETTLED, minTestBets: MIN_TEST_BETS, minRoiLift: MIN_ROI_LIFT, allFoldsTestNotWorse: folds.length > 0 && folds.every(f => f.testNotWorse) },
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  fs.writeFileSync(OUT_MD, renderMarkdown(out), 'utf8');
  console.log(`参数优化 ${out.status} | 样本${settled}场/折${folds.length} | 基线ROI${pct(baselineTest.roi)} | 候选ROI${candidate ? pct(candidateTest.roi) : '—'} | ${OUT}`);
  await pool().end();
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('optimize.ts')) {
  run().catch(e => { console.error('参数优化失败:', e?.message || e); process.exit(1); });
}
