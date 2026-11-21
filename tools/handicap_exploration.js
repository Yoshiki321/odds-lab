/**
 * tools/handicap_exploration.js — 让球盘全面探索引擎
 *
 * 不预设任何策略，让数据自己说话。
 * 输出 JSON 到 stdout，由调用方渲染为报告。
 */

import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const HIST_DIR = join(ROOT, 'data', 'history', 'football');
const CACHE_DIR = join(ROOT, 'data', 'history', '_odds_cache');

// ── 工具函数 ──────────────────────────────────────────────

function settleHandicap(score, goalLine) {
  const gl = parseFloat(goalLine);
  if (isNaN(gl)) return null;
  const [hs, as] = score.split(':').map(Number);
  const homeAdj = hs + gl;
  return homeAdj === as ? 'D' : homeAdj > as ? 'H' : 'A';
}

/** 读取一场比赛的变盘历史（包含让球盘数据） */
function getOddsDetail(matchId) {
  const f = join(CACHE_DIR, `${matchId}.json`);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch (e) {
    return null;
  }
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
        const h = parseFloat(m.h), d_ = parseFloat(m.d), a = parseFloat(m.a);
        if (isNaN(h) || isNaN(d_) || isNaN(a)) continue;
        if (!m.sectionsNo999) continue;
        if (m.poolStatus !== 'Payout' && m.poolStatus !== 'Refund' && m.poolStatus !== '') continue;
        if (!m.goalLine || m.goalLine === '') continue;

        const handicapResult = settleHandicap(m.sectionsNo999, m.goalLine);
        if (!handicapResult) continue;

        const detail = getOddsDetail(m.matchId);
        const hhadList = detail?.oddsHistory?.hhadList || [];
        const hadList = detail?.oddsHistory?.hadList || [];

        // 获取让球盘赔率（取变盘最后一条，或初始数据）
        let hhOdds = null, hdOdds = null, haOdds = null;
        let hhDirection = null; // hf/df/af: 1=上升, -1=下降, 0=不变
        if (hhadList.length > 0) {
          const last = hhadList[hhadList.length - 1];
          hhOdds = parseFloat(last.h);
          hdOdds = parseFloat(last.d);
          haOdds = parseFloat(last.a);
          hhDirection = { hf: parseInt(last.hf), df: parseInt(last.df), af: parseInt(last.af) };
        }

        // 变盘趋势
        const oddsChanges = hhadList.length;
        // 让球盘变盘方向：哪个方向被压
        let hhDirection_press = null;
        if (hhadList.length >= 2) {
          const first = hhadList[0], last = hhadList[hhadList.length - 1];
          const drifts = {
            h: parseFloat(first.h) - parseFloat(last.h),
            d: parseFloat(first.d) - parseFloat(last.d),
            a: parseFloat(first.a) - parseFloat(last.a)
          };
          if (drifts.h > drifts.a && drifts.h > drifts.d) hhDirection_press = 'H';
          else if (drifts.a > drifts.h && drifts.a > drifts.d) hhDirection_press = 'A';
          else if (drifts.d > 0 && drifts.d >= drifts.h && drifts.d >= drifts.a) hhDirection_press = 'D';
        }

        // 欧赔变盘方向（从原引擎逻辑）
        let oddsDirection = null;
        if (hadList.length >= 2) {
          const first = hadList[0], last = hadList[hadList.length - 1];
          const drifts = {
            h: parseFloat(first.h) - parseFloat(last.h),
            d: parseFloat(first.d) - parseFloat(last.d),
            a: parseFloat(first.a) - parseFloat(last.a)
          };
          if (drifts.h > drifts.a && drifts.h > drifts.d) oddsDirection = 'H';
          else if (drifts.a > drifts.h && drifts.a > drifts.d) oddsDirection = 'A';
          else if (drifts.d > 0 && drifts.d >= drifts.h && drifts.d >= drifts.a) oddsDirection = 'D';
        }

        // 让球盘初始赔率
        let hhOpen = null, hdOpen = null, haOpen = null;
        if (hhadList.length > 0) {
          hhOpen = parseFloat(hhadList[0].h);
          hdOpen = parseFloat(hhadList[0].d);
          haOpen = parseFloat(hhadList[0].a);
        }

        out.push({
          matchId: m.matchId,
          date: m.matchDate,
          league: m.leagueNameAbbr,
          home: m.homeTeam,
          away: m.awayTeam,
          h, d: d_, a,
          goalLine: m.goalLine,
          glNum: parseFloat(m.goalLine),
          winFlag: m.winFlag,          // 实际赛果
          handicapResult,              // 让球赛果 H/D/A
          score: m.sectionsNo999,
          hhOdds, hdOdds, haOdds,      // 让球盘收盘赔率
          hhOpen, hdOpen, haOpen,       // 让球盘开盘赔率
          hhDirection,                  // 让球盘赔率方向变化
          hhDirection_press,            // 让球盘被压方向
          oddsChanges,                  // 让球盘变盘次数
          oddsDirection,               // 欧赔变盘压向
          hhadList: hhadList.length,    // 让球盘变盘点数
        });
      }
    } catch (e) { /* skip bad file */ }
  }
  return out.sort((a, b) => a.date < b.date ? -1 : 1);
}

