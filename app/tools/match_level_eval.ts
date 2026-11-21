/**
 * match_level_eval.ts — 按"每场一个预设预测时点"重算（聚类统计）
 * 用法: node app/tools/match_level_eval.ts
 * 输出: data/experiment_survival_100/dataset/match_level_report.json
 *
 * 预设时点（先定后用，不看结果再改）：
 *  - 每场取"严格可用"快照中，距开赛最近但至少 30 分钟的那一个
 *  - 若某场没有 >=30min 的严格快照 → 该场不进入主分析
 *  - predictable time = 文件名时间（strict 已保证 oddsMs <= nameMs）；
 *    仍标注"文件名时间本身无独立证据（mtime 被改写 +8h）"
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ODDS = 'data/odds';
const HIST = 'data/history/football';
const OUT = 'data/experiment_survival_100/dataset/match_level_report_v2.json';
const TZ = '+08:00';

const ts = (d: string, t: string) => Date.parse(`${d}T${t}${TZ}`);
const parseName = (n: string) => {
  const m = n.match(/football_all_(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})-(\d{2})\.json$/);
  return m ? { date: m[1], time: `${m[2]}:${m[3]}:${m[4]}` } : null;
};
const poisson = (l: number, k: number) => { let p = Math.exp(-l); for (let i = 1; i <= k; i++) p *= l / i; return p; };

interface H { date: string; hId: string; aId: string; hg: number; ag: number; lg: string }

function loadHistory(): H[] {
  const out: H[] = [];
  for (const f of readdirSync(HIST).filter((x) => /^\d{4}-\d{2}-\d{2}\.json$/.test(x))) {
    const date = f.replace('.json', '');
    let j: any; try { j = JSON.parse(readFileSync(join(HIST, f), 'utf8')); } catch { continue; }
    for (const m of j.matches || []) {
      if (m.poolStatus !== 'Payout' || !m.sectionsNo999) continue;
      const [hg, ag] = String(m.sectionsNo999).split(':').map(Number);
      if (Number.isFinite(hg) && Number.isFinite(ag)) out.push({ date, hId: String(m.homeTeamId), aId: String(m.awayTeamId), hg, ag, lg: m.leagueNameAbbr || '' });
    }
  }
  return out;
}
function resultOf(date: string, id: string): { hg: number; ag: number } | null {
  const p = join(HIST, `${date}.json`);
  if (!existsSync(p)) return null;
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'));
    const m = (j.matches || []).find((x: any) => String(x.matchId) === String(id));
    if (!m || m.poolStatus !== 'Payout' || !m.sectionsNo999 || !m.winFlag) return null;
    const [hg, ag] = String(m.sectionsNo999).split(':').map(Number);
    return Number.isFinite(hg) && Number.isFinite(ag) ? { hg, ag } : null;
  } catch { return null; }
}
function fitRates(past: H[], league: string) {
  const pool = past.filter((m) => m.lg === league);
  const use = pool.length >= 30 ? pool : past;
  let hg = 0, ag = 0, n = 0;
  const gf: Record<string, number> = {}, ga: Record<string, number> = {}, c: Record<string, number> = {};
  for (const m of use) {
    hg += m.hg; ag += m.ag; n++;
    gf[m.hId] = (gf[m.hId] || 0) + m.hg; ga[m.hId] = (ga[m.hId] || 0) + m.ag; c[m.hId] = (c[m.hId] || 0) + 1;
    gf[m.aId] = (gf[m.aId] || 0) + m.ag; ga[m.aId] = (ga[m.aId] || 0) + m.hg; c[m.aId] = (c[m.aId] || 0) + 1;
  }
  const lgHome = n ? hg / n : 1.4, lgAway = n ? ag / n : 1.1;
  const att: Record<string, number> = {}, def: Record<string, number> = {};
  const base = (lgHome + lgAway) / 2;
  for (const id of Object.keys(c)) {
    const k = c[id], w = k / (k + 5);
    att[id] = 1 + w * ((gf[id] / k) / Math.max(base, 1e-9) - 1);
    def[id] = 1 + w * ((ga[id] / k) / Math.max(base, 1e-9) - 1);
  }
  return { att, def, lgHome, lgAway, n };
}
function predict(rates: any, hId: string, aId: string) {
  const lh = rates.lgHome * (rates.att[hId] ?? 1) * (rates.def[aId] ?? 1);
  const la = rates.lgAway * (rates.att[aId] ?? 1) * (rates.def[hId] ?? 1);
  let ph = 0, pd = 0, pa = 0;
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
    const p = poisson(lh, i) * poisson(la, j);
    if (i > j) ph += p; else if (i === j) pd += p; else pa += p;
  }
  const z = ph + pd + pa;
  return { H: ph / z, D: pd / z, A: pa / z };
}

// 收集严格快照
interface Cand { matchId: string; date: string; nameMs: number; kickoffMs: number; oddsMs: number; had: any; hId: string; aId: string; league: string }
const cands: Cand[] = [];
for (const f of readdirSync(ODDS).filter((x) => /^football_all_.*\.json$/.test(x))) {
  const nm = parseName(f);
  if (!nm) continue;
  const nameMs = Date.parse(`${nm.date}T${nm.time}Z`); // scraper.js uses UTC toISOString()
  let j: any; try { j = JSON.parse(readFileSync(join(ODDS, f), 'utf8')); } catch { continue; }
  for (const g of j?.value?.matchInfoList || []) for (const m of g.subMatchList || []) {
    if (!m.matchDate || !m.matchTime || !m.had?.updateDate || !m.had?.updateTime) continue;
    const kickoffMs = ts(m.matchDate, m.matchTime);
    const oddsMs = ts(m.had.updateDate, m.had.updateTime);
    if (!(oddsMs <= nameMs) || !(oddsMs < kickoffMs)) continue;      // 严格：内容不晚于文件名时间且赛前
    if (!(kickoffMs - nameMs >= 30 * 60000)) continue;                // 至少 T-30
    const h = Number(m.had.h), d = Number(m.had.d), a = Number(m.had.a);
    if (!(h > 1 && d > 1 && a > 1)) continue;
    if (!resultOf(m.matchDate, m.matchId)) continue;
    cands.push({ matchId: String(m.matchId), date: m.matchDate, nameMs, kickoffMs, oddsMs, had: { h, d, a }, hId: String(m.homeTeamId), aId: String(m.awayTeamId), league: m.leagueAbbName || '' });
  }
}

// 每场取"距开赛最近且 >=30min"的那一个
const byMatch = new Map<string, Cand>();
for (const c of cands) {
  const cur = byMatch.get(c.matchId);
  if (!cur || c.nameMs > cur.nameMs) byMatch.set(c.matchId, c);
}

const hist = loadHistory();
const picks: any[] = [];
for (const c of [...byMatch.values()].sort((a, b) => a.kickoffMs - b.kickoffMs)) {
  // 无开赛时刻的历史文件采用 -36h 双日保守缓冲，防止 D-1 跨午夜场泄露
  const cutoff = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(c.nameMs - 36 * 3600_000));
  const past = hist.filter((m) => m.date <= cutoff);
  if (!past.length) continue;
  const rates = fitRates(past, c.league);
  const pm = predict(rates, c.hId, c.aId);
  const res = resultOf(c.date, c.matchId)!;
  const actual: 'H' | 'D' | 'A' = res.hg > res.ag ? 'H' : res.hg === res.ag ? 'D' : 'A';
  const inv = [1 / c.had.h, 1 / c.had.d, 1 / c.had.a];
  const z = inv[0] + inv[1] + inv[2];
  const base = { H: inv[0] / z, D: inv[1] / z, A: inv[2] / z };
  const onehot = { H: actual === 'H' ? 1 : 0, D: actual === 'D' ? 1 : 0, A: actual === 'A' ? 1 : 0 };
  const brier = (p: any) => ['H', 'D', 'A'].reduce((s, k) => s + (p[k] - (onehot as any)[k]) ** 2, 0);
  picks.push({
    matchId: c.matchId, league: c.league, kickoffMs: c.kickoffMs, nameMs: c.nameMs, oddsMs: c.oddsMs,
    minutesBeforeKickoff: Math.round((c.kickoffMs - c.nameMs) / 60000),
    actual, score: `${res.hg}:${res.ag}`,
    model: pm, baseline: base,
    brierModel: brier(pm), brierBase: brier(base),
    llModel: -Math.log(Math.max(pm[actual], 1e-12)),
    llBase: -Math.log(Math.max(base[actual], 1e-12)),
  });
}

// 聚类 bootstrap（按比赛重采样；mulberry32 可复现）
import { mulberry32 } from './rng.ts';

function bootstrapCI(diffs: number[], reps = 20000, seed = 20261119): { ci: [number, number]; seed: number; reps: number } {
  if (diffs.length < 5) return { ci: [NaN, NaN], seed, reps };
  const rnd = mulberry32(seed);
  const means: number[] = [];
  for (let r = 0; r < reps; r++) {
    let s = 0;
    for (let i = 0; i < diffs.length; i++) s += diffs[Math.floor(rnd() * diffs.length)];
    means.push(s / diffs.length);
  }
  means.sort((a, b) => a - b);
  return { ci: [means[Math.floor(reps * 0.025)], means[Math.floor(reps * 0.975)]], seed, reps };
}

/** 日期块 bootstrap（敏感性分析）：按开赛日整体重采样 */
function blockBootstrapCI(items: Array<{ date: string; diff: number }>, reps = 20000, seed = 20261119): { ci: [number, number]; blocks: number; seed: number; reps: number } {
  const byDate = new Map<string, number[]>();
  for (const it of items) {
    if (!byDate.has(it.date)) byDate.set(it.date, []);
    byDate.get(it.date)!.push(it.diff);
  }
  const blocks = [...byDate.values()];
  if (blocks.length < 5) return { ci: [NaN, NaN], blocks: blocks.length, seed, reps };
  const rnd = mulberry32(seed + 1);
  const means: number[] = [];
  for (let r = 0; r < reps; r++) {
    let sum = 0, count = 0;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[Math.floor(rnd() * blocks.length)];
      for (const d of b) { sum += d; count++; }
    }
    means.push(sum / count);
  }
  means.sort((a, b) => a - b);
  return { ci: [means[Math.floor(reps * 0.025)], means[Math.floor(reps * 0.975)]], blocks: blocks.length, seed: seed + 1, reps };
}

