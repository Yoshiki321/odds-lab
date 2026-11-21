/**
 * tools/handicap_round4.js — 最终回测：反压向 + 0变盘A方向
 *
 * 对 round3 中最有希望的信号做完整资金回测
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
        if (hhadList.length > 0) {
          const last = hhadList[hhadList.length - 1];
          hhOdds = parseFloat(last.h); hdOdds = parseFloat(last.d); haOdds = parseFloat(last.a);
        }
        const hhadChanges = Math.max(0, hhadList.length - 1);
        let hhadPress = null;
        if (hhadList.length >= 2) {
          const f0 = hhadList[0], l0 = hhadList[hhadList.length - 1];
          const dr = { h: parseFloat(f0.h) - parseFloat(l0.h), d: parseFloat(f0.d) - parseFloat(l0.d), a: parseFloat(f0.a) - parseFloat(l0.a) };
          if (dr.h > dr.a && dr.h > dr.d) hhadPress = 'H';
          else if (dr.a > dr.h && dr.a > dr.d) hhadPress = 'A';
          else if (dr.d > 0 && dr.d >= dr.h && dr.d >= dr.a) hhadPress = 'D';
        }

        out.push({
          matchId: m.matchId, date: m.matchDate, league: m.leagueNameAbbr,
          home: m.homeTeam, away: m.awayTeam,
          h, d: dd, a, goalLine: m.goalLine, glNum: parseFloat(m.goalLine),
          score: m.sectionsNo999, handicap: hh,
          hhOdds, hdOdds, haOdds, hhadChanges, hhadPress,
        });
      }
    } catch (e) { /* skip */ }
  }
  return out.sort((x, y) => x.date < y.date ? -1 : 1);
}

function backtest(matches, filterFn, label, stakePerBet = 50) {
  let bankroll = 1000;
  const curve = [{ date: 'start', bankroll: 1000 }];
  let bets = 0, wins = 0, maxDrawdown = 0, peak = 1000;
  const sorted = [...matches].sort((a, b) => a.date < b.date ? -1 : 1);

  for (const m of sorted) {
    const result = filterFn(m);
    if (!result) continue;
    const { direction, odds } = result;
    if (!odds || odds < 1.01) continue;

    bets++;
    const win = m.handicap === direction;
    let profit = 0;
    if (win) {
      profit = stakePerBet * (odds - 1);
      wins++;
    } else {
      profit = -stakePerBet;
    }
    bankroll += profit;
    if (bankroll > peak) peak = bankroll;
    const dd = (peak - bankroll) / peak * 100;
    if (dd > maxDrawdown) maxDrawdown = dd;
    curve.push({ date: m.date, bankroll: Math.round(bankroll * 100) / 100, profit: Math.round(profit * 100) / 100 });
  }

  const roi = bets > 0 ? ((bankroll - 1000) / 1000 * 100).toFixed(1) + '%' : '0%';
  const winRate = bets > 0 ? (wins / bets * 100).toFixed(1) + '%' : '0%';
  const avgOdds = bets > 0 ? sorted.filter(m => filterFn(m)).reduce((s, m) => {
    const r = filterFn(m);
    return s + (r ? r.odds : 0);
  }, 0) / bets : 0;
  return { label, bets, wins, winRate, finalBankroll: Math.round(bankroll * 100) / 100, roi, avgOdds: avgOdds.toFixed(2), maxDrawdown: maxDrawdown.toFixed(1) + '%', curve };
}

const matches = loadAllMatches();
const train = matches.filter(m => m.date <= '2026-04-30');
const test = matches.filter(m => m.date > '2026-04-30');

console.log('总场次:', matches.length, 'train:', train.length, 'test:', test.length);

// 策略1: 反压向 - 所有比赛
const bt1 = backtest(matches, m => {
  if (!m.hhadPress) return null;
  const dir = m.hhadPress === 'H' ? 'A' : m.hhadPress === 'A' ? 'H' : 'H';
  const odds = dir === 'H' ? m.hhOdds : dir === 'D' ? m.hdOdds : m.haOdds;
  return { direction: dir, odds };
}, '反压向(全场)');

// 策略2: 反压向 - 仅train验证
const bt2 = backtest(train, m => {
  if (!m.hhadPress) return null;
  const dir = m.hhadPress === 'H' ? 'A' : m.hhadPress === 'A' ? 'H' : 'H';
  const odds = dir === 'H' ? m.hhOdds : dir === 'D' ? m.hdOdds : m.haOdds;
  return { direction: dir, odds };
}, '反压向(train)');

