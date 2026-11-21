/**
 * tools/handicap_round2.js — 让球盘第2轮：组合信号验证
 *
 * 用 strict 时间切割 out-of-sample 验证：
 *  train = 2026-01-01 ~ 2026-04-30
 *  test  = 2026-05-01 ~ 2026-08-25
 *
 * 重点验证：
 *  A) -1盘 + 主胜赔率2.0-3.0 → 让球负A
 *  B) +1盘 + 1.5-2.0区间 → 让球胜H
 *  C) 让球平方向 all
 *  D) 变盘次数的真实定义（hhadList.length-1）
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const HIST_DIR = join(ROOT, 'data', 'history', 'football');
const CACHE_DIR = join(ROOT, 'data', 'history', '_odds_cache');

function settleHandicap(score, goalLine) {
  const gl = parseFloat(goalLine);
  if (isNaN(gl)) return null;
  const [hs, as] = score.split(':').map(Number);
  const homeAdj = hs + gl;
  return homeAdj === as ? 'D' : homeAdj > as ? 'H' : 'A';
}

function getOddsDetail(matchId) {
  const f = join(CACHE_DIR, `${matchId}.json`);
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch (e) { return null; }
}

function loadAllMatches() {
  const files = existsSync(HIST_DIR)
    ? readdirSync(HIST_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_merged')).sort()
    : [];
  const out = [];
  for (const f of files) {
    try {
      const d = JSON.parse(readFileSync(join(HIST_DIR, f), 'utf8'));
      for (const m of d.matches || []) {
        if (!m.sectionsNo999) continue;
        if (m.poolStatus !== 'Payout' && m.poolStatus !== 'Refund' && m.poolStatus !== '') continue;
        if (!m.goalLine || m.goalLine === '') continue;
        const h = parseFloat(m.h), dd = parseFloat(m.d), a = parseFloat(m.a);
        if (isNaN(h) || isNaN(dd) || isNaN(a)) continue;
        const hh = settleHandicap(m.sectionsNo999, m.goalLine);
        if (!hh) continue;

        const detail = getOddsDetail(m.matchId);
        const hhadList = detail?.oddsHistory?.hhadList || [];
        const hadList = detail?.oddsHistory?.hadList || [];

        let hhOdds = null, hdOdds = null, haOdds = null;
        let hhOpenOdds = null, hdOpenOdds = null, haOpenOdds = null;
        let hhadChanges = 0; // 让球盘变盘次数 = 快照数-1
        if (hhadList.length > 0) {
          const last = hhadList[hhadList.length - 1];
          hhOdds = parseFloat(last.h); hdOdds = parseFloat(last.d); haOdds = parseFloat(last.a);
          const first = hhadList[0];
          hhOpenOdds = parseFloat(first.h); hdOpenOdds = parseFloat(first.d); haOpenOdds = parseFloat(first.a);
          hhadChanges = Math.max(0, hhadList.length - 1);
        }
        // 让球盘被压方向
        let hhadPress = null;
        if (hhadList.length >= 2) {
          const f0 = hhadList[0], l0 = hhadList[hhadList.length - 1];
          const dr = {
            h: parseFloat(f0.h) - parseFloat(l0.h),
            d: parseFloat(f0.d) - parseFloat(l0.d),
            a: parseFloat(f0.a) - parseFloat(l0.a)
          };
          if (dr.h > dr.a && dr.h > dr.d) hhadPress = 'H';
          else if (dr.a > dr.h && dr.a > dr.d) hhadPress = 'A';
          else if (dr.d > 0 && dr.d >= dr.h && dr.d >= dr.a) hhadPress = 'D';
        }

        // 欧赔变盘
        let hadChanges = 0;
        if (hadList.length > 0) hadChanges = Math.max(0, hadList.length - 1);

        out.push({
          matchId: m.matchId, date: m.matchDate, league: m.leagueNameAbbr,
          home: m.homeTeam, away: m.awayTeam,
          h, d: dd, a, goalLine: m.goalLine, glNum: parseFloat(m.goalLine),
          score: m.sectionsNo999, winFlag: m.winFlag, handicap: hh,
          hhOdds, hdOdds, haOdds, hhOpenOdds, hdOpenOdds, haOpenOdds,
          hhadChanges, hhadPress, hadChanges,
        });
      }
    } catch (e) { /* skip */ }
  }
  return out.sort((x, y) => x.date < y.date ? -1 : 1);
}

// ── 分析工具 ─────────────────────────────────────────
function fmtPct(n, total) { return total === 0 ? '0.0%' : (n / total * 100).toFixed(1) + '%'; }

