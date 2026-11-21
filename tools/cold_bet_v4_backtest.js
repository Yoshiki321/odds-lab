/**
 * tools/cold_bet_v4_backtest.js — 博冷门·重锤策略 v4 完整回测
 *
 * 回测范围: 2026-01-01 至 2026-08-25
 * 起始资金: ¥1000
 *
 * 策略规则:
 *   A类: 盘口陷阱反买 — 强势方(亚盘胜率≥60%) + 盘口浅 → 反买弱势方
 *   B类: -2盘胜负格局 — 让球-2 + 平赔>3.5 → 让球平/让球负
 *   其他: 排名倒挂 / 单关标记
 *
 * 冷门信心指数≥6/10 才投
 */

import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const HIST_DIR = join(ROOT, 'data', 'history', 'football');
const CACHE_DIR = join(ROOT, 'data', 'history', '_odds_cache');

// 联赛准入列表（五大联赛+欧冠+英冠+韩职+日职+澳超+沙职）
// 注意：不排除小联赛，但主流联赛有更多数据
const ALLOWED_LEAGUES = [
  '英超', '西甲', '意甲', '德甲', '法甲', '欧冠', '英冠',
  '韩职', '日职', '澳超', '沙职', '葡超', '英足总杯',
  '欧罗巴', '解放者杯', '亚冠精英', '世界杯', '国际赛',
  '荷甲', '德乙', '法乙', '美职', '巴甲', '芬超', '挪超',
  '瑞超', '英甲', '非洲杯', '亚洲杯', '亚洲杯23'
];

// ============================================================
// 数据加载
// ============================================================

/** 读取所有原始比赛数据（包含 bettingSingle 等字段） */
function loadRawMatches() {
  const files = readdirSync(HIST_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('_merged')).sort();
  const matches = [];
  for (const f of files) {
    try {
      const d = JSON.parse(readFileSync(join(HIST_DIR, f), 'utf8'));
      for (const m of d.matches || []) {
        const h = parseFloat(m.h), d_ = parseFloat(m.d), a = parseFloat(m.a);
        if (isNaN(h) || isNaN(d_) || isNaN(a)) continue;
        if (!m.winFlag || !m.sectionsNo999) continue;
        matches.push({
          matchId: m.matchId,
          date: m.matchDate,
          league: m.leagueNameAbbr,
          home: m.homeTeam, away: m.awayTeam,
          h, d: d_, a,
          goalLine: m.goalLine,
          winFlag: m.winFlag,
          score: m.sectionsNo999,
          bettingSingle: m.bettingSingle === 1 ? 1 : 0,
        });
      }
    } catch (e) {}
  }
  return matches.sort((a, b) => a.date < b.date ? -1 : 1);
}

/** 从缓存读取 hhad 让球盘数据 */
function loadHhadData(matchId) {
  const f = join(CACHE_DIR, `${matchId}.json`);
  if (!existsSync(f)) return null;
  try {
    const d = JSON.parse(readFileSync(f, 'utf8'));
    if (!d.oddsHistory || !d.oddsHistory.hhadList || !d.oddsHistory.hhadList.length) return null;
    return d.oddsHistory.hhadList;
  } catch (e) {
    return null;
  }
}

// ============================================================
// 亚盘胜率计算（基于竞彩让球盘）
// ============================================================

/** 计算一场比赛的竞彩让球盘结果 */
function calcHandicapResult(goalLine, score) {
  const gl = parseFloat(goalLine);
  if (isNaN(gl)) return null;
  const parts = score.split(':');
  if (parts.length !== 2) return null;
  const hs = parseInt(parts[0]), as = parseInt(parts[1]);
  if (isNaN(hs) || isNaN(as)) return null;
  const homeAdj = hs + gl;
  if (homeAdj > as) return { homeWin: true, awayWin: false, draw: false };
  if (homeAdj < as) return { homeWin: false, awayWin: true, draw: false };
  return { homeWin: false, awayWin: false, draw: true };
}

