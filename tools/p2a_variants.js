/**
 * P2a变体完整回测 — 全面对比P2a及其所有变体
 *
 * 从deep_ev_scan发现的P2a系列信号：
 *   P2a: HHAD_A 变盘1-2 + 其他联赛 (baseline)
 *   P2a+: 同上 + 让球+1 + 非单关
 *   P2a+flat: 同上 + 让球负方向flat
 *   P2a+down: 同上 + 让球负方向down
 *   P2a+单关: 同上 + 单关
 *   P2a+让球-1: 同上 + 让球-1
 *   P2a+赔率2-3: 同上 + 赔率2.0-3.0
 *   P2a+赔率3-5: 同上 + 赔率3.0-5.0
 *   以及它们的资金管理表现
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
        const hhadHF = hhad.filter(e => parseInt(e.hf) === 1).length;
        const hhadHD = hhad.filter(e => parseInt(e.hf) === -1).length;
        const hhadHDir = hhadHF - hhadHD > 0 ? 'up' : hhadHF - hhadHD < 0 ? 'down' : 'flat';

        const hhadSingle = (single.find(s => s.poolCode === 'HHAD'))?.single ?? 1;

        // 让球线的变化
        const glChanges = hhad.filter((e, i) => i > 0 && e.goalLine !== hhad[i-1].goalLine).length;

        out.push({
          matchId: m.matchId, date: m.matchDate, league,
          home: m.homeTeam, away: m.awayTeam, score: m.sectionsNo999,
          goalLine: m.goalLine,
          hhadGoalLine: hhadLast.goalLine || m.goalLine,
          h: parseFloat(hadLast.h), d: parseFloat(hadLast.d), a: parseFloat(hadLast.a),
          hh: parseFloat(hhadLast.h), hd: parseFloat(hhadLast.d), ha: parseFloat(hhadLast.a),
          hadChanges: had.length, hhadChanges: hhad.length,
          hhadADir, hhadHDir, hhadSingle, glChanges,
          hadWin: hadRes.combination,  // 'H'|'D'|'A'
          hhadWin: hhadRes.combination, // 'H'|'D'|'A'
        });
      }
    } catch (e) { /* skip */ }
  }
  return out.sort((a, b) => a.date < b.date ? -1 : 1);
}

// ========== P2a基础条件 ==========

function isP2a(m) {
  return m.hhadChanges >= 1 && m.hhadChanges <= 2 &&
    !TOP5.includes(m.league) && !SECOND.includes(m.league);
}

// ========== 策略 ==========

const STRATEGIES = {
  P2a_baseline: {
    desc: 'HHAD-A 变盘1-2+其他联赛 (原始)',
    cond: (m) => isP2a(m),
  },
  P2a_gl1: {
    desc: 'P2a + 让球+1',
    cond: (m) => isP2a(m) && (m.hhadGoalLine === '+1' || m.hhadGoalLine === '1'),
  },
  P2a_gl1_nosingle: {
    desc: 'P2a + 让球+1 + 非单关',
    cond: (m) => isP2a(m) && (m.hhadGoalLine === '+1' || m.hhadGoalLine === '1') && m.hhadSingle === 0,
  },
  P2a_gl1_single: {
    desc: 'P2a + 让球+1 + 单关',
    cond: (m) => isP2a(m) && (m.hhadGoalLine === '+1' || m.hhadGoalLine === '1') && m.hhadSingle === 1,
  },
  P2a_gl1_adir_flat: {
    desc: 'P2a + 让球+1 + 让球负方向flat',
    cond: (m) => isP2a(m) && (m.hhadGoalLine === '+1' || m.hhadGoalLine === '1') && m.hhadADir === 'flat',
  },
  P2a_adir_flat: {
    desc: 'P2a + 让球负方向flat',
    cond: (m) => isP2a(m) && m.hhadADir === 'flat',
  },
  P2a_adir_down: {
    desc: 'P2a + 让球负方向down',
    cond: (m) => isP2a(m) && m.hhadADir === 'down',
  },
  P2a_odds2_3: {
    desc: 'P2a + 赔率2.0-3.0',
    cond: (m) => isP2a(m) && m.ha >= 2.0 && m.ha < 3.0,
  },
  P2a_odds3_5: {
    desc: 'P2a + 赔率3.0-5.0',
    cond: (m) => isP2a(m) && m.ha >= 3.0 && m.ha < 5.0,
  },
  P2a_odds1_5_2: {
    desc: 'P2a + 赔率1.5-2.0',
    cond: (m) => isP2a(m) && m.ha >= 1.5 && m.ha < 2.0,
  },
  P2a_hdir_flat: {
    desc: 'P2a + 让球主方向flat',
    cond: (m) => isP2a(m) && m.hhadHDir === 'flat',
  },
  P2a_hdir_down: {
    desc: 'P2a + 让球主方向down',
    cond: (m) => isP2a(m) && m.hhadHDir === 'down',
  },
  P2a_gl0: {
    desc: 'P2a + 无让球(平手)',
    cond: (m) => isP2a(m) && (m.hhadGoalLine === '' || m.hhadGoalLine === '+0' || m.hhadGoalLine === '0'),
  },
  P2a_gl_minus1: {
    desc: 'P2a + 让球-1',
    cond: (m) => isP2a(m) && (m.hhadGoalLine === '-1' || m.hhadGoalLine === '-0.5'),
  },
  P2a_nosingle: {
    desc: 'P2a + 非单关',
    cond: (m) => isP2a(m) && m.hhadSingle === 0,
  },
  P2a_single: {
    desc: 'P2a + 单关',
    cond: (m) => isP2a(m) && m.hhadSingle === 1,
  },
  P2a_glChanges0: {
    desc: 'P2a + 让球线不动',
    cond: (m) => isP2a(m) && m.glChanges === 0,
  },
  P2a_glChanges1: {
    desc: 'P2a + 让球线变化≥1',
    cond: (m) => isP2a(m) && m.glChanges >= 1,
  },
};

