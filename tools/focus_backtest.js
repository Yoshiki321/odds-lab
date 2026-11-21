/**
 * 全面对比回测 — HAD_H(主胜) vs HAD_D(平局) vs HAD_A(客胜)
 *
 * 从暴力扫描中挑选各方向最强信号，用完整资金管理
 * 验证：到底是高EV更重要，还是高胜率（低波动）更重要？
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const HIST_DIR = join(ROOT, 'data', 'history', 'football');
const CACHE_DIR = join(ROOT, 'data', 'history', '_odds_cache');
const OUTPUT_DIR = join(ROOT, 'data', 'backtest', 'loop');

const TOP5 = ['英超','西甲','德甲','意甲','法甲','欧冠','欧罗巴'];
const SECOND = ['英冠','德乙','法乙','葡超','荷甲','巴甲','美职'];

function loadCache(fp) {
  try { return JSON.parse(readFileSync(fp, 'utf8')); } catch { return null; }
}

function loadAll() {
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

        const cache = loadCache(join(CACHE_DIR, `${m.matchId}.json`));
        if (!cache) continue;
        const had = cache.oddsHistory?.hadList || [];
        if (!had.length) continue;
        const first = had[0], last = had[had.length - 1];

        const hDir = last.h > first.h ? '↑' : last.h < first.h ? '↓' : '→';
        const dDir = last.d > first.d ? '↑' : last.d < first.d ? '↓' : '→';
        const aDir = last.a > first.a ? '↑' : last.a < first.a ? '↓' : '→';

        const hadResult = cache.matchResultList?.find(r => r.code === 'HAD');

        out.push({
          matchId: m.matchId, date: m.matchDate, league: m.leagueNameAbbr,
          home: m.homeTeam, away: m.awayTeam, score: m.sectionsNo999,
          h: parseFloat(last.h), d: parseFloat(last.d), a: parseFloat(last.a),
          changes: had.length, dirPattern: `h${hDir}d${dDir}a${aDir}`,
          hWin: hadResult?.combination === 'H',
          dWin: hadResult?.combination === 'D',
          aWin: hadResult?.combination === 'A',
        });
      }
    } catch (e) { /* skip */ }
  }
  return out.sort((a, b) => a.date < b.date ? -1 : 1);
}

// ========== 策略定义 ==========

const STRATEGIES = {};

// 主胜方向（HAD_H）
STRATEGIES.H_H_赔率降 = {
  desc: 'HAD-H 主胜赔率降(看好)',
  oddsKey: 'h', winKey: 'hWin',
  check: (m) => m.dirPattern === 'h↓d→a→' || m.dirPattern === 'h↓d↓a↑' || m.dirPattern === 'h↓d→a↑',
};
STRATEGIES.H_H_变盘3_4 = {
  desc: 'HAD-H 变盘3-4次',
  oddsKey: 'h', winKey: 'hWin',
  check: (m) => m.changes >= 3 && m.changes <= 4,
};
STRATEGIES.H_H_其他联赛 = {
  desc: 'HAD-H 其他联赛(非五大非次级)',
  oddsKey: 'h', winKey: 'hWin',
  check: (m) => !TOP5.includes(m.league) && !SECOND.includes(m.league),
};
STRATEGIES.H_H_赔率1_5_1_7 = {
  desc: 'HAD-H 赔率1.5-1.7',
  oddsKey: 'h', winKey: 'hWin',
  check: (m) => m.h >= 1.5 && m.h < 1.7,
};
STRATEGIES.H_H_赔率1_7_2_0 = {
  desc: 'HAD-H 赔率1.7-2.0',
  oddsKey: 'h', winKey: 'hWin',
  check: (m) => m.h >= 1.7 && m.h < 2.0,
};
STRATEGIES.H_H_赔率降变盘3_4 = {
  desc: 'HAD-H 赔率降+变盘3-4次',
  oddsKey: 'h', winKey: 'hWin',
  check: (m) => (m.dirPattern === 'h↓d→a→' || m.dirPattern === 'h↓d↓a↑' || m.dirPattern === 'h↓d→a↑') && m.changes >= 3 && m.changes <= 4,
};
STRATEGIES.H_H_赔率降变盘5_7 = {
  desc: 'HAD-H 赔率降+变盘5-7次',
  oddsKey: 'h', winKey: 'hWin',
  check: (m) => (m.dirPattern === 'h↓d→a→' || m.dirPattern === 'h↓d↓a↑' || m.dirPattern === 'h↓d→a↑') && m.changes >= 5 && m.changes <= 7,
};