// ── 统计工具 ──────────────────────────────────────────────

function count(arr) {
  const c = {};
  for (const x of arr) {
    const k = x === null || x === undefined ? 'null' : String(x);
    c[k] = (c[k] || 0) + 1;
  }
  return c;
}

function crossCount(arr, keyA, keyB) {
  // 返回 { [keyA_val]: { total, H, D, A } }
  const result = {};
  for (const item of arr) {
    const ka = item[keyA];
    const kb = item[keyB] || 'null';
    const kaStr = ka === null || ka === undefined ? 'null' : String(ka);
    if (!result[kaStr]) result[kaStr] = { total: 0, H: 0, D: 0, A: 0 };
    result[kaStr].total++;
    result[kaStr][kb]++;
  }
  return result;
}

function crossCount2D(arr, keyA, keyB, keyC) {
  // 返回 { [keyA_val]: { [keyB_val]: { total, H, D, A } } }
  const result = {};
  for (const item of arr) {
    const ka = item[keyA];
    const kb = item[keyB];
    const kc = item[keyC] || 'null';
    const kaStr = ka === null || ka === undefined ? 'null' : String(ka);
    const kbStr = kb === null || kb === undefined ? 'null' : String(kb);
    if (!result[kaStr]) result[kaStr] = {};
    if (!result[kaStr][kbStr]) result[kaStr][kbStr] = { total: 0, H: 0, D: 0, A: 0 };
    result[kaStr][kbStr].total++;
    result[kaStr][kbStr][kc]++;
  }
  return result;
}

function getEV(stats, total, odds) {
  // 给定方向在stats中的计数，计算EV
  // stats: { total, H, D, A }
  return null;
}

function formatPct(n, total) {
  if (total === 0) return '0.0%';
  return (n / total * 100).toFixed(1) + '%';
}

function formatTable(rows, headers) {
  // rows: array of arrays
  // headers: array of strings
  const colWidths = headers.map((h, i) => {
    let max = h.length;
    for (const r of rows) {
      if (r[i] !== undefined) max = Math.max(max, String(r[i]).length);
    }
    return max;
  });
  const line = '| ' + headers.map((h, i) => h.padEnd(colWidths[i])).join(' | ') + ' |';
  const sep = '|-' + colWidths.map(w => '-'.repeat(w)).join('-|-') + '-|';
  const body = rows.map(r => '| ' + r.map((v, i) => String(v === undefined ? '' : v).padEnd(colWidths[i])).join(' | ') + ' |');
  return [line, sep, ...body].join('\n');
}

// ── 主分析 ────────────────────────────────────────────────

