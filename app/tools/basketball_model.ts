/**
 * basketball_model.ts — 篮球球队强度模型 + 日级 walk-forward 样本外验证
 *
 * 模型假设（诚实标注）：
 * - 每队攻/防强度按「联赛内相对场均得分」估计，向 1 收缩（K=8），样本少自动回退联赛平均。
 * - 主客期望得分：λh = lgAvg × homeAdv × off_h × def_a；λa = lgAvg ÷ homeAdv × off_a × def_h。
 * - 分差用两个独立泊松之差（Skellam）精确卷积；总分用泊松和。
 * - 篮球真实分差方差通常小于独立泊松（节奏相关），本模型会高估方差 → 极端盘口概率偏保守。
 *
 * 验证口径：
 * - 日级 walk-forward：预测某日比赛只用该日之前已完赛的比赛；同日比赛不互相使用。
 * - 数据只有 matchDate（无开赛时刻），因此无法做「赛前时点级」验证，只能做日级。
 * - 市场基线 = 竞彩让分盘赔率 h/a 去水；该赔率接近 50/50（水位约 17%），信息量低。
 *
 * 运行：node --experimental-strip-types app/tools/basketball_model.ts
 * 输出：data/experiment_survival_100/model/basketball_report.json
 *       仅当显著优于基线且 n≥100 时写 basketball_verified.json（供信号门使用）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { devigTwoWay } from "./basketball.ts";
import { compareToBaseline, type PairedObs } from "./prob_metrics.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HIST = path.join(ROOT, "data", "history", "basketball");
const OUTDIR = path.join(ROOT, "data", "experiment_survival_100", "model");
const REPORT = path.join(OUTDIR, "basketball_report.json");
const VERIFIED = path.join(OUTDIR, "basketball_verified.json");

interface Game {
  matchId: string; date: string; leagueId: string; leagueName: string;
  homeId: string; awayId: string; homeScore: number; awayScore: number;
  line: number | null; h: number | null; a: number | null;
}

// ---------- 数据加载（finalScore = 客:主，已用 winFlag 交叉验证） ----------
function loadGames(): Game[] {
  const files = fs.readdirSync(HIST).filter((f) => f.endsWith(".json"));
  const byId = new Map<string, Game>();
  for (const f of files) {
    let j: any;
    try { j = JSON.parse(fs.readFileSync(path.join(HIST, f), "utf8")); } catch { continue; }
    for (const m of j.matches || []) {
      if (!m.matchId || !m.finalScore) continue;
      const parts = String(m.finalScore).split(":");
      if (parts.length !== 2) continue;
      const awayScore = Number(parts[0]), homeScore = Number(parts[1]);
      if (!Number.isFinite(awayScore) || !Number.isFinite(homeScore)) continue;
      if (homeScore < 0 || awayScore < 0) continue;
      const date = String(m.matchDate || j.date || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const lineNum = m.goalline === "" || m.goalline === undefined ? null : Number(m.goalline);
      const id = String(m.matchId);
      if (byId.has(id)) continue;
      byId.set(id, {
        matchId: id, date,
        leagueId: String(m.leagueId || "?"), leagueName: String(m.leagueName || "?"),
        homeId: String(m.homeTeamId || "?"), awayId: String(m.awayTeamId || "?"),
        homeScore, awayScore,
        line: Number.isFinite(lineNum as number) ? (lineNum as number) : null,
        h: Number(m.h) > 1 ? Number(m.h) : null,
        a: Number(m.a) > 1 ? Number(m.a) : null,
      });
    }
  }
  return [...byId.values()].sort((x, y) => x.date.localeCompare(y.date) || x.matchId.localeCompare(y.matchId));
}

// ---------- 统计与预测 ----------
interface TeamStat { games: number; ptsFor: number; ptsAgainst: number }
interface LeagueStat { games: number; homePts: number; awayPts: number; teams: Map<string, TeamStat> }
const K_SHRINK = 8;
const MAX_K = 320;

function poissonArr(l: number, K: number): Float64Array {
  const a = new Float64Array(K + 1);
  a[0] = Math.exp(-l);
  for (let k = 1; k <= K; k++) a[k] = a[k - 1] * l / k;
  return a;
}
function poissonCdf(l: number, K: number): Float64Array {
  const pmf = poissonArr(l, K), cdf = new Float64Array(K + 1);
  let s = 0;
  for (let k = 0; k <= K; k++) { s += pmf[k]; cdf[k] = s; }
  return cdf;
}
function clampLambda(l: number): number { return Math.max(40, Math.min(l, 160)); }

/** P(主队覆盖 line)，line 为主队视角（+6.5 受让）。 */
export function coverProb(lh: number, la: number, line: number): number {
  const LH = clampLambda(lh), LA = clampLambda(la);
  const ph = poissonArr(LH, MAX_K), cdfA = poissonCdf(LA, MAX_K);
  const t = Math.ceil(-line) - 1; // margin ≤ t → 不覆盖；margin = home − away
  let pLe = 0;
  for (let j = 0; j <= MAX_K; j++) {
    const idx = j - t - 1;
    const c = idx < 0 ? 0 : cdfA[Math.min(idx, MAX_K)];
    pLe += ph[j] * (1 - c);
  }
  return Math.max(0, Math.min(1, 1 - pLe));
}

