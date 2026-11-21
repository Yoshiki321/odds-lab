/**
 * oos_eval.ts — 时间样本外评估：独立泊松模型 vs 市场基线（独赢）
 * 用法: node app/tools/oos_eval.ts
 * 输入: data/experiment_survival_100/dataset/rows.jsonl（dataset_build 产物）
 *        data/history/football/*.json（只用 matchDate 早于预测日的比赛）
 * 输出: data/experiment_survival_100/dataset/oos_report.json + 控制台摘要
 *
 * 纪律：
 *  - 每场只用 predictMs 之前已完赛的历史（按 matchDate < 预测日，保守）
 *  - 基线 = 同一快照比例去水
 *  - 报告 Brier 差值、样本量、覆盖率；样本不足时明确 insufficient
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { brier, logLoss, compareToBaseline, type Pair, type PairedObs } from './prob_metrics.ts';

interface HMatch { date: string; homeId: string; awayId: string; hg: number; ag: number; lg: string }
interface Row {
  matchId: string; league: string; home: string; away: string;
  homeId: string; awayId: string;
  kickoffMs: number; predictMs: number; side: 'H' | 'D' | 'A';
  pBaseline: number; outcome: 0 | 1; score: string;
}

const HIST = 'data/history/football';
const ROWS = 'data/experiment_survival_100/dataset/rows.jsonl';
const OUT = 'data/experiment_survival_100/dataset/oos_report.json';

function loadHistory(): HMatch[] {
  const out: HMatch[] = [];
  if (!existsSync(HIST)) return out;
  for (const f of readdirSync(HIST).filter((x) => /^\d{4}-\d{2}-\d{2}\.json$/.test(x))) {
    const date = f.replace('.json', '');
    let j: any;
    try { j = JSON.parse(readFileSync(`${HIST}/${f}`, 'utf8')); } catch { continue; }
    for (const m of j.matches || []) {
      if (m.poolStatus !== 'Payout' || !m.sectionsNo999) continue;
      const [hg, ag] = String(m.sectionsNo999).split(':').map(Number);
      if (!Number.isFinite(hg) || !Number.isFinite(ag)) continue;
      out.push({ date, homeId: String(m.homeTeamId), awayId: String(m.awayTeamId), hg, ag, lg: m.leagueNameAbbr || '' });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const poisson = (lam: number, k: number): number => {
  let p = Math.exp(-lam);
  for (let i = 1; i <= k; i++) p *= lam / i;
  return p;
};

interface Rates { att: Record<string, number>; def: Record<string, number>; lgHome: number; lgAway: number; n: number }

/** 用给定历史样本估计球队攻防（收缩 K=5，向 1 收缩） */
export function fitRates(hist: HMatch[], league: string): Rates {
  const pool = hist.filter((m) => m.lg === league);
  const use = pool.length >= 30 ? pool : hist;
  let hg = 0, ag = 0, n = 0;
  const gf: Record<string, number> = {}, ga: Record<string, number> = {}, cnt: Record<string, number> = {};
  for (const m of use) {
    hg += m.hg; ag += m.ag; n++;
    gf[m.homeId] = (gf[m.homeId] || 0) + m.hg; ga[m.homeId] = (ga[m.homeId] || 0) + m.ag; cnt[m.homeId] = (cnt[m.homeId] || 0) + 1;
    gf[m.awayId] = (gf[m.awayId] || 0) + m.ag; ga[m.awayId] = (ga[m.awayId] || 0) + m.hg; cnt[m.awayId] = (cnt[m.awayId] || 0) + 1;
  }
  const lgHome = n ? hg / n : 1.4;
  const lgAway = n ? ag / n : 1.1;
  const K = 5;
  const att: Record<string, number> = {}, def: Record<string, number> = {};
  for (const id of Object.keys(cnt)) {
    const c = cnt[id];
    const gfRate = gf[id] / c, gaRate = ga[id] / c;
    const gfBase = (lgHome + lgAway) / 2;
    const attRaw = gfRate / Math.max(gfBase, 1e-9);
    const defRaw = gaRate / Math.max(gfBase, 1e-9);
    const w = c / (c + K);
    att[id] = 1 + w * (attRaw - 1);
    def[id] = 1 + w * (defRaw - 1);
  }
  return { att, def, lgHome, lgAway, n };
}

