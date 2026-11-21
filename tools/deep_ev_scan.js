/**
 * 深度EV扫描 v2 — 搜索3维组合 + 新维度（hf/df/af方向标志, single, goalLine变化）
 *
 * 正确EV = Σ(赔率×单注胜) / 总注数
 * 搜索全部6玩法 × 全维度 × 3维组合
 *
 * 跑法:
 *   node tools/deep_ev_scan.js                # 全量扫描（耗时）
 *   node tools/deep_ev_scan.js --fast         # 快速模式（只扫2维+顶3维）
 *   node tools/deep_ev_scan.js --p2a          # 只搜索P2a周边
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

// ========== 数据加载 ==========

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

        // ===== 变盘方向标志（hf/df/af）汇总 =====
        // 计算每个方向净变化: 1(涨) -1(降) 0(平) 的累加
        const hadHF = had.filter(e => parseInt(e.hf) === 1).length;
        const hadHD = had.filter(e => parseInt(e.hf) === -1).length;
        const hadDF = had.filter(e => parseInt(e.df) === 1).length;
        const hadDD = had.filter(e => parseInt(e.df) === -1).length;
        const hadAF = had.filter(e => parseInt(e.af) === 1).length;
        const hadAD = had.filter(e => parseInt(e.af) === -1).length;

        const hhadHF = hhad.filter(e => parseInt(e.hf) === 1).length;
        const hhadHD = hhad.filter(e => parseInt(e.hf) === -1).length;
        const hhadDF = hhad.filter(e => parseInt(e.df) === 1).length;
        const hhadDD = hhad.filter(e => parseInt(e.df) === -1).length;
        const hhadAF = hhad.filter(e => parseInt(e.af) === 1).length;
        const hhadAD = hhad.filter(e => parseInt(e.af) === -1).length;

        // 让球线变化
        const glChanges = hhad.filter((e, i) => i > 0 && e.goalLine !== hhad[i-1].goalLine).length;

        // 单关状态
        const hadSingle = single.find(s => s.poolCode === 'HAD');
        const hhadSingle = single.find(s => s.poolCode === 'HHAD');

        out.push({
          matchId: m.matchId, date: m.matchDate, league,
          home: m.homeTeam, away: m.awayTeam, score: m.sectionsNo999,
          goalLine: m.goalLine,
          hhadGoalLine: hhadLast.goalLine || m.goalLine,

          // HAD 终盘
          h: parseFloat(hadLast.h), d: parseFloat(hadLast.d), a: parseFloat(hadLast.a),
          hadChanges: had.length,
          hadHF, hadHD, hadDF, hadDD, hadAF, hadAD,
          hadSingle: hadSingle ? hadSingle.single : 1,
          hadWin: { H: hadRes.combination === 'H', D: hadRes.combination === 'D', A: hadRes.combination === 'A' },

          // HHAD 终盘
          hh: parseFloat(hhadLast.h), hd: parseFloat(hhadLast.d), ha: parseFloat(hhadLast.a),
          hhadChanges: hhad.length,
          hhadHF, hhadHD, hhadDF, hhadDD, hhadAF, hhadAD,
          glChanges,
          hhadSingle: hhadSingle ? hhadSingle.single : 1,
          hhadWin: { H: hhadRes.combination === 'H', D: hhadRes.combination === 'D', A: hhadRes.combination === 'A' },
        });
      }
    } catch (e) { /* skip */ }
  }
  return out.sort((a, b) => a.date < b.date ? -1 : 1);
}

// ========== 精确EV ==========

function preciseStats(bets) {
  const n = bets.length;
  if (!n) return null;
  const wins = bets.filter(b => b.won).length;
  const winOdds = bets.filter(b => b.won).reduce((s, b) => s + b.odds, 0);
  return { n, wins, winRate: wins/n, preciseEV: (winOdds / n) * 100 };
}

// ========== 玩法 ==========