function reportSignal(subset, label, direction, oddsFn) {
  const total = subset.length;
  const hit = subset.filter(m => m.handicap === direction).length;
  const hitRate = total > 0 ? hit / total : 0;
  const oddsVals = subset.map(oddsFn).filter(o => o && !isNaN(o));
  const avgOdds = oddsVals.length > 0 ? (oddsVals.reduce((a, b) => a + b, 0) / oddsVals.length) : null;
  const medianOdds = oddsVals.length > 0 ? [...oddsVals].sort((a, b) => a - b)[Math.floor(oddsVals.length / 2)] : null;
  let ev = null;
  if (avgOdds && hitRate > 0) ev = hitRate * avgOdds * 100;
  return {
    label, total, hit, hitRate: hitRate * 100,
    avgOdds: avgOdds ? avgOdds.toFixed(2) : '-',
    medianOdds: medianOdds ? medianOdds.toFixed(2) : '-',
    ev: ev ? ev.toFixed(1) : '-',   // >>100 表示正EV
    sample: subset.map(m => `${m.date}|${m.league}|${m.home}vs${m.away}|${m.score}|gl${m.goalLine}`)
  };
}

const matches = loadAllMatches();
const train = matches.filter(m => m.date <= '2026-04-30');
const test = matches.filter(m => m.date > '2026-04-30');

console.log('总场次:', matches.length, ' train:', train.length, ' test:', test.length);

const r = (m) => {
  const mn = Math.min(m.h, m.d, m.a);
  if (mn < 1.5) return 'A1.0-1.5';
  if (mn < 2.0) return 'B1.5-2.0';
  if (mn < 3.0) return 'C2.0-3.0';
  if (mn < 5.0) return 'D3.0-5.0';
  return 'E5.0+';
};

console.log('\n═══════ 信号A: -1盘 + 主胜赔率区间 ═══════');
for (const bucket of ['A1.0-1.5', 'B1.5-2.0', 'C2.0-3.0', 'D3.0-5.0', 'E5.0+']) {
  const tr = train.filter(m => m.goalLine === '-1' && r(m) === bucket);
  const te = test.filter(m => m.goalLine === '-1' && r(m) === bucket);
  const trA = reportSignal(tr, 'train', 'A', m => m.haOdds);
  const teA = reportSignal(te, 'test', 'A', m => m.haOdds);
  console.log(`[${bucket}] train: n=${trA.total} A率=${trA.hitRate.toFixed(1)}% 均赔=${trA.avgOdds} EV=${trA.ev}% | test: n=${teA.total} A率=${teA.hitRate.toFixed(1)}% 均赔=${teA.avgOdds} EV=${teA.ev}%`);
}
console.log('\n--- 拉出 test 期 -1盘 C2.0-3.0 的具体场次 ---');
const teSig = test.filter(m => m.goalLine === '-1' && r(m) === 'C2.0-3.0');
for (const m of teSig) {
  console.log(`${m.date} ${m.league} ${m.home}vs${m.away} 欧赔[${m.h}/${m.d}/${m.a}] 让盘A=${m.haOdds} 结果(${m.score}) 让球=${m.handicap}`);
}

console.log('\n═══════ 信号B: +1盘 + 赔率区间 ═══════');
for (const bucket of ['A1.0-1.5', 'B1.5-2.0', 'C2.0-3.0', 'D3.0-5.0', 'E5.0+']) {
  const tr = train.filter(m => m.goalLine === '+1' && r(m) === bucket);
  const te = test.filter(m => m.goalLine === '+1' && r(m) === bucket);
  const trH = reportSignal(tr, 'train', 'H', m => m.hhOdds);
  const teH = reportSignal(te, 'test', 'H', m => m.hhOdds);
  console.log(`[${bucket}] train: n=${trH.total} H率=${trH.hitRate.toFixed(1)}% 均赔=${trH.avgOdds} EV=${trH.ev}% | test: n=${teH.total} H率=${teH.hitRate.toFixed(1)}% 均赔=${teH.avgOdds} EV=${teH.ev}%`);
}

console.log('\n═══════ 信号C: 让球平D 全局 ═══════');
for (const bucket of ['A1.0-1.5', 'B1.5-2.0', 'C2.0-3.0', 'D3.0-5.0', 'E5.0+']) {
  const tr = train.filter(m => r(m) === bucket);
  const te = test.filter(m => r(m) === bucket);
  const trD = reportSignal(tr, 'train', 'D', m => m.hdOdds);
  const teD = reportSignal(te, 'test', 'D', m => m.hdOdds);
  console.log(`[${bucket}] train: n=${trD.total} D率=${trD.hitRate.toFixed(1)}% 均赔=${trD.avgOdds} EV=${trD.ev}% | test: n=${teD.total} D率=${teD.hitRate.toFixed(1)}% 均赔=${teD.avgOdds} EV=${teD.ev}%`);
}

console.log('\n═══════ 信号D: 各盘口深度 × 各方向 out-of-sample ═══════');
const dirs = ['H', 'D', 'A'];
for (const gl of ['-2', '-1', '+1', '+2']) {
  const tr = train.filter(m => m.goalLine === gl);
  const te = test.filter(m => m.goalLine === gl);
  const parts = [];
  for (const dir of dirs) {
    const t0 = reportSignal(tr, 'train', dir, m => dir === 'H' ? m.hhOdds : dir === 'D' ? m.hdOdds : m.haOdds);
    const t1 = reportSignal(te, 'test', dir, m => dir === 'H' ? m.hhOdds : dir === 'D' ? m.hdOdds : m.haOdds);
    parts.push(`${dir}: trainEV=${t0.ev}%(n${t0.total}) testEV=${t1.ev}%(n${t1.total})`);
  }
  console.log(`[${gl}盘]`, parts.join(' | '));
}

