// score_sat_full.cjs — 全表逐场打分 v1.8（已废弃，仅存档）
// ⚠️ 2026-09-09 起评分引擎迁至 TS v2.0：`app/tools/score.ts`（npx tsx），本文不再维护。
//     v2.0 = 权重 22/12/22/12/22/10 + 严格EV + R_draw 5因子，见 data/betting/scoring-system.md。
// 用法: node tools/score_sat_full.cjs [date]（旧引擎）
// 引擎: 真降水选侧；让球深口一律退回同侧胜平负，不打让胜/让负；退回后价值/风险按退回方向重算
//       v1.6: HAD 裸盘信号同向存在受让盘(下盘)且水位健康(1.6~2.2) → 下盘保护化改投受让盘
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let VERSION = 'v?';
try {
  const doc = fs.readFileSync(path.join(ROOT, 'data', 'betting', 'scoring-system.md'), 'utf8');
  const m = doc.match(/版本:\s*\*\*(v[\d.]+)\*\*/);
  if (m) VERSION = m[1];
} catch (e) {}

const TOP5 = ['英超', '西甲', '德甲', '意甲', '法甲'];
const SECOND = ['英冠', '德乙', '法乙', '意乙', '西乙', '葡超', '荷甲', '巴甲', '美职', '俄超'];
const STRONG = ['曼城','利物浦','阿森纳','切尔西','热刺','曼联','纽卡斯尔','皇马','巴萨','马竞',
  '拜仁','多特','勒沃库森','莱比锡','斯图加特','国米','AC米兰','尤文','那不勒斯','罗马','拉齐奥','亚特兰大',
  '巴黎圣曼','马赛','摩纳哥','里昂','波尔图','本菲卡','里斯本竞技','阿贾克斯','埃因霍温','费耶诺德'];

const DROP = amt => amt>=0.5?35 : amt>=0.4?32 : amt>=0.3?29 : amt>=0.2?26 : amt>=0.1?22 : amt>=0.05?15 : amt>0?10 : 5;

function latestTodayDate() {
  const dir = path.join(ROOT, 'data', 'today');
  const files = fs.readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  if (!files.length) throw new Error('data/today 无日期文件');
  return files[files.length - 1].slice(0, 10);
}
const dateArg = process.argv[2];
const dateStr = dateArg && /^\d{4}-\d{2}-\d{2}$/.test(dateArg) ? dateArg : latestTodayDate();
const today = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'today', dateStr + '.json'), 'utf8'));
// 基线: 当天 *.base → 否则最近一份 .base（跨天文件名兜底）
// 场次对齐只按 matchId，不用「周日006」编号（昨天的周日006不是今天这场）
// 仍没有 → 当天 .first.json（本场第一次见到的盘）
const snapDir = path.join(ROOT, 'data', 'today', 'snapshots');
let baseFile = null;
if (fs.existsSync(snapDir)) {
  const snaps = fs.readdirSync(snapDir).filter(f => f.endsWith('.json'));
  const todayBase = snaps.filter(f => f.startsWith(dateStr + '-') && f.includes('.base.')).sort();
  baseFile = (todayBase.length ? todayBase[todayBase.length - 1]
    : snaps.filter(f => f.includes('.base.')).sort().pop()) || null;
}
const base = baseFile ? JSON.parse(fs.readFileSync(path.join(snapDir, baseFile), 'utf8')) : { matches: [] };
const firstPath = path.join(snapDir, dateStr + '.first.json');
const firstDoc = fs.existsSync(firstPath) ? JSON.parse(fs.readFileSync(firstPath, 'utf8')) : { matches: {} };
const firstMap = firstDoc.matches && !Array.isArray(firstDoc.matches) ? firstDoc.matches : {};
const bmById = new Map((base.matches || []).filter(x => x && x.matchId).map(x => [String(x.matchId), x]));
const mm = new Map(today.matches.map(m => [m.num, m]));

