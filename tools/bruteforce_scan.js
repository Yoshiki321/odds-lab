/**
 * 暴力扫描引擎 — 横扫所有投注方向 × 所有过滤条件
 *
 * 6个投注方向：HAD-H, HAD-D, HAD-A, HHAD-H, HHAD-D, HHAD-A
 * 过滤条件：赔率区间、方向模式、变盘次数、让球盘、联赛
 * 评估：每种子组合的注数、胜率、赔率、EV
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUTPUT_DIR = join(ROOT, 'data', 'backtest', 'loop');

// ========== 数据加载 ==========

function loadAll() {
  const HIST_DIR = join(ROOT, 'data', 'history', 'football');
  const CACHE_DIR = join(ROOT, 'data', 'history', '_odds_cache');

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

        // 加载缓存
        const cache = loadCache(join(CACHE_DIR, `${m.matchId}.json`));
        if (!cache) continue;

        // 欧赔变盘方向
        const had = cache.oddsHistory?.hadList || [];
        const hadFirst = had[0], hadLast = had[had.length - 1];
        const hDir = hadLast ? (hadLast.h > hadFirst.h ? '↑' : hadLast.h < hadFirst.h ? '↓' : '→') : '→';
        const dDir = hadLast ? (hadLast.d > hadFirst.d ? '↑' : hadLast.d < hadFirst.d ? '↓' : '→') : '→';
        const aDir = hadLast ? (hadLast.a > hadFirst.a ? '↑' : hadLast.a < hadFirst.a ? '↓' : '→') : '→';

        // 让球盘变盘方向
        const hhad = cache.oddsHistory?.hhadList || [];
        const hhadFirst = hhad[0], hhadLast = hhad[hhad.length - 1];
        const hh_hDir = hhadLast ? (hhadLast.h > hhadFirst.h ? '↑' : hhadLast.h < hhadFirst.h ? '↓' : '→') : '→';
        const hh_dDir = hhadLast ? (hhadLast.d > hhadFirst.d ? '↑' : hhadLast.d < hhadFirst.d ? '↓' : '→') : '→';
        const hh_aDir = hhadLast ? (hhadLast.a > hhadFirst.a ? '↑' : hhadLast.a < hhadFirst.a ? '↓' : '→') : '→';

        // 找出各投注方向的最终赔率
        const hadResult = cache.matchResultList?.find(r => r.code === 'HAD');
        const hhadResult = cache.matchResultList?.find(r => r.code === 'HHAD');

        // 计算每注的实际回报
        const hadHWin = hadResult?.combination === 'H';
        const hadDWin = hadResult?.combination === 'D';
        const hadAWin = hadResult?.combination === 'A';

        // 让球胜平负：H=让球胜, D=让球平, A=让球负
        const hhadHWin = hhadResult?.combination === 'H';
        const hhadDWin = hhadResult?.combination === 'D';
        const hhadAWin = hhadResult?.combination === 'A';

        out.push({
          matchId: m.matchId, date: m.matchDate, league: m.leagueNameAbbr,
          home: m.homeTeam, away: m.awayTeam, score: m.sectionsNo999,
          goalLine: m.goalLine,

          // HAD相关
          hadH: parseFloat(hadLast?.h || 0) || 0, hadD: parseFloat(hadLast?.d || 0) || 0, hadA: parseFloat(hadLast?.a || 0) || 0,
          hadHFirst: parseFloat(hadFirst?.h || 0) || 0, hadDFirst: parseFloat(hadFirst?.d || 0) || 0, hadAFirst: parseFloat(hadFirst?.a || 0) || 0,
          hadChanges: had.length,
          hadDirPattern: `h${hDir}d${dDir}a${aDir}`,
          hadHWin, hadDWin, hadAWin,

          // HHAD相关
          hhadH: parseFloat(hhadLast?.h || 0) || 0, hhadD: parseFloat(hhadLast?.d || 0) || 0, hhadA: parseFloat(hhadLast?.a || 0) || 0,
          hhadHFirst: parseFloat(hhadFirst?.h || 0) || 0, hhadDFirst: parseFloat(hhadFirst?.d || 0) || 0, hhadAFirst: parseFloat(hhadFirst?.a || 0) || 0,
          hhadChanges: hhad.length,
          hhadDirPattern: `h${hh_hDir}d${hh_dDir}a${hh_aDir}`,
          hhadGoalLine: hhadLast?.goalLine || m.goalLine,
          hhadHWin, hhadDWin, hhadAWin,
        });
      }
    } catch (e) { /* skip */ }
  }
  return out.sort((a, b) => a.date < b.date ? -1 : 1);
}

