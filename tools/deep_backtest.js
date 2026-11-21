/**
 * 深度扫描资金回测 — 对 v2 扫描发现的最强信号做完整资金管理回测
 *
 * 测试信号 (从deep_ev_scan中选前6)：
 *   S1: HHAD_A 变盘1-2+让球+1 (P2a升级)
 *   S2: HHAD_A 赔率3.0-5.0+让球负方向flat
 *   S3: HAD_D 次级联赛+让球-1
 *   S4: HHAD_D 变盘1-2+次级联赛
 *   S5: HAD_D 次级联赛+客胜方向down
 *   S6: HHAD_A 变盘1-2+其他联赛 (原始P2a baseline)
 *   S7: HAD_A 变盘8+ + 赔率3.0-5.0 + 让球负方向up
 *   S8: HHAD_A 让球+1+让球负方向flat
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
        const hadFirst = had[0], hadLast = had[had.length - 1];
        const hhad = cache.oddsHistory?.hhadList || [];
        const hhadFirst = hhad[0], hhadLast = hhad[hhad.length - 1];
        const single = cache.oddsHistory?.singleList || [];
        if (!hadFirst || !hadLast || !hhadFirst || !hhadLast) continue;

        const hadRes = cache.matchResultList?.find(r => r.code === 'HAD');
        const hhadRes = cache.matchResultList?.find(r => r.code === 'HHAD');
        if (!hadRes || !hhadRes) continue;

        const league = cache.oddsHistory?.leagueAbbName || m.leagueNameAbbr || '';

        // hhadADir
        const hhadAF = hhad.filter(e => parseInt(e.af) === 1).length;
        const hhadAD = hhad.filter(e => parseInt(e.af) === -1).length;
        const hhadADir = hhadAF - hhadAD > 0 ? 'up' : hhadAF - hhadAD < 0 ? 'down' : 'flat';

        const hadAF = had.filter(e => parseInt(e.af) === 1).length;
        const hadAD = had.filter(e => parseInt(e.af) === -1).length;
        const hadADir = hadAF - hadAD > 0 ? 'up' : hadAF - hadAD < 0 ? 'down' : 'flat';

        const hhadSingle = (single.find(s => s.poolCode === 'HHAD'))?.single ?? 1;

        out.push({
          matchId: m.matchId, date: m.matchDate, league,
          home: m.homeTeam, away: m.awayTeam, score: m.sectionsNo999,
          goalLine: m.goalLine,
          hhadGoalLine: hhadLast.goalLine || m.goalLine,
          h: parseFloat(hadLast.h), d: parseFloat(hadLast.d), a: parseFloat(hadLast.a),
          hh: parseFloat(hhadLast.h), hd: parseFloat(hhadLast.d), ha: parseFloat(hhadLast.a),
          hadChanges: had.length, hhadChanges: hhad.length,
          hhadADir, hadADir,
          hhadSingle,
          hadWin: { H: hadRes.combination === 'H', D: hadRes.combination === 'D', A: hadRes.combination === 'A' },
          hhadWin: { H: hhadRes.combination === 'H', D: hhadRes.combination === 'D', A: hhadRes.combination === 'A' },
        });
      }
    } catch (e) { /* skip */ }
  }
  return out.sort((a, b) => a.date < b.date ? -1 : 1);
}

// ========== 策略定义 ==========

