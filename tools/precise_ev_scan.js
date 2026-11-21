/**
 * 精确EV扫描 — 用正确的逐注EV公式重扫所有信号
 *
 * 正确EV = Σ(赔率×单注胜) / 总注数
 *   而不是（错误地）平均胜率 × 平均赔率
 *
 * 因为：赢的注赔率往往低（市场看好的方向才赢），输的注赔率往往高
 * 只有逐注累加才能暴露真实期望值
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

        // ===== HAD (胜平负) =====
        const had = cache.oddsHistory?.hadList || [];
        const hadFirst = had[0], hadLast = had[had.length - 1];
        const hadRes = cache.matchResultList?.find(r => r.code === 'HAD');

        // ===== HHAD (让球胜平负) =====
        const hhad = cache.oddsHistory?.hhadList || [];
        const hhadFirst = hhad[0], hhadLast = hhad[hhad.length - 1];
        const hhadRes = cache.matchResultList?.find(r => r.code === 'HHAD');

        if (!hadLast || !hadFirst || !hhadLast || !hhadFirst) continue;
        if (!hadRes || !hhadRes) continue;

        const hDir = hadLast.h > hadFirst.h ? '↑' : hadLast.h < hadFirst.h ? '↓' : '→';
        const dDir = hadLast.d > hadFirst.d ? '↑' : hadLast.d < hadFirst.d ? '↓' : '→';
        const aDir = hadLast.a > hadFirst.a ? '↑' : hadLast.a < hadFirst.a ? '↓' : '→';

        const hhDir = hhadLast.h > hhadFirst.h ? '↑' : hhadLast.h < hhadFirst.h ? '↓' : '→';
        const hdDir = hhadLast.d > hhadFirst.d ? '↑' : hhadLast.d < hhadFirst.d ? '↓' : '→';
        const haDir = hhadLast.a > hhadFirst.a ? '↑' : hhadLast.a < hhadFirst.a ? '↓' : '→';

        out.push({
          matchId: m.matchId, date: m.matchDate, league: m.leagueNameAbbr,
          home: m.homeTeam, away: m.awayTeam, score: m.sectionsNo999,
          goalLine: m.goalLine, hhadGoalLine: hhadLast.goalLine || m.goalLine,

          // HAD 终盘
          h: parseFloat(hadLast.h), d: parseFloat(hadLast.d), a: parseFloat(hadLast.a),
          hadChanges: had.length, hadDir: `h${hDir}d${dDir}a${aDir}`,
          hadWin: { H: hadRes.combination === 'H', D: hadRes.combination === 'D', A: hadRes.combination === 'A' },

          // HHAD 终盘
          hh: parseFloat(hhadLast.h), hd: parseFloat(hhadLast.d), ha: parseFloat(hhadLast.a),
          hhadChanges: hhad.length, hhadDir: `h${hhDir}d${hdDir}a${haDir}`,
          hhadWin: { H: hhadRes.combination === 'H', D: hhadRes.combination === 'D', A: hhadRes.combination === 'A' },
        });
      }
    } catch (e) { /* skip */ }
  }
  return out.sort((a, b) => a.date < b.date ? -1 : 1);
}

// ========== 精确EV计算 ==========

/**
 * 对一组 bets [{odds, won}] 计算精确EV
 * 返回 { n, wins, winRate, preciseEV, avgWinOdds, avgLoseOdds }
 */
function preciseStats(bets) {
  const n = bets.length;
  if (!n) return null;
  const wins = bets.filter(b => b.won).length;
  const winOdds = bets.filter(b => b.won).reduce((s, b) => s + b.odds, 0);
  const loseBets = bets.filter(b => !b.won);
  return {
    n,
    wins,
    winRate: wins / n,
    preciseEV: (winOdds / n) / 1 * 100,  // sum(odds*won)/n*100%
    avgWinOdds: wins ? winOdds / wins : 0,
    avgLoseOdds: (n - wins) ? loseBets.reduce((s, b) => s + b.odds, 0) / (n - wins) : 0,
    fakeAVG: (wins / n) * (bets.reduce((s, b) => s + b.odds, 0) / n) * 100, // 错误公式值，用于对比
  };
}