// ========== 回测 ==========

function backtest(strat, matches, startCash = 1000) {
  let cash = startCash, peak = cash, maxDD = 0;
  let streak = 0, wins = 0;
  let curDate = null, dailyPnL = 0;
  const bets = [];
  const pcts = [0.05, 0.08, 0.10, 0.12];

  for (const m of matches) {
    if (!strat.cond(m)) continue;
    const odds = m.ha;
    if (!odds || odds <= 1) continue;

    if (curDate !== m.date) { curDate = m.date; dailyPnL = 0; }
    if (dailyPnL <= -cash * 0.20) continue;

    let tier = cash > 5000 ? 3 : cash > 3000 ? 2 : cash > 1000 ? 1 : 0;
    if (streak >= 2 && tier > 0) tier--;
    const amount = Math.max(Math.round(cash * pcts[tier]), 2);
    if (amount > cash) continue;

    const won = m.hhadWin === 'A';
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
    roi: (cash - startCash) / startCash,
    winRate: total ? totalW/total : 0,
    avgOdds: total ? bets.reduce((s,b)=>s+b.odds,0)/total : 0,
    maxDD: Math.round(maxDD*10000)/100,
    reached: cash >= 10000,
  };
}

// ========== 精确EV ==========

function preciseEV(strat, matches) {
  const bets = matches.filter(m => strat.cond(m) && m.ha > 1.1);
  if (!bets.length) return null;
  const wins = bets.filter(m => m.hhadWin === 'A').length;
  const winOdds = bets.filter(m => m.hhadWin === 'A').reduce((s, m) => s + m.ha, 0);
  return { n: bets.length, wins, winRate: wins/bets.length, preciseEV: (winOdds / bets.length) * 100 };
}