const n = picks.length;
const mean = (f: (p: any) => number) => n ? picks.reduce((s, p) => s + f(p), 0) / n : null;
const bm = mean((p) => p.brierModel), bb = mean((p) => p.brierBase);
const lm = mean((p) => p.llModel), lb = mean((p) => p.llBase);
const diffs = picks.map((p) => p.brierModel - p.brierBase);
const minutes = picks.map((p) => p.minutesBeforeKickoff).sort((a, b) => a - b);
const bjDate = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const blockItems = picks.map((p) => ({ date: bjDate(p.kickoffMs), diff: p.brierModel - p.brierBase }));
const boot = bootstrapCI(diffs);
const block = blockBootstrapCI(blockItems);
const perMatchSnaps: Record<string, number> = {};
for (const c of cands) perMatchSnaps[c.matchId] = (perMatchSnaps[c.matchId] || 0) + 1;

/** 统计一律从 picks/cands 现算，不手写进报告 */
const derived = {
  usedMatches: n,
  snapshotsPerMatch: {
    min: Math.min(...Object.values(perMatchSnaps)),
    median: (() => { const v = Object.values(perMatchSnaps).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; })(),
    max: Math.max(...Object.values(perMatchSnaps)),
    mean: +(Object.values(perMatchSnaps).reduce((a, b) => a + b, 0) / Object.keys(perMatchSnaps).length).toFixed(2),
  },
  minutesBeforeKickoff: {
    min: minutes[0],
    median: minutes[Math.floor(minutes.length / 2)],
    max: minutes[minutes.length - 1],
  },
  hasT30Sample: minutes.some((m) => m >= 30 && m <= 35),
  kickoffRangeBJ: n ? { from: bjDate(picks[0].kickoffMs), to: bjDate(picks[n - 1].kickoffMs) } : null,
};

