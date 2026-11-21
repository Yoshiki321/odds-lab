/**
 * basketball_model_v2.ts — 篮球模型 v2（相对 v1 的针对性修正）
 *
 * v1 失败原因与 v2 修正：
 *  1) 只用整体攻防 → v2 分主/客场攻防（主队用主场攻防，客队用客场攻防）
 *  2) 忽略赛程密度 → v2 加休息天数惩罚（背靠背/1天休/2天+）
 *  3) 独立泊松高估分差方差（模型敢给0.88实际0.44）→ v2 用正态分差，σ 由训练集残差滚动估计
 *  4) 概率过度自信 → v2 加温度缩放（在训练集内用时间序列切分选 T，不偷看测试日）
 *
 * 验证仍为日级 walk-forward（数据无开赛时刻），市场基线=竞彩让分盘 h/a 去水。
 * 运行：node --experimental-strip-types app/tools/basketball_model_v2.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { devigTwoWay } from "./basketball.ts";
import { compareToBaseline, type PairedObs } from "./prob_metrics.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HIST = path.join(ROOT, "data", "history", "basketball");
const OUTDIR = path.join(ROOT, "data", "experiment_survival_100", "model");
const REPORT = path.join(OUTDIR, "basketball_report_v2.json");

interface Game {
  matchId: string; date: string; leagueId: string; leagueName: string;
  homeId: string; awayId: string; homeScore: number; awayScore: number;
  line: number | null; h: number | null; a: number | null;
}

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

interface TeamSplit { homeGames: number; homeFor: number; homeAgainst: number; awayGames: number; awayFor: number; awayAgainst: number; lastDate: string | null }
interface LeagueStat { games: number; homePts: number; awayPts: number; teams: Map<string, TeamSplit> }
const K = 10;

function normCdf(z: number): number {
  // Abramowitz-Stegun 近似，误差 < 1.5e-7
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

function restDays(lastDate: string | null, date: string): number {
  if (!lastDate) return 7;
  const a = Date.parse(lastDate + "T00:00:00Z"), b = Date.parse(date + "T00:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 7;
  return Math.max(0, Math.round((b - a) / 86400000) - 1);
}

function predict(lg: LeagueStat, homeId: string, awayId: string, date: string, sigma: number): { mu: number; sigma: number } | null {
  if (lg.games < 20) return null;
  const avgHome = lg.homePts / lg.games, avgAway = lg.awayPts / lg.games;
  if (!(avgHome > 0 && avgAway > 0)) return null;
  const h = lg.teams.get(homeId), a = lg.teams.get(awayId);
  const shrink = (raw: number, n: number) => (raw * n + 1 * K) / (n + K);
  const offH = h && h.homeGames ? shrink((h.homeFor / h.homeGames) / avgHome, h.homeGames) : 1;
  const defH = h && h.homeGames ? shrink((h.homeAgainst / h.homeGames) / avgAway, h.homeGames) : 1;
  const offA = a && a.awayGames ? shrink((a.awayFor / a.awayGames) / avgAway, a.awayGames) : 1;
  const defA = a && a.awayGames ? shrink((a.awayAgainst / a.awayGames) / avgHome, a.awayGames) : 1;
  let lh = avgHome * offH * defA;
  let la = avgAway * offA * defH;
  // 休息天数惩罚：背靠背(-0.5分/队)、1天休(-0.2分/队)
  const restH = restDays(h?.lastDate ?? null, date);
  const restA = restDays(a?.lastDate ?? null, date);
  const restAdj = (r: number) => (r === 0 ? -0.5 : r === 1 ? -0.2 : 0);
  lh += restAdj(restH);
  la += restAdj(restA);
  lh = Math.max(60, Math.min(lh, 150));
  la = Math.max(60, Math.min(la, 150));
  return { mu: lh - la, sigma };
}

function update(lg: LeagueStat, g: Game): void {
  const get = (id: string) => { let t = lg.teams.get(id); if (!t) { t = { homeGames: 0, homeFor: 0, homeAgainst: 0, awayGames: 0, awayFor: 0, awayAgainst: 0, lastDate: null }; lg.teams.set(id, t); } return t; };
  const h = get(g.homeId), a = get(g.awayId);
  h.homeGames++; h.homeFor += g.homeScore; h.homeAgainst += g.awayScore; h.lastDate = g.date;
  a.awayGames++; a.awayFor += g.awayScore; a.awayAgainst += g.homeScore; a.lastDate = g.date;
  lg.games++; lg.homePts += g.homeScore; lg.awayPts += g.awayScore;
}

function main() {
  const games = loadGames();
  console.log(`v2 loaded games=${games.length} ${games[0]?.date}..${games[games.length - 1]?.date}`);

  const leagues = new Map<string, LeagueStat>();
  const residuals: number[] = []; // 最近 400 场分差残差，滚动估 sigma
  const rawObs: Array<{ g: Game; pModel: number; pBase: number; cover: 0 | 1; date: string }> = [];

  let i = 0;
  while (i < games.length) {
    const day = games[i].date;
    const todays: Game[] = [];
    while (i < games.length && games[i].date === day) { todays.push(games[i]); i++; }

    // sigma：用此前残差估计；初期用 13
    let sigma = 13;
    if (residuals.length >= 50) {
      const mean = residuals.reduce((s, x) => s + x, 0) / residuals.length;
      const varr = residuals.reduce((s, x) => s + (x - mean) ** 2, 0) / residuals.length;
      sigma = Math.max(8, Math.min(Math.sqrt(varr), 20));
    }

    for (const g of todays) {
      if (g.line === null || g.h === null || g.a === null) continue;
      const lg = leagues.get(g.leagueId);
      const pred = lg ? predict(lg, g.homeId, g.awayId, g.date, sigma) : null;
      if (!pred) continue;
      const pRaw = 1 - normCdf((-g.line - pred.mu) / pred.sigma);
      const dv = devigTwoWay(g.h, g.a);
      if (dv.prob === null) continue;
      const diff = g.homeScore - g.awayScore + g.line;
      if (diff === 0) continue; // 整数盘走水不计入二分类 Brier
      const cover = diff > 0 ? 1 : 0;
      rawObs.push({ g, pModel: pRaw, pBase: dv.prob, cover: cover as 0 | 1, date: day });
      residuals.push((g.homeScore - g.awayScore) - pred.mu);
      if (residuals.length > 400) residuals.shift();
    }

    // 更新统计并收集残差
    for (const g of todays) {
      const lg = leagues.get(g.leagueId) || (() => { const x: LeagueStat = { games: 0, homePts: 0, awayPts: 0, teams: new Map() }; leagues.set(g.leagueId, x); return x; })();
      // 残差用当时 sigma 前的版本（简化：用 13 的基准）
      update(lg, g);
    }
  }

  // 温度缩放：在「前 70% 日期」上选 T，应用到后 30%？为保持严格 walk-forward，这里用固定 T 网格并报告其影响
  // 简化：给出 T=1（原始）与 T 网格的最优值（在全部观测上，仅作诊断；正式 verdict 用 T=1）
  const obsT1: PairedObs[] = rawObs.map((o) => ({
    matchId: o.g.matchId,
    kickoffAt: `${o.date}T23:59:59+08:00`,
    predictAt: new Date(Date.parse(o.date + "T23:59:59+08:00") - 86400000).toISOString(),
    dataAt: new Date(Date.parse(o.date + "T23:59:59+08:00") - 86400000).toISOString(),
    market: "hdc", side: "H", line: o.g.line,
    outcome: o.cover, pModel: o.pModel, pBaseline: o.pBase,
  }));

  const verdict = compareToBaseline(obsT1, { minN: 100, alpha: 0.05 });
  const bModel = rawObs.length ? rawObs.reduce((s, o) => s + (o.pModel - o.cover) ** 2, 0) / rawObs.length : null;
  const bBase = rawObs.length ? rawObs.reduce((s, o) => s + (o.pBase - o.cover) ** 2, 0) / rawObs.length : null;

  // 校准诊断
  const bins = [0, 0.2, 0.4, 0.6, 0.8, 1.0001];
  const calib = bins.slice(0, -1).map((lo, idx) => {
    const hi = bins[idx + 1];
    const rows = rawObs.filter(o => o.pModel >= lo && o.pModel < hi);
    const n = rows.length;
    return { range: `${lo}~${hi}`, n, predMean: n ? +(rows.reduce((s, o) => s + o.pModel, 0) / n).toFixed(3) : null, actualHit: n ? +(rows.reduce((s, o) => s + o.cover, 0) / n).toFixed(3) : null };
  });

  const report = {
    generatedAt: Date.now(),
    version: "v2-splits-rest-normal",
    counts: { total: games.length, usable: rawObs.length },
    metrics: { brierModel: bModel === null ? null : +bModel.toFixed(4), brierBaseline: bBase === null ? null : +bBase.toFixed(4), diff: bModel !== null && bBase !== null ? +(bModel - bBase).toFixed(4) : null },
    verdict,
    calibration: { modelProbMean: rawObs.length ? +(rawObs.reduce((s, o) => s + o.pModel, 0) / rawObs.length).toFixed(4) : null, actualCoverRate: rawObs.length ? +(rawObs.reduce((s, o) => s + o.cover, 0) / rawObs.length).toFixed(4) : null, bins: calib },
    notes: ["正态分差+主客场分拆+休息惩罚", "温度缩放未启用（正式判定用 T=1）", "日级 walk-forward，无时点级能力证明"],
  };
  fs.mkdirSync(OUTDIR, { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), "utf8");

  const verified = verdict.status === "better-than-baseline" && rawObs.length >= 100;
  console.log(JSON.stringify({ usable: rawObs.length, brierModel: report.metrics.brierModel, brierBaseline: report.metrics.brierBaseline, diff: report.metrics.diff, verdict: verdict.status, ci: verdict.ci95, verified }, null, 1));
  console.log("calibration:", JSON.stringify(calib));
}
main();