// 客胜方向（HAD_A）
STRATEGIES.H_A_变盘1_2 = {
  desc: 'HAD-A 变盘1-2次',
  oddsKey: 'a', winKey: 'aWin',
  check: (m) => m.changes >= 1 && m.changes <= 2,
};
STRATEGIES.H_A_降平升客 = {
  desc: 'HAD-A 方向h↓d↑a↓',
  oddsKey: 'a', winKey: 'aWin',
  check: (m) => m.dirPattern === 'h↓d↑a↓',
};
STRATEGIES.H_A_赔率5_0 = {
  desc: 'HAD-A 赔率5.0+',
  oddsKey: 'a', winKey: 'aWin',
  check: (m) => m.a >= 5.0,
};
STRATEGIES.H_A_赔率降5_0 = {
  desc: 'HAD-A 赔率5.0+客胜赔率降',
  oddsKey: 'a', winKey: 'aWin',
  check: (m) => m.a >= 5.0 && m.dirPattern === 'h→d→a↓',
};

// 平局方向（HAD_D）
STRATEGIES.H_D_变盘5_7 = {
  desc: 'HAD-D 变盘5-7次',
  oddsKey: 'd', winKey: 'dWin',
  check: (m) => m.changes >= 5 && m.changes <= 7,
};
STRATEGIES.H_D_次级联赛 = {
  desc: 'HAD-D 次级联赛',
  oddsKey: 'd', winKey: 'dWin',
  check: (m) => SECOND.includes(m.league),
};

// ========== 资金管理回测 ==========

function backtest(strat, matches) {
  let cash = 1000;
  let peak = cash;
  let maxDD = 0;
  let losses = 0, wins = 0;
  let curDate = null, dailyPnL = 0;

  const bets = [];
  const stagePcts = [0.05, 0.08, 0.10, 0.12];

  for (const m of matches) {
    const odds = m[strat.oddsKey];
    if (!odds || odds <= 1) continue;
    if (!strat.check(m)) continue;

    // 单日20%止损
    if (curDate !== m.date) { curDate = m.date; dailyPnL = 0; }
    if (dailyPnL <= -cash * 0.20) continue;

    // 阶段
    let tier = cash > 5000 ? 3 : cash > 3000 ? 2 : cash > 1000 ? 1 : 0;
    if (losses >= 2 && tier > 0) tier--;
    let pct = stagePcts[tier];
    let amount = Math.max(Math.round(cash * pct), 2);
    if (amount > cash) amount = cash;

    const won = m[strat.winKey];
    const profit = won ? amount * (odds - 1) : -amount;
    cash += profit;
    dailyPnL += profit;

    if (won) { wins++; losses = 0; } else { losses++; wins = 0; }
    peak = Math.max(peak, cash);
    maxDD = Math.max(maxDD, (peak - cash) / peak);

    bets.push({
      date: m.date, league: m.league, home: m.home, away: m.away, score: m.score,
      odds: Math.round(odds * 100) / 100,
      amount: Math.round(amount * 100) / 100,
      won, profit: Math.round(profit * 100) / 100,
      cash: Math.round(cash * 100) / 100,
    });

    if (cash <= 50) break;
    if (cash >= 10000) break;
  }

  const totalWins = bets.filter(b => b.won).length;
  const total = bets.length;
  return {
    bets, total, wins: totalWins,
    finalCash: Math.round(cash * 100) / 100,
    roi: (cash - 1000) / 1000,
    winRate: total ? totalWins / total : 0,
    avgOdds: total ? bets.reduce((s, b) => s + b.odds, 0) / total : 0,
    maxDD: Math.round(maxDD * 10000) / 100,
    maxCL: losses, // 回测结束时的连输
    reached: cash >= 10000,
  };
}