const report = {
  generatedAt: new Date().toISOString(),
  design: {
    unit: 'match（每场一个预测时点）',
    predictionTime: '严格快照中距开赛最近且 >=30min 的那一个；预测时间取文件名时间',
    strictRule: 'oddsMs <= nameMs 且 oddsMs < kickoffMs 且 有赛果',
    caveat: '文件名时间无独立证据（mtime 被改写 +8h）；本报告把 strict 当作"可证明的下界"，结论仍受此限制',
    cutoff: '训练只用 matchDate < 预测日 的历史（保守；跨午夜场可能被推迟一天才可用）',
  },
  counts: derived,
  metrics: {
    definition: {
      brier3: 'sum_k (p_k - y_k)^2，三类求和（范围 0~2）',
      logloss: '-ln p_actual',
    },
    model: { brier: bm, logloss: lm },
    baseline: { brier: bb, logloss: lb },
    pairedBrierDiff: n ? { mean: +(bm! - bb!).toFixed(6), clusterBootstrap: boot, dateBlockBootstrap: block } : null,
  },
  limitations: [
    '样本仅覆盖 2026-08-23~08-29 的快照，比赛数很小',
    '文件名时间缺少独立采集证据（mtime +8h 说明被复制/改写）',
    '训练集只有日期，无法证明结果在预测时已产生；跨午夜场可能滞后',
    '同队多场、同联赛聚集，聚类 bootstrap 只处理"按比赛"层级，未处理球队层级',
  ],
  picks,
};
writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({
  used: n, strictAppearances: cands.length,
  modelBrier: bm, baseBrier: bb, modelLL: lm, baseLL: lb,
  diff: n ? +(bm! - bb!).toFixed(6) : null,
  ci: n ? bootstrapCI(diffs) : null,
  kickoffRange: report.counts.kickoffRangeBJ,
  out: OUT,
}, null, 2));