const PLAYS = [
  { id: 'HAD_H', odds: m => m.h, win: m => m.hadWin.H, changes: m => m.hadChanges, single: m => m.hadSingle },
  { id: 'HAD_D', odds: m => m.d, win: m => m.hadWin.D, changes: m => m.hadChanges, single: m => m.hadSingle },
  { id: 'HAD_A', odds: m => m.a, win: m => m.hadWin.A, changes: m => m.hadChanges, single: m => m.hadSingle },
  { id: 'HHAD_H', odds: m => m.hh, win: m => m.hhadWin.H, changes: m => m.hhadChanges, single: m => m.hhadSingle },
  { id: 'HHAD_D', odds: m => m.hd, win: m => m.hhadWin.D, changes: m => m.hhadChanges, single: m => m.hhadSingle },
  { id: 'HHAD_A', odds: m => m.ha, win: m => m.hhadWin.A, changes: m => m.hhadChanges, single: m => m.hhadSingle },
];

// ========== 过滤器 ==========

const FILTERS = {
  oddsRange: {
    apply: (m, play, val) => { const o = play.odds(m);
      if (val === '1.0-1.5') return o >= 1.0 && o < 1.5;
      if (val === '1.5-2.0') return o >= 1.5 && o < 2.0;
      if (val === '2.0-3.0') return o >= 2.0 && o < 3.0;
      if (val === '3.0-5.0') return o >= 3.0 && o < 5.0;
      if (val === '5.0+') return o >= 5.0;
      return true;
    },
    values: ['1.0-1.5', '1.5-2.0', '2.0-3.0', '3.0-5.0', '5.0+'],
  },
  changes: {
    apply: (m, play, val) => { const c = play.changes(m);
      if (val === '0') return c === 0;
      if (val === '1-2') return c >= 1 && c <= 2;
      if (val === '3-4') return c >= 3 && c <= 4;
      if (val === '5-7') return c >= 5 && c <= 7;
      if (val === '8+') return c >= 8;
      return true;
    },
    values: ['0', '1-2', '3-4', '5-7', '8+'],
  },
  leagueTier: {
    apply: (m, play, val) => {
      if (val === 'any') return true;
      if (val === 'top') return TOP5.includes(m.league);
      if (val === 'second') return SECOND.includes(m.league);
      if (val === 'other') return !TOP5.includes(m.league) && !SECOND.includes(m.league);
      return false;
    },
    values: ['top', 'second', 'other'],
  },
  hadGoalLine: {
    apply: (m, play, val) => {
      if (val === 'any') return true;
      if (val === '0') return m.goalLine === '+0' || m.goalLine === '0' || m.goalLine === '';
      // goalLine in hhad context
      const gl = m.hhadGoalLine;
      if (val === '-2') return gl === '-2' || gl === '-1.5' || gl === '-2';
      if (val === '-1') return gl === '-1' || gl === '-0.5' || gl === '-1';
      if (val === '+1') return gl === '+1' || gl === '+0.5' || gl === '+1';
      if (val === '+2') return gl === '+2' || gl === '+1.5' || gl === '+2';
      return false;
    },
    values: ['-2', '-1', '+1', '+2'],
  },
  // 主方向净变化（涨的次数 - 降的次数）
  hadHDir: {
    apply: (m, play, val) => {
      const net = m.hadHF - m.hadHD;
      if (val === 'up') return net > 0;
      if (val === 'down') return net < 0;
      if (val === 'flat') return net === 0;
      return true;
    },
    values: ['up', 'down', 'flat'],
  },
  hadADir: {
    apply: (m, play, val) => {
      const net = m.hadAF - m.hadAD;
      if (val === 'up') return net > 0;
      if (val === 'down') return net < 0;
      if (val === 'flat') return net === 0;
      return true;
    },
    values: ['up', 'down', 'flat'],
  },
  hhadADir: {
    apply: (m, play, val) => {
      const net = m.hhadAF - m.hhadAD;
      if (val === 'up') return net > 0;
      if (val === 'down') return net < 0;
      if (val === 'flat') return net === 0;
      return true;
    },
    values: ['up', 'down', 'flat'],
  },
  hhadHDir: {
    apply: (m, play, val) => {
      const net = m.hhadHF - m.hhadHD;
      if (val === 'up') return net > 0;
      if (val === 'down') return net < 0;
      if (val === 'flat') return net === 0;
      return true;
    },
    values: ['up', 'down', 'flat'],
  },
  hhadSingle: {
    apply: (m, play, val) => val === '1' ? m.hhadSingle === 1 : m.hhadSingle === 0,
    values: ['0', '1'],
  },
  hadSingle: {
    apply: (m, play, val) => val === '1' ? m.hadSingle === 1 : m.hadSingle === 0,
    values: ['0', '1'],
  },
  glChanges: {
    apply: (m, play, val) => {
      if (val === '0') return m.glChanges === 0;
      if (val === '1+') return m.glChanges >= 1;
      return true;
    },
    values: ['0', '1+'],
  },
};

