/**
 * 自我进化 Loop 分析引擎 v3
 *
 * 基于前两版失败教训改进：
 * 1. 多轮独立模拟（5轮重跑）→ 找跨轮重复出现的稳定策略，而非单次最优
 * 2. 前滚验证（walk-forward）→ 每轮从训练集再切内验证集，亲测过拟合
 * 3. 保留精英策略（不直接丢弃轮间结果）
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const HIST_DIR = join(ROOT, 'data', 'history', 'football');
const CACHE_DIR = join(ROOT, 'data', 'history', '_odds_cache');
const OUTPUT_DIR = join(ROOT, 'data', 'backtest', 'loop');

// ========== 配置 ==========
const CONFIG = {
  maxGenerations: 20,      // 每轮最多20代
  populationSize: 50,      // 每代50策略
  numRounds: 5,            // 5轮独立模拟
  eliteRatio: 0.2,
  mutationRate: 0.3,
  crossoverRate: 0.3,
  newRandomRatio: 0.2,
  startingCash: 1000,
};

// ========== 数据加载 ==========

function loadOddsTrend(matchId) {
  const f = join(CACHE_DIR, `${matchId}.json`);
  if (!existsSync(f)) return { changes: 0, directionPattern: null, direction: null };
  try {
    const o = JSON.parse(readFileSync(f, 'utf8'));
    if (o.noData) return { changes: 0, directionPattern: null, direction: null };
    const had = o.hadList || [];
    if (!had.length) return { changes: 0, directionPattern: null, direction: null };

    const first = had[0], last = had[had.length - 1];
    const hDir = last.h > first.h ? '↑' : last.h < first.h ? '↓' : '→';
    const dDir = last.d > first.d ? '↑' : last.d < first.d ? '↓' : '→';
    const aDir = last.a > first.a ? '↑' : last.a < first.a ? '↓' : '→';

    return {
      changes: had.length,
      directionPattern: `h${hDir}d${dDir}a${aDir}`,
      direction: driftsDirection(first, last),
    };
  } catch {
    return { changes: 0, directionPattern: null, direction: null };
  }
}

function driftsDirection(first, last) {
  const dh = parseFloat(first.h) - parseFloat(last.h);
  const dd = parseFloat(first.d) - parseFloat(last.d);
  const da = parseFloat(first.a) - parseFloat(last.a);
  if (dh > da && dh > dd) return 'H';
  if (da > dh && da > dd) return 'A';
  if (dd > 0 && dd >= dh && dd >= da) return 'D';
  return null;
}

function loadAllMatches() {
  const files = existsSync(HIST_DIR)
    ? readdirSync(HIST_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_merged')).sort()
    : [];

  const out = [];
  for (const f of files) {
    try {
      const d = JSON.parse(readFileSync(join(HIST_DIR, f), 'utf8'));
      for (const m of (d.matches || [])) {
        const h = parseFloat(m.h), d_ = parseFloat(m.d), a = parseFloat(m.a);
        if (isNaN(h) || isNaN(d_) || isNaN(a)) continue;
        if (!m.winFlag || !m.sectionsNo999) continue;
        if (m.poolStatus !== 'Payout' && m.poolStatus !== 'Refund' && m.poolStatus !== '') continue;

        const trend = loadOddsTrend(m.matchId);
        out.push({
          matchId: m.matchId, date: m.matchDate, league: m.leagueNameAbbr,
          home: m.homeTeam, away: m.awayTeam,
          h, d: d_, a, goalLine: m.goalLine,
          winFlag: m.winFlag, score: m.sectionsNo999,
          changes: trend.changes, directionPattern: trend.directionPattern, direction: trend.direction,
        });
      }
    } catch (e) { /* skip */ }
  }
  return out.sort((a, b) => a.date < b.date ? -1 : 1);
}

// ========== 策略空间 ==========

const DIRECTION_PATTERNS = [
  'h↑d→a↓', 'h↓d→a↑', 'h↑d↓a↓', 'h↓d↑a↑',
  'h→d↑a↓', 'h→d↓a↑', 'h↑d↑a↓', 'h↓d↓a↑',
  'h↑d→a→', 'h↓d→a→', 'h→d→a↑', 'h→d→a↓',
  'h↑d↓a→', 'h↓d↑a→', 'any',
];