// 策略3: 反压向 - 仅test验证
const bt3 = backtest(test, m => {
  if (!m.hhadPress) return null;
  const dir = m.hhadPress === 'H' ? 'A' : m.hhadPress === 'A' ? 'H' : 'H';
  const odds = dir === 'H' ? m.hhOdds : dir === 'D' ? m.hdOdds : m.haOdds;
  return { direction: dir, odds };
}, '反压向(test)');

// 策略4: 反压向 + 仅变盘3-7次
const bt4 = backtest(matches, m => {
  if (!m.hhadPress || m.hhadChanges < 3 || m.hhadChanges > 7) return null;
  const dir = m.hhadPress === 'H' ? 'A' : m.hhadPress === 'A' ? 'H' : 'H';
  const odds = dir === 'H' ? m.hhOdds : dir === 'D' ? m.hdOdds : m.haOdds;
  return { direction: dir, odds };
}, '反压向+变盘3-7');

// 策略5: 反压向 + 变盘1-2次
const bt5 = backtest(matches, m => {
  if (!m.hhadPress || m.hhadChanges < 1 || m.hhadChanges > 2) return null;
  const dir = m.hhadPress === 'H' ? 'A' : m.hhadPress === 'A' ? 'H' : 'H';
  const odds = dir === 'H' ? m.hhOdds : dir === 'D' ? m.hdOdds : m.haOdds;
  return { direction: dir, odds };
}, '反压向+变盘1-2');

// 策略6: 0变盘 + 买A方向
const bt6 = backtest(matches, m => {
  if (m.hhadChanges !== 0) return null;
  return { direction: 'A', odds: m.haOdds };
}, '0变盘买A方向');

// 策略7: 0变盘 + 买A方向 (仅test)
const bt7 = backtest(test, m => {
  if (m.hhadChanges !== 0) return null;
  return { direction: 'A', odds: m.haOdds };
}, '0变盘买A(test)');

// 策略8: 跟压向
const bt8 = backtest(matches, m => {
  if (!m.hhadPress) return null;
  const dir = m.hhadPress;
  const odds = dir === 'H' ? m.hhOdds : dir === 'D' ? m.hdOdds : m.haOdds;
  return { direction: dir, odds };
}, '跟压向(全场)');

// 策略9: 跟压向(test)
const bt9 = backtest(test, m => {
  if (!m.hhadPress) return null;
  const dir = m.hhadPress;
  const odds = dir === 'H' ? m.hhOdds : dir === 'D' ? m.hdOdds : m.haOdds;
  return { direction: dir, odds };
}, '跟压向(test)');

// 策略10: 反压向 + 仅test + 按stake不同
const bt10 = backtest(test, m => {
  if (!m.hhadPress) return null;
  const dir = m.hhadPress === 'H' ? 'A' : m.hhadPress === 'A' ? 'H' : 'H';
  const odds = dir === 'H' ? m.hhOdds : dir === 'D' ? m.hdOdds : m.haOdds;
  return { direction: dir, odds };
}, '反压向(test) 5%', 50);

// 策略11: 反压向 + 仅test + 8% stake
const bt11 = backtest(test, m => {
  if (!m.hhadPress) return null;
  const dir = m.hhadPress === 'H' ? 'A' : m.hhadPress === 'A' ? 'H' : 'H';
  const odds = dir === 'H' ? m.hhOdds : dir === 'D' ? m.hdOdds : m.haOdds;
  return { direction: dir, odds };
}, '反压向(test) 8%', 80);

// 策略12: 反压向 + -1盘
const bt12 = backtest(matches, m => {
  if (!m.hhadPress || m.goalLine !== '-1') return null;
  const dir = m.hhadPress === 'H' ? 'A' : m.hhadPress === 'A' ? 'H' : 'H';
  const odds = dir === 'H' ? m.hhOdds : dir === 'D' ? m.hdOdds : m.haOdds;
  return { direction: dir, odds };
}, '反压向+-1盘');

// 策略13: 反压向 + +1盘
const bt13 = backtest(matches, m => {
  if (!m.hhadPress || m.goalLine !== '+1') return null;
  const dir = m.hhadPress === 'H' ? 'A' : m.hhadPress === 'A' ? 'H' : 'H';
  const odds = dir === 'H' ? m.hhOdds : dir === 'D' ? m.hdOdds : m.haOdds;
  return { direction: dir, odds };
}, '反压向++1盘');

// 策略14: 反压向 + test + -1盘
const bt14 = backtest(test, m => {
  if (!m.hhadPress || m.goalLine !== '-1') return null;
  const dir = m.hhadPress === 'H' ? 'A' : m.hhadPress === 'A' ? 'H' : 'H';
  const odds = dir === 'H' ? m.hhOdds : dir === 'D' ? m.hdOdds : m.haOdds;
  return { direction: dir, odds };
}, '反压向+-1盘(test)');