// ========== Walk-forward按月统计 ==========

function walkForward(strat, matches) {
  const months = {};
  for (const m of matches) {
    const mk = m.date.slice(0, 7);
    if (!months[mk]) months[mk] = [];
    months[mk].push(m);
  }
  const keys = Object.keys(months).sort();
  const results = [];
  for (const mk of keys) {
    const r = backtest(strat, months[mk]);
    results.push({ month: mk, bets: r.total, final: r.finalCash, profit: r.finalCash - 1000, winRate: r.winRate });
  }
  return results;
}

// ========== 主函数 ==========

function main() {
  console.log('=== 全面对比回测 ===\n');
  const all = loadAll();
  const splitIdx = Math.floor(all.length * 0.7);
  const train = all.slice(0, splitIdx);
  const test = all.slice(splitIdx);

  console.log('HAD_H(主胜) vs HAD_D(平局) vs HAD_A(客胜) 全面对比\n');

  const results = [];
  for (const [name, strat] of Object.entries(STRATEGIES)) {
    const full = backtest(strat, all);
    const trainR = backtest(strat, train);
    const testR = backtest(strat, test);
    // 按月统计
    const monthly = walkForward(strat, all);
    const monthsProfit = monthly.filter(m => m.profit > 0).length;
    const totalMonths = monthly.filter(m => m.bets > 0).length;

    results.push({ name, desc: strat.desc, full, train: trainR, test: testR, monthlyProfit: monthsProfit, totalMonths });

    const emoji = full.reached ? '✅' : full.roi > 0 ? '🟡' : '❌';
    console.log(`${emoji} ${name}: ${strat.desc}`);
    console.log(`  全量: ${full.total}注 胜率${(full.winRate*100).toFixed(1)}% 均赔${full.avgOdds.toFixed(2)} 资金¥${full.finalCash} ROI${(full.roi*100).toFixed(1)}% 回撤${full.maxDD}%`);
    console.log(`  训练@${full.total}注 → 测试: ROI${(testR.roi*100).toFixed(1)}%`);
    console.log(`  月度盈利: ${monthsProfit}/${totalMonths}个月`);
  }

  results.sort((a, b) => b.full.roi - a.full.roi);

  // 生成报告
  const lines = [];
  lines.push('# 全面对比回测 — HAD_H(主胜) vs HAD_D(平局) vs HAD_A(客胜)');
  lines.push('');
  lines.push(`> 数据: ${all.length}场 (2026-01-01 ~ 2026-08-25)`);
  lines.push(`> 资金: ¥1000起 | 管理: 阶段加注+连输降档+单日20%上限`);
  lines.push('');

  lines.push('## 全量回测对比');
  lines.push('');
  lines.push('| 排名 | 策略 | 方向 | 注数 | 胜率 | 均赔 | 资金 | ROI | 回撤 | 月度盈利 | 达标 |');
  lines.push('|------|------|------|------|------|------|------|-----|------|---------|------|');
  results.forEach((r, i) => {
    lines.push(`| ${i+1} | ${r.name} | ${r.desc} | ${r.full.total} | ${(r.full.winRate*100).toFixed(1)}% | ${r.full.avgOdds.toFixed(2)} | ¥${r.full.finalCash} | ${(r.full.roi*100).toFixed(1)}% | ${r.full.maxDD}% | ${r.monthlyProfit}/${r.totalMonths} | ${r.full.reached ? '✅' : '❌'} |`);
  });
  lines.push('');

  lines.push('## 训练/测试对比');
  lines.push('');
  lines.push('| 策略 | 训练注 | 训练ROI | 测试注 | 测试ROI | 稳定性判定 |');
  lines.push('|------|--------|---------|--------|---------|-----------|');
  for (const r of results) {
    const stable = r.train.roi > 0 && r.test.roi > 0 ? '✅ 双正' : r.train.roi > 0 ? '⚠️ 训练正测试负' : '❌ 双负';
    lines.push(`| ${r.name} | ${r.train.total} | ${(r.train.roi*100).toFixed(1)}% | ${r.test.total} | ${(r.test.roi*100).toFixed(1)}% | ${stable} |`);
  }
  lines.push('');

  // 各方向最佳策略
  const bestH = results.filter(r => r.name.startsWith('H_H')).sort((a,b) => b.full.roi - a.full.roi)[0];
  const bestA = results.filter(r => r.name.startsWith('H_A')).sort((a,b) => b.full.roi - a.full.roi)[0];
  const bestD = results.filter(r => r.name.startsWith('H_D')).sort((a,b) => b.full.roi - a.full.roi)[0];

  lines.push('## 各方向冠军');
  lines.push('');
  lines.push('| 方向 | 最佳策略 | 注数 | 胜率 | 均赔 | ROI | 最大回撤 |');
  lines.push('|------|---------|------|------|------|-----|---------|');
  if (bestH) lines.push(`| HAD-H(主胜) | ${bestH.desc} | ${bestH.full.total} | ${(bestH.full.winRate*100).toFixed(1)}% | ${bestH.full.avgOdds.toFixed(2)} | ${(bestH.full.roi*100).toFixed(1)}% | ${bestH.full.maxDD}% |`);
  if (bestA) lines.push(`| HAD-A(客胜) | ${bestA.desc} | ${bestA.full.total} | ${(bestA.full.winRate*100).toFixed(1)}% | ${bestA.full.avgOdds.toFixed(2)} | ${(bestA.full.roi*100).toFixed(1)}% | ${bestA.full.maxDD}% |`);
  if (bestD) lines.push(`| HAD-D(平局) | ${bestD.desc} | ${bestD.full.total} | ${(bestD.full.winRate*100).toFixed(1)}% | ${bestD.full.avgOdds.toFixed(2)} | ${(bestD.full.roi*100).toFixed(1)}% | ${bestD.full.maxDD}% |`);
  lines.push('');

  // 结论
  lines.push('## 结论');
  lines.push('');

  const reached = results.filter(r => r.full.reached);
  if (reached.length) {
    lines.push(`✅ **${reached.length}个策略全量回测达到¥10000！**`);
    lines.push('');
    for (const r of reached) {
      lines.push(`- **${r.name}** (${r.desc}): ¥1000→¥${r.full.finalCash}，${r.full.total}注，胜率${(r.full.winRate*100).toFixed(1)}%，最大回撤${r.full.maxDD}%`);
    }
  } else {
    const pos = results.filter(r => r.full.roi > 0);
    if (pos.length) {
      lines.push(`🟡 **${pos.length}个策略正ROI但未达¥10000**`);
      for (const r of pos) {
        lines.push(`- ${r.name} (${r.desc}): ROI${(r.full.roi*100).toFixed(1)}% 回撤${r.full.maxDD}%`);
      }
    } else {
      lines.push('❌ 无策略在完整资金管理下正ROI');
    }
  }
  lines.push('');

  // 最高胜率稳健策略
  const winRateSorted = results.filter(r => r.full.total >= 50).sort((a, b) => b.full.winRate - a.full.winRate);
  const bestStable = winRateSorted[0];
  if (bestStable) {
    lines.push(`### 最稳健策略（高胜率+大样本）`);
    lines.push(`**${bestStable.name}** (${bestStable.desc}):`);
    lines.push(`- 胜率${(bestStable.full.winRate*100).toFixed(1)}% × ${bestStable.full.total}注`);
    lines.push(`- ROI${(bestStable.full.roi*100).toFixed(1)}% 回撤${bestStable.full.maxDD}%`);
    lines.push(`- 月度盈利${bestStable.monthlyProfit}/${bestStable.totalMonths}个月`);
  }

  lines.push('');
  lines.push(`*tools/focus_backtest.js 生成 | 2026-08-26*`);

  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(join(OUTPUT_DIR, 'compare_backtest_report.md'), lines.join('\n'), 'utf-8');
  console.log('\n报告已写入');
}

main();