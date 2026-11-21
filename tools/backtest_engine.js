/**
 * tools/backtest_engine.js — 历史回测数据引擎
 *
 * 供回测agent复用：从 data/history/football/ 读取历史赛果，
 * 叠加 _odds_cache 里的变盘历史，输出结构化的可投注场次。
 *
 * 用法:
 *   const { loadMatches } = require('./tools/backtest_engine.js');
 *   const all = loadMatches();           // 全部场次
 *   const byDate = loadMatches({from:'2026-03-01'});  // 按日期过滤
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const HIST_DIR = join(ROOT, 'data', 'history', 'football');
const CACHE_DIR = join(ROOT, 'data', 'history', '_odds_cache');

/** 读取一场比赛的变盘历史（从缓存） */
export function getOddsTrend(matchId) {
  const f = join(CACHE_DIR, `${matchId}.json`);
  if (!existsSync(f)) return { changes: 0, direction: null, error: 'no_cache' };
  try {
    const o = JSON.parse(readFileSync(f, 'utf8'));
    if (o.noData) return { changes: 0, direction: null, error: 'noData' };
    const had = o.hadList || [];
    if (!had.length) return { changes: 0, direction: null };
    const first = had[0], last = had[had.length - 1];
    const changes = had.length;
    // 判断方向：主胜/客胜/平 哪个被压低（odds下降=压）
    const drifts = {
      h: (parseFloat(first.h) - parseFloat(last.h)),
      d: (parseFloat(first.d) - parseFloat(last.d)),
      a: (parseFloat(first.a) - parseFloat(last.a))
    };
    // 压的方向 = 赔率下降最多的那个
    let direction = null;
    if (drifts.h > drifts.a && drifts.h > drifts.d) direction = 'H';
    else if (drifts.a > drifts.h && drifts.a > drifts.d) direction = 'A';
    else if (drifts.d > 0 && drifts.d >= drifts.h && drifts.d >= drifts.a) direction = 'D';
    return {
      changes: had.length,
      first: { h: parseFloat(first.h), d: parseFloat(first.d), a: parseFloat(first.a) },
      last: { h: parseFloat(last.h), d: parseFloat(last.d), a: parseFloat(last.a) },
      drift: drifts,   // 正数 = 压了(赔率下降)
      direction,       // 被压的方向 H/D/A
      history: had.map(x => ({ time: `${x.updateDate} ${x.updateTime}`, h: parseFloat(x.h), d: parseFloat(x.d), a: parseFloat(x.a) }))
    };
  } catch (e) {
    return { changes: 0, direction: null, error: e.message };
  }
}

/** 读取所有历史比赛，叠加变盘数据 */
export function loadMatches({ from, to } = {}) {
  const files = existsSync(HIST_DIR)
    ? readdirSync(HIST_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_merged')).sort()
    : [];
  const out = [];
  for (const f of files) {
    if (from && f.slice(0, 10) < from) continue;
    if (to && f.slice(0, 10) > to) continue;
    try {
      const d = JSON.parse(readFileSync(join(HIST_DIR, f), 'utf8'));
      for (const m of d.matches || []) {
        // 校验字段完整性
        const h = parseFloat(m.h), d_ = parseFloat(m.d), a = parseFloat(m.a);
        if (isNaN(h) || isNaN(d_) || isNaN(a)) continue;
        if (!m.winFlag || !m.sectionsNo999) continue;
        if (m.poolStatus !== 'Payout' && m.poolStatus !== 'Refund' && m.poolStatus !== '') continue;
        const trend = getOddsTrend(m.matchId);
        out.push({
          matchId: m.matchId,
          date: m.matchDate,
          league: m.leagueNameAbbr,
          home: m.homeTeam,
          away: m.awayTeam,
          h, d: d_, a,
          goalLine: m.goalLine,
          winFlag: m.winFlag,          // H/D/A（最终中奖组合）
          score: m.sectionsNo999,      // 比分
          oddsChanges: trend.changes,
          oddsDirection: trend.direction,  // 变盘压向
          oddsHistory: trend.history,
        });
      }
    } catch (e) { /* skip bad file */ }
  }
  return out.sort((a, b) => a.date < b.date ? -1 : 1);
}

/** 计算2串1结算 */
export function settleParlay(leg1, leg2) {
  // 返回 { win: bool }
  const w1 = leg1.pick === leg1.match.winFlag;
  const w2 = leg2.pick === leg2.match.winFlag;
  return { win: w1 && w2, leg1Win: w1, leg2Win: w2 };
}

/** 让球盘结算 */
export function settleHandicap(match, homePick) {
  // goalLine: "-2" 主让2，"+1" 客让1（主受让）
  const gl = parseFloat(match.goalLine);
  if (isNaN(gl)) return null;
  const [hs, as] = match.score.split(':').map(Number);
  const homeAdj = hs + gl; // 主队让gl球
  return homeAdj === as ? 'D' : homeAdj > as ? 'H' : 'A';
}

// CLI 快速查看
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const N = Number(process.argv[2] || 10);
  const m = loadMatches();
  console.log(`共 ${m.length} 场比赛，显示前 ${N} 场:`);
  m.slice(0, N).forEach(x => {
    console.log(`${x.date} ${x.league} ${x.home}vs${x.away} [${x.h}/${x.d}/${x.a}] 变盘${x.oddsChanges}次` +
      (x.oddsDirection ? ` 压${x.oddsDirection}` : '') + ` 结果${x.winFlag}(${x.score})`);
  });
}