// 策略15: 前5次策略的对比基准 - 巴斯光年
const bt15 = backtest(matches, m => {
  // 随机选一个方向作为基准
  return null;
}, '空仓基准', 0);

const results = [bt1, bt2, bt3, bt4, bt5, bt6, bt7, bt8, bt9, bt10, bt11, bt12, bt13, bt14];
console.log('\n======= 最终回测对比 =======');
console.log('策略名'.padEnd(30), '场次'.padEnd(6), '胜率'.padEnd(8), '均赔'.padEnd(8), '最终资金'.padEnd(12), 'ROI'.padEnd(10), '最大回撤');
console.log('-'.repeat(90));
for (const r of results.sort((a, b) => b.finalBankroll - a.finalBankroll)) {
  console.log(r.label.padEnd(30), String(r.bets).padEnd(6), r.winRate.padEnd(8), r.avgOdds.padEnd(8), ('¥' + r.finalBankroll).padEnd(12), r.roi.padEnd(10), r.maxDrawdown);
}

// 分析反压向是否真的有效：看每次被压方向的分布
console.log('\n======= 反压向详细分析 =======');
const pressDist = {};
for (const m of matches) {
  if (!m.hhadPress) continue;
  const key = m.hhadPress;
  if (!pressDist[key]) pressDist[key] = { total: 0, win: 0, loss: 0, odds: [] };
  pressDist[key].total++;
  const dir = key === 'H' ? 'A' : key === 'A' ? 'H' : 'H';
  const odds = dir === 'H' ? m.hhOdds : dir === 'D' ? m.hdOdds : m.haOdds;
  if (m.handicap === dir) pressDist[key].win++;
  else pressDist[key].loss++;
  if (odds) pressDist[key].odds.push(odds);
}
for (const [dir, s] of Object.entries(pressDist)) {
  const avgOdds = s.odds.length > 0 ? (s.odds.reduce((a, b) => a + b, 0) / s.odds.length).toFixed(2) : '-';
  const rate = (s.win / s.total * 100).toFixed(1);
  const ev = (s.win / s.total * parseFloat(avgOdds) * 100).toFixed(1);
  console.log(`被压${dir} → 反买: n=${s.total} 胜=${s.win} 负=${s.loss} 胜率=${rate}% 均赔=${avgOdds} EV=${ev}%`);
}

// 反压向的月度表现
console.log('\n======= 反压向月度表现 =======');
const monthly = {};
for (const m of matches) {
  if (!m.hhadPress) continue;
  const month = m.date.slice(0, 7);
  if (!monthly[month]) monthly[month] = { total: 0, win: 0, profit: 0 };
  monthly[month].total++;
  const dir = m.hhadPress === 'H' ? 'A' : m.hhadPress === 'A' ? 'H' : 'H';
  const odds = dir === 'H' ? m.hhOdds : dir === 'D' ? m.hdOdds : m.haOdds;
  if (m.handicap === dir) {
    monthly[month].win++;
    monthly[month].profit += (odds - 1) * 50;
  } else {
    monthly[month].profit -= 50;
  }
}
for (const [month, s] of Object.entries(monthly).sort()) {
  const rate = (s.win / s.total * 100).toFixed(1);
  console.log(`${month}: n=${s.total} 胜=${s.win}(${rate}%) 利润=¥${s.profit.toFixed(0)}`);
}

// 反压向的逐日资金曲线（test期）
console.log('\n======= 反压向(test) 逐日资金曲线 =======');
const testBets = test.filter(m => m.hhadPress).sort((a, b) => a.date < b.date ? -1 : 1);
let bank = 1000;
const daily = {};
for (const m of testBets) {
  const dir = m.hhadPress === 'H' ? 'A' : m.hhadPress === 'A' ? 'H' : 'H';
  const odds = dir === 'H' ? m.hhOdds : dir === 'D' ? m.hdOdds : m.haOdds;
  if (!odds) continue;
  const profit = m.handicap === dir ? 50 * (odds - 1) : -50;
  bank += profit;
  if (!daily[m.date]) daily[m.date] = [];
  daily[m.date].push(bank);
}
let lastPrint = 0;
for (const [date, vals] of Object.entries(daily).sort()) {
  if (Math.round(vals[vals.length-1]) !== Math.round(lastPrint)) {
    console.log(`${date}: ¥${vals[vals.length-1].toFixed(0)}`);
    lastPrint = vals[vals.length-1];
  }
}
console.log(`最终: ¥${bank.toFixed(0)}`);