function predict(lg: LeagueStat, homeId: string, awayId: string): { lh: number; la: number } | null {
  if (lg.games < 20) return null;
  const avg = (lg.homePts + lg.awayPts) / (2 * lg.games);
  if (!(avg > 0)) return null;
  const homeAdv = Math.sqrt(lg.homePts / Math.max(1, lg.awayPts));
  const off = (id: string): number => {
    const t = lg.teams.get(id);
    if (!t || t.games === 0) return 1;
    const raw = (t.ptsFor / t.games) / avg;
    return (raw * t.games + 1 * K_SHRINK) / (t.games + K_SHRINK);
  };
  const def = (id: string): number => {
    const t = lg.teams.get(id);
    if (!t || t.games === 0) return 1;
    const raw = (t.ptsAgainst / t.games) / avg;
    return (raw * t.games + 1 * K_SHRINK) / (t.games + K_SHRINK);
  };
  return { lh: avg * homeAdv * off(homeId) * def(awayId), la: (avg / homeAdv) * off(awayId) * def(homeId) };
}

function update(lg: LeagueStat, g: Game): void {
  const add = (id: string, pf: number, pa: number) => {
    let t = lg.teams.get(id);
    if (!t) { t = { games: 0, ptsFor: 0, ptsAgainst: 0 }; lg.teams.set(id, t); }
    t.games++; t.ptsFor += pf; t.ptsAgainst += pa;
  };
  add(g.homeId, g.homeScore, g.awayScore);
  add(g.awayId, g.awayScore, g.homeScore);
  lg.games++; lg.homePts += g.homeScore; lg.awayPts += g.awayScore;
}

