// score_auto.cjs — 自动打分（从盘口数据出分，无需手填）
// 评分机制见 data/betting/scoring-system.md（版本自动读取）
//
// 数据流:
//   每次抓盘后跑: node tools/score_auto.cjs
//   首次跑(无快照) → 存开盘基线快照 + 出"开盘快照分"
//   之后跑 → 对比基线算降水分量/变盘次数 → 出完整分
//
// 用法:
//   node tools/score_auto.cjs [date] [--detail] [--csv]
//   date 默认取 data/today 下最新文件
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TODAY_DIR = path.join(ROOT, 'data', 'today');
const SNAP_DIR = path.join(TODAY_DIR, 'snapshots');

// ---- 版本号 ----
let VERSION = 'v?';
try {
  const doc = fs.readFileSync(path.join(ROOT, 'data', 'betting', 'scoring-system.md'), 'utf8');
  const m = doc.match(/版本:\s*\*\*(v[\d.]+)\*\*/);
  if (m) VERSION = m[1];
} catch (e) {}

// ---- 常数 ----
const TOP5 = ['英超', '西甲', '德甲', '意甲', '法甲'];
const SECOND = ['英冠', '德乙', '法乙', '意乙', '西乙', '葡超', '荷甲', '巴甲', '美职', '俄超'];
const TRAP = ['济州SK']; // 盘口陷阱记忆（反买信号）
const STRONG = ['曼城','利物浦','阿森纳','切尔西','热刺','曼联','纽卡斯尔','皇马','巴萨','马竞',
  '拜仁','多特','勒沃库森','莱比锡','斯图加特','国米','AC米兰','尤文','那不勒斯','罗马','拉齐奥','亚特兰大',
  '巴黎圣曼','马赛','摩纳哥','里昂','波尔图','本菲卡','里斯本竞技','阿贾克斯','埃因霍温','费耶诺德'];

const DROP = (amt, ok) => ok ? (amt>=0.5?35:amt>=0.4?32:amt>=0.3?29:amt>=0.2?26:amt>=0.1?22:amt>=0.05?15:amt>0?10:5) : 0;
const CONFIRM = {4:20, 3:16, 2:12, 1:4, 0:0};