// ========== 月度 ==========

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
  console.log('=== P2a变体完整回测 ===\n');
  const all = loadAll();
  const splitIdx = Math.floor(all.length * 0.65);
  const train = all.slice(0, splitIdx);
  const test = all.slice(splitIdx);
  console.log(`总: ${all.length} | 训练: ${train.length} | 测试: ${test.length}\n`);

  // 基础统计：P2a全量
  const p2aBase = all.filter(isP2a);
  const p2aEV = preciseEV({ cond: isP2a }, all);
  console.log(`P2a基础: ${p2aBase.length}场 精确EV ${p2aEV?.preciseEV.toFixed(1)}%\n`);

  const results = [];
  for (const [name, strat] of Object.entries(STRATEGIES)) {
    const ev = preciseEV(strat, all);
    if (!ev || ev.n < 10) continue;

    const full = backtest(strat, all);
    const tr = backtest(strat, train);
    const te = backtest(strat, test);
    const monthly = walkForward(strat, all);
    const mp = monthly.filter(m => m.profit > 0).length;
    const tm = monthly.filter(m => m.bets > 0).length;

    results.push({ name, desc: strat.desc, full, tr, te, ev, monthly, mp, tm });

    const mark = full.reached ? '✅' : full.roi > 0 ? '🟡' : '❌';
    console.log(`${mark} ${name}: ${strat.desc}`);
    console.log(`  全量: ${full.total}注 胜率${(full.winRate*100).toFixed(1)}% 均赔${full.avgOdds.toFixed(2)}`);
    console.log(`  资金: ¥${full.finalCash} ROI${(full.roi*100).toFixed(1)}% 回撤${full.maxDD}%`);
    console.log(`  精确EV: ${ev.preciseEV.toFixed(1)}% | 训练ROI${(tr.roi*100).toFixed(1)}% → 测试ROI${(te.roi*100).toFixed(1)}%`);
    console.log(`  月度盈利: ${mp}/${tm}个月\n`);
  }

  // 排序
  results.sort((a, b) => b.full.roi - a.full.roi);

  // 报告
  const lines = [];
  lines.push('# P2a变体完整回测报告');
  lines.push('');
  lines.push(`> 数据 ${all.length}场 | 训练 ${train.length} | 测试 ${test.length}`);
  lines.push(`> P2a基础: ${p2aBase.length}注 精确EV ${p2aEV?.preciseEV.toFixed(1)}%`);
  lines.push(`> 资金管理: 阶段(5/8/10/12%)+连输降档+单日20%上限 | 起点¥1000`);
  lines.push('');

  lines.push('## 全量回测排名');
  lines.push('');
  lines.push('| 排名 | 策略 | 注数 | 胜率 | 均赔 | 精确EV | 资金 | ROI | 回撤 | 训练ROI | 测试ROI | 月盈利 | 达标 |');
  lines.push('|------|------|------|------|------|--------|------|-----|------|---------|---------|--------|------|');
  results.forEach((r, i) => {
    lines.push(`| ${i+1} | ${r.name} | ${r.full.total} | ${(r.full.winRate*100).toFixed(1)}% | ${r.full.avgOdds.toFixed(2)} | ${r.ev.preciseEV.toFixed(1)}% | ¥${r.full.finalCash} | ${(r.full.roi*100).toFixed(1)}% | ${r.full.maxDD}% | ${(r.tr.roi*100).toFixed(1)}% | ${(r.te.roi*100).toFixed(1)}% | ${r.mp}/${r.tm} | ${r.full.reached ? '✅' : '❌'} |`);
  });
  lines.push('');

  // 双正EV+P2a基准
  lines.push('## 双正ROI（训练+测试都正ROI）');
  lines.push('');
  const doublePos = results.filter(r => r.tr.roi > 0 && r.te.roi > 0);
  if (doublePos.length) {
    lines.push('| 策略 | 注数 | 精确EV | 资金 | 训练ROI | 测试ROI | 回撤 | 月盈利 |');
    lines.push('|------|------|--------|------|---------|---------|------|--------|');
    for (const r of doublePos) {
      lines.push(`| **${r.name}** | ${r.full.total} | ${r.ev.preciseEV.toFixed(1)}% | ¥${r.full.finalCash} | ${(r.tr.roi*100).toFixed(1)}% | ${(r.te.roi*100).toFixed(1)}% | ${r.full.maxDD}% | ${r.mp}/${r.tm} |`);
    }
  } else {
    lines.push('❌ 无策略在训练和测试都正ROI');
  }
  lines.push('');

  // 最佳策略详细
  if (doublePos.length) {
    const best = doublePos.sort((a, b) => b.full.roi - a.full.roi)[0];
    lines.push(`## 最佳稳定策略 — ${best.name}`);
    lines.push('');
    lines.push(`**${best.desc}**`);
    lines.push(`- 总注: ${best.full.total} | 胜率: ${(best.full.winRate*100).toFixed(1)}% | 均赔: ${best.full.avgOdds.toFixed(2)}`);
    lines.push(`- 精确EV: ${best.ev.preciseEV.toFixed(1)}%`);
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
        lines.push(`| ${m.profit > 0 ? '✅' : '❌'} ${m.month} | ${m.bets} | ${m.profit > 0 ? '+' : ''}${m.profit.toFixed(1)} | ${(m.winRate*100).toFixed(1)}% |`);
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
    lines.push(`✅ ${reached.length}个变体达到¥10000！`);
    for (const r of reached) {
      lines.push(`- **${r.name}**: ¥1000→¥${r.full.finalCash} (${r.full.total}注 EV${r.ev.preciseEV.toFixed(1)}% 回撤${r.full.maxDD}%)`);
    }
  }
  lines.push('');
  const stable = doublePos.length;
  if (stable) {
    lines.push(`🟢 ${stable}个策略训练+测试双正ROI，适合实战：`);
    for (const r of doublePos) {
      lines.push(`- **${r.name}**: ${r.desc} | ROI${(r.full.roi*100).toFixed(1)}% 回撤${r.full.maxDD}% 月度${r.mp}/${r.tm}`);
    }
  }
  lines.push('');
  lines.push('### 实战建议');
  lines.push('');
  lines.push('1. 优先使用双正ROI策略');
  lines.push('2. 1月-2月小联赛少，注意谨慎');
  lines.push('3. 连输2单自动降档，单日亏损20%停');
  lines.push('4. 目标¥10000，达到后可以降仓保守操作');
  lines.push('');
  lines.push(`*tools/p2a_variants.js | 2026-08-26*`);

  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(join(OUTPUT_DIR, 'p2a_variants_report.md'), lines.join('\n'), 'utf-8');
  console.log('报告已写入: p2a_variants_report.md');
}

main();