function loadCache(fp) {
  try {
    return JSON.parse(readFileSync(fp, 'utf8'));
  } catch { return null; }
}

// ========== 暴力扫描 ==========

// 6个投注方向
const BET_TYPES = [
  { key: 'HAD_H', desc: '欧赔-主胜', oddsKey: 'hadH', winKey: 'hadHWin', firstKey: 'hadHFirst', dirPattern: 'hadDirPattern', changes: 'hadChanges' },
  { key: 'HAD_D', desc: '欧赔-平局', oddsKey: 'hadD', winKey: 'hadDWin', firstKey: 'hadDFirst', dirPattern: 'hadDirPattern', changes: 'hadChanges' },
  { key: 'HAD_A', desc: '欧赔-客胜', oddsKey: 'hadA', winKey: 'hadAWin', firstKey: 'hadAFirst', dirPattern: 'hadDirPattern', changes: 'hadChanges' },
  { key: 'HHAD_H', desc: '让球-胜', oddsKey: 'hhadH', winKey: 'hhadHWin', firstKey: 'hhadHFirst', dirPattern: 'hhadDirPattern', changes: 'hhadChanges' },
  { key: 'HHAD_D', desc: '让球-平', oddsKey: 'hhadD', winKey: 'hhadDWin', firstKey: 'hhadDFirst', dirPattern: 'hhadDirPattern', changes: 'hhadChanges' },
  { key: 'HHAD_A', desc: '让球-负', oddsKey: 'hhadA', winKey: 'hhadAWin', firstKey: 'hhadAFirst', dirPattern: 'hhadDirPattern', changes: 'hhadChanges' },
];

// 过滤维度
const FILTERS = {
  // 赔率区间
  oddsRange: (m, bt) => {
    const odds = m[bt.oddsKey];
    if (!odds || odds <= 1) return 'none';
    if (odds < 1.5) return '1.0-1.5';
    if (odds < 2.0) return '1.5-2.0';
    if (odds < 3.0) return '2.0-3.0';
    if (odds < 5.0) return '3.0-5.0';
    return '5.0+';
  },

  // 开赔赔率区间
  firstOddsRange: (m, bt) => {
    const odds = m[bt.firstKey];
    if (!odds || odds <= 1) return 'none';
    if (odds < 1.5) return '1.0-1.5';
    if (odds < 2.0) return '1.5-2.0';
    if (odds < 3.0) return '2.0-3.0';
    if (odds < 5.0) return '3.0-5.0';
    return '5.0+';
  },

  // 赔率变化方向
  dirPattern: (m, bt) => m[bt.dirPattern] || 'unknown',

  // 变盘次数
  changes: (m, bt) => {
    const c = m[bt.changes];
    if (c === 0) return '0';
    if (c <= 2) return '1-2';
    if (c <= 4) return '3-4';
    if (c <= 7) return '5-7';
    return '8+';
  },

  // 让球盘
  goalLine: (m) => {
    if (!m.goalLine) return 'any';
    const gl = parseInt(m.goalLine);
    if (gl <= -2) return '-2';
    if (gl === -1) return '-1';
    if (gl === 0) return '0';
    if (gl === 1) return '+1';
    if (gl >= 2) return '+2';
    return 'any';
  },

  // 联赛级别
  leagueTier: (m) => {
    const top5 = ['英超','西甲','德甲','意甲','法甲','欧冠','欧罗巴'];
    const second = ['英冠','德乙','法乙','葡超','荷甲','巴甲','美职'];
    if (top5.includes(m.league)) return 'top';
    if (second.includes(m.league)) return 'second';
    return 'other';
  },

  // 开盘方向 vs 终盘方向（升赔还是降赔）
  oddsDirection: (m, bt) => {
    const odds = m[bt.oddsKey];
    const first = m[bt.firstKey];
    if (!odds || !first) return 'unknown';
    if (odds > first) return 'up'; // 赔率升 = 不看好
    if (odds < first) return 'down'; // 赔率降 = 看好
    return 'flat';
  },

  // 赔率变化幅度
  oddsChangePct: (m, bt) => {
    const odds = m[bt.oddsKey];
    const first = m[bt.firstKey];
    if (!odds || !first) return 'none';
    const pct = (odds - first) / first;
    if (pct < -0.05) return 'down5+'; // 降5%以上
    if (pct > 0.05) return 'up5+'; // 升5%以上
    return 'flat';
  },
};