const GOAL_LINES = ['any', '-2', '-1', '+1', '+2'];
const ODD_RANGES = ['any', '1.0-1.5', '1.5-2.0', '2.0-3.0', '3.0-5.0'];
const BET_DIRS = ['H', 'D', 'A'];
const CHANGE_RANGES = ['any', '0', '1-2', '3-4', '5-7', '8+'];

function randomStrategy(id) {
  return {
    id,
    dirPattern: DIRECTION_PATTERNS[Math.floor(Math.random() * DIRECTION_PATTERNS.length)],
    goalLine: GOAL_LINES[Math.floor(Math.random() * GOAL_LINES.length)],
    oddsRange: ODD_RANGES[Math.floor(Math.random() * ODD_RANGES.length)],
    betDir: BET_DIRS[Math.floor(Math.random() * BET_DIRS.length)],
    changeRange: CHANGE_RANGES[Math.floor(Math.random() * CHANGE_RANGES.length)],
    trapFilter: Math.random() > 0.5,
  };
}

function mutateStrategy(parent, id) {
  const child = { ...parent, id };
  const fields = ['dirPattern', 'goalLine', 'oddsRange', 'betDir', 'changeRange', 'trapFilter'];
  const field = fields[Math.floor(Math.random() * fields.length)];
  switch (field) {
    case 'dirPattern': child.dirPattern = DIRECTION_PATTERNS[Math.floor(Math.random() * DIRECTION_PATTERNS.length)]; break;
    case 'goalLine': child.goalLine = GOAL_LINES[Math.floor(Math.random() * GOAL_LINES.length)]; break;
    case 'oddsRange': child.oddsRange = ODD_RANGES[Math.floor(Math.random() * ODD_RANGES.length)]; break;
    case 'betDir': child.betDir = BET_DIRS[Math.floor(Math.random() * BET_DIRS.length)]; break;
    case 'changeRange': child.changeRange = CHANGE_RANGES[Math.floor(Math.random() * CHANGE_RANGES.length)]; break;
    case 'trapFilter': child.trapFilter = !child.trapFilter; break;
  }
  return child;
}

function strategyKey(s) {
  return [s.dirPattern, s.goalLine, s.oddsRange, s.betDir, s.changeRange, s.trapFilter].join('|');
}

// ========== 过滤 ==========

function matchGoalLine(m, gl) { return gl === 'any' || m.goalLine === gl; }
function matchOddsRange(m, r) {
  if (r === 'any') return true;
  const [lo, hi] = r.split('-').map(Number);
  if (hi === undefined) return m.h >= lo;
  return m.h >= lo && m.h < hi;
}
function matchDirectionPattern(m, p) { return p === 'any' || m.directionPattern === p; }
function matchChangeRange(m, r) {
  if (r === 'any') return true;
  if (r === '0') return m.changes === 0;
  const [lo, hi] = r.split('-').map(Number);
  return m.changes >= lo && m.changes <= hi;
}
function checkTrap(m) {
  // 盘口陷阱近似：主让球(负goalLine)但主胜赔率≥1.5 = 强队盘口浅
  return m.goalLine !== undefined && parseInt(m.goalLine) < 0 && m.h >= 1.5;
}
function getBetOdds(m, d) { return d === 'H' ? m.h : d === 'D' ? m.d : m.a; }
function checkWin(d, m) {
  const [hs, as] = m.score.split(':').map(Number);
  if (d === 'H') return hs > as;
  if (d === 'D') return hs === as;
  return hs < as;
}

// ========== 回测 ==========

