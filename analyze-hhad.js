/**
 * 分析"深让1球且让球胜赔极深"的受让方(+1)胜率
 *
 * 筛选条件（对每场取 hhadList 最后一条 = 赛前最终让球赔率）：
 *   - 让球线 goalLine = -1 或 +1（让1球）
 *   - -1方(让球方) 让球胜赔率 > 5.1
 *   - -1方(让球方) 让球平赔率 > 4.1
 * 投注：+1 方（受让方）让球胜
 * 结算：用 matchResultList 中的 HHAD combination，或 sectionsNo999 推演
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const CACHE_DIR = join(__dirname, 'data/history/_odds_cache');
const HIST_DIR = join(__dirname, 'data/history/football');

// 参数: 阈值
const WIN_ODDS = parseFloat(process.argv[2] ?? '5.1');   // -1方胜赔率阈值
const DRAW_ODDS = parseFloat(process.argv[3] ?? '4.1');  // -1方平赔率阈值

// 1. 读取所有 matchId 对应的缓存
const histFiles = readdirSync(HIST_DIR).filter(f => f.endsWith('.json') && /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
const matches = [];
for (const f of histFiles) {
  const d = JSON.parse(readFileSync(join(HIST_DIR, f), 'utf8'));
  for (const m of (d.matches || [])) {
    if (m.matchId) matches.push({
      matchId: String(m.matchId),
      date: m.matchDate,
      home: m.allHomeTeam,
      away: m.allAwayTeam,
      data: m
    });
  }
}
console.log(`[分析] 历史 ${matches.length} 场`);

// 2. 逐场读取缓存
let withCache = 0, noCache = 0, withHhad = 0;
const hits = [];
const allHhad = [];
for (const m of matches) {
  const p = join(CACHE_DIR, `${m.matchId}.json`);
  if (!existsSync(p)) { noCache++; continue; }
  withCache++;
  let c;
  try { c = JSON.parse(readFileSync(p, 'utf8')); } catch(e) { continue; }
  const hhad = c.oddsHistory?.hhadList;
  const had = c.oddsHistory?.hadList;
  const resultList = c.matchResultList || [];
  if (!hhad || !hhad.length) { continue; }
  withHhad++;

  // 赛前最终让球赔率 = 最后一条
  const last = hhad[hhad.length - 1];
  const gl = String(last.goalLine ?? '').trim();
  if (!gl) continue;

  // 判断 -1方(让球方)
  // 竞彩让球: goalLine 表示"主队让球数"。+1=主队受让1球(-1方是客队), -1=主队让1球(-1方是主队)
  const gv = parseInt(gl, 10);
  let fav = null; // -1方: {winIdx:'h'|'a', winOdds, drawOdds, name}
  if (gv <= -1) {
    // 主队让球 => -1方=主队, 让球胜=h
    fav = { winKey: 'h', contraryKey: 'a', name: m.home, gw: last.h, gd: last.d, ga: last.a, gl };
  } else if (gv >= 1) {
    // 主队受让 => -1方=客队, 让球胜=a
    fav = { winKey: 'a', contraryKey: 'h', name: m.away, gw: last.a, gd: last.d, ga: last.h, gl };
  } else continue;

  const gw = parseFloat(fav.gw), gd = parseFloat(fav.gd);
  if (isNaN(gw) || isNaN(gd)) continue;

  allHhad.push({ match: m, cache: c, last, fav, gw, gd });

  // 命中条件
  if (gw > WIN_ODDS && gd > DRAW_ODDS) {
    // 结算: 找HHAD结果
    const hhadRes = resultList.find(r => r.code === 'HHAD');
    let result = null;
    if (hhadRes) {
      const combo = hhadRes.combination; // H/D/A
      result = combo === 'H' ? 'H' : combo === 'D' ? 'D' : 'A';
    }
    hits.push({ match: m, cache: c, last, fav, gw, gd, result, resultRaw: hhadRes });
  }
}

console.log(`[分析] 有缓存 ${withCache}, 有hhad ${withHhad}, 无缓存 ${noCache}`);
console.log(`[筛选] 命中 ${hits.length} 场 (-1方让球胜>${WIN_ODDS} 且 平>${DRAW_ODDS})`);

// 3. 结算
let win = 0, lose = 0, draw = 0, unknown = 0;
let stake = 0, ret = 0;
const detail = [];
for (const h of hits) {
  // 投 +1方(受让方) 胜 = fav.contraryKey 那个赔率
  // +1方胜的赔率 = last[fav.contraryKey]
  const betOdds = parseFloat(h.last[h.fav.contraryKey]);
  const r = h.result;
  stake += 100;
  if (r === 'D') { draw++; /* 让球平 = 投注输一半? 竞彩让球: 平为输 */ lose++; }
  else if (r === h.fav.contraryKey.toUpperCase()) { win++; ret += 100 * betOdds; }
  else if (r === h.fav.winKey.toUpperCase()) { lose++; }
  else { unknown++; }

  detail.push({
    ...h,
    betSide: h.fav.contraryKey.toUpperCase() === 'H' ? '主胜' : '客胜',
    betOdds,
    match: h.match.home + ' vs ' + h.match.away,
    date: h.match.date,
    goalLine: h.last.goalLine,
    favWin: h.last[h.fav.winKey],
    favDraw: h.last.d,
    favLose: h.last[h.fav.contraryKey],
    result: r || '?'
  });
}

console.log('\n========== 结算结果 ==========');
console.log(`场次: ${stake/100}`);
console.log(`+1方胜: ${win}  |  +1方输: ${lose}  |  平: ${draw}  |  未知: ${unknown}`);
const decided = win + lose;
if (decided) console.log(`+1方胜率(排除平): ${(win/decided*100).toFixed(1)}%`);
console.log(`均注100: 总投入¥${stake} | 总回报¥${ret.toFixed(0)} | 净盈亏¥${(ret-stake).toFixed(0)}`);
console.log(`ROI: ${((ret-stake)/stake*100).toFixed(1)}%`);

console.log('\n========== 明细(前40) ==========');
detail.slice(0, 40).forEach(h => {
  console.log([h.date, h.match, `盘${h.goalLine}`, `让球胜${h.favWin}`, `平${h.favDraw}`, `受让赔${h.betOdds}`, `→ ${h.result === 'H' ? '主胜' : h.result === 'D' ? '平' : h.result === 'A' ? '客胜' : '?'}`, h.betSide === 'H' ? '[投主胜]' : '[投客胜]', h.result === 'H' && h.betSide === '主胜' ? '✓赢' : h.result === 'A' && h.betSide === '客胜' ? '✓赢' : h.result === 'D' ? '' : '✗输'].join(' '));
});

// 保存明细
import { writeFileSync } from 'node:fs';
writeFileSync(join(__dirname, 'data/hhad_analysis.json'), JSON.stringify({ winOdds: WIN_ODDS, drawOdds: DRAW_ODDS, total: hits.length, summary: { win, lose, draw, unknown, stake, ret, roi: (ret-stake)/stake }, detail: detail.map(h => ({ date: h.date, match: h.match, goalLine: h.goalLine, favWin: h.favWin, favDraw: h.favDraw, betSide: h.betSide, betOdds: h.betOdds, result: h.result })) }, null, 2));
console.log('\n[已保存] data/hhad_analysis.json');