const STRATEGIES = {
  S1_P2aPlus: {
    desc: 'HHAD-A 让球负 + 变盘1-2 + 其他联赛 + 让球+1 + 非单关',
    oddsKey: 'ha', winKey: 'hhadWin.A',
    check: (m) =>
      m.hhadChanges >= 1 && m.hhadChanges <= 2 &&
      !TOP5.includes(m.league) && !SECOND.includes(m.league) &&
      (m.hhadGoalLine === '+1' || m.hhadGoalLine === '1') &&
      m.hhadSingle === 0,
  },
  S2_HHAD_A_3_5_flat: {
    desc: 'HHAD-A 让球负 + 赔率3.0-5.0 + 让球负方向flat',
    oddsKey: 'ha', winKey: 'hhadWin.A',
    check: (m) =>
      m.ha >= 3.0 && m.ha < 5.0 &&
      m.hhadADir === 'flat',
  },
  S3_HAD_D_second_gl1: {
    desc: 'HAD-D 平局 + 次级联赛 + 让球-1',
    oddsKey: 'd', winKey: 'hadWin.D',
    check: (m) =>
      SECOND.includes(m.league) &&
      (m.goalLine === '-1' || m.goalLine === '1'),
  },
  S4_HHAD_D_1_2_second: {
    desc: 'HHAD-D 让球平 + 变盘1-2 + 次级联赛',
    oddsKey: 'hd', winKey: 'hhadWin.D',
    check: (m) =>
      m.hhadChanges >= 1 && m.hhadChanges <= 2 &&
      SECOND.includes(m.league),
  },
  S5_HAD_D_second_adown: {
    desc: 'HAD-D 平局 + 次级联赛 + 客胜方向down',
    oddsKey: 'd', winKey: 'hadWin.D',
    check: (m) =>
      SECOND.includes(m.league) &&
      m.hadADir === 'down',
  },
  S6_P2a_baseline: {
    desc: 'HHAD-A 让球负 + 变盘1-2 + 其他联赛 (原始P2a)',
    oddsKey: 'ha', winKey: 'hhadWin.A',
    check: (m) =>
      m.hhadChanges >= 1 && m.hhadChanges <= 2 &&
      !TOP5.includes(m.league) && !SECOND.includes(m.league),
  },
  S7_HAD_A_8_3_5_up: {
    desc: 'HAD-A 客胜 + 变盘8+ + 赔率3.0-5.0 + 让球负方向up',
    oddsKey: 'a', winKey: 'hadWin.A',
    check: (m) =>
      m.hadChanges >= 8 &&
      m.a >= 3.0 && m.a < 5.0 &&
      m.hhadADir === 'up',
  },
  S8_HHAD_A_gl1_flat: {
    desc: 'HHAD-A 让球负 + 让球+1 + 让球负方向flat',
    oddsKey: 'ha', winKey: 'hhadWin.A',
    check: (m) =>
      (m.hhadGoalLine === '+1' || m.hhadGoalLine === '1') &&
      m.hhadADir === 'flat',
  },
};

// ========== 资金管理回测 ==========

function backtest(strat, matches) {
  let cash = 1000, peak = cash, maxDD = 0;
  let streak = 0, wins = 0;
  let curDate = null, dailyPnL = 0;
  const bets = [];
  const pcts = [0.05, 0.08, 0.10, 0.12];

  for (const m of matches) {
    const odds = m[strat.oddsKey];
    if (!odds || odds <= 1) continue;
    if (!strat.check(m)) continue;

    if (curDate !== m.date) { curDate = m.date; dailyPnL = 0; }
    if (dailyPnL <= -cash * 0.20) continue;

    let tier = cash > 5000 ? 3 : cash > 3000 ? 2 : cash > 1000 ? 1 : 0;
    if (streak >= 2 && tier > 0) tier--;
    const amount = Math.max(Math.round(cash * pcts[tier]), 2);
    if (amount > cash) continue;

    const won = strat.winKey.split('.').reduce((o, k) => o?.[k], m);
    const profit = won ? amount * (odds - 1) : -amount;
    cash += profit; dailyPnL += profit;
    if (won) { wins++; streak = 0; } else { streak++; }
    peak = Math.max(peak, cash);
    maxDD = Math.max(maxDD, (peak - cash) / peak);

    bets.push({ date: m.date, league: m.league, home: m.home, away: m.away, score: m.score,
      odds: Math.round(odds*100)/100, amount: Math.round(amount*100)/100, won, profit: Math.round(profit*100)/100, cash: Math.round(cash*100)/100 });

    if (cash <= 50) break;
    if (cash >= 10000) break;
  }

  const totalW = bets.filter(b => b.won).length;
  const total = bets.length;
  return {
    bets, total, wins: totalW,
    finalCash: Math.round(cash*100)/100,
    roi: (cash-1000)/1000,
    winRate: total ? totalW/total : 0,
    avgOdds: total ? bets.reduce((s,b)=>s+b.odds,0)/total : 0,
    maxDD: Math.round(maxDD*10000)/100,
    reached: cash >= 10000,
  };
}