console.log('\n═══════ 信号E: 让球盘变盘次数(hhadChanges) × 方向 ═══════');
const ocBuckets = { '0': m => m.hhadChanges === 0, '1-2': m => m.hhadChanges >= 1 && m.hhadChanges <= 2, '3-4': m => m.hhadChanges >= 3 && m.hhadChanges <= 4, '5-7': m => m.hhadChanges >= 5 && m.hhadChanges <= 7, '8+': m => m.hhadChanges >= 8 };
for (const [bk, fn] of Object.entries(ocBuckets)) {
  const tr = train.filter(fn);
  const te = test.filter(fn);
  const parts = [];
  for (const dir of dirs) {
    const t0 = reportSignal(tr, 'train', dir, m => dir === 'H' ? m.hhOdds : dir === 'D' ? m.hdOdds : m.haOdds);
    const t1 = reportSignal(te, 'test', dir, m => dir === 'H' ? m.hhOdds : dir === 'D' ? m.hdOdds : m.haOdds);
    parts.push(`${dir}: trainEV=${t0.ev}%(n${t0.total}) testEV=${t1.ev}%(n${t1.total})`);
  }
  console.log(`[变盘${bk}]`, 'train n=' + tr.length, parts.join(' | ') || '', '\n test n=' + te.length);
}

console.log('\n═══════ 信号F: 让球盘被压方向 vs 反方向 ═══════');
{
  const tr = train.filter(m => m.hhadPress);
  const te = test.filter(m => m.hhadPress);
  for (const [nm, fn, dir] of [['跟压向', m => m.hhadPress, m => m.hhadPress], ['反压向', m => m.hhadPress, m => m.hhadPress === 'H' ? 'A' : m.hhadPress === 'A' ? 'H' : 'H']]) {
    const t0 = reportSignal(tr, 'train', dir, m => dir === 'H' ? m.hhOdds : dir === 'D' ? m.hdOdds : m.haOdds);
    const t1 = reportSignal(te, 'test', dir, m => dir === 'H' ? m.hhOdds : dir === 'D' ? m.hdOdds : m.haOdds);
    console.log(`[${nm}] train: n=${t0.total} hitRate=${t0.hitRate.toFixed(1)}% avgOdds=${t0.avgOdds} EV=${t0.ev}% | test: n=${t1.total} hitRate=${t1.hitRate.toFixed(1)}% avgOdds=${t1.avgOdds} EV=${t1.ev}%`);
  }
}

console.log('\n═══════ 信号G: 欧赔压向（hadChanges）vs 让球赛果 ═══════');
{
  const trAll = train.filter(m => m.hhadPress);
  // 欧赔方向从hadList
  // (为简化：用hhadPress近似)
  const teAll = test.filter(m => m.hhadPress);
  console.log(`train带压向数据: ${trAll.length}, test: ${teAll.length}`);
}

// 深度：-1盘 C2.0-3.0 在test中的赔率分布
console.log('\n═══════ test期 -1盘 C2.0-3.0 A方向赔率分布 ═══════');
if (teSig.length > 0) {
  const oddsArr = teSig.map(m => m.haOdds).filter(o => o).sort((a, b) => a - b);
  console.log('A方向让球赔率:', oddsArr.join(', '));
  const below2 = oddsArr.filter(o => o < 2.0).length;
  const at2plus = oddsArr.filter(o => o >= 2.0).length;
  console.log(`<2.0: ${below2}个, >=2.0: ${at2plus}个, 中位数: ${oddsArr[Math.floor(oddsArr.length / 2)]}`);
}

// 欧赔与让球赔率的关系 sanity check
console.log('\n═══════ sanity: -1盘时 主胜h 与 让球A赔率的一致性 ═══════');
const glNeg1 = matches.filter(m => m.goalLine === '-1' && m.haOdds);
const buckets = { '<1.5': [], '1.5-2.0': [], '2.0-3.0': [], '3.0-5.0': [], '5.0+': [] };
for (const m of glNeg1) {
  if (m.h < 1.5) buckets['<1.5'].push(m);
  else if (m.h < 2.0) buckets['1.5-2.0'].push(m);
  else if (m.h < 3.0) buckets['2.0-3.0'].push(m);
  else if (m.h < 5.0) buckets['3.0-5.0'].push(m);
  else buckets['5.0+'].push(m);
}
for (const [bk, ms] of Object.entries(buckets)) {
  const hits = ms.filter(m => m.handicap === 'A').length;
  const avgA = ms.reduce((s, m) => s + m.haOdds, 0) / Math.max(1, ms.length);
  const avgH = ms.reduce((s, m) => s + m.h, 0) / Math.max(1, ms.length);
  console.log(`[主胜h ${bk}] n=${ms.length} 让球A率=${fmtPct(hits, ms.length)} 平均主胜赔=${avgH.toFixed(2)} 平均让球A赔=${avgA.toFixed(2)}`);
}