// ---------- 主流程 ----------
function main() {
  const games = loadGames();
  console.log(`loaded games=${games.length} dates=${games[0]?.date}..${games[games.length - 1]?.date}`);

  const leagues = new Map<string, LeagueStat>();
  const obs: PairedObs[] = [];
  const byLeague = new Map<string, { n: number; bModel: number; bBase: number }>();
  let usable = 0, noLine = 0, noOdds = 0, noPred = 0;
  let modelBrierSum = 0, baseBrierSum = 0;

  let i = 0;
  while (i < games.length) {
    const day = games[i].date;
    const todays: Game[] = [];
    while (i < games.length && games[i].date === day) { todays.push(games[i]); i++; }

    // 先用「当天之前」的统计做预测
    for (const g of todays) {
      if (g.line === null) { noLine++; continue; }
      if (g.h === null || g.a === null) { noOdds++; continue; }
      const lg = leagues.get(g.leagueId);
      const pred = lg ? predict(lg, g.homeId, g.awayId) : null;
      if (!pred) { noPred++; continue; }
      const pModel = coverProb(pred.lh, pred.la, g.line);
      const dv = devigTwoWay(g.h, g.a);
      if (dv.prob === null) { noOdds++; continue; }
      const pBase = dv.prob;
      const margin = g.homeScore - g.awayScore;
      const cover = margin + g.line > 0 ? 1 : 0;
      modelBrierSum += (pModel - cover) ** 2;
      baseBrierSum += (pBase - cover) ** 2;
      usable++;
      const key = g.leagueName;
      const rec = byLeague.get(key) || { n: 0, bModel: 0, bBase: 0 };
      rec.n++; rec.bModel += (pModel - cover) ** 2; rec.bBase += (pBase - cover) ** 2;
      byLeague.set(key, rec);
      obs.push({
        matchId: g.matchId,
        kickoffAt: `${g.date}T23:59:59+08:00`,
        predictAt: `${new Date(Date.parse(g.date + "T23:59:59+08:00") - 86400000).toISOString().replace("Z", "+00:00")}`,
        dataAt: `${new Date(Date.parse(g.date + "T23:59:59+08:00") - 86400000).toISOString().replace("Z", "+00:00")}`,
        market: "hdc", side: "H", line: g.line,
        outcome: cover as 0 | 1,
        pModel, pBaseline: pBase,
      });
    }

    // 再用当天结果更新统计（严格：当天比赛不影响当天预测）
    for (const g of todays) {
      let lg = leagues.get(g.leagueId);
      if (!lg) { lg = { games: 0, homePts: 0, awayPts: 0, teams: new Map() }; leagues.set(g.leagueId, lg); }
      update(lg, g);
    }
  }

  const verdict = compareToBaseline(obs, { minN: 100, alpha: 0.05 });
  const bModel = usable ? modelBrierSum / usable : null;
  const bBase = usable ? baseBrierSum / usable : null;

  // 校准诊断：按模型概率分桶，看预测均值与实际命中率是否一致
  const bins = [0, 0.2, 0.4, 0.6, 0.8, 1.0001];
  const calib = bins.slice(0, -1).map((lo, idx) => {
    const hi = bins[idx + 1];
    const rows = obs.filter(o => o.pModel >= lo && o.pModel < hi);
    const n = rows.length;
    const predMean = n ? rows.reduce((s, o) => s + o.pModel, 0) / n : null;
    const hit = n ? rows.reduce((s, o) => s + o.outcome, 0) / n : null;
    return { range: `${lo}~${hi}`, n, predMean: predMean === null ? null : +predMean.toFixed(3), actualHit: hit === null ? null : +hit.toFixed(3) };
  });
  const modelProbMean = obs.length ? obs.reduce((s, o) => s + o.pModel, 0) / obs.length : null;
  const actualCoverRate = obs.length ? obs.reduce((s, o) => s + o.outcome, 0) / obs.length : null;

  const leagueRows = [...byLeague.entries()]
    .filter(([, v]) => v.n >= 30)
    .map(([name, v]) => ({ league: name, n: v.n, brierModel: +(v.bModel / v.n).toFixed(4), brierBaseline: +(v.bBase / v.n).toFixed(4), diff: +((v.bModel - v.bBase) / v.n).toFixed(4) }))
    .sort((x, y) => y.n - x.n);

  const report = {
    generatedAt: Date.now(),
    generatedAtBJ: new Date(Date.now() + 8 * 3600e3).toISOString().replace("T", " ").slice(0, 19),
    design: {
      model: "联赛内球队攻防强度（向1收缩K=8）+ 主客期望得分 + Skellam 分差",
      validation: "日级 walk-forward：预测某日只用该日之前完赛数据；同日不互用",
      baseline: "竞彩让分盘赔率 h/a 两路去水（接近50/50，水位约17%）",
      scoreOrder: "finalScore=客:主（已用 winFlag 交叉验证）",
      caveat: "数据无开赛时刻，无法做时点级验证；篮球独立泊松会高估分差方差",
    },
    counts: { total: games.length, usable, noLine, noOdds, noPred },
    metrics: { brierModel: bModel === null ? null : +bModel.toFixed(4), brierBaseline: bBase === null ? null : +bBase.toFixed(4), diff: bModel !== null && bBase !== null ? +(bModel - bBase).toFixed(4) : null },
    verdict,
    calibration: { modelProbMean: modelProbMean === null ? null : +modelProbMean.toFixed(4), actualCoverRate: actualCoverRate === null ? null : +actualCoverRate.toFixed(4), bins: calib },
    byLeague: leagueRows,
    limitations: [
      "日级而非时点级：同日比赛共享同一预测时点，无法证明赛前T-30机制",
      "终盘赔率作基线，含轻微前视（终盘是赛前最后定价）",
      "独立泊松假设对篮球分差方差偏大，极端盘口概率可能偏保守",
      "未按主客场分拆球队攻防，只分拆联赛主场优势",
      "样本跨度 2026-01-01 ~ 2026-11-20，含跨赛季与联赛结构变化",
    ],
  };

  fs.mkdirSync(OUTDIR, { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), "utf8");

  const verified = verdict.status === "better-than-baseline" && usable >= 100;
  if (verified) {
    fs.writeFileSync(VERIFIED, JSON.stringify({
      generatedAt: Date.now(),
      verified: true,
      oosBeatsBaseline: true,
      model: "league-relative-attack-defense-shrunk-skellam",
      trainThrough: games[games.length - 1]?.date,
      report: "basketball_report.json",
      verdict,
    }, null, 2), "utf8");
  } else {
    try { fs.unlinkSync(VERIFIED); } catch {}
  }

  console.log(JSON.stringify({
    usable, brierModel: report.metrics.brierModel, brierBaseline: report.metrics.brierBaseline,
    diff: report.metrics.diff, verdict: verdict.status, n: verdict.n, ci: verdict.ci95, verified,
  }, null, 1));
  console.log("byLeague top:", JSON.stringify(leagueRows.slice(0, 6)));
}
main();