function bruteForceScan(matches) {
  // 分割训练/验证
  const splitIdx = Math.floor(matches.length * 0.7);
  const train = matches.slice(0, splitIdx);
  const test = matches.slice(splitIdx);

  const results = [];

  for (const bt of BET_TYPES) {
    // 单维度过滤
    for (const [filterName, filterFn] of Object.entries(FILTERS)) {
      // 收集该维度下所有可能的值
      const values = new Set();
      for (const m of train) {
        const v = filterFn(m, bt);
        if (v && v !== 'none') values.add(v);
      }

      for (const val of values) {
        const trainBets = [];
        for (const m of train) {
          if (filterFn(m, bt) !== val) continue;
          const odds = m[bt.oddsKey];
          if (!odds || odds <= 1) continue;
          const won = m[bt.winKey];
          trainBets.push({ odds, won });
        }

        if (trainBets.length < 15) continue;

        const trainWins = trainBets.filter(b => b.won).length;
        const trainWinRate = trainWins / trainBets.length;
        const trainAvgOdds = trainBets.reduce((s, b) => s + b.odds, 0) / trainBets.length;
        const trainEV = trainWinRate * trainAvgOdds;

        // 测试集验证
        const testBets = [];
        for (const m of test) {
          if (filterFn(m, bt) !== val) continue;
          const odds = m[bt.oddsKey];
          if (!odds || odds <= 1) continue;
          const won = m[bt.winKey];
          testBets.push({ odds, won });
        }

        const testWins = testBets.filter(b => b.won).length;
        const testWinRate = testBets.length ? testWins / testBets.length : 0;
        const testAvgOdds = testBets.length ? testBets.reduce((s, b) => s + b.odds, 0) / testBets.length : 0;
        const testEV = testBets.length ? testWinRate * testAvgOdds : 0;

        results.push({
          type: bt.key,
          desc: bt.desc,
          filter: filterName,
          value: val,
          trainN: trainBets.length,
          trainWinRate: Math.round(trainWinRate * 10000) / 100,
          trainAvgOdds: Math.round(trainAvgOdds * 100) / 100,
          trainEV: Math.round(trainEV * 10000) / 100,
          testN: testBets.length,
          testWinRate: Math.round(testWinRate * 10000) / 100,
          testAvgOdds: Math.round(testAvgOdds * 100) / 100,
          testEV: Math.round(testEV * 10000) / 100,
          score: trainEV * 100 + (testEV > 0.95 ? testEV * 50 : -50),
        });
      }
    }

    // 两个维度组合过滤
    const filterEntries = Object.entries(FILTERS);
    for (let i = 0; i < filterEntries.length; i++) {
      for (let j = i + 1; j < filterEntries.length; j++) {
        const [f1_name, f1_fn] = filterEntries[i];
        const [f2_name, f2_fn] = filterEntries[j];

        // 收集所有组合值
        const combos = {};
        for (const m of train) {
          const v1 = f1_fn(m, bt);
          const v2 = f2_fn(m, bt);
          if (!v1 || v1 === 'none' || !v2 || v2 === 'none') continue;
          const key = `${v1}|${v2}`;
          if (!combos[key]) combos[key] = { v1, v2, bets: [] };
          const odds = m[bt.oddsKey];
          if (!odds || odds <= 1) continue;
          combos[key].bets.push({ odds, won: m[bt.winKey] });
        }

        for (const [, c] of Object.entries(combos)) {
          if (c.bets.length < 15) continue;
          const wins = c.bets.filter(b => b.won).length;
          const wr = wins / c.bets.length;
          const avgOdds = c.bets.reduce((s, b) => s + b.odds, 0) / c.bets.length;
          const ev = wr * avgOdds;

          // 测试集
          const testBets = [];
          for (const m of test) {
            const v1 = f1_fn(m, bt);
            const v2 = f2_fn(m, bt);
            if (v1 !== c.v1 || v2 !== c.v2) continue;
            const odds = m[bt.oddsKey];
            if (!odds || odds <= 1) continue;
            testBets.push({ odds, won: m[bt.winKey] });
          }
          const testWins = testBets.filter(b => b.won).length;
          const testWr = testBets.length ? testWins / testBets.length : 0;
          const testAvgOdds = testBets.length ? testBets.reduce((s, b) => s + b.odds, 0) / testBets.length : 0;
          const testEV = testBets.length ? testWr * testAvgOdds : 0;

          results.push({
            type: bt.key,
            desc: bt.desc,
            filter: `${f1_name}+${f2_name}`,
            value: `${c.v1} + ${c.v2}`,
            trainN: c.bets.length,
            trainWinRate: Math.round(wr * 10000) / 100,
            trainAvgOdds: Math.round(avgOdds * 100) / 100,
            trainEV: Math.round(ev * 10000) / 100,
            testN: testBets.length,
            testWinRate: Math.round(testWr * 10000) / 100,
            testAvgOdds: Math.round(testAvgOdds * 100) / 100,
            testEV: Math.round(testEV * 10000) / 100,
            score: ev * 100 + (testEV > 0.95 ? testEV * 50 : -50),
          });
        }
      }
    }
  }

  // 排序
  results.sort((a, b) => {
    // 优先看训练集EV高，然后测试集样本多
    if (b.trainEV !== a.trainEV) return b.trainEV - a.trainEV;
    return b.testN - a.testN;
  });

  return results;
}