// ========== Walk-forward ==========

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

// ========== 精确EV ==========

function preciseEV(strat, matches) {
  const bets = matches.filter(m => strat.check(m) && m[strat.oddsKey] > 1.1);
  if (!bets.length) return null;
  const wins = bets.filter(m => {
    const keys = strat.winKey.split('.');
    return keys.reduce((o, k) => o?.[k], m);
  }).length;
  const winOdds = bets.filter(m => {
    const keys = strat.winKey.split('.');
    return keys.reduce((o, k) => o?.[k], m);
  }).reduce((s, m) => s + m[strat.oddsKey], 0);
  return { n: bets.length, wins, winRate: wins/bets.length, preciseEV: (winOdds / bets.length) * 100 };
}

// ========== 主函数 ==========

function main() {
  console.log('=== 深度扫描 · 资金回测 ===\n');
  const all = loadAll();
  const splitIdx = Math.floor(all.length * 0.65);
  const train = all.slice(0, splitIdx);
  const test = all.slice(splitIdx);
  console.log(`总: ${all.length} | 训练: ${train.length} | 测试: ${test.length}\n`);

  const results = [];
  for (const [name, strat] of Object.entries(STRATEGIES)) {
    const full = backtest(strat, all);
    const tr = backtest(strat, train);
    const te = backtest(strat, test);
    const ev = preciseEV(strat, all);
    const monthly = walkForward(strat, all);
    const mp = monthly.filter(m => m.profit > 0).length;
    const tm = monthly.filter(m => m.bets > 0).length;

    results.push({ name, desc: strat.desc, full, tr, te, ev, monthly, mp, tm });

    const mark = full.reached ? '✅' : full.roi > 0 ? '🟡' : '❌';
    console.log(`${mark} ${name}: ${strat.desc}`);
    console.log(`  全量: ${full.total}注 胜率${(full.winRate*100).toFixed(1)}% 均赔${full.avgOdds.toFixed(2)}`);
    console.log(`  资金: ¥${full.finalCash} ROI${(full.roi*100).toFixed(1)}% 回撤${full.maxDD}%`);
    console.log(`  精确EV: ${ev?.preciseEV.toFixed(1)}% | 训练ROI${(tr.roi*100).toFixed(1)}% → 测试ROI${(te.roi*100).toFixed(1)}%`);
    console.log(`  月度盈利: ${mp}/${tm}个月\n`);
  }

  // 排序
  results.sort((a, b) => b.full.roi - a.full.roi);

  // 报告
  const lines = [];
  lines.push('# 深度扫描 · 资金回测报告');
  lines.push('');
  lines.push(`> 数据 ${all.length}场 | 训练 ${train.length} | 测试 ${test.length}`);
  lines.push(`> 资金管理: 阶段(5/8/10/12%)+连输降档+单日20%上限 | 起点¥1000 目标¥10000`);
  lines.push('');

  lines.push('## 全量回测');
  lines.push('');
  lines.push('| 排名 | 策略 | 注数 | 胜率 | 均赔 | 资金 | ROI | 回撤 | 精确EV | 训练ROI | 测试ROI | 月盈利 | 达标 |');
  lines.push('|------|------|------|------|------|------|-----|------|--------|---------|---------|--------|------|');
  results.forEach((r, i) => {
    lines.push(`| ${i+1} | ${r.name} | ${r.full.total} | ${(r.full.winRate*100).toFixed(1)}% | ${r.full.avgOdds.toFixed(2)} | ¥${r.full.finalCash} | ${(r.full.roi*100).toFixed(1)}% | ${r.full.maxDD}% | ${r.ev?.preciseEV.toFixed(1)}% | ${(r.tr.roi*100).toFixed(1)}% | ${(r.te.roi*100).toFixed(1)}% | ${r.mp}/${r.tm} | ${r.full.reached ? '✅' : '❌'} |`);
  });
  lines.push('');

  // 最佳策略详细
  const best = results[0];
  if (best && best.full.roi > 0) {
    lines.push(`## 最佳策略 — ${best.name}`);
    lines.push('');
    lines.push(`**${best.desc}**`);
    lines.push(`- 总注: ${best.full.total} | 胜率: ${(best.full.winRate*100).toFixed(1)}% | 均赔: ${best.full.avgOdds.toFixed(2)}`);
    lines.push(`- 精确EV: ${best.ev?.preciseEV.toFixed(1)}%`);
    lines.push(`- 资金: ¥1000 → ¥${best.full.finalCash} (ROI${(best.full.roi*100).toFixed(1)}%)`);
    lines.push(`- 最大回撤: ${best.full.maxDD}% | 月度盈利: ${best.mp}/${best.tm}个月`);
    lines.push(`- 训练ROI: ${(best.tr.roi*100).toFixed(1)}% | 测试ROI: ${(best.te.roi*100).toFixed(1)}%`);
    lines.push('');

    // 月度明细
    lines.push('### 月度明细');
    lines.push('');
    lines.push('| 月 | 注数 | 盈亏 | 胜率 |');
    lines.push('|----|------|------|------|');
    for (const m of best.monthly) {
      if (m.bets > 0) {
        const emoji = m.profit > 0 ? '✅' : '❌';
        lines.push(`| ${emoji} ${m.month} | ${m.bets} | ${m.profit > 0 ? '+' : ''}${m.profit} | ${(m.winRate*100).toFixed(1)}% |`);
      }
    }
    lines.push('');

    // 投注记录
    lines.push('### 投注记录');
    lines.push('');
    lines.push('| 日期 | 联赛 | 对阵 | 比分 | 赔率 | 金额 | 结果 | 盈亏 | 现金 |');
    lines.push('|------|------|------|------|------|------|------|------|------|');
    for (const b of best.full.bets) {
      lines.push(`| ${b.date} | ${b.league} | ${b.home} vs ${b.away} | ${b.score} | ${b.odds} | ¥${b.amount} | ${b.won ? '✅' : '❌'} | ${b.won ? '+' : ''}${b.profit} | ¥${b.cash} |`);
    }
    lines.push('');
  }

  // 结论
  lines.push('## 结论');
  lines.push('');
  const reached = results.filter(r => r.full.reached);
  if (reached.length) {
    lines.push(`✅ ${reached.length}个策略达到¥10000！`);
    for (const r of reached) {
      lines.push(`- **${r.name}**: ¥1000→¥${r.full.finalCash} (${r.full.total}注 胜率${(r.full.winRate*100).toFixed(1)}% 回撤${r.full.maxDD}% 精确EV ${r.ev?.preciseEV.toFixed(1)}%)`);
    }
  } else {
    const pos = results.filter(r => r.full.roi > 0);
    if (pos.length) {
      lines.push(`🟡 ${pos.length}个策略正ROI：`);
      for (const r of pos) {
        lines.push(`- ${r.name}: ROI${(r.full.roi*100).toFixed(1)}% 回撤${r.full.maxDD}% 精确EV ${r.ev?.preciseEV.toFixed(1)}%`);
      }
    } else {
      lines.push('❌ 无策略正ROI');
    }
  }
  lines.push('');
  lines.push(`*tools/deep_backtest.js | 2026-08-26*`);

  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(join(OUTPUT_DIR, 'deep_backtest_report.md'), lines.join('\n'), 'utf-8');
  console.log('报告已写入: deep_backtest_report.md');
}

main();