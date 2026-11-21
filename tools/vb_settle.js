/**
 * vb_settle.js — 欧亚盘虚拟注自动结算
 *
 * 读 data/virtual/vb-*.json 中 status=open 的注单，
 * 用 sporttery getFixedBonusV1 查比分，按亚盘/大小球规则结算。
 *
 * 用法:
 *   node tools/vb_settle.js            # 结算所有已开赛的在途虚拟注
 *   node tools/vb_settle.js list       # 只列出在途(不结算)
 *
 * 结算规则（欧亚盘玩法）:
 *   - 亚盘让球: pick 含 "-1.5(球半)" 等, 用比分差 vs 让球线判定
 *   - 大小球: pick 含 "大2.5"/"小3.0" 等, 用总分 vs 线判定
 * 注: 竞彩让球(受让+1等)老注单也用竞彩HHAD判定(legacy)
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const VDIR = join(ROOT, 'data', 'virtual');

function fetch(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', referer: 'https://www.sporttery.cn/jc/zqdz/' },
      timeout: 15000
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function checkResult(matchId) {
  const url = `https://webapi.sporttery.cn/gateway/uniform/football/getFixedBonusV1.qry?clientCode=3001&matchId=${matchId}`;
  const j = await fetch(url);
  if (!j.success || !j.value) return { ready: false };
  const v = j.value;
  // 终场判定：matchResultList 有正式开奖记录(HAD combination)才算终场。
  // sectionsNo999 只是实时比分，比赛未结束时也会返回，绝不能当最终比分。
  const mr = v.matchResultList || [];
  const had = mr.find(x => x.code === 'HAD');
  const hhad = mr.find(x => x.code === 'HHAD');
  if (!had || !had.combination) return { ready: false };
  return { ready: true, score: v.sectionsNo999, hadResult: had.combination, hhadResult: hhad?.combination };
}

/** 解析比分 "2:0" -> [2,0] */
function parseScore(s) {
  const m = String(s).match(/(\d+)\s*:\s*(\d+)/);
  if (!m) return null;
  return [parseInt(m[1]), parseInt(m[2])];
}

/** 从pick文本提取亚盘让球线，如 "-1.5(球半)" -> -1.5, "受让+1" -> +1 */
function extractAsianLine(pick) {
  // 支持 .25/.50/.75 盘: "-1.25" "-2.25" "+0.5" 等
  const m = pick.match(/([+-])(\d+\.\d{1,2})/);
  if (m) {
    let v = parseFloat(m[1] + m[2]);
    // 四舍五入到 .25 的半分位
    if (v % 1 !== 0) v = Math.round(v * 4) / 4;
    return v;
  }
  const mi = pick.match(/([+-])(\d+)/);  // 整数盘 -1 / +1
  if (mi) return parseFloat(mi[1] + mi[2]);
  // "受让X" / "让X"（无符号）
  const m2 = pick.match(/(受让|让)(\d+(?:\.5)?)/);
  if (m2) {
    let v = parseFloat(m2[2]);
    if (m2[1] === '受让') v = -v;
    return v;
  }
  return null;
}

/** 判定亚盘是否赢: 净胜差 + 让球线 */
function asianResult(score, line) {
  const s = parseScore(score);
  if (!s) return 'void';
  const diff = s[0] - s[1];
  const value = diff + line; // 主队-让球线后
  if (value > 0) return 'win';
  if (value < 0) return 'loss';
  return 'push';
}

function settleBet(b, res) {
  const pick = b.pick || '';
  const score = parseScore(res.score);

  // 大小球
  if (pick.includes('大') || pick.includes('小')) {
    const m = pick.match(/(大|小)(\d+(?:\.\d+)?)/);
    if (m && score) {
      const total = score[0] + score[1];
      const line = parseFloat(m[2]);
      const isOver = m[1] === '大';
      const result = isOver ? (total > line ? 'win' : total === line ? 'push' : 'loss')
                            : (total < line ? 'win' : total === line ? 'push' : 'loss');
      return result;
    }
  }

  // 亚盘让球 (含 "受让+1")
  if (pick.includes('亚盘') || pick.includes('让') || pick.includes('受让')) {
    // 找出该队
    const homeFirst = /^(亚盘\s*)?(.+?)\s*([-+]\d)/.exec(pick);
    let line = extractAsianLine(pick);
    // 若 pick 形如 "多特 -1.5(球半)" -> 主队-1.5
    // 若 pick 形如 "马尔默 +0.5(受让半球)" -> 客队受让半球 = 主队-0.5
    if (line !== null && score) {
      const diff = score[0] - score[1];
      // 让球线正负: 主队让 = 负值; 客队让/主队受让 = 正值
      // pick里含队名, 判断是主还是客
      const isHomePick = pick.includes(b.home);
      let value;
      if (isHomePick) {
        value = diff + line;  // 主队-1.5: diff+(-1.5)
      } else {
        // 客队: 客队让一球 -> 线对主队是 +1 (主受让), 或客队受让 -> 主队-0.5
        value = -(diff - line); // 反转视角
      }
      if (value > 0) return 'win';
      if (value < 0) return 'loss';
      return 'push';
    }
  }

  // legacy: 竞彩让球 (HHAD)
  if (b.goalLine && res.hhadResult) {
    let target;
    if (pick.includes('让胜')) target = 'H';
    else if (pick.includes('让平')) target = 'D';
    else if (pick.includes('让负')) target = 'A';
    if (target) return target === res.hhadResult ? 'win' : 'loss';
  }
  // legacy: 胜平负
  if (pick.includes('主胜') && res.hadResult) return res.hadResult === 'H' ? 'win' : 'loss';
  if (pick.includes('主负') && res.hadResult) return res.hadResult === 'A' ? 'win' : 'loss';
  if (pick.includes('客胜') && res.hadResult) return res.hadResult === 'A' ? 'win' : 'loss';
  if (pick.includes('平') && res.hadResult) return res.hadResult === 'D' ? 'win' : 'loss';

  return 'void';
}

const mode = process.argv[2] || 'settle';
const all = [];
for (const f of readdirSync(VDIR).filter(f => f.startsWith('vb-') && f.endsWith('.json'))) {
  all.push(JSON.parse(readFileSync(join(VDIR, f), 'utf8')));
}
const open = all.filter(b => b.status === 'open');
console.log(`在途虚拟注 ${open.length} 单`);

if (mode === 'list') process.exit(0);

for (const b of open) {
  const res = await checkResult(b.matchId);
  if (!res.ready) {
    console.log(`  [待定] ${b.id} ${b.home}vs${b.away} 比分未出`);
    continue;
  }
  const outcome = settleBet(b, res);
  const icon = outcome === 'win' ? '✅' : outcome === 'loss' ? '❌' : '⚠️';
  console.log(`  [${icon}] ${b.id} ${b.home} ${res.score} ${b.away} | ${b.pick} -> ${outcome}`);
  b.result = res.score;
  b.hadResult = res.hadResult;
  b.hhadResult = res.hhadResult;
  b.status = outcome;
  b.settledAt = new Date().toISOString();
  writeFileSync(join(VDIR, `${b.id}.json`), JSON.stringify(b, null, 2), 'utf8');
}
console.log('done');