// ========== 主函数 ==========

function main() {
  console.log('=== 暴力扫描引擎 — 6个投注方向 × 所有过滤条件 ===\n');

  const all = loadAll();
  console.log(`总场次: ${all.length}\n`);

  const results = bruteForceScan(all);

  // 按预测类型分组
  const byType = {};
  for (const r of results) {
    if (!byType[r.type]) byType[r.type] = [];
    byType[r.type].push(r);
  }

  // 输出每个类型TOP10
  const topPerType = {};
  for (const [type, rs] of Object.entries(byType)) {
    // 只看训练集EV>1.0的
    const valid = rs.filter(r => r.trainEV > 100 && r.trainN >= 20 && r.testN >= 10);
    valid.sort((a, b) => b.score - a.score);
    topPerType[type] = valid.slice(0, 10);
  }

  // 全局TOP20
  const globalTop = results.filter(r => r.trainEV > 100 && r.trainN >= 20 && r.testN >= 10);
  globalTop.sort((a, b) => b.score - a.score);

  // ===== 输出报告 =====
  const lines = [];

  lines.push('# 暴力扫描结果 — 6个投注方向 × 所有过滤条件');
  lines.push('');
  lines.push(`> 总场次: ${all.length} | 训练集: ${Math.floor(all.length * 0.7)} | 测试集: ${Math.ceil(all.length * 0.3)}`);
  lines.push(`> 过滤维度: 赔率区间/开赔赔率区间/变化方向/变盘次数/让球盘/联赛级别/升降方向/升降幅度`);
  lines.push(`> 投注方向: HAD-H(主胜) HAD-D(平局) HAD-A(客胜) HHAD-H(让胜) HHAD-D(让平) HHAD-A(让负)`);
  lines.push('');

  lines.push('## 评选标准');
  lines.push('- 训练集注数 ≥ 20');
  lines.push('- 测试集注数 ≥ 10');
  lines.push('- 训练集EV > 100%（超过1.0才盈利）');
  lines.push('- 按得分排序：训练EV + 测试EV>0.95的加分');
  lines.push('');

  for (const [type, rs] of Object.entries(topPerType)) {
    const desc = rs[0]?.desc || type;
    lines.push(`### ${type} (${desc})`);
    lines.push('');
    lines.push('| 排名 | 过滤条件 | 训练注数 | 训练胜率 | 训练均赔 | 训练EV | 测试注数 | 测试胜率 | 测试均赔 | 测试EV |');
    lines.push('|------|----------|---------|---------|---------|-------|---------|---------|---------|-------|');
    rs.forEach((r, i) => {
      lines.push(`| ${i + 1} | ${r.filter}:${r.value} | ${r.trainN} | ${r.trainWinRate}% | ${r.trainAvgOdds} | ${r.trainEV}% | ${r.testN} | ${r.testWinRate}% | ${r.testAvgOdds} | ${r.testEV}% |`);
    });
    lines.push('');
  }

  lines.push('## 全局TOP20（所有方向+所有过滤）');
  lines.push('');
  lines.push('| 排名 | 方向 | 过滤条件 | 训练注 | 训练胜率 | 训练均赔 | 训练EV | 测试注 | 测试胜率 | 测试均赔 | 测试EV |');
  lines.push('|------|------|---------|--------|---------|---------|-------|-------|---------|---------|-------|');
  globalTop.slice(0, 20).forEach((r, i) => {
    lines.push(`| ${i + 1} | ${r.type} | ${r.filter}:${r.value} | ${r.trainN} | ${r.trainWinRate}% | ${r.trainAvgOdds} | ${r.trainEV}% | ${r.testN} | ${r.testWinRate}% | ${r.testAvgOdds} | ${r.testEV}% |`);
  });
  lines.push('');

  // 关键检查：训练集EV>100%且测试集EV>100%才算真正正EV
  const bothPositive = globalTop.filter(r => r.trainEV > 100 && r.testEV > 100);
  lines.push('## 训练集+测试集都正EV的信号');
  lines.push('');
  if (bothPositive.length) {
    lines.push('| 排名 | 方向 | 过滤条件 | 训练注 | 训练胜率 | 训练均赔 | 训练EV | 测试注 | 测试胜率 | 测试均赔 | 测试EV |');
    lines.push('|------|------|---------|--------|---------|---------|-------|-------|---------|---------|-------|');
    bothPositive.forEach((r, i) => {
      lines.push(`| ${i + 1} | ${r.type} | ${r.filter}:${r.value} | ${r.trainN} | ${r.trainWinRate}% | ${r.trainAvgOdds} | ${r.trainEV}% | ${r.testN} | ${r.testWinRate}% | ${r.testAvgOdds} | ${r.testEV}% |`);
    });
  } else {
    lines.push('❌ **无任何信号能在训练集和测试集同时保持正EV。**');
    lines.push('');

    // 找最接近的
    const sorted = globalTop.filter(r => r.trainEV > 100).sort((a, b) => b.testEV - a.testEV);
    const best = sorted.slice(0, 5);
    lines.push('### 最接近正EV的信号（测试EV最高的TOP5）');
    lines.push('');
    lines.push('| 方向 | 过滤条件 | 训练注 | 训练EV | 测试注 | 测试EV |');
    lines.push('|------|---------|--------|-------|-------|-------|');
    for (const r of best) {
      lines.push(`| ${r.type} | ${r.filter}:${r.value} | ${r.trainN} | ${r.trainEV}% | ${r.testN} | ${r.testEV}% |`);
    }
  }

  lines.push('');
  lines.push('---');
  lines.push('');

  // 各方向EV分布
  lines.push('## 各投注方向基础EV（无过滤）');
  lines.push('');
  lines.push('| 方向 | 总场次 | 胜率 | 均赔 | EV |');
  lines.push('|------|--------|------|------|-----|');
  for (const bt of BET_TYPES) {
    const bets = all.filter(m => m[bt.oddsKey] && m[bt.oddsKey] > 1);
    const wins = bets.filter(m => m[bt.winKey]).length;
    const wr = bets.length ? (wins / bets.length * 100).toFixed(1) : '0';
    const avgOdds = bets.length ? (bets.reduce((s, m) => s + m[bt.oddsKey], 0) / bets.length * 100).toFixed(2) : '0';
    const ev = bets.length ? (wins / bets.length * (bets.reduce((s, m) => s + m[bt.oddsKey], 0) / bets.length) * 100).toFixed(1) : '0';
    lines.push(`| ${bt.key} | ${bets.length} | ${wr}% | ${avgOdds} | ${ev}% |`);
  }
  lines.push('');

  // 写入文件
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(join(OUTPUT_DIR, 'bruteforce_scan_report.md'), lines.join('\n'), 'utf-8');

  // 也输出到控制台
  console.log(lines.join('\n'));
}

main();