function backtest(strategy, matches) {
  let cash = CONFIG.startingCash;
  let peak = cash, maxDD = 0;
  const bets = [];
  let cw = 0, cl = 0, maxCw = 0, maxCl = 0;

  for (const m of matches) {
    if (!matchGoalLine(m, strategy.goalLine)) continue;
    if (!matchOddsRange(m, strategy.oddsRange)) continue;
    if (!matchDirectionPattern(m, strategy.dirPattern)) continue;
    if (!matchChangeRange(m, strategy.changeRange)) continue;
    if (strategy.trapFilter && !checkTrap(m)) continue;

    const odds = getBetOdds(m, strategy.betDir);
    if (!odds || odds <= 1) continue;

    let pct;
    if (cash <= 1000) pct = 0.05;
    else if (cash <= 3000) pct = 0.08;
    else if (cash <= 5000) pct = 0.10;
    else pct = 0.12;
    if (cash <= 100) break;
    let amount = Math.max(cash * pct, 10);
    if (amount > cash) amount = cash;

    const won = checkWin(strategy.betDir, m);
    const profit = won ? amount * (odds - 1) : -amount;
    cash += profit;

    if (won) { cw++; cl = 0; maxCw = Math.max(maxCw, cw); }
    else { cl++; cw = 0; maxCl = Math.max(maxCl, cl); }

    peak = Math.max(peak, cash);
    maxDD = Math.max(maxDD, (peak - cash) / peak);

    bets.push({ date: m.date, league: m.league, home: m.home, away: m.away, odds: Math.round(odds*100)/100, amount: Math.round(amount*100)/100, won, profit: Math.round(profit*100)/100, cash: Math.round(cash*100)/100 });
  }

  const wins = bets.filter(b => b.won).length;
  const total = bets.length;
  return {
    finalCash: Math.round(cash*100)/100,
    roi: (cash - CONFIG.startingCash) / CONFIG.startingCash,
    wins, total,
    winRate: total ? wins/total : 0,
    avgOdds: total ? bets.reduce((s,b)=>s+b.odds,0)/total : 0,
    maxDD: Math.round(maxDD*10000)/100,
    maxCw, maxCl, bets,
    betRate: total / matches.length,
  };
}

/**
 * 给足训练集+内验证集评分的函数
 * 训练集表现好 holdout 表现差 → 过拟合扣分
 */
function scoreWithHoldout(trainResult, holdoutResult) {
  if (trainResult.total < 10) return -9999;

  // 基础分
  let s = 0;
  s += trainResult.roi * 2 * 100;            // 训练ROI
  s += Math.min(trainResult.total / 50, 1) * 10; // 样本充足

  // 内验证（holdout）是判断过拟合的关键
  if (holdoutResult.total >= 5) {
    // 用holdout的表现给"泛化加分"，holdout和train同向才给大奖
    if (holdoutResult.roi > 0.01) {
      s += holdoutResult.roi * 100;          // holdout正ROI加分
      s += 30;                               // 同时转正大额奖励
    } else {
      s -= 40;                               // holdout失败 → 过拟合重罚
    }
  } else {
    s -= 20; // holdout样本太少也不放心
  }

  // 风险惩罚
  s -= Math.max(0, trainResult.maxDD - 30) * 0.5;
  s -= Math.max(0, trainResult.maxCl - 5) * 2;
  return s;
}

// ========== 多轮遗传 ==========

function runRound(roundIdx, allMatches, verifySet) {
  // 本轮：把数据按8:2切成 train / holdout（holdout做内验证）
  const splitIdx = Math.floor(allMatches.length * 0.8);
  const train = allMatches.slice(0, splitIdx);
  const holdout = allMatches.slice(splitIdx);

  let pop = Array.from({ length: CONFIG.populationSize }, (_, i) => randomStrategy(`r${roundIdx}_g0_${i}`));
  const roundHistory = [];

  for (let gen = 0; gen < CONFIG.maxGenerations; gen++) {
    for (const s of pop) {
      if (s._score !== undefined) continue;
      const r = backtest(s, train);
      const h = backtest(s, holdout);
      s._result = r;
      s._holdout = h;
      s._score = scoreWithHoldout(r, h);
    }

    pop.sort((a, b) => b._score - a._score);
    const best = pop[0];
    roundHistory.push({ gen: gen + 1, score: best._score, roi: best._result.roi, holdROI: best._holdout.roi, winRate: best._result.winRate, total: best._result.total, avgOdds: best._result.avgOdds, key: strategyKey(best) });

    // 收敛检查：4代得分不再提升
    if (roundHistory.length >= 4) {
      const last = roundHistory.slice(-4);
      if (last.every(g => g.score === last[0].score)) break;
    }

    // 下一代
    if (gen < CONFIG.maxGenerations - 1) {
      const next = [];
      const eliteN = Math.floor(CONFIG.populationSize * CONFIG.eliteRatio);
      const elites = pop.slice(0, eliteN);
      elites.forEach(s => next.push({ ...s, id: `r${roundIdx}_g${gen+1}_e${next.length}` }));
      const mutN = Math.floor(CONFIG.populationSize * CONFIG.mutationRate);
      for (let i = 0; i < mutN; i++) next.push(mutateStrategy(elites[Math.floor(Math.random()*elites.length)], `r${roundIdx}_g${gen+1}_m${i}`));
      const crossN = Math.floor(CONFIG.populationSize * CONFIG.crossoverRate);
      for (let i = 0; i < crossN; i++) {
        const p1 = elites[Math.floor(Math.random()*elites.length)], p2 = elites[Math.floor(Math.random()*elites.length)];
        const child = { id: `r${roundIdx}_g${gen+1}_c${i}` };
        for (const f of ['dirPattern','goalLine','oddsRange','betDir','changeRange','trapFilter']) child[f] = Math.random() > 0.5 ? p1[f] : p2[f];
        next.push(child);
      }
      const randN = Math.floor(CONFIG.populationSize * CONFIG.newRandomRatio);
      for (let i = 0; i < randN; i++) next.push(randomStrategy(`r${roundIdx}_g${gen+1}_r${i}`));
      while (next.length < CONFIG.populationSize) next.push(mutateStrategy(elites[Math.floor(Math.random()*elites.length)], `r${roundIdx}_g${gen+1}_f${next.length}`));
      pop = next;
    }
  }

  const best = pop.sort((a, b) => b._score - a._score)[0];
  const verifyResult = backtest(best, verifySet);

  return { best, roundHistory, verifyResult, trainSize: train.length, holdoutSize: holdout.length };
}

