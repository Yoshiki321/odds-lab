/**
 * jc_water_detector.js — 竞彩降水方向检测（用户 2026-08-31 定调）
 *
 * 核心认知：竞彩官方定价偏保守，竞彩在某个方向降水（赔率下调）= 真正看好该方向。
 * 实证：HHAD降水方向命中 8/11=73%，HAD 9/13=69%（2026-08-31 用已结算场次验证）。
 * 降水 ≥0.1 才算真信号（0.1以下水位波动是噪声）。
 *
 * 用法:
 *   node tools/jc_water_detector.js              # 扫描 data/today/ 当日盘的竞彩降水方向
 *   node tools/jc_water_detector.js <matchId>    # 单场查降水历史
 *   node tools/jc_water_detector.js --date 2026-08-31   # 指定日期盘
 *
 * 输出: 每场的竞彩 HAD/HHAD 降水方向（降水≥0.1 标记 [强信号]），方向=降水最多的 H/D/A。
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TODAY_DIR = join(ROOT, 'data', 'today');
const THRESHOLD = 0.1;

function fetch(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', referer: 'https://www.sporttery.cn/jc/zqdz/' },
      timeout: 15000
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** 计算某方向的降水幅度（开盘价 - 临场价，正=降水） */
function dropAmount(list, side) {
  if (!list || list.length < 2) return null;
  const o = parseFloat(list[0][side]);
  const l = parseFloat(list[list.length - 1][side]);
  if (isNaN(o) || isNaN(l)) return null;
  return +(o - l).toFixed(2);
}

/** 从历史列表找降水最多的方向（只看 H/A，不含平局） */
function findWaterDirection(list) {
  if (!list || list.length < 2) return null;
  const dH = dropAmount(list, 'h');
  const dA = dropAmount(list, 'a');
  const dirs = [
    ['H', dH], ['A', dA]
  ].filter(x => x[1] !== null).sort((a, b) => b[1] - a[1]);
  if (!dirs.length || dirs[0][1] <= 0) return null; // 无降水方向
  return { dir: dirs[0][0], drop: dirs[0][1] };
}

async function scanMatch(m) {
  const id = m.matchId;
  try {
    const j = await fetch(`https://webapi.sporttery.cn/gateway/uniform/football/getFixedBonusV1.qry?clientCode=3001&matchId=${id}`);
    const oh = j.value?.oddsHistory || {};
    const had = oh.hadList || [];
    const hhad = oh.hhadList || [];
    const hadW = findWaterDirection(had);
    const hhadW = findWaterDirection(hhad);
    const hhadGL = hhad.length ? hhad[hhad.length - 1].goalLine : (m.hhad?.goalLine ?? '-');
    const strong = (hhadW && hhadW.drop >= THRESHOLD) || (hadW && hadW.drop >= THRESHOLD);
    return {
      num: m.num, home: m.home, away: m.away,
      goalLine: hhadGL,
      kickoff: `${m.matchDate} ${m.matchTime}`,
      hadWater: hadW, hhadWater: hhadW,
      strong: strong
    };
  } catch (e) {
    return { num: m.num, home: m.home, away: m.away, error: e.message };
  }
}

const arg = process.argv[2];
if (arg && !arg.startsWith('--')) {
  // 单场模式
  const j = await fetch(`https://webapi.sporttery.cn/gateway/uniform/football/getFixedBonusV1.qry?clientCode=3001&matchId=${arg}`);
  const oh = j.value?.oddsHistory || {};
  const had = oh.hadList || [];
  const hhad = oh.hhadList || [];
  console.log(`matchId=${arg}`);
  console.log(`HAD 变盘 ${had.length} 次: 开盘[${had[0]?.h}/${had[0]?.d}/${had[0]?.a}] → 临场[${had[had.length-1]?.h}/${had[had.length-1]?.d}/${had[had.length-1]?.a}]`);
  console.log(`  降水: H ${dropAmount(had,'h') ?? '-'} D ${dropAmount(had,'d') ?? '-'} A ${dropAmount(had,'a') ?? '-'}`);
  console.log(`HHAD 变盘 ${hhad.length} 次(让${hhad[hhad.length-1]?.goalLine}): 开盘[${hhad[0]?.h}/${hhad[0]?.d}/${hhad[0]?.a}] → 临场[${hhad[hhad.length-1]?.h}/${hhad[hhad.length-1]?.d}/${hhad[hhad.length-1]?.a}]`);
  console.log(`  降水: H ${dropAmount(hhad,'h') ?? '-'} A ${dropAmount(hhad,'a') ?? '-'}`);
  process.exit(0);
}

// 扫描模式
const dateArg = process.argv.find(x => x.startsWith('--date='));
const dateStr = dateArg ? dateArg.split('=')[1] : new Date().toISOString().slice(0, 10);
const file = join(TODAY_DIR, `${dateStr}.json`);
if (!existsSync(file)) {
  console.log(`未找到 ${dateStr} 盘口文件，请先 node tools/fetch_today_odds.js`);
  process.exit(1);
}
const data = JSON.parse(readFileSync(file, 'utf8'));
const matches = data.matches || [];
console.log(`扫描 ${dateStr} 竞彩降水方向（共 ${matches.length} 场，降水≥${THRESHOLD}=强信号）\n`);

const results = [];
for (const m of matches) {
  const r = await scanMatch(m);
  results.push(r);
  await sleep(120);
}

let strongCnt = 0;
for (const r of results) {
  if (r.error) { console.log(`  ${r.num} ${r.home}vs${r.away} ERR ${r.error}`); continue; }
  const hh = r.hhadWater ? `HHAD让球${r.goalLine} 降水→${r.hhadWater.dir}(${r.hhadWater.drop})` : 'HHAD无降水';
  const had = r.hadWater ? `HAD降水→${r.hadWater.dir}(${r.hadWater.drop})` : 'HAD无降水';
  const flag = r.strong ? ' [强信号]' : '';
  if (r.strong) strongCnt++;
  console.log(`  ${r.num} ${r.home}vs${r.away} | ${hh} | ${had}${flag}`);
}
console.log(`\n共 ${results.length} 场，强信号 ${strongCnt} 场。方向=降水最多；与欧亚错配方向一致时为确认信号。`);