// ---- 找最新today文件 ----
function latestTodayFile() {
  const files = fs.readdirSync(TODAY_DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  return files[files.length - 1];
}

// ---- 快照管理 ----
function listSnapshots(dateStr) {
  if (!fs.existsSync(SNAP_DIR)) return [];
  return fs.readdirSync(SNAP_DIR).filter(f => f.startsWith(dateStr) && f.endsWith('.json')).sort();
}
function takeSnapshot(dateStr, matches, isBase = false) {
  if (!fs.existsSync(SNAP_DIR)) fs.mkdirSync(SNAP_DIR, { recursive: true });
  const now = new Date();
  const stamp = dateStr + '-' + String(now.getHours()).padStart(2,'0') + String(now.getMinutes()).padStart(2,'0') + (isBase ? '.base' : '');
  const rec = { savedAt: now.toISOString(), dateStr, isBaseline: !!isBase, matches: matches.map(m => ({
    num: m.num, matchId: m.matchId, home: m.home, away: m.away, league: m.league, matchTime: m.matchTime,
    had: m.had, hhad: m.hhad
  })) };
  fs.writeFileSync(path.join(SNAP_DIR, stamp + '.json'), JSON.stringify(rec, null, 2));
  return stamp;
}

// ---- 每场打分 ----
function scoreMatch(m, baseline) {
  const hh = m.hhad, had = m.had;
  const gl = hh && hh.goalLine ? parseInt(String(hh.goalLine).replace('+','')) : null;
  const hasHH = hh && hh.h !== undefined && hh.h !== '0' && hh.h !== '';
  const hasHAD = had && had.h !== undefined && had.h !== '0' && had.h !== '';
  if (!hasHH) return null; // 未开盘

  const h = +hh.h, dd = +hh.d, a = +hh.a;
  const side = ['H','D','A'][[h, dd, a].indexOf(Math.min(h, dd, a))];   // 竞彩让球盘低赔侧
  const odds = side === 'H' ? h : side === 'D' ? dd : a;
  // 投注方向描述（竞彩让球盘）
  const glDesc = gl === null ? '' : (gl >= 0 ? '+' + gl : String(gl));
  const dirDesc = side === 'H' ? '主队' + (glDesc ? '(' + glDesc + ')' : '') + 'H'
                : side === 'A' ? '客队A'
                : '平D';

  // 降水: 基线 → 当前 (方向侧)
  let drop = 0, ok = true, changes = 0;
  if (baseline) {
    const bhh = baseline.matches.find(x => x.matchId === m.matchId || x.num === m.num);
    if (bhh && bhh.hhad && bhh.hhad.h !== undefined) {
      const bh = +bhh.hhad.h, bd = +bhh.hhad.d, ba = +bhh.hhad.a;
      drop = side === 'H' ? bh - h : side === 'D' ? bd - dd : ba - a;
      ok = drop > 0;                       // 降水方向与低赔侧一致
      // 变盘次数: h/d/a 任一侧相对基线的净变化次数(超过0.01算一次)
      changes = [Math.abs(bh-h), Math.abs(bd-dd), Math.abs(ba-a)].filter(v => v > 0.01).length;
    }
  }

  // 方向确认: had 低赔侧与 hhad 低赔侧同向
  let confirm = 0;
  if (hasHAD && had.h !== '') {
    const hh2 = +had.h, d2 = +had.d, a2 = +had.a;
    const side2 = ['H','D','A'][[hh2, d2, a2].indexOf(Math.min(hh2, d2, a2))];
    confirm = side === side2 ? 2 : (side !== 'D' && side2 !== 'D' ? 1 : 0);
  } else {
    confirm = 1;
  }

  // 模型: P2a_gl1 条件自动判断
  let model = 0;
  const isTop5 = TOP5.includes(m.league);
  const isSec = SECOND.includes(m.league);
  if (gl === 1 && !isTop5 && !isSec && changes >= 1 && changes <= 2 && side === 'A' && confirm >= 1) {
    model = 20; // M1 P2a_gl1
  } else if (!isTop5 && !isSec && gl === 1 && confirm >= 2 && odds >= 2.0 && odds <= 5.0) {
    model = 12; // 降水规则/冷门形态弱命中
  }

  // 历史验证: 简化(同类联赛样本=6, 陷阱队=0)
  let history = 6;
  if (TRAP.some(t => m.home.includes(t) || m.away.includes(t))) history = 0;

  // 风险排除(从10扣)
  let risk = 10;
  if (TRAP.some(t => m.home.includes(t) || m.away.includes(t))) risk -= 5;
  if (gl !== null && Math.abs(gl) >= 2) risk -= 3;
  if (STRONG.includes(m.home) && STRONG.includes(m.away)) risk -= 2;
  const awayHuge = hasHAD && had.a !== '' && +had.a <= 1.30 && !isTop5;
  if (awayHuge) risk -= 2;
  const nowMs = Date.now();
  const kickMs = new Date(m.matchDate + 'T' + m.matchTime + '+08:00').getTime();
  if (kickMs - nowMs > 12 * 3600 * 1000) risk -= 2; // 远期
  if (risk < 0) risk = 0;

  // 赔率价值
  let value = odds >= 2.0 && odds <= 5.0 ? 5 : odds >= 1.5 ? 4 : odds > 5.0 ? 3 : odds >= 1.2 ? 2 : 0;

  const dropSc = DROP(Math.abs(drop), ok);
  const chkSc = changes >= 1 && changes <= 2 ? 3 : 0;
  const confirmSc = CONFIRM[confirm];
  const total = dropSc + chkSc + confirmSc + model + history + risk + value;

  return {
    num: m.num, league: m.league, home: m.home, away: m.away, matchTime: m.matchTime,
    dir: dirDesc, odds: odds.toFixed(2), gl: glDesc || '-',
    drop: Math.round(drop * 100) / 100, changes,
    dropSc, chkSc, confirmSc, model, history, risk, value, total,
    note: (drop > 0 ? '降水' + Math.abs(drop).toFixed(2) : drop < 0 ? '升水' + Math.abs(drop).toFixed(2) : '静盘')
      + ' 变盘' + changes + ' 让' + (glDesc || '?')
  };
}

// ---- 主流程 ----
const dateArg = process.argv[2];
const dateStr = dateArg && /^\d{4}-\d{2}-\d{2}$/.test(dateArg) ? dateArg : latestTodayFile().replace('.json','');
const todayFile = path.join(TODAY_DIR, dateStr + '.json');
if (!fs.existsSync(todayFile)) { console.error('无数据文件: ' + todayFile); process.exit(1); }

const data = JSON.parse(fs.readFileSync(todayFile, 'utf8'));
const matches = data.matches || [];

// 基线: 优先取 *.base.json(开盘基线)，否则取当日最早快照；--baseline 建/重建开盘基线
// 兜底: 当天无任何快照(如基线文件前缀跨天)时，回退到最近一次 .base 基线。
//   对比按 matchId 匹配，跨天前缀的基线内容若不匹配当前场次自然无水份，安全。
const REBASE = process.argv.includes('--baseline');
const snaps = listSnapshots(dateStr);
const baseSnaps = snaps.filter(f => f.includes('.base.'));
let chosen = baseSnaps.length > 0 ? baseSnaps[baseSnaps.length - 1] : snaps[0];
if (!chosen) {
  const allBase = fs.existsSync(SNAP_DIR)
    ? fs.readdirSync(SNAP_DIR).filter(f => f.endsWith('.json') && f.includes('.base.')).sort()
    : [];
  chosen = allBase[allBase.length - 1] || null;
}
let baseline = null, baselineStamp = null;
if (REBASE) {
  baselineStamp = takeSnapshot(dateStr, matches, true);
  console.log('[基线] 已建立开盘基线 ' + baselineStamp + '（旧基线保留不删）。\n');
} else if (chosen) {
  baseline = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, chosen), 'utf8'));
  baselineStamp = chosen;
}
// 无任何快照 → 存基线
if (!REBASE && !chosen) {
  baselineStamp = takeSnapshot(dateStr, matches, true);
  console.log('[基线] 无历史快照，已存开盘基线 ' + baselineStamp + '。下次抓盘后重跑即出降水分量。\n');
}