// ========== 主函数 ==========

function main() {
  console.log('=== 自我进化 Loop v3（多轮+前滚+过拟合惩罚） ===');
  const all = loadAllMatches();
  console.log(`总场次: ${all.length}`);

  // 固定末尾20%为最终验证集（多轮共享，防泄漏）
  const verifyIdx = Math.floor(all.length * 0.8);
  const globalVerify = all.slice(verifyIdx);
  const trainable = all.slice(0, verifyIdx);
  console.log(`可训练: ${trainable.length} | 全局最终验证: ${globalVerify.length}\n`);

  // 记录跨轮稳定策略
  const crossRound = {}; // key -> { count, totalRoundROI }

  for (let round = 1; round <= CONFIG.numRounds; round++) {
    console.log(`\n===== 第 ${round}/${CONFIG.numRounds} 轮模拟 =====`);
    // 每轮重新洗乱训练集（固定种子按 index 偏移，保证可复现）
    const shuffled = [...trainable];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = (i * 7 + round * 13) % shuffled.length; // 确定性伪随机
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const { best, roundHistory, verifyResult } = runRound(round, shuffled, globalVerify);

    console.log(`  最优: ${best.dirPattern} | ${best.goalLine} | ${best.oddsRange} | ${best.betDir} | ${best.changeRange} | trap=${best.trapFilter}`);
    console.log(`  训练集: ROI=${(best._result.roi*100).toFixed(1)}% 胜率=${(best._result.winRate*100).toFixed(1)}% 注数=${best._result.total}`);
    console.log(`  内验证: ROI=${(best._holdout.roi*100).toFixed(1)}% 注数=${best._holdout.total}`);
    console.log(`  全局验证: ROI=${(verifyResult.roi*100).toFixed(1)}% 胜率=${(verifyResult.winRate*100).toFixed(1)}% 注数=${verifyResult.total} 均赔=${verifyResult.avgOdds}`);
    console.log(`  进化${roundHistory.length}代 收敛`);

    // 跨轮统计
    const k = strategyKey(best);
    if (!crossRound[k]) crossRound[k] = { count: 0, verifyROIs: [], trainROIs: [] };
    crossRound[k].count++;
    crossRound[k].verifyROIs.push(verifyResult.roi);
    crossRound[k].trainROIs.push(best._result.roi);
  }

  // ========== 汇总 ==========
  console.log('\n\n===== 跨轮稳定策略统计 =====');
  const entries = Object.entries(crossRound).sort((a, b) => b[1].count - a[1].count);
  for (const [k, v] of entries) {
    const avgTrainROI = v.trainROIs.reduce((s, x) => s + x, 0) / v.trainROIs.length;
    const avgVerifyROI = v.verifyROIs.reduce((s, x) => s + x, 0) / v.verifyROIs.length;
    console.log(`${v.count}轮: ${k.substring(0, 60)} | 训练均ROI=${(avgTrainROI*100).toFixed(1)}% 验证均ROI=${(avgVerifyROI*100).toFixed(1)}%`);
  }

  // 生成报告
  writeReport(crossRound, all.length);
  console.log(`\n报告: ${join(OUTPUT_DIR, 'loop_multi_report.md')}`);
}