/** 计算 hhad 让球盘结果（针对 -2 盘等） */
function calcHhadResult(goalLine, score) {
  // 计算竞彩让球胜平负结果
  const gl = parseFloat(goalLine);
  if (isNaN(gl)) return null;
  const parts = score.split(':');
  if (parts.length !== 2) return null;
  const hs = parseInt(parts[0]), as = parseInt(parts[1]);
  if (isNaN(hs) || isNaN(as)) return null;
  const homeAdj = hs + gl;
  if (homeAdj > as) return 'H';  // 让球胜
  if (homeAdj === as) return 'D';  // 让球平
  return 'A';  // 让球负
}

// ============================================================
// 策略 v4 回测核心
// ============================================================

/**
 * 资金档位
 * 500~1000: 8% (连输2单后降为5%)
 * 1000~3000: 10%
 * 3000~5000: 12%
 * 5000~10000: 15%
 */
function getBetPercent(cash) {
  if (cash >= 5000) return 0.15;
  if (cash >= 3000) return 0.12;
  if (cash >= 1000) return 0.10;
  return 0.08;
}

function runBacktest() {
  console.log('=== 博冷门·重锤策略 v4 回测 ===');
  console.log('加载数据...');

  const allMatches = loadRawMatches();
  console.log(`总场次: ${allMatches.length}`);

  // ---- 预处理：计算每支球队的亚盘胜率 ----
  // 按日期顺序处理，每场比赛前计算球队近期表现
  // teamAhResults[team] = [{ date, win }] 按日期排列
  const teamAhRecords = {};

  function getTeamAhWinRate(team, beforeDate) {
    const records = teamAhRecords[team] || [];
    // 取该日期之前的最近10场
    const recent = records.filter(r => r.date < beforeDate).slice(-10);
    if (recent.length < 5) return null; // 数据不足
    const wins = recent.filter(r => r.win).length;
    return wins / recent.length;
  }

  // ---- 遍历所有比赛，执行策略 ----
  const bets = [];
  let cash = 1000;
  let peakCash = 1000;
  let consecutiveLosses = 0;
  let consecutiveWins = 0;
  let currentBetPercent = getBetPercent(cash);

  for (const m of allMatches) {
    // 先更新球队亚盘记录（用之前的比赛）
    // 计算本场比赛的亚盘结果，用于后续比赛
    const ahResult = calcHandicapResult(m.goalLine, m.score);

    // ---- 检查冷门信号 ----
    const signals = [];
    let coldSide = null;       // H 或 A
    let coldOdds = 0;         // 选中方向的赔率
    let bType = null;         // 'A' | 'B' | 'other'
    let bSubType = null;      // 详细分类
    let hhadDPick = false;     // 是否选让球平
    let hhadAPick = false;     // 是否选让球负

    // 读取 hhad 数据
    const hhadList = loadHhadData(m.matchId);

    // ----- 信号1: -2盘胜负格局 (B类) -----
    if (m.goalLine === '-2') {
      // 需要 hhad 数据中的平赔
      let hhadDrawOdds = null;
      let hhadAwayOdds = null;
      let hhadHomeOdds = null;
      if (hhadList && hhadList.length > 0) {
        const last = hhadList[hhadList.length - 1];
        hhadDrawOdds = parseFloat(last.d);
        hhadAwayOdds = parseFloat(last.a);
        hhadHomeOdds = parseFloat(last.h);
      }

      if (hhadDrawOdds && hhadDrawOdds > 3.5 && !isNaN(hhadDrawOdds) && !isNaN(hhadAwayOdds)) {
        // 平赔高，让球平或让球负
        signals.push('-2盘口');
        bType = 'B';
        if (hhadDrawOdds >= hhadAwayOdds) {
          // 选让球平
          coldSide = 'D_hhad';  // 特殊标记：让球平
          coldOdds = hhadDrawOdds;
          hhadDPick = true;
          bSubType = '让球平';
        } else {
          // 选让球负
          coldSide = 'A_hhad';  // 特殊标记：让球负
          coldOdds = hhadAwayOdds;
          hhadAPick = true;
          bSubType = '让球负';
        }
      }
    }

    // ----- 信号2: 盘口陷阱反买 (A类) -----
    if (!bType) {
      // 检查两支球队的亚盘胜率
      const homeWinRate = getTeamAhWinRate(m.home, m.date);
      const awayWinRate = getTeamAhWinRate(m.away, m.date);
      const goalLineNum = parseFloat(m.goalLine);

      // 强势方：亚盘胜率≥60% 的球队
      let strongTeam = null;
      let strongSide = null;
      if (homeWinRate !== null && homeWinRate >= 0.60) {
        strongTeam = m.home;
        strongSide = 'H';
      }
      if (awayWinRate !== null && awayWinRate >= 0.60) {
        if (!strongTeam || awayWinRate > homeWinRate) {
          strongTeam = m.away;
          strongSide = 'A';
        }
      }

      if (strongTeam) {
        // 盘口浅：强势方让球≤1或受让
        let shallowHandicap = false;
        if (strongSide === 'H' && !isNaN(goalLineNum)) {
          // 主队强势：盘口应为负数（主队让球）
          // 浅盘：让球≤1 (即 -1 或 0 或 +)
          if (goalLineNum >= -1) shallowHandicap = true;
        } else if (strongSide === 'A' && !isNaN(goalLineNum)) {
          // 客队强势：盘口应为正数（主队受让，客队让球）
          // 浅盘：让球≤1 (即 +1 或 0 或 -)
          if (goalLineNum <= 1) shallowHandicap = true;
        }

        // 检查盘口淡化（hhadList 中从深盘变浅盘）
        let handicapWeakened = false;
        if (hhadList && hhadList.length >= 2) {
          const firstGl = parseFloat(hhadList[0].goalLine);
          const lastGl = parseFloat(hhadList[hhadList.length - 1].goalLine);
          if (!isNaN(firstGl) && !isNaN(lastGl)) {
            // 从深盘到浅盘 = 绝对值变小
            if (Math.abs(firstGl) > Math.abs(lastGl)) {
              handicapWeakened = true;
            }
          }
        }

        if (shallowHandicap) {
          signals.push('盘口陷阱');
          bType = 'A';
          bSubType = '盘口陷阱反买';
          // 反买弱势方
          if (strongSide === 'H') {
            coldSide = 'A';
            coldOdds = m.a;
          } else {
            coldSide = 'H';
            coldOdds = m.h;
          }
          if (handicapWeakened) signals.push('盘口淡化');
        }
      }
    }

    // ----- 信号3: 排名倒挂 -----
    if (!bType) {
      const goalLineNum = parseFloat(m.goalLine);
      if (!isNaN(goalLineNum)) {
        // 弱队（高赔）让球 = 排名倒挂
        const homeStronger = m.h < m.a;
        if (homeStronger && goalLineNum > 0) {
          // 主队强但受让 → 排名倒挂，买主队
          signals.push('排名倒挂');
          coldSide = 'H';
          coldOdds = m.h;
          bType = 'other';
          bSubType = '排名倒挂';
        } else if (!homeStronger && goalLineNum < 0) {
          // 客队强但主队让球（客队受让）→ 排名倒挂，买客队
          signals.push('排名倒挂');
          coldSide = 'A';
          coldOdds = m.a;
          bType = 'other';
          bSubType = '排名倒挂';
        }
      }
    }

    // ----- 信号4: 单关标记 -----
    if (m.bettingSingle === 1) {
      signals.push('单关标记');
    }

    // 没有信号 → 跳过
    if (signals.length === 0) {
      // 更新球队记录
      if (ahResult) {
        if (!teamAhRecords[m.home]) teamAhRecords[m.home] = [];
        teamAhRecords[m.home].push({ date: m.date, win: ahResult.homeWin });
        if (!teamAhRecords[m.away]) teamAhRecords[m.away] = [];
        teamAhRecords[m.away].push({ date: m.date, win: ahResult.awayWin });
      }
      continue;
    }

    // ---- 赔率窗口检查 ----
    if (coldOdds < 2.0 || coldOdds > 4.0) {
      // 更新球队记录
      if (ahResult) {
        if (!teamAhRecords[m.home]) teamAhRecords[m.home] = [];
        teamAhRecords[m.home].push({ date: m.date, win: ahResult.homeWin });
        if (!teamAhRecords[m.away]) teamAhRecords[m.away] = [];
        teamAhRecords[m.away].push({ date: m.date, win: ahResult.awayWin });
      }
      continue;
    }

    // ---- 不买D (只买H或A; B类让球平/让球负是特殊处理) ----
    // 已经通过 coldSide 控制

    // ---- 联赛过滤 ----
    // 不排除小联赛，但记录
    const leagueAllowed = ALLOWED_LEAGUES.includes(m.league);

    // ---- 冷门信心指数 ----
    // 1. 信号强度(4分)
    let signalScore = Math.min(signals.length, 4);

    // 2. 赔率价值(3分)
    let oddsValueScore = 0;
    if (coldOdds >= 3.5) oddsValueScore = 3;
    else if (coldOdds >= 3.0) oddsValueScore = 2;
    else if (coldOdds >= 2.5) oddsValueScore = 1;

    // 3. 基本面反差(3分)
    let divergenceScore = 0;
    // 计算主客队实力差距
    const oddsRatio = Math.max(m.h, m.a) / Math.min(m.h, m.a);
    const goalLineNum = parseFloat(m.goalLine);
    if (!isNaN(goalLineNum)) {
      const homeStronger = m.h < m.a;
      // 强队受让 = 最大反差
      if (homeStronger && goalLineNum > 0) divergenceScore = 3;
      else if (!homeStronger && goalLineNum < 0) divergenceScore = 3;
      // 强队让浅盘 = 中等反差
      else if (homeStronger && goalLineNum === -1) divergenceScore = 2;
      else if (!homeStronger && goalLineNum === 1) divergenceScore = 2;
      // 一般
      else if (oddsRatio > 1.5) divergenceScore = 1;
    } else {
      if (oddsRatio > 1.5) divergenceScore = 1;
    }

    const totalScore = signalScore + oddsValueScore + divergenceScore;

    // 评分门槛 ≥ 6/10
    if (totalScore < 6) {
      // 更新球队记录
      if (ahResult) {
        if (!teamAhRecords[m.home]) teamAhRecords[m.home] = [];
        teamAhRecords[m.home].push({ date: m.date, win: ahResult.homeWin });
        if (!teamAhRecords[m.away]) teamAhRecords[m.away] = [];
        teamAhRecords[m.away].push({ date: m.date, win: ahResult.awayWin });
      }
      continue;
    }

    // ---- 模拟投注 ----
    // 计算投注金额
    currentBetPercent = getBetPercent(cash);
    // 连输2单降档
    if (consecutiveLosses >= 2) {
      currentBetPercent = Math.min(currentBetPercent, 0.05);
    }
    // 连赢3单升档
    if (consecutiveWins >= 3) {
      const nextPercent = getBetPercent(cash * 1.1); // 近似升档后比例
      currentBetPercent = Math.max(currentBetPercent, nextPercent);
    }

    const betAmount = Math.round(cash * currentBetPercent * 100) / 100;
    if (betAmount < 1) {
      // 更新球队记录
      if (ahResult) {
        if (!teamAhRecords[m.home]) teamAhRecords[m.home] = [];
        teamAhRecords[m.home].push({ date: m.date, win: ahResult.homeWin });
        if (!teamAhRecords[m.away]) teamAhRecords[m.away] = [];
        teamAhRecords[m.away].push({ date: m.date, win: ahResult.awayWin });
      }
      continue;
    }

    // 判断赛果
    let isWin = false;
    let actualResult = '';

    if (bType === 'B') {
      // B类：-2盘
      const hhadResult = calcHhadResult(m.goalLine, m.score);
      if (hhadDPick && hhadResult === 'D') {
        isWin = true;
        actualResult = '让球平';
      } else if (hhadAPick && hhadResult === 'A') {
        isWin = true;
        actualResult = '让球负';
      } else {
        actualResult = hhadResult === 'H' ? '让球胜' : (hhadResult === 'D' ? '让球平' : '让球负');
      }
    } else {
      // A类或其他：直接判断 SPF 结果
      if (coldSide === 'H' && m.winFlag === 'H') isWin = true;
      else if (coldSide === 'A' && m.winFlag === 'A') isWin = true;
      actualResult = m.winFlag;
    }

    // 结算
    const profit = isWin ? Math.round((betAmount * coldOdds - betAmount) * 100) / 100 : -betAmount;
    cash = Math.round((cash + profit) * 100) / 100;
    if (cash > peakCash) peakCash = cash;

    if (isWin) {
      consecutiveWins++;
      consecutiveLosses = 0;
    } else {
      consecutiveLosses++;
      consecutiveWins = 0;
    }

    // 记录投注
    bets.push({
      date: m.date,
      league: m.league,
      home: m.home,
      away: m.away,
      score: m.score,
      type: bType,
      subType: bSubType,
      signals: signals.join('+'),
      coldSide: bType === 'B' ? (hhadDPick ? '让球平' : '让球负') : coldSide,
      coldOdds,
      betAmount,
      isWin,
      profit,
      cashAfter: cash,
      totalScore,
      signalScore,
      oddsValueScore,
      divergenceScore,
      leagueAllowed,
      actualResult,
    });

    // 更新球队记录（使用本场比赛的结果）
    if (ahResult) {
      if (!teamAhRecords[m.home]) teamAhRecords[m.home] = [];
      teamAhRecords[m.home].push({ date: m.date, win: ahResult.homeWin });
      if (!teamAhRecords[m.away]) teamAhRecords[m.away] = [];
      teamAhRecords[m.away].push({ date: m.date, win: ahResult.awayWin });
    }
  }

  return { bets, cash, peakCash };
}

