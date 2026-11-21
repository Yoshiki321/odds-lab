/**
 * tools/heavy_bet_backtest.js — 重锤策略 1000→10000 完整回测
 *
 * 执行: node tools/heavy_bet_backtest.js
 * 输出: data/backtest/heavy_bet_10000_report.md
 *
 * 核心规则：
 *   1. 联赛过滤：只买 英超/西甲/意甲/德甲/法甲/欧冠/英冠
 *   2. 赔率窗口：1.60-2.00 热门方向（H或A，不买D）
 *   3. 变盘次数 < 5
 *   4. 8维信心评分 >= 65/80
 *   5. 盘口陷阱识别与反买
 *   6. 重锤资金管理（按阶段%）
 */

import { loadMatches } from './backtest_engine.js';
import { writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE_DIR = join(ROOT, 'data', 'history', '_odds_cache');

// ===== 稳定联赛列表（按可靠性排序） =====
const STABLE_LEAGUES = ['英超','西甲','意甲','德甲','法甲','欧冠','英冠'];
const LEAGUE_SCORE = { '英超':10, '西甲':10, '意甲':9, '德甲':9, '法甲':8, '欧冠':8, '英冠':7 };

// ===== 资金管理表 =====
function getBetRate(cash, consecutiveLosses, consecutiveWins) {
  let stageName = '起步期';
  let baseRate = 0.05;
  if (cash >= 5000) { baseRate = 0.12; stageName = '冲刺期'; }
  else if (cash >= 3000) { baseRate = 0.10; stageName = '增长期'; }
  else if (cash >= 1000) { baseRate = 0.08; stageName = '积累期'; }
  // 连输2单 → 降到最低档
  if (consecutiveLosses >= 2) baseRate = Math.min(baseRate, 0.05);
  // 连赢3单 → 可提前升档（但不超过当前阶段上限+2%）
  if (consecutiveWins >= 3) baseRate = Math.min(baseRate + 0.02, 0.15);
  return { rate: baseRate, stage: stageName };
}

// ===== 8维评分系统 =====
function scoreMatch(match) {
  const { h, d, a, goalLine, oddsChanges, oddsDirection, league } = match;
  let totalScore = 0;
  const breakdown = {};

  // 确定热门方向
  let pick = null;
  let pickOdds = null;
  if (h <= a && h <= d) { pick = 'H'; pickOdds = h; }
  else if (a <= h && a <= d) { pick = 'A'; pickOdds = a; }
  else { pick = 'D'; pickOdds = d; }
  if (pick === 'D') return { total: 0, breakdown: {}, pick: null, pickOdds: null, eligible: false, reason: '平局热门' };

  // 赔率窗口检查
  if (pickOdds < 1.60 || pickOdds > 2.00)
    return { total: 0, breakdown: {}, pick, pickOdds, eligible: false, reason: '赔率不在窗口' };

  // 变盘检查
  if (oddsChanges >= 5)
    return { total: 0, breakdown: {}, pick, pickOdds, eligible: false, reason: '变盘≥5' };

  // 联赛检查
  if (!STABLE_LEAGUES.includes(league))
    return { total: 0, breakdown: {}, pick, pickOdds, eligible: false, reason: '非稳定联赛' };

  // --- 维度1: 赔率价值(10) ---
  // 竞彩赔率 vs 理论公平赔率。公平赔率 = 1/概率
  // 用反向概率估算：如果热门赔率1.60，另外两个平均>3.5，说明价值高
  const otherMin = pick === 'H' ? Math.min(d, a) : Math.min(d, h);
  const valueRatio = otherMin / pickOdds;
  let valueScore = 0;
  if (valueRatio >= 2.5) valueScore = 10;       // 另外两项赔率是热门2.5倍+
  else if (valueRatio >= 2.0) valueScore = 8;
  else if (valueRatio >= 1.8) valueScore = 6;
  else if (valueRatio >= 1.5) valueScore = 4;
  else valueScore = 2;
  breakdown['赔率价值'] = { score: valueScore, detail: `热门${pickOdds} vs 次低${otherMin.toFixed(2)}, 比值${valueRatio.toFixed(2)}` };
  totalScore += valueScore;

  // --- 维度2: 变盘方向(10) ---
  // 变盘压向与热门方向一致 = 强信号
  if (oddsDirection === pick) {
    breakdown['变盘方向'] = { score: 10, detail: `变盘压向${pick}，与热门方向一致` };
    totalScore += 10;
  } else if (oddsDirection === null || oddsChanges === 0) {
    breakdown['变盘方向'] = { score: 5, detail: '无变盘，中性' };
    totalScore += 5;
  } else {
    breakdown['变盘方向'] = { score: 3, detail: `变盘压向${oddsDirection}，与热门方向${pick}相反` };
    totalScore += 3;
  }

  // --- 维度3: 变盘次数价值(10) ---
  // 3-4次变盘 = 最佳信号量
  let changesScore = 0;
  if (oddsChanges >= 3 && oddsChanges <= 4) changesScore = 10;
  else if (oddsChanges === 2) changesScore = 7;
  else if (oddsChanges === 1) changesScore = 5;
  else if (oddsChanges === 0) changesScore = 4;
  breakdown['变盘次数'] = { score: changesScore, detail: `变盘${oddsChanges}次` };
  totalScore += changesScore;

  // --- 维度4: 盘口匹配(10) ---
  // goalLine: "-1" = 主让1球(主队强), "+1" = 主受让1球(主队弱)
  // 检查盘口与赔率是否一致
  const gl = parseInt(goalLine);
  let glScore = 5; // 默认中性
  if (!isNaN(gl)) {
    if (pick === 'H') {
      if (gl < 0) glScore = 10;         // 主队热门+让球=一致
      else if (gl === 0) glScore = 5;
      else glScore = 2;                  // 主队热门但受让=矛盾
    } else if (pick === 'A') {
      if (gl > 0) glScore = 10;         // 客队热门+主队受让=一致
      else if (gl === 0) glScore = 5;
      else glScore = 2;                  // 客队热门但主队让球=矛盾
    }
  }
  breakdown['盘口匹配'] = { score: glScore, detail: `让球${goalLine}，热门${pick}，${glScore>=8?'一致':'矛盾'}` };
  totalScore += glScore;

  // --- 维度5: 联赛稳定(10) ---
  const ls = LEAGUE_SCORE[league] || 5;
  breakdown['联赛稳定'] = { score: ls, detail: `${league} ${ls}/10` };
  totalScore += ls;

  // --- 维度6: 赔率档位(10) ---
  // 1.60-1.70 = 最佳档位
  let oddsTierScore = 0;
  if (pickOdds >= 1.60 && pickOdds < 1.70) oddsTierScore = 10;
  else if (pickOdds >= 1.70 && pickOdds < 1.80) oddsTierScore = 8;
  else if (pickOdds >= 1.80 && pickOdds < 1.90) oddsTierScore = 5;
  else oddsTierScore = 3;
  breakdown['赔率档位'] = { score: oddsTierScore, detail: `${pick}@${pickOdds} ${oddsTierScore>=8?'最佳档位':'一般档位'}` };
  totalScore += oddsTierScore;

  // --- 维度7: 盘口陷阱(10) ---
  // 用 bettingSingle 和 goalLine 判断
  // 从原始数据读取 bettingSingle
  // 这里先放一个占位，需要从原始数据拿
  breakdown['盘口陷阱'] = { score: 5, detail: '暂无法获取完整陷阱数据，默认中性' };
  totalScore += 5;

  // --- 维度8: 比分特征(10) ---
  // 基于历史赛果的胜率特征
  // 热门方在1.60-2.00区间，整体胜率~
  // 用这个修正：1.60-1.70 胜率约48%，1.70-1.80 约49%，1.80-2.00 约38-44%
  // 结合变盘方向修正
  let winRateScore = 0;
  if (pickOdds < 1.70) winRateScore = 8;
  else if (pickOdds < 1.80) winRateScore = 7;
  else winRateScore = 4;
  if (oddsDirection === pick) winRateScore += 2; // 变盘一致加分
  winRateScore = Math.min(winRateScore, 10);
  breakdown['历史特征'] = { score: winRateScore, detail: `赔率${pickOdds}区间历史胜率约${pickOdds<1.7?'48':'45'}%` };
  totalScore += winRateScore;

  return {
    total: totalScore,
    breakdown,
    pick,
    pickOdds,
    eligible: totalScore >= 65,
    reason: totalScore >= 65 ? '符合重锤标准' : `评分不足(${totalScore}/80)`
  };
}

// ===== 读取 bettingSingle 数据（从原始历史文件） =====
function loadBettingSingleMap() {
  const map = {};
  const histDir = join(ROOT, 'data', 'history', 'football');
  try {
    const files = readdirSync(histDir).filter(f => f.endsWith('.json') && !f.startsWith('_')).sort();
    for (const f of files) {
      const d = JSON.parse(readFileSync(join(histDir, f), 'utf8'));
      for (const m of d.matches || []) {
        map[m.matchId] = m.bettingSingle;
      }
    }
  } catch (e) { /* ignore */ }
  return map;
}

// ===== 盘口陷阱检测（基于已有数据） =====
function detectTrapSimple(match, bettingSingleMap) {
  const { h, d, a, goalLine, league, matchId } = match;
  const bs = bettingSingleMap[matchId];
  const signals = [];
  let trapScore = 0;

  // 信号1: 单关放行
  if (bs === 1) {
    trapScore += 20;
    signals.push('单关放行');
  }

  // 信号2: 强势方盘口浅
  const minOdds = Math.min(h, a);
  const gl = parseInt(goalLine);
  if (!isNaN(gl)) {
    // 主队热门(赔率低)但受让(gl>0) = 盘口不认
    if (h <= a && h <= d && gl > 0) {
      trapScore += 25;
      signals.push('主队热门但受让');
    }
    // 客队热门(赔率低)但主队让球(gl<0) = 客队该让但没让
    if (a <= h && a <= d && gl < 0) {
      trapScore += 25;
      signals.push('客队热门但主队让球');
    }
    // 排名倒挂：让球线很深但赔率不低
    if (Math.abs(gl) >= 2 && minOdds > 1.70) {
      trapScore += 15;
      signals.push('深盘但赔率不低');
    }
  }

  // 信号3: 五大联赛单关+浅盘
  if (bs === 1 && STABLE_LEAGUES.includes(league)) {
    const gl = parseInt(goalLine);
    if (!isNaN(gl) && Math.abs(gl) <= 1) {
      trapScore += 10;
      signals.push('五大联赛单关浅盘');
    }
  }

  return { trapScore, signals, verdict: trapScore >= 45 ? 'trap_high' : trapScore >= 30 ? 'trap_medium' : trapScore >= 15 ? 'trap_low' : 'safe' };
}

// ===== 主函数 =====
async function main() {
  console.log('=== 重锤策略 1000→10000 完整回测 ===\n');

  // 1. 加载数据
  const all = loadMatches();
  console.log(`总场次: ${all.length}`);

  // 2. 加载 bettingSingle 数据
  const bettingSingleMap = loadBettingSingleMap();
  console.log(`bettingSingle 数据: ${Object.keys(bettingSingleMap).length} 条`);

  // 3. 筛选漏斗
  const funnel = { total: all.length, leaguePass: 0, oddsPass: 0, changesPass: 0, scored65: 0, finalBets: 0 };

  // 4. 评分所有场次
  const scoredBets = [];
  for (const match of all) {
    const result = scoreMatch(match);
    if (!result.pick) continue; // 平局热门跳过

    // 漏斗计数
    if (STABLE_LEAGUES.includes(match.league)) funnel.leaguePass++;
    if (result.pickOdds >= 1.60 && result.pickOdds <= 2.00) funnel.oddsPass++;
    if (match.oddsChanges < 5) funnel.changesPass++;

    if (result.eligible) {
      funnel.scored65++;
      // 盘口陷阱检测
      const trap = detectTrapSimple(match, bettingSingleMap);
      scoredBets.push({
        match,
        score: result,
        trap,
        pick: result.pick,
        pickOdds: result.pickOdds,
        breakdown: result.breakdown
      });
    }
  }

  // 5. 按评分排序
  scoredBets.sort((a, b) => {
    // 按评分降序，同分按日期
    if (b.score.total !== a.score.total) return b.score.total - a.score.total;
    return a.match.date < b.match.date ? -1 : 1;
  });

  console.log(`\n筛选漏斗:`);
  console.log(`  总场次: ${funnel.total}`);
  console.log(`  通过联赛筛选: ${funnel.leaguePass}`);
  console.log(`  通过赔率窗口: ${funnel.oddsPass}`);
  console.log(`  通过变盘<5: ${funnel.changesPass}`);
  console.log(`  8维评分≥65: ${funnel.scored65}`);
  console.log(`  最终可投: ${scoredBets.length}`);

  // 6. 模拟投注
  let cash = 1000;
  let peakCash = 1000;
  let consecutiveLosses = 0;
  let consecutiveWins = 0;
  let maxConsecutiveLosses = 0;
  let maxConsecutiveWins = 0;
  let maxDrawdown = 0;
  let totalBets = 0;
  let winBets = 0;
  let dailyLoss = 0;
  let currentDate = '';
  const betLog = [];
  const monthlyStats = {};

  // 按日期分组
  const betsByDate = {};
  for (const bet of scoredBets) {
    const d = bet.match.date;
    if (!betsByDate[d]) betsByDate[d] = [];
    betsByDate[d].push(bet);
  }

  const sortedDates = Object.keys(betsByDate).sort();

  for (const date of sortedDates) {
    const dayBets = betsByDate[date];
    // 重置日亏损
    dailyLoss = 0;

    for (const bet of dayBets) {
      const { match, score, trap, pick, pickOdds } = bet;
      const { rate, stage } = getBetRate(cash, consecutiveLosses, consecutiveWins);

      // 单笔金额
      let stake = Math.round(cash * rate * 100) / 100;
      stake = Math.min(stake, cash * 0.15); // 绝对上限15%
      stake = Math.min(stake, cash); // 不超过本金

      // 日亏损上限
      if (dailyLoss >= cash * 0.20) {
        // 当日不再投
        continue;
      }

      // 结算
      const isWin = pick === match.winFlag;
      const profit = isWin ? Math.round(stake * (pickOdds - 1) * 100) / 100 : -stake;
      const newCash = Math.round((cash + profit) * 100) / 100;

      // 更新资金
      cash = newCash;
      if (cash > peakCash) peakCash = cash;
      const drawdown = peakCash > 0 ? Math.round((peakCash - cash) / peakCash * 10000) / 100 : 0;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;

      // 更新连输/赢
      if (isWin) {
        consecutiveWins++;
        consecutiveLosses = 0;
        if (consecutiveWins > maxConsecutiveWins) maxConsecutiveWins = consecutiveWins;
      } else {
        consecutiveLosses++;
        consecutiveWins = 0;
        if (consecutiveLosses > maxConsecutiveLosses) maxConsecutiveLosses = consecutiveLosses;
      }

      // 日亏损
      if (!isWin) dailyLoss += Math.abs(profit);

      totalBets++;
      if (isWin) winBets++;

      // 陷阱反买验证
      let trapReverse = false;
      if (trap.verdict !== 'safe' && !isWin) {
        trapReverse = true;
      }

      betLog.push({
        date: match.date,
        matchId: match.matchId,
        league: match.league,
        home: match.home,
        away: match.away,
        pick,
        odds: pickOdds,
        goalLine: match.goalLine,
        score: match.score,
        winFlag: match.winFlag,
        oddsChanges: match.oddsChanges,
        oddsDirection: match.oddsDirection,
        totalScore: score.total,
        trapScore: trap.trapScore,
        trapVerdict: trap.verdict,
        stake: Math.round(stake * 100) / 100,
        result: isWin ? 'W' : 'L',
        profit: Math.round(profit * 100) / 100,
        newCash: cash,
        betRate: rate,
        stage,
        breakdown: { ...score.breakdown }
      });

      // 月度统计
      const month = match.date.slice(0, 7);
      if (!monthlyStats[month]) monthlyStats[month] = { bets: 0, wins: 0, profit: 0, cash: [] };
      monthlyStats[month].bets++;
      if (isWin) monthlyStats[month].wins++;
      monthlyStats[month].profit += profit;
    }
  }

  // 7. 整理月度统计
  const sortedMonths = Object.keys(monthlyStats).sort();
  let prevCash = 1000;
  for (const month of sortedMonths) {
    monthlyStats[month].startCash = Math.round(prevCash * 100) / 100;
    monthlyStats[month].endCash = Math.round((prevCash + monthlyStats[month].profit) * 100) / 100;
    monthlyStats[month].winRate = monthlyStats[month].bets > 0
      ? Math.round(monthlyStats[month].wins / monthlyStats[month].bets * 10000) / 100 + '%'
      : '0%';
    monthlyStats[month].profit = Math.round(monthlyStats[month].profit * 100) / 100;
    prevCash = monthlyStats[month].endCash;
  }

  // 8. 生成报告
  const finalCash = cash;
  const totalProfit = Math.round((finalCash - 1000) * 100) / 100;
  const winRate = totalBets > 0 ? Math.round(winBets / totalBets * 10000) / 100 : 0;
  const avgOdds = betLog.length > 0 ? Math.round(betLog.reduce((s, b) => s + b.odds, 0) / betLog.length * 100) / 100 : 0;

  // 最大单笔盈利/亏损
  const maxWin = betLog.length > 0 ? betLog.reduce((max, b) => b.profit > max.profit ? b : max, betLog[0]) : null;
  const maxLoss = betLog.length > 0 ? betLog.reduce((min, b) => b.profit < min.profit ? b : min, betLog[0]) : null;

  // 关键转折点: 资金首次突破各整数关口
  const milestones = [];
  const thresholds = [1500, 2000, 3000, 5000, 8000, 10000];
  for (const t of thresholds) {
    const m = betLog.find(b => b.newCash >= t);
    if (m) milestones.push({ threshold: t, date: m.date, match: `${m.home} vs ${m.away}`, newCash: m.newCash });
  }

  // 逐月统计表
  const monthRows = sortedMonths.map(m => {
    const s = monthlyStats[m];
    return `| ${m} | ${s.bets} | ${s.wins} | ${s.winRate} | ${s.profit > 0 ? '+' : ''}${s.profit} | ${s.startCash} | ${s.endCash} |`;
  }).join('\n');

  // 战例分析
  const top5Wins = betLog.filter(b => b.result === 'W').sort((a, b) => b.profit - a.profit).slice(0, 5);
  const top5Losses = betLog.filter(b => b.result === 'L').sort((a, b) => a.profit - b.profit).slice(0, 5);

  // 陷阱反买统计
  const trapBets = betLog.filter(b => b.trapVerdict !== 'safe');
  const trapWins = trapBets.filter(b => b.result === 'W');
  const trapWinRate = trapBets.length > 0 ? Math.round(trapBets.filter(b => b.result === 'W').length / trapBets.length * 10000) / 100 : 0;

  const report = `# 重锤策略 1000→10000 完整回测报告

> 回测范围: 2026-01-01 至 2026-08-25 (${all.length}场)
> 执行时间: ${new Date().toISOString().slice(0, 10)}

---

## 筛选漏斗

| 阶段 | 场次 | 保留率 |
|------|------|--------|
| 总场次 | ${funnel.total} | 100% |
| 稳定联赛(英超/西甲/意甲/德甲/法甲/欧冠/英冠) | ${funnel.leaguePass} | ${(funnel.leaguePass/funnel.total*100).toFixed(1)}% |
| + 赔率窗口1.60-2.00 | ${funnel.oddsPass} | ${(funnel.oddsPass/funnel.total*100).toFixed(1)}% |
| + 变盘<5次 | ${funnel.changesPass} | ${(funnel.changesPass/funnel.total*100).toFixed(1)}% |
| + 8维评分≥65/80 | ${funnel.scored65} | ${(funnel.scored65/funnel.total*100).toFixed(1)}% |
| **最终投注场次** | **${totalBets}** | **${(totalBets/funnel.total*100).toFixed(2)}%** |

> 平均每 ${totalBets > 0 ? Math.round(244/totalBets) : 'N/A'} 天投一注

---

## 资金曲线

| 指标 | 数值 |
|------|------|
| 起始资金 | ¥1000 |
| 最终资金 | ¥${finalCash.toFixed(2)} |
| 总盈亏 | ${totalProfit >= 0 ? '+' : ''}¥${totalProfit.toFixed(2)} |
| 收益率 | ${totalProfit >= 0 ? '+' : ''}${(totalProfit/1000*100).toFixed(2)}% |
| 峰值资金 | ¥${peakCash.toFixed(2)} |
| 最大回撤 | ${maxDrawdown}% |
| 总注数 | ${totalBets} |
| 命中数 | ${winBets} |
| 胜率 | ${winRate}% |
| 平均赔率 | ${avgOdds} |
| 最长连赢 | ${maxConsecutiveWins} 单 |
| 最长连输 | ${maxConsecutiveLosses} 单 |

---

## 逐月统计

| 月份 | 注数 | 命中 | 胜率 | 盈亏 | 期初现金 | 期末现金 |
|------|------|------|------|------|---------|---------|
${monthRows}

---

## 关键战例

### 最大单笔盈利 TOP5

| 日期 | 联赛 | 场次 | 方向 | 赔率 | 金额 | 评分 | 盈利 |
|------|------|------|------|------|------|------|------|
${top5Wins.map(b => `| ${b.date} | ${b.league} | ${b.home} vs ${b.away} | ${b.pick} | ${b.odds} | ¥${b.stake} | ${b.totalScore} | +¥${b.profit} |`).join('\n')}

### 最大单笔亏损 TOP5

| 日期 | 联赛 | 场次 | 方向 | 赔率 | 金额 | 评分 | 亏损 |
|------|------|------|------|------|------|------|------|
${top5Losses.map(b => `| ${b.date} | ${b.league} | ${b.home} vs ${b.away} | ${b.pick} | ${b.odds} | ¥${b.stake} | ${b.totalScore} | -¥${Math.abs(b.profit)} |`).join('\n')}

### 关键转折点

| 关口 | 日期 | 场次 | 资金 |
|------|------|------|------|
${milestones.length > 0 ? milestones.map(m => `| ¥${m.threshold} | ${m.date} | ${m.match} | ¥${m.newCash.toFixed(2)} |`).join('\n') : '| 未突破任何关口 | - | - | - |'}

---

## 盘口陷阱分析

| 指标 | 数值 |
|------|------|
| 陷阱标记场次 | ${trapBets.length} |
| 陷阱场次命中 | ${trapWins.length} |
| 陷阱场次胜率 | ${trapWinRate}% |
| 整体胜率 | ${winRate}% |

${
  trapBets.length > 0
? `### 陷阱信号分布

${['trap_high','trap_medium','trap_low'].map(v => {
  const g = trapBets.filter(b => b.trapVerdict === v);
  const gw = g.filter(b => b.result === 'W');
  return `- **${v}**: ${g.length}场, 胜${gw.length}场 (${g.length>0?(gw.length/g.length*100).toFixed(1):'N/A'}%)`;
}).join('\n')}`
: ''
}

---

## 资金管理执行

| 现金区间 | 标准单笔上限 | 实际执行 |
|----------|-------------|----------|
| 500~1000 | 5% | 实际平均 ${betLog.filter(b => b.newCash < 1000).length > 0 ? Math.round(betLog.filter(b => b.newCash < 1000).reduce((s,b) => s + b.betRate, 0) / betLog.filter(b => b.newCash < 1000).length * 100) / 100 : 'N/A'}% |
| 1000~3000 | 8% | 实际平均 ${betLog.filter(b => b.newCash >= 1000 && b.newCash < 3000).length > 0 ? Math.round(betLog.filter(b => b.newCash >= 1000 && b.newCash < 3000).reduce((s,b) => s + b.betRate, 0) / betLog.filter(b => b.newCash >= 1000 && b.newCash < 3000).length * 100) / 100 : 'N/A'}% |
| 3000~5000 | 10% | 实际平均 ${betLog.filter(b => b.newCash >= 3000 && b.newCash < 5000).length > 0 ? Math.round(betLog.filter(b => b.newCash >= 3000 && b.newCash < 5000).reduce((s,b) => s + b.betRate, 0) / betLog.filter(b => b.newCash >= 3000 && b.newCash < 5000).length * 100) / 100 : 'N/A'}% |
| 5000~10000 | 12% | 实际平均 ${betLog.filter(b => b.newCash >= 5000).length > 0 ? Math.round(betLog.filter(b => b.newCash >= 5000).reduce((s,b) => s + b.betRate, 0) / betLog.filter(b => b.newCash >= 5000).length * 100) / 100 : 'N/A'}% |

---

## 对比前两次迭代

| 指标 | 2串1均注 | 单场v2 | 重锤策略 |
|------|---------|--------|---------|
| 最终资金 | 80~409元 | 725元 | ¥${finalCash.toFixed(2)} |
| 胜率 | 16~22% | 53.51% | ${winRate}% |
| 最大回撤 | 90% | 36.43% | ${maxDrawdown}% |
| 注数 | 191~211 | 114 | ${totalBets} |
| 平均赔率 | ~2.5 | ~1.70 | ${avgOdds} |
| 结论 | 负EV | 负EV | ${totalProfit > 0 ? '✅ 正EV' : '❌ 负EV'} |

---

## 是否达到10000？

${
  finalCash >= 10000
? `**✅ 达到目标！** 从 ¥1000 到 ¥${finalCash.toFixed(2)}，` +
  `收益率 +${totalProfit.toFixed(2)}%`
: `**❌ 未达到目标。** 最终资金 ¥${finalCash.toFixed(2)}，` +
  `目标 ¥10000，还差 ¥${(10000 - finalCash).toFixed(2)}。`
}

### 瓶颈分析

${
  (() => {
    const issues = [];
    if (totalBets < 20) issues.push(`- **投注场次太少** (${totalBets}注)：重锤策略过于保守，平均每${Math.round(244/totalBets)}天投一注，样本量不足以产生稳定收益。`);
    if (winRate < 60) issues.push(`- **胜率不足** (${winRate}%)：目标60%+才能显著转正，当前${winRate}%在${avgOdds}平均赔率下仍为负EV。`);
    if (avgOdds < 2.0) issues.push(`- **平均赔率偏低** (${avgOdds})：目标2.0+，当前赔率导致即使60%胜率也仅小幅盈利。`);
    if (maxDrawdown > 30) issues.push(`- **回撤过大** (${maxDrawdown}%)：需要更好的止损机制。`);
    if (maxConsecutiveLosses >= 4) issues.push(`- **连输过长** (${maxConsecutiveLosses}单)：需要更严格的冷却机制。`);
    if (issues.length === 0) issues.push('- 策略表现良好，但需要更多数据验证。');
    return issues.join('\n');
  })()
}

### 下一次迭代建议

1. **放宽变盘限制**：变盘<5过于严格，可尝试<8（单场v2已验证变盘3-7次表现最佳）
2. **降低评分门槛**：65/80过高，降至55-60可增加样本次数，验证是否仍保持高胜率
3. **加入2/3原则**：允许在评分不足时小额试水，而非全部空仓
4. **联赛扩展**：验证英冠、德乙、葡超等次顶级联赛的可靠性
5. **动态评分**：根据近期表现动态调整联赛权重，而非固定分数
6. **盘口陷阱反买**：系统化识别陷阱后反向投注，而非仅规避

---

## 完整投注记录

${betLog.map(b => {
  const emoji = b.result === 'W' ? '✅' : '❌';
  return `${emoji} ${b.date} | ${b.league} | ${b.home} ${b.score} ${b.away} | ${b.pick}@${b.odds} | 评分${b.totalScore} | 变盘${b.oddsChanges}次 | 投¥${b.stake} | ${b.result === 'W' ? '+' : ''}¥${b.profit} | 现金¥${b.newCash}`;
}).join('\n')}
`;

  const outFile = join(ROOT, 'data', 'backtest', 'heavy_bet_10000_report.md');
  writeFileSync(outFile, report, 'utf8');
  console.log(`\n报告已写入: ${outFile}`);

  // 输出核心结论
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  核心结论`);
  console.log(`═══════════════════════════════════════════`);
  console.log(`  起始: ¥1000 → 最终: ¥${finalCash.toFixed(2)}`);
  console.log(`  总盈亏: ${totalProfit >= 0 ? '+' : ''}¥${totalProfit.toFixed(2)} (${totalProfit >= 0 ? '+' : ''}${(totalProfit/1000*100).toFixed(2)}%)`);
  console.log(`  注数: ${totalBets} | 命中: ${winBets} (${winRate}%)`);
  console.log(`  平均赔率: ${avgOdds} | 最大回撤: ${maxDrawdown}%`);
  console.log(`  峰值: ¥${peakCash.toFixed(2)}`);
  console.log(`  最长连赢: ${maxConsecutiveWins} | 最长连输: ${maxConsecutiveLosses}`);
  console.log(`  目标10000: ${finalCash >= 10000 ? '✅ 达到' : '❌ 未达到'}`);
  console.log(`═══════════════════════════════════════════`);
}

main().catch(e => console.error(e));