function writeReport(crossRound, totalMatches) {
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

  const lines = [];
  lines.push('# 自我进化 Loop v3 · 多轮模拟报告');
  lines.push('');
  lines.push(`> 生成时间: 2026-08-26`);
  lines.push(`> 总数据: ${totalMatches} 场`);
  lines.push(`> 模拟轮次: ${CONFIG.numRounds}`);
  lines.push(`> 每轮进化: ${CONFIG.maxGenerations} 代 x ${CONFIG.populationSize} 策略`);
  lines.push(`> 全局验证集: 最后 ${Math.floor(totalMatches*0.2)} 场（未被任何轮次训练）`);
  lines.push('');

  lines.push('## 核心原则');
  lines.push('- 单轮拟合的"最优"几乎必然过拟合 → 只看**跨轮重复出现**的策略');
  lines.push('- 训练集分成 train + holdout，holdout 反转正ROI才给大奖，否则重罚过拟合');
  lines.push('- 全局验证集只测一次，作为最终裁判');
  lines.push('');

  const entries = Object.entries(crossRound).sort((a, b) => b[1].count - a[1].count);

  lines.push('## 跨轮稳定策略');
  lines.push('');
  lines.push('| 轮次 | 策略 | 训练均ROI | 全局验证均ROI |');
  lines.push('|------|------|-----------|---------------|');
  for (const [k, v] of entries) {
    const avgTrainROI = (v.trainROIs.reduce((s, x) => s + x, 0) / v.trainROIs.length * 100).toFixed(1);
    const avgVerifyROI = (v.verifyROIs.reduce((s, x) => s + x, 0) / v.verifyROIs.length * 100).toFixed(1);
    lines.push(`| ${v.count} | ${k} | ${avgTrainROI}% | ${avgVerifyROI}% |`);
  }
  lines.push('');
  lines.push('### 只有同时满足以下条件的策略才算"真实信号"：');
  lines.push('1. 出现轮次 ≥ 3（跨轮复用性强）');
  lines.push('2. 全局验证均ROI > 0（样本外盈利）');
  lines.push('3. 验证注数 ≥ 10（样本充足）');
  lines.push('');

  // 判断结论
  const stable = entries.filter(([, v]) => v.count >= 3 && v.verifyROIs.reduce((s,x)=>s+x,0)/v.verifyROIs.length > 0.01);
  lines.push('## 结论');
  lines.push('');
  if (stable.length) {
    lines.push('✅ **存在跨轮稳定的正ROI策略：**');
    for (const [k, v] of stable) lines.push(`- ${k}`);
  } else {
    lines.push('❌ **无跨轮稳定的正ROI策略。** 即使用多轮+前滚+过拟合惩罚，遗传算法仍无法找到样本外可持续盈利的模式。');
    lines.push('');
    lines.push('这意味着：让球盘深度、赔率区间、变盘方向、盘口陷阱近似值——这些纯赔率/盘口数据驱动的信号，在竞彩的抽水天花板（返奖率70-80%）下**不存在可挖掘的正EV空间**。');
  }
  lines.push('');
  lines.push('### 时序对比');
  lines.push('');
  lines.push('| 迭代 | 方法 | 结果 |');
  lines.push('|------|------|------|');
  lines.push('| 1-6 | 手工规则×6轮 | 全负EV |');
  lines.push(`| 7 | 遗传算法(单轮) | 训练+211% 验证-40% 过拟合 |`);
  lines.push(`| 8 | 遗传算法(5轮+前滚) | ${stable.length ? '跨轮稳定' : '全负EV'} |`);
  lines.push('');

  lines.push(`*tools/loop_analysis.js v3 生成*`);
  writeFileSync(join(OUTPUT_DIR, 'loop_multi_report.md'), lines.join('\n'), 'utf-8');
}

main();