const rows = [];
for (const num of [...mm.keys()].filter(n => n && /^周/.test(n))) {
  const m = mm.get(num);
  if (!m) continue;
  const b = bmById.get(String(m.matchId || '')) || firstMap[String(m.matchId || '')] || null;
  const hh = m.hhad || {}, had = m.had || {};
  const glh = hh.goalLine || '';
  const gln = parseFloat(glh);
  const H = parseFloat(hh.h), D = parseFloat(hh.d), A = parseFloat(hh.a);
  const hadH = parseFloat(had.h), hadA = parseFloat(had.a);
  if (isNaN(H) || isNaN(A) || !H) { rows.push({ num, note: '未开盘' }); continue; }

  const hasBase = b && b.hhad && parseFloat(b.hhad.h) !== undefined;
  const bH = hasBase ? parseFloat(b.hhad.h) : NaN;
  const bA = hasBase ? parseFloat(b.hhad.a) : NaN;
  const bHadH = b && b.had ? parseFloat(b.had.h) : NaN;
  const bHadA = b && b.had ? parseFloat(b.had.a) : NaN;
  const dH = hasBase && !isNaN(bH) ? +(bH - H).toFixed(2) : 0;
  const dA = hasBase && !isNaN(bA) ? +(bA - A).toFixed(2) : 0;
  const dWh = hasBase && !isNaN(bHadH) && !isNaN(hadH) ? +(bHadH - hadH).toFixed(2) : 0;
  const dWa = hasBase && !isNaN(bHadA) && !isNaN(hadA) ? +(bHadA - hadA).toFixed(2) : 0;

  const cands = [
    { side: 'H', market: 'HAD', amt: dWh, odds: hadH },
    { side: 'A', market: 'HAD', amt: dWa, odds: hadA },
    { side: 'H', market: 'HHAD', amt: dH, odds: H },
    { side: 'A', market: 'HHAD', amt: dA, odds: A },
  ].filter(x => x.amt > 0 && !isNaN(x.odds));
  let pick = cands.sort((a, b) => b.amt - a.amt)[0] || null;
  if (!pick || isNaN(pick.odds)) {
    if (!isNaN(hadH) && !isNaN(hadA)) {
      const low = hadH <= hadA ? 'H' : 'A';
      pick = { side: low, market: 'HAD', amt: 0, odds: low === 'H' ? hadH : hadA };
    } else {
      pick = { side: 'H', market: 'HHAD', amt: Math.max(dH, 0), odds: H };
    }
  }
  // 深盘退回：让球盘上选中「对家方向」（主受让选客 / 主让选主）= 赌穿盘 → 退回同侧胜平负
  // v1.4（2026-09-06）：退回提前到打分前，价值/风险按退回方向赔率重算，展示与六维自洽
  const letting = pick.market === 'HHAD' && ((pick.side === 'H' && gln < 0) || (pick.side === 'A' && gln > 0));

  const dropSide = pick.side;
  const dropAmt = pick.amt;
  const glAbs = isNaN(gln) ? 0 : Math.abs(gln);

  // v1.6（2026-09-06 下盘保护化）：HAD 裸胜/裸负信号若同向存在受让盘（下盘 +0.5/+1），
  // 且裸注赔率≥2.5（长射难中）而受让盘水位在 1.6~2.2 健康区间 → 改投受让盘。
  // 依据：信号证明方向、不证明纵深；受让盘「输一球退回」，命中率远高于裸赢长射。
  // 死钱(<1.6)不保护化仍走裸盘；上盘穿盘退回逻辑不动（防「赢1球走让平」）。
  const recvSide = gln > 0 ? 'H' : gln < 0 ? 'A' : null;
  const recvCell = recvSide === 'H' ? { side: 'H', market: 'HHAD', amt: dH, odds: H }
    : recvSide === 'A' ? { side: 'A', market: 'HHAD', amt: dA, odds: A } : null;
  let bet = { side: dropSide, market: pick.market, odds: pick.odds, amt: pick.amt };
  let betNote = letting ? '退回胜平负' : '';
  if (pick.market === 'HAD' && recvCell && recvCell.side === dropSide
      && pick.odds >= 2.5 && recvCell.odds >= 1.6 && recvCell.odds <= 2.2) {
    bet = { side: recvCell.side, market: 'HHAD', odds: recvCell.odds, amt: recvCell.amt };
    betNote = '下盘保护化';
  }

  let market = bet.market;
  let dirOdds = bet.odds;
  const hadOdds = dropSide === 'H' ? hadH : hadA;
  if (letting && !isNaN(hadOdds)) { market = 'HAD'; dirOdds = hadOdds; }
  const signed = n => (n > 0 ? '+' : '') + n;
  let dirDesc;
  if (market === 'HAD') dirDesc = dropSide === 'H' ? '主胜' : '主负';
  else if (dropSide === 'H') dirDesc = '主' + signed(gln) + '胜';
  else dirDesc = '客' + signed(-gln) + '胜';

  let confirm = 1;
  if (!isNaN(hadH) && !isNaN(hadA)) {
    const lowSide = hadH <= hadA ? 'H' : 'A';
    if (lowSide === dropSide) confirm = 2;
  }

  const isTop5 = TOP5.includes(m.league);
  const isSec = SECOND.includes(m.league);
  let model = 0;
  if (gln === 1 && !isTop5 && !isSec && dropSide === 'A' && dropAmt > 0.05 && pick.market === 'HHAD') model = 20;
  else if (pick.market === 'HHAD' && dropAmt >= 0.3 && confirm === 2) model = 12;

  let history = 6;
  let risk = 10;
  if (glAbs >= 2 && pick.market === 'HHAD') risk -= 5;                            // 深盘（结构风险，退回根因，保留）
  if (STRONG.includes(m.home) && STRONG.includes(m.away)) risk -= 2;              // 强强对话
  if (isSec && market === 'HHAD' && dropSide === 'H' && dirOdds < 1.7) risk -= 4; // 次级低赔让球（仅未退回时）
  if (risk < 0) risk = 0;
  // 深口高赔(-4) 在 v1.4 移除：它只命中「退回」场，退回后投注已为胜平负，让球盘穿盘疑虑不再适用

  // 价值按最终方向赔率分档（退回后 = 同侧胜平负赔率）
  const value = dirOdds >= 2.0 && dirOdds <= 5.0 ? 5 : dirOdds >= 1.5 ? 4 : dirOdds > 5.0 ? 3 : dirOdds >= 1.2 ? 2 : 0;
  const hasBaseMark = hasBase ? 'v' : '!';
  const dropSc = hasBase ? (dropAmt < 0 ? 0 : DROP(dropAmt)) : 0;
  const total = dropSc + (confirm === 2 ? 8 : 4) + model + history + risk + value;
  const dropNote = hasBase
    ? (dropAmt > 0 ? '💧' + Number(dropAmt).toFixed(2) : dropAmt < 0 ? '↑升' + Math.abs(dropAmt).toFixed(2) : '静')
    : '首盘';
  const band = total >= 80 ? '🔨加注' : total >= 70 ? '✅实单' : total >= 60 ? '⏳候选' : total >= 40 ? '👀弱' : '❌放弃';

  rows.push({
    num, league: m.league, home: m.home, away: m.away, time: m.matchTime,
    matchId: m.matchId,
    dir: dirDesc, odds: dirOdds, dropAmt, hasBaseMark, dropNote, confirm, model,
    history, risk, value, total, band, market, pred: dropSide, betNote,
    had: m.had || null, hhad: m.hhad || null,
    base: hasBase ? { had: b.had || null, hhad: b.hhad || null } : null
  });
}