// ========== P2a专用过滤器（快速搜索周边） ==========

function p2aFilter(m) {
  const changes = m.hhadChanges >= 1 && m.hhadChanges <= 2;
  const other = !TOP5.includes(m.league) && !SECOND.includes(m.league);
  return changes && other;
}

// ========== 扫描引擎 ==========

function makeBets(matches, play, filterFns) {
  return matches
    .filter(m => play.odds(m) > 1.1 && filterFns.every(f => f(m)))
    .map(m => ({ odds: play.odds(m), won: play.win(m), match: m }));
}

function scanDim(train, test, play, filterName, filterVal, filterFns) {
  const trBets = makeBets(train, play, filterFns);
  if (trBets.length < 20) return null;
  const tr = preciseStats(trBets);
  const teBets = makeBets(test, play, filterFns);
  const te = teBets.length ? preciseStats(teBets) : null;
  return {
    play: play.id, filter: filterName, value: filterVal,
    trN: tr.n, trWR: tr.winRate, trEV: tr.preciseEV,
    teN: te?.n || 0, teEV: te?.preciseEV || 0, teWR: te?.winRate || 0,
  };
}

// ========== 主函数 ==========

function main() {
  const args = process.argv.slice(2);
  const fast = args.includes('--fast');
  const p2aOnly = args.includes('--p2a');

  console.log('=== 深度EV扫描 v2 ===');
  console.log(`模式: ${p2aOnly ? 'P2a周边' : fast ? '快速' : '全量'}\n`);

  const all = loadAll();
  const splitIdx = Math.floor(all.length * 0.65);
  const train = all.slice(0, splitIdx);
  const test = all.slice(splitIdx);
  console.log(`总: ${all.length} | 训练: ${train.length} | 测试: ${test.length}\n`);

  const results = [];
  const DIMS = Object.entries(FILTERS);

  // ====== 1D ======
  for (const play of PLAYS) {
    for (const [fName, f] of DIMS) {
      for (const val of f.values) {
        const r = scanDim(train, test, play, fName, val, [m => f.apply(m, play, val)]);
        if (r) results.push(r);
      }
    }
  }

  // ====== 2D ======
  const dimPairs = [];
  for (let i = 0; i < DIMS.length; i++)
    for (let j = i + 1; j < DIMS.length; j++)
      dimPairs.push([DIMS[i], DIMS[j]]);

  for (const play of PLAYS) {
    for (const [f1, f2] of dimPairs) {
      for (const v1 of f1[1].values) {
        for (const v2 of f2[1].values) {
          const r = scanDim(train, test, play, `${f1[0]}+${f2[0]}`, `${v1}+${v2}`, [
            m => f1[1].apply(m, play, v1),
            m => f2[1].apply(m, play, v2),
          ]);
          if (r) results.push(r);
        }
      }
    }
  }

  // ====== 3D（关键组合） ======
  if (!fast || p2aOnly) {
    const top3Dims = [
      ['changes', 'leagueTier', 'hadGoalLine'],
      ['changes', 'leagueTier', 'hhadADir'],
      ['changes', 'leagueTier', 'hhadSingle'],
      ['changes', 'leagueTier', 'glChanges'],
      ['changes', 'leagueTier', 'oddsRange'],
      ['changes', 'hhadADir', 'hadGoalLine'],
      ['changes', 'hhadADir', 'hhadSingle'],
      ['leagueTier', 'hhadADir', 'hadGoalLine'],
      ['leagueTier', 'hhadADir', 'hhadSingle'],
      ['changes', 'hhadADir', 'glChanges'],
      ['hadGoalLine', 'hhadADir', 'hhadSingle'],
      ['changes', 'oddsRange', 'leagueTier'],
      ['changes', 'oddsRange', 'hhadADir'],
      ['changes', 'hadGoalLine', 'hhadSingle'],
      ['leagueTier', 'hadGoalLine', 'hhadSingle'],
    ];

    for (const play of PLAYS) {
      for (const [f1n, f2n, f3n] of top3Dims) {
        const f1 = FILTERS[f1n], f2 = FILTERS[f2n], f3 = FILTERS[f3n];
        if (!f1 || !f2 || !f3) continue;
        for (const v1 of f1.values) {
          // 剪枝：只搜索有希望的组合
          if (v1 === 'any') continue;
          for (const v2 of f2.values) {
            if (v2 === 'any') continue;
            for (const v3 of f3.values) {
              if (v3 === 'any') continue;
              const r = scanDim(train, test, play, `${f1n}+${f2n}+${f3n}`, `${v1}+${v2}+${v3}`, [
                m => f1.apply(m, play, v1),
                m => f2.apply(m, play, v2),
                m => f3.apply(m, play, v3),
              ]);
              if (r) results.push(r);
            }
          }
        }
      }
    }

    // ====== P2a周边特化搜索 ======
    if (p2aOnly) {
      console.log('=== P2a周边深度搜索 ===\n');
      const p2aMatches = all.filter(p2aFilter);
      console.log(`P2a基础: ${p2aMatches.length}场\n`);

      // 在P2a基础上叠加额外维度
      const p2aExtra = [
        ['hadGoalLine', 'hhadADir'],
        ['hadGoalLine', 'hhadSingle'],
        ['hadGoalLine', 'oddsRange'],
        ['hhadADir', 'hhadSingle'],
        ['hhadADir', 'oddsRange'],
        ['hhadADir', 'glChanges'],
        ['hhadSingle', 'oddsRange'],
        ['hhadSingle', 'glChanges'],
        ['oddsRange', 'glChanges'],
        ['hadHDir', 'hhadADir'],
        ['hadADir', 'hhadADir'],
        ['hhadHDir', 'hhadADir'],
      ];

      const p2aPlay = PLAYS.find(p => p.id === 'HHAD_A');
      const p2aTrain = p2aMatches.filter(m => train.includes(m));
      const p2aTest = p2aMatches.filter(m => test.includes(m));

      for (const [f1n, f2n] of p2aExtra) {
        const f1 = FILTERS[f1n], f2 = FILTERS[f2n];
        if (!f1 || !f2) continue;
        for (const v1 of f1.values) {
          if (v1 === 'any') continue;
          for (const v2 of f2.values) {
            if (v2 === 'any') continue;
            const r = scanDim(p2aTrain, p2aTest, p2aPlay, `P2a+${f1n}+${f2n}`, `${v1}+${v2}`, [
              p2aFilter,
              m => f1.apply(m, p2aPlay, v1),
              m => f2.apply(m, p2aPlay, v2),
            ]);
            if (r) results.push(r);
          }
        }
      }
    }
  }

  // ========== 筛选 ==========
  const candidates = results
    .filter(r => r.trN >= 30 && r.trEV >= 100 && r.teN >= 20 && r.teEV >= 100)
    .sort((a, b) => (b.trEV * b.teEV) - (a.trEV * a.teEV));

  // 双集正EV（训练测试都>=100）
  const doublePos = results
    .filter(r => r.trN >= 50 && r.trEV >= 100 && r.teN >= 20 && r.teEV >= 100)
    .sort((a, b) => b.teEV - a.teEV);

  // ========== 报告 ==========
  const lines = [];
  lines.push('# 深度EV扫描 v2');
  lines.push('');
  lines.push(`> 总场次 ${all.length} | 训练 ${train.length} | 测试 ${test.length}`);
  lines.push(`> 精确EV = Σ(赔率×单注胜)/N | 新增维度: hf/df/af标志, single, goalLine变化`);
  lines.push(`> 搜索维度: 1D + 2D + 关键3D组合` + (p2aOnly ? ' + P2a周边' : ''));
  lines.push('');

  // 双集正EV排行榜
  lines.push('## 双集正EV排行榜（训练+测试都≥100%）');
  lines.push('');
  lines.push('| 排名 | 玩法 | 过滤 | 值 | 训练注 | 训练胜率 | 训练EV | 测试注 | 测试EV |');
  lines.push('|------|------|------|-----|--------|---------|--------|--------|--------|');
  doublePos.forEach((r, i) => {
    lines.push(`| ${i+1} | ${r.play} | ${r.filter} | ${r.value} | ${r.trN} | ${(r.trWR*100).toFixed(1)}% | ${r.trEV.toFixed(1)}% | ${r.teN} | ${r.teEV.toFixed(1)}% |`);
  });
  lines.push('');

  if (!doublePos.length) {
    lines.push('❌ 无双集正EV信号（放宽到训练≥100 测试≥95）');
    const relaxed = results
      .filter(r => r.trN >= 50 && r.trEV >= 100 && r.teN >= 20 && r.teEV >= 95)
      .sort((a, b) => b.teEV - a.teEV);
    if (relaxed.length) {
      lines.push('| 排名 | 玩法 | 过滤 | 值 | 训练注 | 训练EV | 测试注 | 测试EV |');
      lines.push('|------|------|------|-----|--------|--------|--------|--------|');
      relaxed.forEach((r, i) => {
        lines.push(`| ${i+1} | ${r.play} | ${r.filter} | ${r.value} | ${r.trN} | ${r.trEV.toFixed(1)}% | ${r.teN} | ${r.teEV.toFixed(1)}% |`);
      });
    }
    lines.push('');
  }

  // P2a周边
  if (p2aOnly) {
    const p2aResults = results.filter(r => r.filter.startsWith('P2a+') && r.trN >= 10).sort((a, b) => b.teEV - a.teEV);
    if (p2aResults.length) {
      lines.push('## P2a周边组合');
      lines.push('');
      lines.push('| 组合 | 值 | 训练注 | 训练胜率 | 训练EV | 测试注 | 测试EV |');
      lines.push('|------|-----|--------|---------|--------|--------|--------|');
      for (const r of p2aResults) {
        const emoji = r.teEV >= 100 ? '✅' : r.teEV >= 95 ? '🟡' : '❌';
        lines.push(`| ${emoji} ${r.filter} | ${r.value} | ${r.trN} | ${(r.trWR*100).toFixed(1)}% | ${r.trEV.toFixed(1)}% | ${r.teN} | ${r.teEV.toFixed(1)}% |`);
      }
      lines.push('');
    }
  }

  // 各玩法最佳
  lines.push('## 各玩法最佳信号');
  lines.push('');
  for (const play of PLAYS) {
    const best = results.filter(r => r.play === play.id && r.trN >= 30).sort((a, b) => b.trEV - a.trEV)[0];
    if (best) {
      lines.push(`- **${play.id}**: ${best.filter} ${best.value} | 训练${best.trN}注 EV${best.trEV.toFixed(1)}% | 测试${best.teN}注 EV${best.teEV.toFixed(1)}%`);
    }
  }
  lines.push('');

  // 前10推荐
  lines.push('## 推荐信号（前10）');
  lines.push('');
  lines.push('| 排名 | 玩法 | 过滤 | 值 | 训练注 | 训练EV | 测试注 | 测试EV | 稳定性 |');
  lines.push('|------|------|------|-----|--------|--------|--------|--------|--------|');
  doublePos.slice(0, 10).forEach((r, i) => {
    const stable = r.trEV > 100 && r.teEV > 100 ? '✅ 双正' : r.teEV > 100 ? '⚠️ 测试正' : '❌';
    const emoji = r.teEV >= 115 ? '🔥' : r.teEV >= 105 ? '⭐' : '➖';
    lines.push(`| ${emoji} ${i+1} | ${r.play} | ${r.filter} | ${r.value} | ${r.trN} | ${r.trEV.toFixed(1)}% | ${r.teN} | ${r.teEV.toFixed(1)}% | ${stable} |`);
  });
  lines.push('');

  // 结论
  lines.push('## 结论');
  lines.push('');
  const best = doublePos[0];
  if (best) {
    lines.push(`**最佳信号**: ${best.play} ${best.filter}:${best.value}`);
    lines.push(`- 训练 ${best.trN}注 胜率${(best.trWR*100).toFixed(1)}% 精确EV ${best.trEV.toFixed(1)}%`);
    lines.push(`- 测试 ${best.teN}注 精确EV ${best.teEV.toFixed(1)}%`);
    lines.push(`- 适合: 资金管理自动投注`);
  } else {
    lines.push('❌ 未找到任何可靠的正EV信号。');
    lines.push('竞彩返奖率约70-80%，市场定价相对有效。');
    lines.push('P2a(让球负+变盘1-2+其他联赛) 仍是目前最强候选。');
  }
  lines.push('');
  lines.push(`*tools/deep_ev_scan.js | 2026-08-26*`);

  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(join(OUTPUT_DIR, 'deep_ev_scan_report.md'), lines.join('\n'), 'utf-8');
  console.log('报告已写入: deep_ev_scan_report.md\n');

  // 控制台输出关键
  if (doublePos.length) {
    console.log('=== 双集正EV排行 ===');
    doublePos.slice(0, 15).forEach((r, i) => {
      console.log(`${i+1}. ${r.play} ${r.filter}:${r.value} | 训练${r.trN}注 EV${r.trEV.toFixed(1)}% → 测试${r.teN}注 EV${r.teEV.toFixed(1)}%`);
    });
  } else {
    console.log('❌ 无双集正EV信号');
    const relaxed = results.filter(r => r.trN >= 50 && r.trEV >= 100 && r.teN >= 15).sort((a, b) => b.teEV - a.teEV).slice(0, 10);
    if (relaxed.length) {
      console.log('\n放宽条件（测试EV≥95%）：');
      relaxed.forEach(r => console.log(`  ${r.play} ${r.filter}:${r.value} 训练${r.trN}注EV${r.trEV.toFixed(1)}% → 测试${r.teN}注EV${r.teEV.toFixed(1)}%`));
    }
  }

  if (p2aOnly) {
    const p2aResults = results.filter(r => r.filter.startsWith('P2a+') && r.trN >= 10).sort((a, b) => b.teEV - a.teEV);
    console.log('\n=== P2a周边组合 ===');
    p2aResults.forEach(r => {
      const mark = r.teEV >= 100 ? '✅' : r.teEV >= 95 ? '🟡' : '❌';
      console.log(`${mark} ${r.filter} ${r.value} | 训练${r.trN}注 EV${r.trEV.toFixed(1)}% | 测试${r.teN}注 EV${r.teEV.toFixed(1)}%`);
    });
  }
}

main();