// 玩法定义
const PLAYS = {
  HAD_H: { odds: m => m.h, win: m => m.hadWin.H, kind: 'HAD' },
  HAD_D: { odds: m => m.d, win: m => m.hadWin.D, kind: 'HAD' },
  HAD_A: { odds: m => m.a, win: m => m.hadWin.A, kind: 'HAD' },
  HHAD_H: { odds: m => m.hh, win: m => m.hhadWin.H, kind: 'HHAD' },
  HHAD_D: { odds: m => m.hd, win: m => m.hhadWin.D, kind: 'HHAD' },
  HHAD_A: { odds: m => m.ha, win: m => m.hhadWin.A, kind: 'HHAD' },
};

// ========== 过滤条件定义 ==========

const FILTERS = {
  // 赔率区间（按玩法方向的赔率）
  oddsRange: {
    apply: (m, play, val) => {
      const o = play.odds(m);
      if (val === '1.0-1.5') return o >= 1.0 && o < 1.5;
      if (val === '1.5-2.0') return o >= 1.5 && o < 2.0;
      if (val === '2.0-3.0') return o >= 2.0 && o < 3.0;
      if (val === '3.0-5.0') return o >= 3.0 && o < 5.0;
      if (val === '5.0+') return o >= 5.0;
      if (val === 'any') return true;
      return false;
    },
    values: ['1.0-1.5', '1.5-2.0', '2.0-3.0', '3.0-5.0', '5.0+'],
  },

  // 变盘次数
  changes: {
    apply: (m, play, val) => {
      const c = play.kind === 'HAD' ? m.hadChanges : m.hhadChanges;
      if (val === '0') return c === 0;
      if (val === '1-2') return c >= 1 && c <= 2;
      if (val === '3-4') return c >= 3 && c <= 4;
      if (val === '5-7') return c >= 5 && c <= 7;
      if (val === '8+') return c >= 8;
      if (val === 'any') return true;
      return false;
    },
    values: ['0', '1-2', '3-4', '5-7', '8+'],
  },

  // 变盘方向模式（该玩法用的赔率表）
  dirPattern: {
    apply: (m, play, val) => {
      const dp = play.kind === 'HAD' ? m.hadDir : m.hhadDir;
      if (val === 'any') return true;
      // 只匹配目标方向的趋势（含h/d/a三向）
      return dp === val;
    },
    values: ['h↑d→a↓', 'h↓d→a↑', 'h↑d↓a↓', 'h↓d↑a↑', 'h→d→a→', 'h→d→a↓', 'h↓d→a→'],
  },

  // 让球盘
  goalLine: {
    apply: (m, play, val) => {
      const gl = m.goalLine;
      if (val === 'any') return true;
      return `${parseInt(gl)}` === val;
    },
    values: ['-2', '-1', '+1', '+2'],
  },

  // 联赛级别
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
};

// 需要排除的赔率<1.1过低（近似必赢，无信息）
function validOdds(o) { return o && o > 1.1; }

// ========== 扫描 ==========