function predictProbs(rates: Rates, homeId: string, awayId: string): { h: number; d: number; a: number } {
  const ah = rates.att[homeId] ?? 1, dh = rates.def[homeId] ?? 1;
  const aa = rates.att[awayId] ?? 1, da = rates.def[awayId] ?? 1;
  const lh = rates.lgHome * ah * da;
  const la = rates.lgAway * aa * dh;
  let ph = 0, pd = 0, pa = 0;
  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j <= 10; j++) {
      const p = poisson(lh, i) * poisson(la, j);
      if (i > j) ph += p; else if (i === j) pd += p; else pa += p;
    }
  }
  const z = ph + pd + pa;
  return { h: ph / z, d: pd / z, a: pa / z };
}

function loadRows(): Row[] {
  if (!existsSync(ROWS)) return [];
  return readFileSync(ROWS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function dateOf(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

(async () => {
  const hist = loadHistory();
  const rows = loadRows();
  const stats: any = { historyMatches: hist.length, rows: rows.length };

  if (!rows.length) { console.log(JSON.stringify({ ok: false, reason: '无数据集，先跑 dataset_build.ts' }, null, 2)); process.exit(0); }

  // 按场聚合（每场三行：H/D/A）
  const byMatch = new Map<string, Row[]>();
  for (const r of rows) {
    const k = `${r.matchId}|${r.kickoffMs}`;
    if (!byMatch.has(k)) byMatch.set(k, []);
    byMatch.get(k)!.push(r);
  }
  const matches = [...byMatch.entries()].map(([k, v]) => ({ key: k, rows: v, kickoffMs: v[0].kickoffMs, predictMs: v[0].predictMs, league: v[0].league }))
    .sort((a, b) => a.kickoffMs - b.kickoffMs);

  // walk-forward：每场只用预测日之前的比赛拟合
  const modelPairs: Pair[] = [];
  const basePairs: Pair[] = [];
  const pairedObs: PairedObs[] = [];
  let usedMatches = 0;

  for (const m of matches) {
    const cutoff = dateOf(m.predictMs);
    const past = hist.filter((h) => h.date < cutoff);
    if (!past.length) continue;
    const rates = fitRates(past, m.league);
    const first = m.rows[0];
    const p = predictProbs(rates, first.homeId, first.awayId);
    usedMatches++;
    for (const r of m.rows) {
      const pm = r.side === 'H' ? p.h : r.side === 'D' ? p.d : p.a;
      modelPairs.push({ p: pm, y: r.outcome });
      basePairs.push({ p: r.pBaseline, y: r.outcome });
      pairedObs.push({
        matchId: r.matchId, kickoffAt: new Date(r.kickoffMs).toISOString(),
        predictAt: new Date(r.predictMs).toISOString(),
        dataAt: new Date(r.predictMs).toISOString(),
        market: 'HAD', side: r.side, line: 'null',
        outcome: r.outcome, pModel: pm, pBaseline: r.pBaseline,
      });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    dataset: stats,
    matchedForEval: usedMatches,
    model: {
      type: 'independent-poisson-lite',
      caveat: '数据集未保存主客队 ID，模型退化为"联赛平均强度"；这不是完整的独立球队模型，仅验证流水线',
      brier: brier(modelPairs), logLoss: logLoss(modelPairs),
    },
    baseline: { brier: brier(basePairs), logLoss: logLoss(basePairs) },
    paired: compareToBaseline(pairedObs),
    independenceWarning: '同场 H/D/A 三行强相关，不能当独立样本；配对函数未做相关性调整',
  };

  writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({
    matched: usedMatches,
    modelBrier: report.model.brier, baseBrier: report.baseline.brier,
    modelLogLoss: report.model.logLoss, baseLogLoss: report.baseline.logLoss,
    pairedStatus: report.paired.status, pairedN: report.paired.n,
    pairedNote: report.paired.note,
    out: OUT,
  }, null, 2));
  process.exit(0);
})();
