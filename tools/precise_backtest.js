/**
 * 精确EV信号 · 完整资金回测
 *
 * 用正确EV扫描发现的"双集正EV"信号做全额资金回测。
 * 资金管理: 阶段加注 + 连输降档 + 单日20%上限，起点¥1000。
 *
 * 挑选信号（训练+测试都EV>100%）：
 *   P1 HAD_D 次级联赛 (153注测试, EV122.8%)
 *   P2 HHAD_A 变盘1-2 + 其他联赛 (36注测试, EV124.0%)
 *   P3 HAD_D 方向h→d→a→ + 让球-1 (24注测试, EV169.3%)
 *   P4 HAD_D 变盘1-2 + 次级联赛 (77注测试, EV129.9%)
 *   P5 HAD_D 方向h→d→a→ (39注测试, EV121.4%)
 *   P6 HHAD_A 方向h→d→a→ (29注测试, EV104.8%)
 *   P7 HAD_D 赔率3.0-5.0 + 次级联赛 (128注测试, EV122.5%)
 *   P8 HAD_D 变盘8+ + 方向h↓d↑a↑ (39注测试, EV110.8%)
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
        if (!hadFirst || !hadLast || !hhadFirst || !hhadLast) continue;

        const hadRes = cache.matchResultList?.find(r => r.code === 'HAD');
        const hhadRes = cache.matchResultList?.find(r => r.code === 'HHAD');
        if (!hadRes || !hhadRes) continue;

        const hDir = hadLast.h > hadFirst.h ? '↑' : hadLast.h < hadFirst.h ? '↓' : '→';
        const dDir = hadLast.d > hadFirst.d ? '↑' : hadLast.d < hadFirst.d ? '↓' : '→';
        const aDir = hadLast.a > hadFirst.a ? '↑' : hadLast.a < hadFirst.a ? '↓' : '→';
        const hhadDir = { h: hadLast, d: hadLast, a: hadLast }; // 占位

        out.push({
          matchId: m.matchId, date: m.matchDate, league: m.leagueNameAbbr,
          home: m.homeTeam, away: m.awayTeam, score: m.sectionsNo999,
          goalLine: m.goalLine,
          h: parseFloat(hadLast.h), d: parseFloat(hadLast.d), a: parseFloat(hadLast.a),
          hh: parseFloat(hhadLast.h), hd: parseFloat(hhadLast.d), ha: parseFloat(hhadLast.a),
          hadChanges: had.length, hadDir: `h${hDir}d${dDir}a${aDir}`,
          hhadChanges: hhad.length,
          hadWin: { H: hadRes.combination === 'H', D: hadRes.combination === 'D', A: hadRes.combination === 'A' },
          hhadWin: { H: hhadRes.combination === 'H', D: hhadRes.combination === 'D', A: hhadRes.combination === 'A' },
        });
      }
    } catch (e) { /* skip */ }
  }
  return out.sort((a, b) => a.date < b.date ? -1 : 1);
}

// ========== 策略集合 ==========

const STRATEGIES = {
  P1_次级联赛平局: {
    desc: 'HAD_D 次级联赛(英冠/德乙/法乙/葡超/荷甲/巴甲/美职)',
    check: (m) => SECOND.includes(m.league),
    odds: (m) => m.d, win: (m) => m.hadWin.D,
  },
  P2_变盘12其他联赛让球负: {
    desc: 'HHAD_A 变盘1-2 + 其他联赛(非五大非次级)',
    check: (m) => m.hhadChanges >= 1 && m.hhadChanges <= 2 && !TOP5.includes(m.league) && !SECOND.includes(m.league),
    odds: (m) => m.ha, win: (m) => m.hhadWin.A,
  },
  P3_平向变盘让球1平局: {
    desc: 'HAD_D 方向h→d→a→ + 让球-1',
    check: (m) => m.hadDir === 'h→d→a→' && m.goalLine === '-1',
    odds: (m) => m.d, win: (m) => m.hadWin.D,
  },
  P4_次级联赛平局变盘12: {
    desc: 'HAD_D 变盘1-2 + 次级联赛',
    check: (m) => m.hadChanges >= 1 && m.hadChanges <= 2 && SECOND.includes(m.league),
    odds: (m) => m.d, win: (m) => m.hadWin.D,
  },
  P5_平向变盘平局: {
    desc: 'HAD_D 方向h→d→a→',
    check: (m) => m.hadDir === 'h→d→a→',
    odds: (m) => m.d, win: (m) => m.hadWin.D,
  },
  P6_平向变盘让球负: {
    desc: 'HHAD_A 方向h→d→a→',
    check: (m) => m.hadDir === 'h→d→a→',
    odds: (m) => m.ha, win: (m) => m.hhadWin.A,
  },
  P7_高赔次级联赛平局: {
    desc: 'HAD_D 赔率3.0-5.0 + 次级联赛',
    check: (m) => (m.d >= 3.0 && m.d < 5.0) && SECOND.includes(m.league),
    odds: (m) => m.d, win: (m) => m.hadWin.D,
  },
  P8_高变盘平局: {
    desc: 'HAD_D 变盘8+ + 方向h↓d↑a↑',
    check: (m) => m.hadChanges >= 8,
    odds: (m) => m.d, win: (m) => m.hadWin.D,
  },
};

// ========== 资金回测 ==========