function scan(train, test) {
  const results = [];

  // 单维度
  for (const [playName, play] of Object.entries(PLAYS)) {
    for (const [fName, f] of Object.entries(FILTERS)) {
      for (const val of f.values) {
        const trBets = train.filter(m => validOdds(play.odds(m)) && f.apply(m, play, val)).map(m => ({ odds: play.odds(m), won: play.win(m) }));
        if (trBets.length < 20) continue;
        const ts = preciseStats(trBets);

        const teBets = test.filter(m => validOdds(play.odds(m)) && f.apply(m, play, val)).map(m => ({ odds: play.odds(m), won: play.win(m) }));
        const tts = teBets.length ? preciseStats(teBets) : null;

        results.push({
          play: playName, filter: fName, value: val,
          trN: ts.n, trWR: ts.winRate, trEV: ts.preciseEV,
          trAvgWin: ts.avgWinOdds, trAvgLose: ts.avgLoseOdds,
          teN: tts?.n || 0, teEV: tts?.preciseEV || 0, teWR: tts?.winRate || 0,
        });
      }
    }
  }

  // 组合（两维度）
  const filterPairs = [
    ['changes', 'leagueTier'],
    ['oddsRange', 'leagueTier'],
    ['changes', 'goalLine'],
    ['dirPattern', 'goalLine'],
    ['oddsRange', 'dirPattern'],
    ['changes', 'dirPattern'],
  ];
  for (const [f1n, f2n] of filterPairs) {
    const f1 = FILTERS[f1n], f2 = FILTERS[f2n];
    for (const [playName, play] of Object.entries(PLAYS)) {
      for (const v1 of f1.values) {
        for (const v2 of f2.values) {
          const trBets = train
            .filter(m => validOdds(play.odds(m)) && f1.apply(m, play, v1) && f2.apply(m, play, v2))
            .map(m => ({ odds: play.odds(m), won: play.win(m) }));
          if (trBets.length < 20) continue;
          const ts = preciseStats(trBets);

          const teBets = test
            .filter(m => validOdds(play.odds(m)) && f1.apply(m, play, v1) && f2.apply(m, play, v2))
            .map(m => ({ odds: play.odds(m), won: play.win(m) }));
          const tts = teBets.length ? preciseStats(teBets) : null;

          results.push({
            play: playName, filter: `${f1n}+${f2n}`, value: `${v1} + ${v2}`,
            trN: ts.n, trWR: ts.winRate, trEV: ts.preciseEV,
            trAvgWin: ts.avgWinOdds, trAvgLose: ts.avgLoseOdds,
            teN: tts?.n || 0, teEV: tts?.preciseEV || 0, teWR: tts?.winRate || 0,
          });
        }
      }
    }
  }

  return results;
}

// ========== 主函数 ==========