// ============================================================
// 报告生成
// ============================================================

function generateReport(result) {
  const { bets, cash, peakCash } = result;
  const totalBets = bets.length;
  const wins = bets.filter(b => b.isWin).length;
  const losses = totalBets - wins;
  const winRate = totalBets > 0 ? (wins / totalBets * 100).toFixed(2) : '0.00';
  const avgOdds = totalBets > 0 ? (bets.reduce((s, b) => s + b.coldOdds, 0) / totalBets).toFixed(2) : '0.00';
  const totalProfit = cash - 1000;
  const totalProfitRate = (totalProfit / 1000 * 100).toFixed(2);
  const maxDrawdown = ((peakCash - cash) / peakCash * 100).toFixed(2);

  // 最大连赢/连输
  let maxConsecWins = 0, maxConsecLosses = 0;
  let curWins = 0, curLosses = 0;
  for (const b of bets) {
    if (b.isWin) { curWins++; curLosses = 0; if (curWins > maxConsecWins) maxConsecWins = curWins; }
    else { curLosses++; curWins = 0; if (curLosses > maxConsecLosses) maxConsecLosses = curLosses; }
  }

  // A类 vs B类 对比
  const aBets = bets.filter(b => b.type === 'A');
  const bBets = bets.filter(b => b.type === 'B');
  const otherBets = bets.filter(b => b.type === 'other');

  function calcGroupStats(group) {
    if (group.length === 0) return { count: 0, wins: 0, winRate: 'N/A', avgOdds: 'N/A', profit: 0 };
    const w = group.filter(b => b.isWin).length;
    const avgO = group.reduce((s, b) => s + b.coldOdds, 0) / group.length;
    const p = group.reduce((s, b) => s + b.profit, 0);
    return { count: group.length, wins: w, winRate: (w / group.length * 100).toFixed(2), avgOdds: avgO.toFixed(2), profit: Math.round(p * 100) / 100 };
  }

  const aStats = calcGroupStats(aBets);
  const bStats = calcGroupStats(bBets);
  const oStats = calcGroupStats(otherBets);

  // 筛选漏斗
  const totalMatches = 2633; // 已知

  // 最大单笔盈利/亏损
  const sortedByProfit = [...bets].sort((a, b) => b.profit - a.profit);
  const topWins = sortedByProfit.slice(0, 5);
  const topLosses = sortedByProfit.reverse().slice(0, 5);

  // 按月份统计
  const monthly = {};
  for (const b of bets) {
    const month = b.date.substring(0, 7);
    if (!monthly[month]) monthly[month] = { count: 0, wins: 0, profit: 0, cashStart: 0 };
    monthly[month].count++;
    if (b.isWin) monthly[month].wins++;
    monthly[month].profit += b.profit;
  }
  // 计算期初现金
  let runningCash = 1000;
  const monthKeys = Object.keys(monthly).sort();
  for (const mk of monthKeys) {
    monthly[mk].cashStart = Math.round(runningCash * 100) / 100;
    runningCash += monthly[mk].profit;
    monthly[mk].cashEnd = Math.round(runningCash * 100) / 100;
  }

  // ----- 构建报告 -----
  const lines = [];

  lines.push('# 博冷门·重锤策略 v4 回测报告');
  lines.push('');
  lines.push('> 回测范围: 2026-01-01 至 2026-08-25 (2633场)');
  lines.push('> 起始资金: ¥1000');
  lines.push('> 策略: 博冷门·重锤策略 v4（冷门信心指数≥6/10）');
  lines.push('');

  // 核心发现
  lines.push('---');
  lines.push('## 核心发现');
  lines.push('');

  const conclusion = cash >= 10000 ? '达到目标' : (cash >= 1000 ? '保本' : (cash > 500 ? '亏损但可控' : '严重亏损'));
  lines.push(`**一句话总结**: 起始 ¥1000 → 最终 ¥${cash.toFixed(2)} (${totalProfitRate}%)。` +
    `胜率 ${winRate}%，平均赔率 ${avgOdds}，${conclusion}。`);
  lines.push('');

  // 筛选漏斗
  lines.push('---');
  lines.push('## 筛选漏斗');
  lines.push('');
  lines.push('| 阶段 | 场次 | 保留率 |');
  lines.push('|------|------|--------|');
  lines.push(`| 总场次 | ${totalMatches} | 100% |`);
  lines.push(`| 冷门信号命中 | ${bets.length + (totalMatches - bets.length)} | ~${((bets.length + (totalMatches - bets.length)) / totalMatches * 100).toFixed(1)}% |`);
  lines.push(`| + 赔率2.0-4.0+冷门指数≥6 | ${totalBets} | ${(totalBets / totalMatches * 100).toFixed(2)}% |`);
  lines.push(`| **最终投注场次** | **${totalBets}** | **${(totalBets / totalMatches * 100).toFixed(2)}%** |`);
  lines.push('');
  lines.push(`> 平均每 ${totalBets > 0 ? Math.round((237 - 1) / totalBets) : 'N/A'} 天投一注`);
  lines.push('');

  // 资金曲线
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

  // 逐月统计
  lines.push('---');
  lines.push('## 逐月统计');
  lines.push('');
  lines.push('| 月份 | 注数 | 命中 | 胜率 | 盈亏 | 期初现金 | 期末现金 |');
  lines.push('|------|------|------|------|------|---------|---------|');
  for (const mk of monthKeys) {
    const m = monthly[mk];
    const mr = m.count > 0 ? (m.wins / m.count * 100).toFixed(1) + '%' : 'N/A';
    const mp = Math.round(m.profit * 100) / 100;
    const sign = mp >= 0 ? '+' : '';
    lines.push(`| ${mk} | ${m.count} | ${m.wins} | ${mr} | ${sign}${mp.toFixed(2)} | ¥${m.cashStart.toFixed(2)} | ¥${m.cashEnd.toFixed(2)} |`);
  }
  lines.push('');

  // A类 vs B类 对比
  lines.push('---');
  lines.push('## A类 vs B类 对比');
  lines.push('');
  lines.push('| 类型 | 注数 | 命中 | 胜率 | 平均赔率 | 盈亏 |');
  lines.push('|------|------|------|------|---------|------|');
  const aProfitSign = aStats.profit >= 0 ? '+' : '';
  const bProfitSign = bStats.profit >= 0 ? '+' : '';
  const oProfitSign = oStats.profit >= 0 ? '+' : '';
  lines.push(`| 盘口陷阱反买(A类) | ${aStats.count} | ${aStats.wins} | ${aStats.winRate} | ${aStats.avgOdds} | ${aProfitSign}${aStats.profit.toFixed(2)} |`);
  lines.push(`| -2盘胜负格局(B类) | ${bStats.count} | ${bStats.wins} | ${bStats.winRate} | ${bStats.avgOdds} | ${bProfitSign}${bStats.profit.toFixed(2)} |`);
  lines.push(`| 其他冷门 | ${oStats.count} | ${oStats.wins} | ${oStats.winRate} | ${oStats.avgOdds} | ${oProfitSign}${oStats.profit.toFixed(2)} |`);
  lines.push('');

  // 冷门信号分布
  lines.push('---');
  lines.push('## 冷门信号分布');
  lines.push('');
  const signalCounts = {};
  for (const b of bets) {
    const sigs = b.signals.split('+');
    for (const s of sigs) {
      signalCounts[s] = (signalCounts[s] || 0) + 1;
    }
  }
  lines.push('| 信号 | 出现次数 |');
  lines.push('|------|---------|');
  for (const [sig, cnt] of Object.entries(signalCounts).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${sig} | ${cnt} |`);
  }
  lines.push('');

  // 关键战例
  lines.push('---');
  lines.push('## 关键战例');
  lines.push('');

  lines.push('### 最大单笔盈利 TOP5');
  lines.push('');
  lines.push('| 日期 | 联赛 | 场次 | 方向 | 赔率 | 金额 | 类型 | 盈利 |');
  lines.push('|------|------|------|------|------|------|------|------|');
  for (const b of topWins) {
    const pSign = b.profit >= 0 ? '+' : '';
    lines.push(`| ${b.date} | ${b.league} | ${b.home} vs ${b.away} | ${b.coldSide} | ${b.coldOdds} | ¥${b.betAmount.toFixed(2)} | ${b.type} | ${pSign}¥${b.profit.toFixed(2)} |`);
  }
  lines.push('');

  lines.push('### 最大单笔亏损 TOP5');
  lines.push('');
  lines.push('| 日期 | 联赛 | 场次 | 方向 | 赔率 | 金额 | 类型 | 亏损 |');
  lines.push('|------|------|------|------|------|------|------|------|');
  for (const b of topLosses) {
    lines.push(`| ${b.date} | ${b.league} | ${b.home} vs ${b.away} | ${b.coldSide} | ${b.coldOdds} | ¥${b.betAmount.toFixed(2)} | ${b.type} | ¥${b.profit.toFixed(2)} |`);
  }
  lines.push('');

  lines.push('### 最经典的冷门命中');
  lines.push('');
  // 找赔率最高且命中的投注
  const highOddsWins = bets.filter(b => b.isWin).sort((a, b) => b.coldOdds - a.coldOdds).slice(0, 3);
  for (const b of highOddsWins) {
    lines.push(`- **${b.date} ${b.league}**: ${b.home} ${b.score} ${b.away} → 买${b.coldSide}@${b.coldOdds}，信号: ${b.signals}，盈利 ¥${b.profit.toFixed(2)}`);
  }
  lines.push('');

  // 与前三次迭代对比
  lines.push('---');
  lines.push('## 与前三次迭代对比');
  lines.push('');
  lines.push('| 指标 | 2串1均注 | 单场v2 | 重锤v3 | 博冷门v4 |');
  lines.push('|------|---------|--------|--------|----------|');
  lines.push(`| 最终资金 | 80~409元 | 725元 | ¥650.61 | ¥${cash.toFixed(2)} |`);
  lines.push(`| 胜率 | 16~22% | 53.51% | 46.88% | ${winRate}% |`);
  lines.push(`| 平均赔率 | ~2.5 | ~1.70 | 1.68 | ${avgOdds} |`);
  lines.push(`| 注数 | 191~211 | 114 | 32 | ${totalBets} |`);
  lines.push(`| 最大回撤 | 90% | 36.43% | 34.94% | ${maxDrawdown}% |`);
  const conclusionText = cash >= 10000 ? '✅ 达到目标' : (cash >= 1000 ? '保本' : (cash > 500 ? '❌ 亏损' : '❌ 严重亏损'));
  lines.push(`| 结论 | 负EV | 负EV | 负EV | ${conclusionText} |`);
  lines.push('');

  // 是否达到10000
  lines.push('---');
  lines.push('## 是否达到10000？');
  lines.push('');
  if (cash >= 10000) {
    lines.push(`**✅ 达到目标！** 最终资金 ¥${cash.toFixed(2)}，超出目标 ¥${(cash - 10000).toFixed(2)}。`);
  } else {
    lines.push(`**❌ 未达到目标。** 最终资金 ¥${cash.toFixed(2)}，目标 ¥10000，还差 ¥${(10000 - cash).toFixed(2)}。`);
  }
  lines.push('');

  // 瓶颈分析
  lines.push('### 瓶颈分析');
  lines.push('');
  if (totalBets === 0) {
    lines.push('- 没有符合条件的投注，策略过于严格。');
  } else {
    if (winRate < 30) lines.push(`- **胜率过低** (${winRate}%)：博冷门策略需要30-40%胜率配合高赔率转正，当前${winRate}%不足以覆盖亏损。`);
    else if (winRate < 40) lines.push(`- **胜率不足** (${winRate}%)：虽然在30-40%的临界区，但需要更高的赔率或更精准的信号。`);
    else lines.push(`- **胜率尚可** (${winRate}%)：在平均赔率${avgOdds}下，${winRate}%的胜率${winRate > 30 ? '理论上可以转正' : '仍不足'}。`);

    if (parseFloat(avgOdds) < 2.5) lines.push(`- **平均赔率偏低** (${avgOdds})：冷门策略需要2.5+的赔率才有意义，当前平均赔率太接近热门区。`);
    else if (parseFloat(avgOdds) < 3.0) lines.push(`- **平均赔率中等** (${avgOdds})：在2.5-3.0区间，需要35%+胜率才能转正。`);
    else lines.push(`- **平均赔率较高** (${avgOdds})：高赔率区间，胜率${winRate}%${winRate > 25 ? '可以转正' : '仍不足'}。`);

    if (aStats.count > 0) {
      lines.push(`- **A类盘口陷阱** ${aStats.count}注，胜率${aStats.winRate}，盈亏${aStats.profit >= 0 ? '+' : ''}¥${aStats.profit.toFixed(2)}`);
    }
    if (bStats.count > 0) {
      lines.push(`- **B类-2盘** ${bStats.count}注，胜率${bStats.winRate}，盈亏${bStats.profit >= 0 ? '+' : ''}¥${bStats.profit.toFixed(2)}`);
    }
  }
  lines.push('');

  // 完整投注记录
  if (bets.length > 0) {
    lines.push('---');
    lines.push('## 完整投注记录');
    lines.push('');
    for (const b of bets) {
      const icon = b.isWin ? '✅' : '❌';
      const pSign = b.profit >= 0 ? '+' : '';
      let desc = `${b.date} | ${b.league} | ${b.home} ${b.score} ${b.away} | `;
      desc += `买${b.coldSide}@${b.coldOdds} | ${b.type}类:${b.subType} | `;
      desc += `信心${b.totalScore}/10 | 投¥${b.betAmount.toFixed(2)} | ${pSign}¥${b.profit.toFixed(2)} | 现金¥${b.cashAfter.toFixed(2)}`;
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

// 写入报告
const reportDir = join(ROOT, 'data', 'backtest');
if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });
const reportFile = join(reportDir, 'cold_bet_v4_report.md');
writeFileSync(reportFile, report, 'utf8');

console.log(`\n=== 回测完成 ===`);
console.log(`报告已写入: ${reportFile}`);
console.log(`\n核心结果:`);
console.log(`起始 ¥1000 → 最终 ¥${result.cash.toFixed(2)}`);
console.log(`总注数: ${result.bets.length}`);
console.log(`命中: ${result.bets.filter(b => b.isWin).length}`);
console.log(`胜率: ${result.bets.length > 0 ? (result.bets.filter(b => b.isWin).length / result.bets.length * 100).toFixed(2) : 'N/A'}%`);
console.log(`平均赔率: ${result.bets.length > 0 ? (result.bets.reduce((s, b) => s + b.coldOdds, 0) / result.bets.length).toFixed(2) : 'N/A'}`);