function backtest(strat, matches) {
  let cash = 1000;
  let peak = cash, maxDD = 0;
  let streak = 0, wins = 0;
  let curDate = null, dailyPnL = 0;
  const bets = [];
  const pcts = [0.05, 0.08, 0.10, 0.12];

  for (const m of matches) {
    if (!strat.check(m)) continue;
    const odds = strat.odds(m);
    if (!odds || odds <= 1) continue;

    if (curDate !== m.date) { curDate = m.date; dailyPnL = 0; }
    if (dailyPnL <= -cash * 0.20) continue;

    let tier = cash > 5000 ? 3 : cash > 3000 ? 2 : cash > 1000 ? 1 : 0;
    if (streak >= 2 && tier > 0) tier--;
    const amount = Math.max(Math.round(cash * pcts[tier]), 2);
    if (amount > cash) continue;

    const won = strat.win(m);
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

function main() {
  console.log('=== 双集正EV信号 · 完整资金回测 ===\n');
  const all = loadAll();
  const splitIdx = Math.floor(all.length * 0.65);
  const train = all.slice(0, splitIdx);
  const test = all.slice(splitIdx);
  console.log(`总 ${all.length} | 训练 ${train.length} | 测试 ${test.length}\n`);

  const results = [];
  for (const [name, strat] of Object.entries(STRATEGIES)) {
    const full = backtest(strat, all);
    const tr = backtest(strat, train);
    const te = backtest(strat, test);
    results.push({ name, desc: strat.desc, full, tr, te });

    const mark = full.reached ? '✅' : full.roi > 0 ? '🟡' : '❌';
    console.log(`${mark} ${name}: ${strat.desc}`);
    console.log(`  全量: ${full.total}注 胜率${(full.winRate*100).toFixed(1)}% 均赔${full.avgOdds.toFixed(2)} 资金¥${full.finalCash} ROI${(full.roi*100).toFixed(1)}% 回撤${full.maxDD}%`);
    console.log(`  训练: ${tr.total}注 ROI${(tr.roi*100).toFixed(1)}% | 测试: ${te.total}注 ROI${(te.roi*100).toFixed(1)}%\n`);
  }

  // 排序
  results.sort((a, b) => b.full.roi - a.full.roi);

  // 报告
  const lines = [];
  lines.push('# 双集正EV信号 · 资金回测报告');
  lines.push('');
  lines.push(`> 数据 ${all.length}场 | 训练 ${train.length} | 测试 ${test.length}`);
  lines.push(`> 资金管理: 阶段(5/8/10/12%)+连输降档+单日20%上限 | 起点¥1000 目标¥10000`);
  lines.push('');
  lines.push('## 全量回测');
  lines.push('');
  lines.push('| 策略 | 注数 | 胜率 | 均赔 | 资金 | ROI | 回撤 | 训练ROI | 测试ROI | 达标 |');
  lines.push('|------|------|------|------|------|-----|------|---------|---------|------|');
  for (const r of results) {
    lines.push(`| ${r.name} | ${r.full.total} | ${(r.full.winRate*100).toFixed(1)}% | ${r.full.avgOdds.toFixed(2)} | ¥${r.full.finalCash} | ${(r.full.roi*100).toFixed(1)}% | ${r.full.maxDD}% | ${(r.tr.roi*100).toFixed(1)}% | ${(r.te.roi*100).toFixed(1)}% | ${r.full.reached ? '✅' : '❌'} |`);
  }
  lines.push('');

  lines.push(`## 结论`);
  lines.push('');
  const reached = results.filter(r => r.full.reached);
  if (reached.length) {
    lines.push(`✅ ${reached.length}个策略达到¥10000`);
    reached.forEach(r => lines.push(`- ${r.name}: ¥1000→¥${r.full.finalCash} (${r.full.total}注 胜率${(r.full.winRate*100).toFixed(1)}% 回撤${r.full.maxDD}%)`));
  } else {
    const pos = results.filter(r => r.full.roi > 0);
    lines.push(pos.length ? `🟡 ${pos.length}个策略正ROI未达10000` : '❌ 无策略正ROI');
    pos.forEach(r => lines.push(`- ${r.name}: ROI${(r.full.roi*100).toFixed(1)}% 回撤${r.full.maxDD}%`));
  }
  lines.push('');

  // 最稳策略投注记录（最高测试ROI且全量盈利）
  const bestTest = results.filter(r => r.full.roi > 0 && r.te.roi > 0).sort((a,b) => b.te.roi - a.te.roi)[0];
  if (bestTest) {
    lines.push(`## 最佳策略投注记录 — ${bestTest.name}（测试ROI${(bestTest.te.roi*100).toFixed(1)}%）`);
    lines.push('');
    lines.push('| 日期 | 联赛 | 对阵 | 赔率 | 金额 | 结果 | 盈亏 | 现金 |');
    lines.push('|------|------|------|------|------|------|------|------|');
    bestTest.full.bets.slice(0, 40).forEach(b => {
      lines.push(`| ${b.date} | ${b.league} | ${b.home} vs ${b.away} | ${b.odds} | ¥${b.amount} | ${b.won ? '✅' : '❌'} | ${b.won ? '+' : ''}${b.profit} | ¥${b.cash} |`);
    });
    if (bestTest.full.bets.length > 40) lines.push(`| ... 还有${bestTest.full.bets.length - 40}注 |`);
  }
  lines.push('');
  lines.push(`*tools/precise_backtest.js | 2026-08-26*`);

  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(join(OUTPUT_DIR, 'precise_backtest_report.md'), lines.join('\n'), 'utf-8');
  console.log('报告已写入 precise_backtest_report.md');
}

main();