function main() {
  console.log('=== 精确EV扫描 — 全部玩法×全部过滤 ===\n');
  const all = loadAll();
  console.log(`总场次: ${all.length}\n`);
  const splitIdx = Math.floor(all.length * 0.65);
  const train = all.slice(0, splitIdx);
  const test = all.slice(splitIdx);
  console.log(`训练: ${train.length} | 测试: ${test.length}\n`);

  const results = scan(train, test);

  // 筛选：训练精确EV>98%（接近正），测试也有一定量
  const candidates = results
    .filter(r => r.trN >= 30 && r.trEV >= 98 && r.teN >= 15)
    .sort((a, b) => b.trEV - a.trEV);

  const lines = [];
  lines.push('# 精确EV扫描报告');
  lines.push('');
  lines.push(`> 总场次 ${all.length} | 训练 ${train.length} | 测试 ${test.length}`);
  lines.push(`> **精确EV = Σ(赔率×单注胜)/N**，逐注计算，非平均胜率×平均赔率`);
  lines.push('');

  // 基础EV
  lines.push('## 各玩法基础精确EV（全量无过滤）');
  lines.push('');
  lines.push('| 玩法 | 注数 | 胜率 | 精确EV | 赢均赔 | 输均赔 | 抽水 |');
  lines.push('|------|------|------|--------|--------|--------|------|');
  for (const [pn, play] of Object.entries(PLAYS)) {
    const bets = all.filter(m => validOdds(play.odds(m))).map(m => ({ odds: play.odds(m), won: play.win(m) }));
    const s = preciseStats(bets);
    lines.push(`| ${pn} | ${s.n} | ${(s.winRate*100).toFixed(1)}% | ${s.preciseEV.toFixed(1)}% | ${s.avgWinOdds.toFixed(2)} | ${s.avgLoseOdds.toFixed(2)} | ${(100-s.preciseEV).toFixed(1)}% |`);
  }
  lines.push('');

  lines.push('## 精确EV最接近正的信号（训练EV>98% 且 样本≥30）');
  lines.push('');
  if (candidates.length) {
    lines.push('| 玩法 | 过滤 | 值 | 注数 | 胜率 | 精确EV | 赢均赔 | 输均赔 | 测试注 | 测试EV |');
    lines.push('|------|------|-----|------|------|--------|--------|--------|--------|--------|');
    for (const r of candidates.slice(0, 60)) {
      lines.push(`| ${r.play} | ${r.filter} | ${r.value} | ${r.trN} | ${(r.trWR*100).toFixed(1)}% | ${r.trEV.toFixed(1)}% | ${r.trAvgWin.toFixed(2)} | ${r.trAvgLose.toFixed(2)} | ${r.teN} | ${r.teEV.toFixed(1)}% |`);
    }
  } else {
    lines.push('❌ 无任何信号训练精确EV≥98%');
  }
  lines.push('');

  // 双集都正
  const doublePos = candidates.filter(r => r.teN >= 10 && r.teEV >= 100 && r.trEV >= 100);
  lines.push('## 训练+测试精确EV都≥100%（真正正EV候选）');
  lines.push('');
  if (doublePos.length) {
    lines.push('| 玩法 | 过滤 | 值 | 训练注 | 训练EV | 测试注 | 测试EV |');
    lines.push('|------|------|-----|--------|--------|--------|--------|');
    for (const r of doublePos) {
      lines.push(`| ${r.play} | ${r.filter} | ${r.value} | ${r.trN} | ${r.trEV.toFixed(1)}% | ${r.teN} | ${r.teEV.toFixed(1)}% |`);
    }
  } else {
    lines.push('❌ **无任何信号在训练集和测试集都达到精确EV≥100%**');
    lines.push('');
    lines.push('结论：竞彩赔率市场定价精确，所有信号的精确EV都被压到≤100%。');
  }
  lines.push('');

  // 让球平玩法专项
  lines.push('## HHAD_D(让球平)专项 — 高赔率玩法EV结构');
  lines.push('');
  const hhadD = all.filter(m => validOdds(m.hd)).map(m => ({ odds: m.hd, won: m.hhadWin.D }));
  const hdS = preciseStats(hhadD);
  lines.push(`全量让球平: ${hdS.n}注 胜率${(hdS.winRate*100).toFixed(1)}% 精确EV ${hdS.preciseEV.toFixed(1)}% 赢均赔${hdS.avgWinOdds.toFixed(2)} 输均赔${hdS.avgLoseOdds.toFixed(2)}`);
  lines.push('');
  for (const val of ['3.0-3.5', '3.5-4.0', '4.0-4.5', '4.5-5.0']) {
    const [lo, hi] = val.split('-').map(Number);
    const sub = all.filter(m => validOdds(m.hd) && m.hd >= lo && m.hd < hi).map(m => ({ odds: m.hd, won: m.hhadWin.D }));
    if (!sub.length) continue;
    const s = preciseStats(sub);
    lines.push(`让球平赔率${lo}-${hi}: ${s.n}注 胜率${(s.winRate*100).toFixed(1)}% 精确EV ${s.preciseEV.toFixed(1)}% 赢均赔${s.avgWinOdds.toFixed(2)} 输均赔${s.avgLoseOdds.toFixed(2)}`);
  }
  lines.push('');

  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(join(OUTPUT_DIR, 'precise_ev_scan_report.md'), lines.join('\n'), 'utf-8');

  // 控制台输出关键部分
  console.log(lines.slice(0, candidates.length ? 60 : 40).join('\n'));
  if (doublePos.length) {
    console.log('\n=== 双集正EV ===');
    doublePos.forEach(r => console.log(`${r.play} ${r.filter}:${r.value} 训练${r.trN}注EV${r.trEV.toFixed(1)}% 测试${r.teN}注EV${r.teEV.toFixed(1)}%`));
  }
  console.log('\n报告: precise_ev_scan_report.md');
}

main();