rows.sort((a, b) => (b.total || 0) - (a.total || 0));

// 落盘 data/scores/<date>.json（供网页每日列表读取）
const SCORE_DIR = path.join(ROOT, 'data', 'scores');
if (!fs.existsSync(SCORE_DIR)) fs.mkdirSync(SCORE_DIR, { recursive: true });
fs.writeFileSync(path.join(SCORE_DIR, dateStr + '.json'), JSON.stringify({
  date: dateStr, generatedAt: new Date().toISOString(), version: VERSION, rows
}, null, 2), 'utf8');

console.log(`信息值评分 ${VERSION} 修复版 | ${dateStr} | 共 ${rows.length} 场 | 基线${baseFile ? '有' : '无'}(${baseFile || ''}) | 已存 data/scores/${dateStr}.json`);
console.log('档位: >=80加注 | 70-79实单 | 60-69候选 | 40-59弱 | <40放弃\n');
for (const r of rows) {
  if (!r.total) { console.log('  ' + r.num + ' ' + (r.note || '')); continue; }
  console.log(`${r.num} ${r.league.padEnd(5)} ${(r.home + '-' + r.away).padEnd(18)} ${r.time} ${(r.dir + '@' + r.odds).padEnd(22)} ${String(r.total).padStart(3)} ${r.band} ${r.dropNote} ${r.betNote || ''} [确认${r.confirm}/模型${r.model}/历史${r.history}/风险${r.risk}/价值${r.value}]`);
}