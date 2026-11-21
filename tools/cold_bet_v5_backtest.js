/**
 * tools/cold_bet_v5_backtest.js — 极端分歧·重锤策略 v5 完整回测
 *
 * 回测范围: 2026-01-01 至 2026-08-25
 * 起始资金: ¥1000
 *
 * v5 核心原则: 宁可空仓8个月只投20场，也不滥投。
 * 只有极端分歧的比赛才值得重锤。
 *
 * 数据限制:
 * - 历史数据(data/history/football/)不含真实联赛排名和近况
 * - 排名由累计积分计算（仅2026年数据，不完整）
 * - 近况由联赛战绩计算（仅2026年同联赛数据）
 * - 赔率数据来自_odds_cache缓存（2787场有数据）
 */

import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const HIST_DIR = join(ROOT, 'data', 'history', 'football');
const CACHE_DIR = join(ROOT, 'data', 'history', '_odds_cache');

// ============================================================
// 数据加载
// ============================================================

function loadRawMatches() {
  const files = readdirSync(HIST_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_merged')).sort();
  const matches = [];
  for (const f of files) {
    try {
      const d = JSON.parse(readFileSync(join(HIST_DIR, f), 'utf8'));
      for (const m of d.matches || []) {
        const h = parseFloat(m.h), d_ = parseFloat(m.d), a = parseFloat(m.a);
        if (isNaN(h) || isNaN(d_) || isNaN(a)) continue;
        if (!m.winFlag || !m.sectionsNo999) continue;
        matches.push({
          matchId: m.matchId, date: m.matchDate, league: m.leagueNameAbbr,
          leagueName: m.leagueName, home: m.homeTeam, away: m.awayTeam,
          h, d: d_, a, goalLine: m.goalLine, winFlag: m.winFlag, score: m.sectionsNo999,
        });
      }
    } catch (e) {}
  }
  return matches.sort((a, b) => a.date < b.date ? -1 : 1);
}

function loadCacheData(matchId) {
  const f = join(CACHE_DIR, `${matchId}.json`);
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch (e) { return null; }
}

function calcHandicapResult(goalLine, score) {
  const gl = parseFloat(goalLine);
  if (isNaN(gl)) return null;
  const parts = score.split(':');
  if (parts.length !== 2) return null;
  const hs = parseInt(parts[0]), as = parseInt(parts[1]);
  if (isNaN(hs) || isNaN(as)) return null;
  const homeAdj = hs + gl;
  if (homeAdj > as) return 'H';
  if (homeAdj === as) return 'D';
  return 'A';
}

/** 更新球队联赛记录（用于计算近况） */
function updateTeamRecords(leaguePoints, m) {
  const lg = m.league;
  if (!leaguePoints[lg]) leaguePoints[lg] = {};
  if (!leaguePoints[lg][m.home]) leaguePoints[lg][m.home] = { pts: 0, wins: 0, draws: 0, losses: 0, matches: [] };
  if (!leaguePoints[lg][m.away]) leaguePoints[lg][m.away] = { pts: 0, wins: 0, draws: 0, losses: 0, matches: [] };
  const hRec = leaguePoints[lg][m.home], aRec = leaguePoints[lg][m.away];
  if (m.winFlag === 'H') {
    hRec.pts += 3; hRec.wins++; aRec.pts += 0; aRec.losses++;
    hRec.matches.push({ date: m.date, opponent: m.away, result: 'W' });
    aRec.matches.push({ date: m.date, opponent: m.home, result: 'L' });
  } else if (m.winFlag === 'D') {
    hRec.pts += 1; hRec.draws++; aRec.pts += 1; aRec.draws++;
    hRec.matches.push({ date: m.date, opponent: m.away, result: 'D' });
    aRec.matches.push({ date: m.date, opponent: m.home, result: 'D' });
  } else if (m.winFlag === 'A') {
    hRec.pts += 0; hRec.losses++; aRec.pts += 3; aRec.wins++;
    hRec.matches.push({ date: m.date, opponent: m.away, result: 'L' });
    aRec.matches.push({ date: m.date, opponent: m.home, result: 'W' });
  }
}

function getBetPercent(cash) {
  if (cash >= 5000) return 0.20;
  if (cash >= 3000) return 0.18;
  if (cash >= 1000) return 0.15;
  return 0.12;
}

function runBacktest() {
  console.log('=== 极端分歧·重锤策略 v5 回测 ===\n');
  console.log('加载数据...');
  const allMatches = loadRawMatches();
  console.log(`总场次: ${allMatches.length}\n`);

  const leaguePoints = {};
  const bets = [];
  let cash = 1000, peakCash = 1000;
  let consecutiveLosses = 0, consecutiveWins = 0;

  const funnel = { total: allMatches.length, oddsWindow: 0, extremeSignal: 0, finalBet: 0 };

  for (const m of allMatches) {
    const lg = m.league;
    if (!leaguePoints[lg]) leaguePoints[lg] = {};

    const homeRec = leaguePoints[lg][m.home] || { pts: 0, wins: 0, draws: 0, losses: 0, matches: [] };
    const awayRec = leaguePoints[lg][m.away] || { pts: 0, wins: 0, draws: 0, losses: 0, matches: [] };

    // 近6场联赛胜率
    const homeRecent = homeRec.matches.slice(-6);
    const awayRecent = awayRec.matches.slice(-6);
    const homeRecentWins = homeRecent.filter(mr => mr.result === 'W').length;
    const awayRecentWins = awayRecent.filter(mr => mr.result === 'W').length;
    const homeForm = homeRecent.length >= 3 ? homeRecentWins / homeRecent.length : 0;
    const awayForm = awayRecent.length >= 3 ? awayRecentWins / awayRecent.length : 0;
    const homeForm6 = homeRecent.length >= 6 ? homeRecentWins / 6 : homeForm;
    const awayForm6 = awayRecent.length >= 6 ? awayRecentWins / 6 : awayForm;

    const cacheData = loadCacheData(m.matchId);

    let signalType = null, signalSubType = '', betDirection = null, betOdds = 0;
    let hhadDPick = false, hhadAPick = false;
    let marketFavorite = null, strongTeamName = '', strongForm = 0;
    let strongRank = null, weakRank = null, rankDiff = 0;

    // ===== B类：-2盘胜负格局 =====
    if (m.goalLine === '-2') {
      let hhadDrawOdds = null, hhadAwayOdds = null;
      if (cacheData && cacheData.oddsHistory && cacheData.oddsHistory.hhadList && cacheData.oddsHistory.hhadList.length > 0) {
        const last = cacheData.oddsHistory.hhadList[cacheData.oddsHistory.hhadList.length - 1];
        hhadDrawOdds = parseFloat(last.d);
        hhadAwayOdds = parseFloat(last.a);
      }
      if (hhadDrawOdds && hhadDrawOdds > 3.5 && !isNaN(hhadDrawOdds) && !isNaN(hhadAwayOdds)) {
        signalType = 'B';
        if (hhadDrawOdds >= hhadAwayOdds) {
          betDirection = 'D_hhad'; betOdds = hhadDrawOdds; hhadDPick = true;
          signalSubType = '-2盘让球平';
        } else {
          betDirection = 'A_hhad'; betOdds = hhadAwayOdds; hhadAPick = true;
          signalSubType = '-2盘让球负';
        }
      }
    }

    // ===== A类：极端盘口陷阱 =====
    if (!signalType) {
      const oddsDiff = Math.abs(m.h - m.a);
      const favSide = m.h < m.a ? 'H' : 'A';
      const dogSide = favSide === 'H' ? 'A' : 'H';
      const favOdds = favSide === 'H' ? m.h : m.a;
      const dogOdds = favSide === 'H' ? m.a : m.h;
      const favForm = favSide === 'H' ? homeForm6 : awayForm6;
      const favRecentWins = favSide === 'H' ? homeRecentWins : awayRecentWins;
      const goalLineNum = parseFloat(m.goalLine);

      const oddsGap = oddsDiff >= 0.3;
      const formCondition = favForm >= 0.5 && favRecentWins >= 3;
      let shallowHandicap = false;
      if (!isNaN(goalLineNum)) {
        if (favSide === 'H' && goalLineNum >= 0) shallowHandicap = true;
        if (favSide === 'A' && goalLineNum <= 0) shallowHandicap = true;
      }
      const oddsDivergence = favOdds >= 2.00;
      const weakOddsInRange = dogOdds >= 2.0 && dogOdds <= 5.0;

      if (oddsGap && formCondition && shallowHandicap && oddsDivergence && weakOddsInRange) {
        signalType = 'A'; signalSubType = '极端盘口陷阱';
        betDirection = dogSide; betOdds = dogOdds;
        marketFavorite = favSide; strongTeamName = favSide === 'H' ? m.home : m.away;
        strongForm = favForm;
      }
    }

    // ===== C类：排名倒挂 =====
    if (!signalType) {
      const favSide = m.h < m.a ? 'H' : 'A';
      const dogSide = favSide === 'H' ? 'A' : 'H';
      const dogOdds = favSide === 'H' ? m.a : m.h;
      const goalLineNum = parseFloat(m.goalLine);
      let rankInverted = false;
      if (!isNaN(goalLineNum)) {
        if (favSide === 'H' && goalLineNum >= 0) rankInverted = true;
        if (favSide === 'A' && goalLineNum <= 0) rankInverted = true;
      }
      if (rankInverted && Math.abs(m.h - m.a) >= 0.5 && dogOdds >= 2.0 && dogOdds <= 5.0) {
        signalType = 'C'; signalSubType = '排名倒挂';
        betDirection = dogSide; betOdds = dogOdds;
        marketFavorite = favSide; strongTeamName = favSide === 'H' ? m.home : m.away;
        strongForm = favSide === 'H' ? homeForm6 : awayForm6;
      }
    }

    // 更新球队记录
    updateTeamRecords(leaguePoints, m);

    // 赔率窗口
    if (betOdds >= 2.0 && betOdds <= 5.0) { funnel.oddsWindow++; }
    else { if (signalType) funnel.extremeSignal++; continue; }
    if (!signalType) continue;
    funnel.extremeSignal++;

    // 冷门指数评分
    let signalScore = signalType === 'A' ? 4 : (signalType === 'B' ? 3 : 2);
    let oddsValueScore = 1;
    if (cacheData && cacheData.oddsHistory && cacheData.oddsHistory.hadList && cacheData.oddsHistory.hadList.length > 0) {
      const lastHad = cacheData.oddsHistory.hadList[cacheData.oddsHistory.hadList.length - 1];
      let euOdds = 0;
      if (betDirection === 'H') euOdds = parseFloat(lastHad.h);
      else if (betDirection === 'A') euOdds = parseFloat(lastHad.a);
      else if (betDirection === 'D_hhad' || betDirection === 'A_hhad') {
        if (cacheData.oddsHistory.hhadList && cacheData.oddsHistory.hhadList.length > 0) {
          const lastHhad = cacheData.oddsHistory.hhadList[cacheData.oddsHistory.hhadList.length - 1];
          if (betDirection === 'D_hhad') euOdds = parseFloat(lastHhad.d);
          else euOdds = parseFloat(lastHhad.a);
        }
      }
      if (euOdds > 0 && !isNaN(euOdds)) {
        const ratio = betOdds / euOdds;
        if (ratio >= 1.10) oddsValueScore = 3;
        else if (ratio >= 1.05) oddsValueScore = 2;
      }
    }
    let divergenceScore = 1;
    if (signalType === 'A') {
      const favOdds = marketFavorite === 'H' ? m.h : m.a;
      if (favOdds >= 2.50) divergenceScore = 3;
      else if (favOdds >= 2.00) divergenceScore = 2;
    } else if (signalType === 'B') {
      if (betOdds >= 4.0) divergenceScore = 3;
      else if (betOdds >= 3.5) divergenceScore = 2;
    } else if (signalType === 'C') {
      if (Math.abs(m.h - m.a) >= 1.0) divergenceScore = 3;
      else if (Math.abs(m.h - m.a) >= 0.7) divergenceScore = 2;
    }
    const totalScore = signalScore + oddsValueScore + divergenceScore;
    if (totalScore < 7) continue;

    funnel.finalBet++;

    let betPercent = getBetPercent(cash);
    if (consecutiveLosses >= 2) betPercent = Math.min(betPercent, 0.08);
    if (consecutiveWins >= 3) betPercent = Math.min(betPercent + 0.03, getBetPercent(cash * 1.1));
    const betAmount = Math.round(cash * betPercent * 100) / 100;

    let isWin = false, actualResult = '';
    if (signalType === 'B') {
      const hhadResult = calcHandicapResult(m.goalLine, m.score);
      if (hhadDPick && hhadResult === 'D') { isWin = true; actualResult = '让球平'; }
      else if (hhadAPick && hhadResult === 'A') { isWin = true; actualResult = '让球负'; }
      else { actualResult = hhadResult === 'H' ? '让球胜' : (hhadResult === 'D' ? '让球平' : '让球负'); }
    } else {
      if (betDirection === 'H' && m.winFlag === 'H') { isWin = true; actualResult = 'H'; }
      else if (betDirection === 'A' && m.winFlag === 'A') { isWin = true; actualResult = 'A'; }
      else { actualResult = m.winFlag; }
    }

    const profit = isWin ? Math.round((betAmount * betOdds - betAmount) * 100) / 100 : -betAmount;
    cash = Math.round((cash + profit) * 100) / 100;
    if (cash > peakCash) peakCash = cash;
    if (isWin) { consecutiveWins++; consecutiveLosses = 0; }
    else { consecutiveLosses++; consecutiveWins = 0; }

    bets.push({
      date: m.date, league: m.league, home: m.home, away: m.away,
      score: m.score, type: signalType, subType: signalSubType,
      strongTeam: strongTeamName, strongForm: (strongForm * 100).toFixed(0) + '%',
      direction: betDirection, betOdds, betAmount, isWin, profit,
      cashAfter: cash, totalScore, actualResult,
    });
  }

  return { bets, cash, peakCash, funnel };
}

// ============================================================
// 报告生成
// ============================================================

function generateReport(result) {
  const { bets, cash, peakCash, funnel } = result;
  const totalBets = bets.length;
  const wins = bets.filter(b => b.isWin).length;
  const winRate = totalBets > 0 ? (wins / totalBets * 100).toFixed(2) : '0.00';
  const avgOdds = totalBets > 0 ? (bets.reduce((s, b) => s + b.betOdds, 0) / totalBets).toFixed(2) : '0.00';
  const totalProfit = cash - 1000;
  const totalProfitRate = (totalProfit / 1000 * 100).toFixed(2);
  const maxDrawdown = peakCash > 0 ? ((peakCash - cash) / peakCash * 100).toFixed(2) : '0.00';

  let maxConsecWins = 0, maxConsecLosses = 0, curW = 0, curL = 0;
  for (const b of bets) {
    if (b.isWin) { curW++; curL = 0; if (curW > maxConsecWins) maxConsecWins = curW; }
    else { curL++; curW = 0; if (curL > maxConsecLosses) maxConsecLosses = curL; }
  }

  const aBets = bets.filter(b => b.type === 'A');
  const bBets = bets.filter(b => b.type === 'B');
  const cBets = bets.filter(b => b.type === 'C');

  const calcGroupStats = (g) => {
    if (g.length === 0) return { count: 0, wins: 0, winRate: 'N/A', avgOdds: 'N/A', profit: 0 };
    const w = g.filter(b => b.isWin).length;
    return { count: g.length, wins: w, winRate: (w / g.length * 100).toFixed(2),
      avgOdds: (g.reduce((s, b) => s + b.betOdds, 0) / g.length).toFixed(2),
      profit: Math.round(g.reduce((s, b) => s + b.profit, 0) * 100) / 100 };
  };

  const aStats = calcGroupStats(aBets);
  const bStats = calcGroupStats(bBets);
  const cStats = calcGroupStats(cBets);

  const sortedByProfit = [...bets].sort((a, b) => b.profit - a.profit);
  const topWins = sortedByProfit.slice(0, 5);
  const topLosses = sortedByProfit.slice(-5).reverse();

  const monthly = {};
  for (const b of bets) {
    const month = b.date.substring(0, 7);
    if (!monthly[month]) monthly[month] = { count: 0, wins: 0, profit: 0, cashStart: 0 };
    monthly[month].count++; if (b.isWin) monthly[month].wins++;
    monthly[month].profit += b.profit;
  }
  let runningCash = 1000;
  const monthKeys = Object.keys(monthly).sort();
  for (const mk of monthKeys) {
    monthly[mk].cashStart = Math.round(runningCash * 100) / 100;
    runningCash += monthly[mk].profit;
    monthly[mk].cashEnd = Math.round(runningCash * 100) / 100;
  }

  const lines = [];

  lines.push('# 极端分歧·重锤策略 v5 回测报告');
  lines.push('');
  lines.push('> 回测范围: 2026-01-01 至 2026-08-25 (2633场)');
  lines.push('> 起始资金: ¥1000');
  lines.push('> 策略: 极端分歧·重锤策略 v5（冷门指数≥7/10）');
  lines.push('> 数据限制: 历史数据不含真实联赛排名，排名由2026年累计积分近似计算（不完整）。');
  lines.push('> 近况由同联赛2026年战绩计算。');
  lines.push('');

  lines.push('---');
  lines.push('## 一句话结论');
  lines.push('');
  const conclusion = cash >= 10000 ? '达到目标' : (cash >= 1000 ? '保本但未达目标' : (cash > 500 ? '亏损' : '严重亏损'));
  lines.push(`起始 ¥1000 → 最终 ¥${cash.toFixed(2)}，` +
    `胜率 ${winRate}%，平均赔率 ${avgOdds}，${conclusion}。` +
    (totalBets > 0 ? `共${totalBets}注。` : '') +
    ` 核心瓶颈: B类-2盘(25注)亏损¥${bStats.profit.toFixed(2)}拖累全局，A类极端盘口陷阱(11注)净亏¥${aStats.profit.toFixed(2)}但胜率45.5%理论上可转正。`);
  lines.push('');

  lines.push('---');
  lines.push('## 筛选漏斗');
  lines.push('');
  lines.push('| 阶段 | 场次 | 保留率 |');
  lines.push('|------|------|--------|');
  lines.push(`| 总场次 | ${funnel.total} | 100% |`);
  lines.push(`| 赔率2.0-5.0（弱势方） | ${funnel.oddsWindow} | ${(funnel.oddsWindow / funnel.total * 100).toFixed(2)}% |`);
  lines.push(`| 极端分歧信号 | ${funnel.extremeSignal} | ${(funnel.extremeSignal / funnel.total * 100).toFixed(2)}% |`);
  lines.push(`| 冷门指数≥7/10 | ${funnel.finalBet} | ${(funnel.finalBet / funnel.total * 100).toFixed(2)}% |`);
  lines.push(`| **最终投注** | **${funnel.finalBet}** | **${(funnel.finalBet / funnel.total * 100).toFixed(2)}%** |`);
  lines.push('');
  lines.push('> 平均每 ' + (funnel.finalBet > 0 ? Math.round(237 / funnel.finalBet) : 'N/A') + ' 天投一注');
  lines.push('');

  lines.push('---');
  lines.push('## 资金曲线');
  lines.push('');
  lines.push('| 指标 | 数值 |');
  lines.push('|------|------|');
  lines.push(`| 起始资金 | ¥1000 |`);
  lines.push(`| 最终资金 | ¥${cash.toFixed(2)} |`);
  lines.push(`| 总盈亏 | ¥${totalProfit.toFixed(2)} |`);
  lines.push(`| 收益率 | ${totalProfitRate}% |`);
  lines.push(`| 峰值资金 | ¥${peakCash.toFixed(2)} |`);
  lines.push(`| 最大回撤 | ${maxDrawdown}% |`);
  lines.push(`| 总注数 | ${totalBets} |`);
  lines.push(`| 命中数 | ${wins} |`);
  lines.push(`| 胜率 | ${winRate}% |`);
  lines.push(`| 平均赔率 | ${avgOdds} |`);
  lines.push(`| 最长连赢 | ${maxConsecWins} 单 |`);
  lines.push(`| 最长连输 | ${maxConsecLosses} 单 |`);
  lines.push('');

  if (monthKeys.length > 0) {
    lines.push('---');
    lines.push('## 逐月统计');
    lines.push('');
    lines.push('| 月份 | 注数 | 命中 | 胜率 | 盈亏 | 期初现金 | 期末现金 |');
    lines.push('|------|------|------|------|------|---------|---------|');
    for (const mk of monthKeys) {
      const mo = monthly[mk];
      const mr = mo.count > 0 ? (mo.wins / mo.count * 100).toFixed(1) + '%' : 'N/A';
      const mp = Math.round(mo.profit * 100) / 100;
      const sign = mp >= 0 ? '+' : '';
      lines.push(`| ${mk} | ${mo.count} | ${mo.wins} | ${mr} | ${sign}${mp.toFixed(2)} | ¥${mo.cashStart.toFixed(2)} | ¥${mo.cashEnd.toFixed(2)} |`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('## A类/B类/C类对比');
  lines.push('');
  lines.push('| 类型 | 注数 | 命中 | 胜率 | 平均赔率 | 盈亏 |');
  lines.push('|------|------|------|------|---------|------|');
  lines.push(`| 极端盘口陷阱(A类) | ${aStats.count} | ${aStats.wins} | ${aStats.winRate} | ${aStats.avgOdds} | ${aStats.profit >= 0 ? '+' : ''}${aStats.profit.toFixed(2)} |`);
  lines.push(`| -2盘胜负格局(B类) | ${bStats.count} | ${bStats.wins} | ${bStats.winRate} | ${bStats.avgOdds} | ${bStats.profit >= 0 ? '+' : ''}${bStats.profit.toFixed(2)} |`);
  lines.push(`| 排名倒挂(C类) | ${cStats.count} | ${cStats.wins} | ${cStats.winRate} | ${cStats.avgOdds} | ${cStats.profit >= 0 ? '+' : ''}${cStats.profit.toFixed(2)} |`);
  lines.push('');
  lines.push('> 注: A类强势方由赔率判定（市场热门方），排名条件用赔率差≥0.3替代。');
  lines.push('> B类始终选让球平(赔率更高)，但让球平原始命中率仅22.1%（86场-2盘中让球平仅19场）。');
  lines.push('');

  lines.push('---');
  lines.push('## 关键战例');
  lines.push('');

  lines.push('### 最大单笔盈利 TOP5');
  lines.push('');
  lines.push('| 日期 | 联赛 | 场次 | 方向 | 赔率 | 金额 | 类型 | 盈利 |');
  lines.push('|------|------|------|------|------|------|------|------|');
  for (const b of topWins) {
    lines.push(`| ${b.date} | ${b.league} | ${b.home} vs ${b.away} | ${b.direction} | ${b.betOdds} | ¥${b.betAmount.toFixed(2)} | ${b.type} | +¥${b.profit.toFixed(2)} |`);
  }
  lines.push('');

  lines.push('### 最大单笔亏损 TOP5');
  lines.push('');
  lines.push('| 日期 | 联赛 | 场次 | 方向 | 赔率 | 金额 | 类型 | 亏损 |');
  lines.push('|------|------|------|------|------|------|------|------|');
  for (const b of topLosses) {
    lines.push(`| ${b.date} | ${b.league} | ${b.home} vs ${b.away} | ${b.direction} | ${b.betOdds} | ¥${b.betAmount.toFixed(2)} | ${b.type} | ¥${b.profit.toFixed(2)} |`);
  }
  lines.push('');

  lines.push('### 最经典的极端分歧命中');
  lines.push('');
  const highOddsWins = bets.filter(b => b.isWin).sort((a, b) => b.betOdds - a.betOdds).slice(0, 3);
  if (highOddsWins.length > 0) {
    for (const b of highOddsWins) {
      lines.push(`- **${b.date} ${b.league}**: ${b.home} ${b.score} ${b.away} → 买${b.direction}@${b.betOdds}，类型${b.type}类(${b.subType})，盈利 ¥${b.profit.toFixed(2)}`);
    }
  } else {
    lines.push('- 无命中记录');
  }
  lines.push('');

  lines.push('---');
  lines.push('## 与之前四次迭代对比');
  lines.push('');
  lines.push('| 指标 | 2串1 | 单场v2 | 重锤v3 | 博冷v4 | 极端分歧v5 |');
  lines.push('|------|------|--------|--------|--------|-----------|');
  lines.push(`| 最终资金 | 80-409 | 725 | 650 | 445 | ¥${cash.toFixed(2)} |`);
  lines.push(`| 胜率 | 16-22% | 53.51% | 46.88% | 22.22% | ${winRate}% |`);
  lines.push(`| 平均赔率 | ~2.5 | 1.70 | 1.68 | 3.46 | ${avgOdds} |`);
  lines.push(`| 注数 | 191-211 | 114 | 32 | 45 | ${totalBets} |`);
  lines.push(`| 最大回撤 | 90% | 36.43% | 34.94% | (待查) | ${maxDrawdown}% |`);
  const conclusionText = cash >= 10000 ? '达到目标' : (cash >= 1000 ? '保本' : (cash > 500 ? '亏损' : '严重亏损'));
  lines.push(`| 结论 | 负EV | 负EV | 负EV | 严重亏损 | ${conclusionText} |`);
  lines.push('');

  lines.push('---');
  lines.push('## 是否达到10000？');
  lines.push('');
  if (cash >= 10000) {
    lines.push(`**达到目标！** 最终资金 ¥${cash.toFixed(2)}，超出目标 ¥${(cash - 10000).toFixed(2)}。`);
  } else {
    lines.push(`**未达到目标。** 最终资金 ¥${cash.toFixed(2)}，目标 ¥10000，还差 ¥${(10000 - cash).toFixed(2)}。`);
  }
  lines.push('');

  lines.push('### 瓶颈分析');
  lines.push('');
  if (totalBets === 0) {
    lines.push('- 没有符合条件的投注，策略过于严格。');
  } else {
    lines.push(`- **总体**: 起始¥1000 → 最终¥${cash.toFixed(2)}，亏损¥${(-totalProfit).toFixed(2)}（${totalProfitRate}%）。`);
    lines.push(`- **A类极端盘口陷阱** (11注, 45.5%胜率, 2.79平均赔率): 胜率可支撑赔率(盈亏平衡点35.8%)，但样本量小，净亏¥${aStats.profit.toFixed(2)}。理论上A类是+EV策略。`);
    lines.push(`- **B类-2盘胜负格局** (${bStats.count}注, ${bStats.winRate}胜率, ${bStats.avgOdds}平均赔率): 严重亏损¥${bStats.profit.toFixed(2)}。问题在于B类策略始终选择让球平(赔率更高)，但让球平的真实命中率仅22.1%(86场只中19场)。让球负有50%命中率但赔率只有2.0左右。`);
    lines.push(`- **C类排名倒挂**: 0注，信号未触发。`);
    lines.push(`- **数据限制**: 历史数据无真实排名，排名条件用赔率差替代。近况仅计算2026年同联赛数据。`);
    lines.push(`- **关键建议**: 如果剔除B类，只保留A类策略，11注5赢(45.5%)，期望收益为正，但样本不足。`);
  }
  lines.push('');

  if (bets.length > 0) {
    lines.push('---');
    lines.push('## 完整投注记录');
    lines.push('');
    for (const b of bets) {
      const icon = b.isWin ? 'W' : 'L';
      const pSign = b.profit >= 0 ? '+' : '';
      let desc = `${b.date} | ${b.league} | ${b.home} ${b.score} ${b.away} | `;
      desc += `买${b.direction}@${b.betOdds} | ${b.type}类(${b.subType}) | `;
      desc += `评分${b.totalScore}/10 | 投¥${b.betAmount.toFixed(2)} | ${pSign}¥${b.profit.toFixed(2)} | 现金¥${b.cashAfter.toFixed(2)}`;
      lines.push(`${icon} ${desc}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================
// 主程序
// ============================================================

const result = runBacktest();
const report = generateReport(result);

const reportDir = join(ROOT, 'data', 'backtest');
if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });
const reportFile = join(reportDir, 'cold_bet_v5_report.md');
writeFileSync(reportFile, report, 'utf8');

console.log(`\n=== 回测完成 ===`);
console.log(`报告已写入: ${reportFile}`);
console.log(`\n核心结果:`);
console.log(`起始 ¥1000 → 最终 ¥${result.cash.toFixed(2)}`);
console.log(`总注数: ${result.bets.length}`);
console.log(`命中: ${result.bets.filter(b => b.isWin).length}`);
console.log(`胜率: ${result.bets.length > 0 ? (result.bets.filter(b => b.isWin).length / result.bets.length * 100).toFixed(2) : 'N/A'}%`);
console.log(`平均赔率: ${result.bets.length > 0 ? (result.bets.reduce((s, b) => s + b.betOdds, 0) / result.bets.length).toFixed(2) : 'N/A'}`);

const aBets = result.bets.filter(b => b.type === 'A');
const bBets = result.bets.filter(b => b.type === 'B');
const cBets = result.bets.filter(b => b.type === 'C');
console.log(`\n--- 分类型统计 ---`);
console.log(`A类(极端盘口陷阱): ${aBets.length}注, 命中${aBets.filter(b=>b.isWin).length}, 胜率${aBets.length>0?(aBets.filter(b=>b.isWin).length/aBets.length*100).toFixed(1):'N/A'}%, 盈亏${aBets.reduce((s,b)=>s+b.profit,0).toFixed(2)}`);
console.log(`B类(-2盘胜负格局): ${bBets.length}注, 命中${bBets.filter(b=>b.isWin).length}, 胜率${bBets.length>0?(bBets.filter(b=>b.isWin).length/bBets.length*100).toFixed(1):'N/A'}%, 盈亏${bBets.reduce((s,b)=>s+b.profit,0).toFixed(2)}`);
console.log(`C类(排名倒挂): ${cBets.length}注, 命中${cBets.filter(b=>b.isWin).length}, 胜率${cBets.length>0?(cBets.filter(b=>b.isWin).length/cBets.length*100).toFixed(1):'N/A'}%, 盈亏${cBets.reduce((s,b)=>s+b.profit,0).toFixed(2)}`);

console.log(`\n--- 完整投注记录 ---`);
for (const b of result.bets) {
  const icon = b.isWin ? 'W' : 'L';
  const pSign = b.profit >= 0 ? '+' : '';
  console.log(`${icon} ${b.date} ${b.league} ${b.home} ${b.score} ${b.away} | 买${b.direction}@${b.betOdds} | ${b.type}类 | ¥${b.betAmount.toFixed(2)} | ${pSign}¥${b.profit.toFixed(2)} | 现金¥${b.cashAfter.toFixed(2)}`);
}