const DETAIL = process.argv.includes('--detail');
const CSV = process.argv.includes('--csv');

const rows = matches.map(m => scoreMatch(m, baseline)).filter(Boolean);
rows.sort((a,b) => b.total - a.total);

if (CSV) {
  console.log('排名,场次,联赛,对阵,方向,gl,odds,降水分量,变盘,降水分,变盘分,确认分,模型分,历史分,风险分,价值分,总分,档位');
  rows.forEach((s, i) => {
    const t = s.total;
    const band = t>=80?'加注':t>=70?'实单':t>=60?'候选':t>=40?'弱':'放弃';
    console.log([i+1, s.num, s.league, s.home+'-'+s.away, s.dir, s.gl, s.odds, s.drop, s.changes, s.dropSc, s.chkSc, s.confirmSc, s.model, s.history, s.risk, s.value, s.total, band].join(','));
  });
  process.exit(0);
}

console.log('信息值评分 ' + VERSION + ' | 数据 ' + dateStr + ' | 基线 ' + (baselineStamp || '(本次建立)') + ' | 共 ' + rows.length + ' 场');
console.log('档位: >=80加注 | 70-79实单 | 60-69候选 | 40-59弱 | <40放弃\n');
const hit = rows.filter(r => r.total >= 70);
if (!hit.length) console.log('⚠ 当前无场次达到70分实单线（最高 ' + (rows[0]?.total ?? '-') + ' 分: ' + (rows[0]?.num ?? '') + ' ' + (rows[0]?.home ?? '') + '-' + (rows[0]?.away ?? '') + '）\n');

rows.forEach((s, i) => {
  const band = s.total>=80?'🔨加注':s.total>=70?'✅实单':s.total>=60?'⏳候选':s.total>=40?'👀弱':'❌放弃';
  const line = String(i+1).padStart(2) + '  ' + s.num + ' ' + (s.league||'').padEnd(4) + (s.home||'').padEnd(6) + '-' + (s.away||'').padEnd(7)
    + '  ' + (s.dir + '@' + s.odds).padEnd(15) + '让' + s.gl.padEnd(3) + ' ' + String(s.total).padStart(3) + ' ' + band.padEnd(4) + ' ' + s.note;
  if (DETAIL) {
    console.log(line + '  [降水' + s.dropSc + '/变盘' + s.chkSc + '/确认' + s.confirmSc + '/模型' + s.model + '/历史' + s.history + '/风险' + s.risk + '/价值' + s.value + ']');
  } else {
    console.log(line);
  }
});