function analyze(matches) {
  const total = matches.length;
  const report = { total, sections: [] };

  // ─── 维度1：让球盘深度 ─────────────────────────────────
  const glDist = crossCount(matches, 'goalLine', 'handicapResult');
  const glSection = {
    title: '维度1：让球盘深度 (goalLine)',
    desc: '按让球盘深度统计让球赛果分布',
    tables: []
  };

  const glRows = Object.entries(glDist)
    .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
    .map(([gl, s]) => {
      const hRate = formatPct(s.H, s.total);
      const dRate = formatPct(s.D, s.total);
      const aRate = formatPct(s.A, s.total);
      // 盈亏平衡所需赔率：1 / 胜率
      const hBreakEven = s.total > 0 ? (1 / (s.H / s.total)).toFixed(2) : '-';
      const dBreakEven = s.total > 0 ? (1 / (s.D / s.total)).toFixed(2) : '-';
      const aBreakEven = s.total > 0 ? (1 / (s.A / s.total)).toFixed(2) : '-';
      return [gl, s.total, hRate, dRate, aRate, hBreakEven, dBreakEven, aBreakEven];
    });
  glSection.tables.push({
    title: '各盘口深度让球赛果分布',
    headers: ['盘口', '场次', '让胜H', '让平D', '让负A', 'H盈亏赔率', 'D盈亏赔率', 'A盈亏赔率'],
    rows: glRows
  });

  // 计算每个盘口深度的平均让球盘赔率
  const glOdds = {};
  for (const m of matches) {
    const gl = m.goalLine;
    if (!glOdds[gl]) glOdds[gl] = { hh: [], hd: [], ha: [] };
    if (m.hhOdds) glOdds[gl].hh.push(m.hhOdds);
    if (m.hdOdds) glOdds[gl].hd.push(m.hdOdds);
    if (m.haOdds) glOdds[gl].ha.push(m.haOdds);
  }
  const glOddsRows = Object.entries(glOdds)
    .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
    .map(([gl, o]) => {
      const avg = (arr) => arr.length > 0 ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : '-';
      return [gl, o.hh.length, avg(o.hh), avg(o.hd), avg(o.ha)];
    });
  glSection.tables.push({
    title: '各盘口深度平均让球赔率',
    headers: ['盘口', '样本数', '平均让胜H', '平均让平D', '平均让负A'],
    rows: glOddsRows
  });

  // 让球平（D方向）的冷门价值分析
  const glDRows = Object.entries(glDist)
    .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
    .map(([gl, s]) => {
      const dRate = s.total > 0 ? (s.D / s.total * 100).toFixed(1) + '%' : '0.0%';
      const dBreakEven = s.total > 0 && s.D > 0 ? (1 / (s.D / s.total)).toFixed(2) : '-';
      const avgHdOdds = glOdds[gl] && glOdds[gl].hd.length > 0
        ? (glOdds[gl].hd.reduce((a, b) => a + b, 0) / glOdds[gl].hd.length).toFixed(2) : '-';
      return [gl, s.total, dRate, avgHdOdds, dBreakEven, dBreakEven !== '-' && avgHdOdds !== '-' ? (parseFloat(dBreakEven) <= parseFloat(avgHdOdds) ? '可能正EV' : '负EV') : '-'];
    });
  glSection.tables.push({
    title: '让球平(D)冷门价值分析',
    desc: '让球平赔率3.0+，如果命中率高于1/赔率则正EV',
    headers: ['盘口', '场次', '让球平占比', '平均让平赔率', '盈亏平衡胜率', '判断'],
    rows: glDRows
  });

  report.sections.push(glSection);

  // ─── 维度2：赔率区间 ─────────────────────────────────
  const oddsRanges = (m) => {
    const minOdds = Math.min(m.h, m.d, m.a);
    if (minOdds < 1.5) return '1.0-1.5';
    if (minOdds < 2.0) return '1.5-2.0';
    if (minOdds < 3.0) return '2.0-3.0';
    if (minOdds < 5.0) return '3.0-5.0';
    return '5.0+';
  };

  const oddsRangeSection = {
    title: '维度2：赔率区间',
    desc: '按最低赔率（即最可能结果）分组，查看让球赛果分布',
    tables: []
  };

  const rangeGroups = {};
  for (const m of matches) {
    const r = oddsRanges(m);
    if (!rangeGroups[r]) rangeGroups[r] = [];
    rangeGroups[r].push(m);
  }

  const rangeRows = Object.entries(rangeGroups)
    .sort((a, b) => {
      const order = ['1.0-1.5', '1.5-2.0', '2.0-3.0', '3.0-5.0', '5.0+'];
      return order.indexOf(a[0]) - order.indexOf(b[0]);
    })
    .map(([range, ms]) => {
      const hhSettle = ms.filter(m => m.handicapResult === 'H').length;
      const ddSettle = ms.filter(m => m.handicapResult === 'D').length;
      const aaSettle = ms.filter(m => m.handicapResult === 'A').length;
      return [
        range, ms.length,
        formatPct(hhSettle, ms.length),
        formatPct(ddSettle, ms.length),
        formatPct(aaSettle, ms.length)
      ];
    });
  oddsRangeSection.tables.push({
    title: '赔率区间让球赛果分布',
    headers: ['赔率区间', '场次', '让胜H', '让平D', '让负A'],
    rows: rangeRows
  });

  // 赔率区间 × 盘口深度
  const rangeGL = crossCount2D(matches, 'goalLine', 'handicapResult', 'handicapResult');
  // Actually let's do a simpler approach - group by range then by goalLine
  const rangeGlTable = [];
  for (const [range, ms] of Object.entries(rangeGroups).sort()) {
    const glSub = crossCount(ms, 'goalLine', 'handicapResult');
    for (const [gl, s] of Object.entries(glSub)) {
      rangeGlTable.push([range, gl, String(s.total), formatPct(s.H, s.total), formatPct(s.D, s.total), formatPct(s.A, s.total)]);
    }
  }
  oddsRangeSection.tables.push({
    title: '赔率区间 × 盘口深度 交叉分析',
    headers: ['赔率区间', '盘口', '场次', '让胜H', '让平D', '让负A'],
    rows: rangeGlTable
  });

  report.sections.push(oddsRangeSection);

  // ─── 维度3：联赛 ─────────────────────────────────
  const leagueSection = {
    title: '维度3：联赛',
    desc: '每个联赛的让球赛果分布，找出冷门多的联赛',
    tables: []
  };

  const leagueDist = crossCount(matches, 'league', 'handicapResult');
  const leagueRows = Object.entries(leagueDist)
    .filter(([_, s]) => s.total >= 20) // 只分析样本>=20的联赛
    .sort((a, b) => a[1].total - b[1].total)
    .map(([league, s]) => {
      const hRate = formatPct(s.H, s.total);
      const dRate = formatPct(s.D, s.total);
      const aRate = formatPct(s.A, s.total);
      return [league, String(s.total), hRate, dRate, aRate];
    });
  leagueSection.tables.push({
    title: '联赛让球赛果分布（样本>=20）',
    headers: ['联赛', '场次', '让胜H', '让平D', '让负A'],
    rows: leagueRows
  });

  // 联赛 × 让球平冷门率
  const leagueDRows = Object.entries(leagueDist)
    .filter(([_, s]) => s.total >= 20)
    .sort((a, b) => (b[1].D / b[1].total) - (a[1].D / a[1].total))
    .map(([league, s]) => {
      return [league, String(s.total), formatPct(s.D, s.total)];
    });
  leagueSection.tables.push({
    title: '联赛让球平冷门率排名（D占比越高越冷）',
    headers: ['联赛', '场次', '让球平D占比'],
    rows: leagueDRows
  });

  report.sections.push(leagueSection);

  // ─── 维度4：让球盘类型（强队让球 vs 弱队受让） ────
  const glTypeSection = {
    title: '维度4：让球盘类型',
    desc: 'goalLine为负=强队让球，为正=弱队受让。分析两类盘型的赛果差异',
    tables: []
  };

  const glType = { '让球(负)': [], '受让(正)': [] };
  for (const m of matches) {
    if (m.glNum < 0) glType['让球(负)'].push(m);
    else glType['受让(正)'].push(m);
  }

  const glTypeRows = [];
  for (const [type, ms] of Object.entries(glType)) {
    const hh = ms.filter(m => m.handicapResult === 'H').length;
    const dd = ms.filter(m => m.handicapResult === 'D').length;
    const aa = ms.filter(m => m.handicapResult === 'A').length;
    glTypeRows.push([type, String(ms.length), formatPct(hh, ms.length), formatPct(dd, ms.length), formatPct(aa, ms.length)]);
  }
  glTypeSection.tables.push({
    title: '让球 vs 受让 赛果分布',
    headers: ['盘口类型', '场次', '让胜H', '让平D', '让负A'],
    rows: glTypeRows
  });

  // 细分：-1盘 vs -2盘 vs +1盘 vs +2盘
  const glDetailRows = [];
  for (const [gl, s] of Object.entries(glDist).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))) {
    glDetailRows.push([
      gl, String(s.total),
      formatPct(s.H, s.total), formatPct(s.D, s.total), formatPct(s.A, s.total),
      s.total > 0 ? (1 / (s.H / s.total)).toFixed(2) : '-',
      s.total > 0 ? (1 / (s.D / s.total)).toFixed(2) : '-',
      s.total > 0 ? (1 / (s.A / s.total)).toFixed(2) : '-',
    ]);
  }
  glTypeSection.tables.push({
    title: '各盘口深度盈亏平衡赔率',
    headers: ['盘口', '场次', '让胜H', '让平D', '让负A', 'H盈亏赔率', 'D盈亏赔率', 'A盈亏赔率'],
    rows: glDetailRows
  });

  report.sections.push(glTypeSection);

  // ─── 维度5：让球平（D方向）的冷门价值 ──────────────
  const drawSection = {
    title: '维度5：让球平（D方向）的冷门价值',
    desc: '让球平是让球盘中最难判断的方向，但赔率也最高。分析不同条件下让球平的命中率。',
    tables: []
  };

  // 不同赔率区间让球平命中率
  const drawByRange = {};
  for (const m of matches) {
    const r = oddsRanges(m);
    if (!drawByRange[r]) drawByRange[r] = { total: 0, draw: 0 };
    drawByRange[r].total++;
    if (m.handicapResult === 'D') drawByRange[r].draw++;
  }
  const drawRangeRows = [];
  for (const [r, s] of Object.entries(drawByRange)) {
    const rate = formatPct(s.draw, s.total);
    const breakEven = s.total > 0 ? (1 / (s.draw / s.total)).toFixed(2) : '-';
    // 平均让平赔率
    const ms = matches.filter(m => oddsRanges(m) === r && m.hdOdds);
    const avgHd = ms.length > 0 ? (ms.reduce((sum, m) => sum + m.hdOdds, 0) / ms.length).toFixed(2) : '-';
    drawRangeRows.push([r, String(s.total), rate, avgHd, breakEven]);
  }
  drawSection.tables.push({
    title: '不同赔率区间让球平(D)命中率',
    headers: ['赔率区间', '场次', '让球平占比', '平均让平赔率', '盈亏平衡赔率'],
    rows: drawRangeRows
  });

  // 不同盘口深度让球平命中率
  const drawByGL = {};
  for (const m of matches) {
    if (!drawByGL[m.goalLine]) drawByGL[m.goalLine] = { total: 0, draw: 0 };
    drawByGL[m.goalLine].total++;
    if (m.handicapResult === 'D') drawByGL[m.goalLine].draw++;
  }
  const drawGLRows = [];
  for (const [gl, s] of Object.entries(drawByGL).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))) {
    const rate = formatPct(s.draw, s.total);
    const breakEven = s.total > 0 ? (1 / (s.draw / s.total)).toFixed(2) : '-';
    const ms = matches.filter(m => m.goalLine === gl && m.hdOdds);
    const avgHd = ms.length > 0 ? (ms.reduce((sum, m) => sum + m.hdOdds, 0) / ms.length).toFixed(2) : '-';
    drawGLRows.push([gl, String(s.total), rate, avgHd, breakEven,
      breakEven !== '-' && avgHd !== '-' ? (parseFloat(breakEven) <= parseFloat(avgHd) ? '可能正EV' : '负EV') : '-']);
  }
  drawSection.tables.push({
    title: '不同盘口深度让球平(D)命中率',
    headers: ['盘口', '场次', '让球平占比', '平均让平赔率', '盈亏平衡赔率', '判断'],
    rows: drawGLRows
  });

  report.sections.push(drawSection);

  // ─── 维度6：变盘次数 ─────────────────────────────────
  const oddsChangeSection = {
    title: '维度6：变盘次数',
    desc: '让球盘变盘次数与赛果的关系。变盘次数多=市场关注度高=信息充分。',
    tables: []
  };

  const ocGroups = { '0': [], '1-2': [], '3-4': [], '5-7': [], '8+': [] };
  for (const m of matches) {
    const oc = m.oddsChanges;
    if (oc === 0) ocGroups['0'].push(m);
    else if (oc <= 2) ocGroups['1-2'].push(m);
    else if (oc <= 4) ocGroups['3-4'].push(m);
    else if (oc <= 7) ocGroups['5-7'].push(m);
    else ocGroups['8+'].push(m);
  }

  const ocRows = [];
  for (const [range, ms] of Object.entries(ocGroups)) {
    const hh = ms.filter(m => m.handicapResult === 'H').length;
    const dd = ms.filter(m => m.handicapResult === 'D').length;
    const aa = ms.filter(m => m.handicapResult === 'A').length;
    ocRows.push([range, String(ms.length), formatPct(hh, ms.length), formatPct(dd, ms.length), formatPct(aa, ms.length)]);
  }
  oddsChangeSection.tables.push({
    title: '变盘次数与让球赛果',
    headers: ['变盘次数', '场次', '让胜H', '让平D', '让负A'],
    rows: ocRows
  });

  // 变盘次数 × 盘口深度
  const ocGL = {};
  for (const m of matches) {
    const oc = m.oddsChanges;
    const ocKey = oc === 0 ? '0' : oc <= 2 ? '1-2' : oc <= 4 ? '3-4' : oc <= 7 ? '5-7' : '8+';
    const key = `${ocKey}|${m.goalLine}`;
    if (!ocGL[key]) ocGL[key] = { total: 0, H: 0, D: 0, A: 0 };
    ocGL[key].total++;
    ocGL[key][m.handicapResult]++;
  }
  const ocGLRows = [];
  for (const [key, s] of Object.entries(ocGL).sort()) {
    ocGLRows.push([key, String(s.total), formatPct(s.H, s.total), formatPct(s.D, s.total), formatPct(s.A, s.total)]);
  }
  oddsChangeSection.tables.push({
    title: '变盘次数 × 盘口深度 交叉分析',
    headers: ['变盘|盘口', '场次', '让胜H', '让平D', '让负A'],
    rows: ocGLRows
  });

  // 让球盘变盘方向（被压方向）vs 赛果
  const pressDist = crossCount(matches, 'hhDirection_press', 'handicapResult');
  const pressRows = [];
  for (const [dir, s] of Object.entries(pressDist)) {
    // 如果被压方向=赛果方向，说明市场正确
    const correct = dir !== 'null' ? s[dir] || 0 : 0;
    const correctRate = s.total > 0 ? formatPct(correct, s.total) : '-';
    pressRows.push([dir, String(s.total), formatPct(s.H, s.total), formatPct(s.D, s.total), formatPct(s.A, s.total), correctRate]);
  }
  oddsChangeSection.tables.push({
    title: '让球盘变盘方向（被压方向）vs 赛果',
    headers: ['被压方向', '场次', '让胜H', '让平D', '让负A', '市场正确率'],
    rows: pressRows
  });

  report.sections.push(oddsChangeSection);

  // ─── 维度7：让球盘赔率方向变化（hf/df/af） ────────
  const dirChangeSection = {
    title: '维度7：让球盘赔率方向变化（hf/df/af）',
    desc: 'hf=1表示让球主胜赔率上升，-1下降。分析赔率变化方向与赛果的关系。',
    tables: []
  };

  // 分析hf/df/af的组合
  const dirCombos = {};
  for (const m of matches) {
    if (!m.hhDirection) continue;
    const key = `h${m.hhDirection.hf}_d${m.hhDirection.df}_a${m.hhDirection.af}`;
    if (!dirCombos[key]) dirCombos[key] = { total: 0, H: 0, D: 0, A: 0 };
    dirCombos[key].total++;
    dirCombos[key][m.handicapResult]++;
  }
  const dirRows = Object.entries(dirCombos)
    .filter(([_, s]) => s.total >= 10)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([combo, s]) => {
      return [combo, String(s.total), formatPct(s.H, s.total), formatPct(s.D, s.total), formatPct(s.A, s.total)];
    });
  dirChangeSection.tables.push({
    title: '让球盘赔率方向组合（样本>=10）',
    headers: ['方向(h/d/a)', '场次', '让胜H', '让平D', '让负A'],
    rows: dirRows
  });

  report.sections.push(dirChangeSection);

  // ─── 维度8：组合信号 ─────────────────────────────────
  const comboSection = {
    title: '第2轮：组合信号分析',
    desc: '基于前7个维度的发现，挑选最有潜力的组合进行交叉验证',
    tables: []
  };

  // 寻找正EV组合：让球平在高赔率区间
  // 组合1: +1盘 + 赔率3.0-5.0 + 让球平
  const combo1 = matches.filter(m => m.goalLine === '+1' && oddsRanges(m) === '3.0-5.0' && m.handicapResult === 'D');
  // 组合2: -1盘 + 变盘3-7次 + 让球负
  const combo2 = matches.filter(m => m.goalLine === '-1' && m.oddsChanges >= 3 && m.oddsChanges <= 7 && m.handicapResult === 'A');
  // 组合3: +1盘 + 变盘0次 + 让球胜
  const combo3 = matches.filter(m => m.goalLine === '+1' && m.oddsChanges === 0 && m.handicapResult === 'H');
  // 组合4: 让球盘被压方向 = 赛果（市场正确时的价值）
  const combo4 = matches.filter(m => m.hhDirection_press === m.handicapResult);
  // 组合5: 让球盘被压方向 ≠ 赛果（市场错误时的价值）
  const combo5 = matches.filter(m => m.hhDirection_press && m.hhDirection_press !== m.handicapResult);

  // 更系统的组合搜索：所有盘口 × 所有变盘区间
  const allCombos = {};
  for (const m of matches) {
    const oc = m.oddsChanges;
    const ocKey = oc === 0 ? '0' : oc <= 2 ? '1-2' : oc <= 4 ? '3-4' : oc <= 7 ? '5-7' : '8+';
    for (const target of ['H', 'D', 'A']) {
      const key = `${m.goalLine}|${ocKey}|${target}`;
      if (!allCombos[key]) allCombos[key] = { total: 0, hit: 0 };
      allCombos[key].total++;
      if (m.handicapResult === target) allCombos[key].hit++;
    }
  }

  // 找正EV组合
  const evCandidates = [];
  for (const m of matches) {
    const oc = m.oddsChanges;
    const ocKey = oc === 0 ? '0' : oc <= 2 ? '1-2' : oc <= 4 ? '3-4' : oc <= 7 ? '5-7' : '8+';
    // 尝试每个方向
    for (const target of ['H', 'D', 'A']) {
      const key = `${m.goalLine}|${ocKey}|${target}`;
      const s = allCombos[key];
      if (s && s.total >= 20 && s.total <= 2000) {
        const hitRate = s.hit / s.total;
        // 这个方向在什么赔率下能赚钱？
        const oddsKey = target === 'H' ? 'hhOdds' : target === 'D' ? 'hdOdds' : 'haOdds';
        const odds = m[oddsKey];
        if (odds && hitRate * odds > 1.05) {
          evCandidates.push({
            key: `${m.goalLine}|${ocKey}|${target}`,
            total: s.total,
            hit: s.hit,
            hitRate: (hitRate * 100).toFixed(1) + '%',
            avgOdds: '',
            ev: (hitRate * odds * 100).toFixed(1) + '%'
          });
        }
      }
    }
  }

  // 去重
  const uniqueCandidates = {};
  for (const c of evCandidates) {
    if (!uniqueCandidates[c.key] || parseFloat(c.ev) > parseFloat(uniqueCandidates[c.key].ev)) {
      uniqueCandidates[c.key] = c;
    }
  }

  // 计算每个组合的平均赔率
  for (const c of Object.values(uniqueCandidates)) {
    const [gl, ocRange, target] = c.key.split('|');
    const oddsKey = target === 'H' ? 'hhOdds' : target === 'D' ? 'hdOdds' : 'haOdds';
    const ms = matches.filter(m => {
      const oc = m.oddsChanges;
      const ocK = oc === 0 ? '0' : oc <= 2 ? '1-2' : oc <= 4 ? '3-4' : oc <= 7 ? '5-7' : '8+';
      return m.goalLine === gl && ocK === ocRange;
    }).filter(m => m[oddsKey]);
    if (ms.length > 0) {
      c.avgOdds = (ms.reduce((sum, m) => sum + m[oddsKey], 0) / ms.length).toFixed(2);
      c.ev = ((c.hit / c.total) * parseFloat(c.avgOdds) * 100).toFixed(1) + '%';
    }
  }

  const comboRows = Object.values(uniqueCandidates)
    .filter(c => c.total >= 20)
    .sort((a, b) => parseFloat(b.ev) - parseFloat(a.ev))
    .map(c => [c.key, String(c.total), c.hitRate, c.avgOdds, c.ev, parseFloat(c.ev) > 105 ? '正EV' : '负EV']);

  comboSection.tables.push({
    title: '盘口×变盘×方向 组合信号（正EV候选）',
    headers: ['组合(盘口|变盘|方向)', '场次', '命中率', '平均赔率', '期望回报', '判断'],
    rows: comboRows
  });

  // 更深度的组合：盘口×变盘×联赛
  const deepCombos = {};
  for (const m of matches) {
    const oc = m.oddsChanges;
    const ocKey = oc === 0 ? '0' : oc <= 2 ? '1-2' : oc <= 4 ? '3-4' : oc <= 7 ? '5-7' : '8+';
    const key = `${m.goalLine}|${ocKey}|${m.league}|${m.handicapResult}`;
    if (!deepCombos[key]) deepCombos[key] = { total: 0, hit: 0 };
    deepCombos[key].total++;
    deepCombos[key].hit++;
  }

  // 找正EV组合（样本>=10）
  const deepComboRows = [];
  const deepComboTotals = {};
  for (const [key, s] of Object.entries(deepCombos)) {
    const [gl, ocRange, league, result] = key.split('|');
    const comboKey = `${gl}|${ocRange}|${league}`;
    if (!deepComboTotals[comboKey]) deepComboTotals[comboKey] = { total: 0, H: 0, D: 0, A: 0 };
    deepComboTotals[comboKey].total += s.total;
    deepComboTotals[comboKey][result] += s.hit;
  }

  for (const [key, s] of Object.entries(deepComboTotals)) {
    if (s.total < 10) continue;
    for (const target of ['H', 'D', 'A']) {
      if (s[target] < 3) continue;
      const hitRate = s[target] / s.total;
      // 估算平均赔率
      const [gl, ocRange, league] = key.split('|');
      const oddsKey = target === 'H' ? 'hhOdds' : target === 'D' ? 'hdOdds' : 'haOdds';
      const ms = matches.filter(m => {
        const oc = m.oddsChanges;
        const ocK = oc === 0 ? '0' : oc <= 2 ? '1-2' : oc <= 4 ? '3-4' : oc <= 7 ? '5-7' : '8+';
        return m.goalLine === gl && ocK === ocRange && m.league === league;
      }).filter(m => m[oddsKey]);
      if (ms.length < 5) continue;
      const avgOdds = ms.reduce((sum, m) => sum + m[oddsKey], 0) / ms.length;
      const ev = hitRate * avgOdds;
      if (ev > 1.05) {
        deepComboRows.push([
          key, String(s.total), String(s[target]),
          (hitRate * 100).toFixed(1) + '%',
          avgOdds.toFixed(2),
          (ev * 100).toFixed(1) + '%',
          '正EV'
        ]);
      }
    }
  }

  comboSection.tables.push({
    title: '盘口×变盘×联赛×方向 深层组合（正EV候选）',
    desc: '三重过滤，样本量>=10，命中>=3，期望回报>105%',
    headers: ['组合(盘口|变盘|联赛|方向)', '总场次', '命中', '命中率', '均赔', '期望回报', '判断'],
    rows: deepComboRows.sort((a, b) => parseFloat(b[5]) - parseFloat(a[5]))
  });

  report.sections.push(comboSection);

  // ─── 第3轮：回测验证 ─────────────────────────────────
  const backtestSection = {
    title: '第3轮：回测验证',
    desc: '对发现的信号进行资金回测',
    tables: [],
    results: []
  };

  // 回测函数
  function backtest(filterFn, label, stakePerBet = 50) {
    let bankroll = 1000;
    const curve = [{ date: 'start', bankroll: 1000, cumulative: 0 }];
    let bets = 0, wins = 0;
    const sorted = [...matches].sort((a, b) => a.date < b.date ? -1 : 1);

    for (const m of sorted) {
      const result = filterFn(m);
      if (!result) continue;
      const { direction, odds } = result;
      if (!odds) continue;

      bets++;
      const win = m.handicapResult === direction;
      let profit = 0;
      if (win) {
        profit = stakePerBet * (odds - 1);
        wins++;
      } else {
        profit = -stakePerBet;
      }
      bankroll += profit;
      curve.push({ date: m.date, bankroll: Math.round(bankroll * 100) / 100, cumulative: Math.round(profit * 100) / 100 });
    }

    const roi = bets > 0 ? ((bankroll - 1000) / 1000 * 100).toFixed(1) + '%' : '0%';
    const winRate = bets > 0 ? (wins / bets * 100).toFixed(1) + '%' : '0%';
    return { label, bets, wins, winRate, finalBankroll: Math.round(bankroll * 100) / 100, roi, curve };
  }

  // 回测策略1：所有比赛买让球方（H在-盘，A在+盘）
  const bt1 = backtest(m => {
    const gl = m.glNum;
    if (gl < 0) {
      // 强队让球，买让球胜H
      return { direction: 'H', odds: m.hhOdds };
    } else {
      // 弱队受让，买让球负A（即客队赢了）
      return { direction: 'A', odds: m.haOdds };
    }
  }, '策略1：买让球方（强队H/弱队A）');

  // 回测策略2：所有比赛买受让方（-盘买A，+盘买H）
  const bt2 = backtest(m => {
    if (m.glNum < 0) return { direction: 'A', odds: m.haOdds };
    else return { direction: 'H', odds: m.hhOdds };
  }, '策略2：买受让方（下盘）');

  // 回测策略3：只买让球平D
  const bt3 = backtest(m => {
    return { direction: 'D', odds: m.hdOdds };
  }, '策略3：只买让球平D');

  // 回测策略4：+1盘买让球胜H（受让方赢球赢盘）
  const bt4 = backtest(m => {
    if (m.goalLine === '+1') return { direction: 'H', odds: m.hhOdds };
    return null;
  }, '策略4：+1盘买让球胜H');

  // 回测策略5：-1盘买让球负A（强队赢球输盘）
  const bt5 = backtest(m => {
    if (m.goalLine === '-1') return { direction: 'A', odds: m.haOdds };
    return null;
  }, '策略5：-1盘买让球负A');

  // 回测策略6：变盘3-7次买让球平D
  const bt6 = backtest(m => {
    if (m.oddsChanges >= 3 && m.oddsChanges <= 7) return { direction: 'D', odds: m.hdOdds };
    return null;
  }, '策略6：变盘3-7次买让球平D');

  // 回测策略7：赔率建议值超过盈亏平衡点 -> 买那个方向
  const bt7 = backtest(m => {
    // 看哪个方向的市场赔率比盈亏平衡点高
    const gl = m.goalLine;
    const glDist = crossCount(matches, 'goalLine', 'handicapResult');
    const s = glDist[gl];
    if (!s || s.total < 20) return null;
    const hRate = s.H / s.total;
    const dRate = s.D / s.total;
    const aRate = s.A / s.total;
    const candidates = [];
    if (m.hhOdds && m.hhOdds > 1 / hRate) candidates.push({ direction: 'H', odds: m.hhOdds, ev: m.hhOdds * hRate });
    if (m.hdOdds && m.hdOdds > 1 / dRate) candidates.push({ direction: 'D', odds: m.hdOdds, ev: m.hdOdds * dRate });
    if (m.haOdds && m.haOdds > 1 / aRate) candidates.push({ direction: 'A', odds: m.haOdds, ev: m.haOdds * aRate });
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.ev - a.ev);
    return candidates[0];
  }, '策略7：盘口历史胜率与赔率对比选正EV');

  // 回测策略8：变盘0次（无关注度比赛）买让球方
  const bt8 = backtest(m => {
    if (m.oddsChanges === 0) {
      if (m.glNum < 0) return { direction: 'H', odds: m.hhOdds };
      else return { direction: 'A', odds: m.haOdds };
    }
    return null;
  }, '策略8：0变盘买让球方');

  // 回测策略9：让球盘被压方向（市场偏好的方向）
  const bt9 = backtest(m => {
    if (m.hhDirection_press) return { direction: m.hhDirection_press, odds: m.hhDirection_press === 'H' ? m.hhOdds : m.hhDirection_press === 'D' ? m.hdOdds : m.haOdds };
    return null;
  }, '策略9：跟让球盘市场方向');

  // 回测策略10：让球盘被压方向的反向
  const bt10 = backtest(m => {
    if (m.hhDirection_press) {
      const reverse = m.hhDirection_press === 'H' ? 'A' : m.hhDirection_press === 'A' ? 'H' : 'H';
      return { direction: reverse, odds: reverse === 'H' ? m.hhOdds : reverse === 'D' ? m.hdOdds : m.haOdds };
    }
    return null;
  }, '策略10：反让球盘市场方向');

  const btResults = [bt1, bt2, bt3, bt4, bt5, bt6, bt7, bt8, bt9, bt10];
  backtestSection.results = btResults;

  const btRows = btResults.map(r => [
    r.label, String(r.bets), r.winRate, `¥${r.finalBankroll}`, r.roi
  ]);
  backtestSection.tables.push({
    title: '10种回测策略对比',
    headers: ['策略', '投注场次', '胜率', '最终资金', 'ROI'],
    rows: btRows
  });

  report.sections.push(backtestSection);

  // ─── 汇总 ─────────────────────────────────
  report.summary = {
    total,
    keyFindings: []
  };

  // 找出最佳策略
  const best = btResults.sort((a, b) => b.finalBankroll - a.finalBankroll);
  report.summary.bestStrategy = best[0];
  report.summary.allStrategiesRanked = btResults.sort((a, b) => b.roi - a.roi);

  return report;
}

// ── 执行 ────────────────────────────────────────────────
const matches = loadAllMatches();
console.log(`加载 ${matches.length} 场比赛`);
const report = analyze(matches);

// 输出到文件
const outDir = join(ROOT, 'data', 'backtest');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'handicap_exploration_raw.json'), JSON.stringify(report, null, 2));

// 输出简要报告到 stdout
console.log('='.repeat(80));
console.log(`让球盘全面探索完成: ${report.total} 场比赛`);
console.log('='.repeat(80));

for (const section of report.sections) {
  console.log(`\n## ${section.title}`);
  if (section.desc) console.log(section.desc);
  for (const table of section.tables) {
    console.log(`\n### ${table.title}`);
    if (table.desc) console.log(table.desc);
    console.log(formatTable(table.rows, table.headers));
  }
}

if (report.summary) {
  console.log(`\n## 汇总`);
  console.log(`总场次: ${report.summary.total}`);
  console.log(`\n### 策略排名 (按最终资金)`);
  for (const r of report.summary.allStrategiesRanked) {
    console.log(`  ${r.label}: ${r.bets}注 ${r.winRate}胜率 最终¥${r.finalBankroll} ROI=${r.roi}`);
  }
}