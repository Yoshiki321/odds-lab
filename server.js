/**
 * 竞彩助手 · 投注账单展示服务器
 *
 * 提供:
 *  - GET /              → public/index.html (账单页面)
 *  - GET /api/summary   → 投注、账单、余额汇总 JSON
 *
 * 用法: node server.js [port]
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { fetchLiveScores } = createRequire(import.meta.url)('./tools/fetch_live_scores.cjs');

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || process.env.PORT || 9000);
// v1 前端目录：优先 public/，缺失时回落 app/public（v2 现行），再回落 public_v1_bak（旧版备份）
const PUBLIC_CANDIDATES = [join(__dirname, 'public'), join(__dirname, 'app', 'public'), join(__dirname, 'public_v1_bak')];
const PUBLIC_DIR = PUBLIC_CANDIDATES.find(p => existsSync(join(p, 'index.html'))) || join(__dirname, 'public');
const DIARY_DIR = join(__dirname, 'data', 'diary');
const BET_DIR = join(__dirname, 'data', 'betting');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const TODAY_DIR = join(__dirname, 'data', 'today');
const SCORES_DIR = join(__dirname, 'data', 'scores');
const VIRTUAL_DIR = join(__dirname, 'data', 'virtual');
const RESULTS_DIR = join(__dirname, 'data', 'results');
const LIVE_DIR = join(__dirname, 'data', 'live');

function loadDayResults(date) {
  const d = safeReadJSON(join(RESULTS_DIR, `${date}.json`));
  return (d && d.byId) || {};
}

/** 当日实时比分（data/live/<date>.json，比赛开始=封盘；server 每 30s 后台自动刷新） */
function loadLiveScores(date) {
  const d = safeReadJSON(join(LIVE_DIR, `${date}.json`));
  return d || null;
}
function predSide(sc) {
  if (sc && (sc.pred === 'H' || sc.pred === 'A')) return sc.pred;
  const d = (sc && sc.dir) || '';
  if (/负/.test(d) || /^客/.test(d) || /受让A/.test(d)) return 'A';
  if (/^主/.test(d) || /主让|主胜/.test(d)) return 'H';
  return null;
}
function hadTxt(x) { return x === 'H' ? '主' : x === 'A' ? '客' : x === 'D' ? '平' : ''; }

/** 当日竞彩场次（data/today/<date>.json 的 matches，兼容不同结构） */
function loadDayMatches(date) {
  const d = safeReadJSON(join(TODAY_DIR, `${date}.json`));
  if (!d) return [];
  const arr = d.matches || d.list || d;
  return Array.isArray(arr) ? arr : [];
}

/** 当日评分（data/scores/<date>.json） */
function loadDayScores(date) {
  return safeReadJSON(join(SCORES_DIR, `${date}.json`)) || null;
}

/** 扫描全部日期（today 主文件 ∪ scores 文件） */
function listDays() {
  const set = new Set();
  const scan = (dir, re) => {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      const m = f.match(re);
      if (m) set.add(m[1]);
    }
  };
  scan(TODAY_DIR, /^(\d{4}-\d{2}-\d{2})\.json$/);
  scan(SCORES_DIR, /^(\d{4}-\d{2}-\d{2})\.json$/);
  return [...set].sort();
}

/** 全部虚拟注 */
function loadAllVirtual() {
  if (!existsSync(VIRTUAL_DIR)) return [];
  const out = [];
  for (const f of readdirSync(VIRTUAL_DIR).filter(f => /^vb-\d+\.json$/.test(f)).sort()) {
    const v = safeReadJSON(join(VIRTUAL_DIR, f));
    if (v) out.push(v);
  }
  return out;
}

/** 全部实单 */
function loadAllBets() {
  if (!existsSync(join(BET_DIR, 'bets'))) return [];
  const out = [];
  for (const f of readdirSync(join(BET_DIR, 'bets')).filter(f => /^bet-\d+\.json$/.test(f)).sort()) {
    const b = safeReadJSON(join(BET_DIR, 'bets', f));
    if (b) out.push(b);
  }
  return out;
}

/** 每日聚合视图：全表评分 + 虚拟注/实单标注 */
function buildDayView(date) {
  const matches = loadDayMatches(date);
  const scoreFile = loadDayScores(date);
  const rows = (scoreFile && scoreFile.rows) || [];

  // 实单/虚拟注按 matchId 精确关联（防周赛号跨周串场），matchId 缺失时才按场次号兜底
  const idKey = id => id == null ? null : String(id);
  const allVirtual = loadAllVirtual().filter(v => typeof v === 'object');
  const allBets = loadAllBets().flatMap(b => (b.legs || []).filter(l => l && l.matchNum).map(l => ({ bet: b, leg: l })));

  // 已知当日 matchId 集合，只挂当日真实匹配
  const dayIds = new Set(matches.map(m => idKey(m.matchId)).filter(Boolean));
  const virtualById = new Map(), virtualByNum = new Map();
  for (const v of allVirtual) {
    const k = idKey(v.matchId);
    if (k) { if (dayIds.has(k)) virtualById.set(k, v); } // 有 matchId：只按 id（不匹配=跨日/跨周，不挂）
    else if (v.matchNum) virtualByNum.set(v.matchNum, v); // 无 matchId：按场次号兜底（同日文件内唯一）
  }
  const betsById = new Map(), betsByNum = new Map();
  for (const { bet, leg } of allBets) {
    const k = idKey(leg.matchId);
    if (k && dayIds.has(k)) { if (!betsById.has(k)) betsById.set(k, []); betsById.get(k).push(bet); }
    else if (!k) { if (!betsByNum.has(leg.matchNum)) betsByNum.set(leg.matchNum, []); betsByNum.get(leg.matchNum).push(bet); }
    // 有 matchId 但不在本日场次（跨周/跨日) → 不挂
  }

  const results = loadDayResults(date);
  const live = loadLiveScores(date) || { matches: {} };
  const nowMs = Date.now();
  let realOpen = 0, realWin = 0, realLoss = 0, virtualOpen = 0, virtualEnd = 0;
  let accHit = 0, accDone = 0, yellowHit = 0, yellowDone = 0;
  const table = matches.map(m => {
    const num = m.num;
    const mid = idKey(m.matchId);
    const score = Array.isArray(rows) ? rows.find(r => r.num === num) : null;
    const v = (mid && virtualById.get(mid)) || virtualByNum.get(num) || null;
    const bets = (mid && betsById.get(mid)) || betsByNum.get(num) || [];
    const res = (mid && results[mid]) || null;
    // 封盘判定：官方结果/比分出现 = 封盘；否则按开赛时间(北京时间)是否已到
    const liveRow = (mid && live.matches[mid]) || null;
    const kickMs = (m.matchDate && m.matchTime)
      ? new Date(`${m.matchDate}T${m.matchTime}+08:00`).getTime()
      : NaN;
    const started = !!(res || (liveRow && liveRow.score) || (Number.isFinite(kickMs) && nowMs >= kickMs));
    const sealed = started; // 已开赛即封盘（不再可投）
    const pred = predSide(score);
    const market = (score && score.market) || 'HHAD';
    const actual = res ? (market === 'HAD' ? res.had : res.hhad) : null;
    const yellow = score && score.total != null && score.total >= 70;
    const hit = !!(res && pred && actual && pred === actual);
    if (res && pred && actual) {
      accDone++;
      if (hit) accHit++;
      if (yellow) { yellowDone++; if (hit) yellowHit++; }
    }

    for (const b of bets) {
      if (b.status === 'open') realOpen++;
      else { (b.profit > 0 ? realWin++ : realLoss++); }
    }
    if (v) { v.status === 'open' ? virtualOpen++ : virtualEnd++; }

    return {
      num: num,
      match: m,
      score: score || null,
      virtual: v || null,
      bets: bets,
      live: liveRow ? {
        score: liveRow.score || null,
        ht: liveRow.ht || null,
        status: liveRow.statusName || liveRow.status || null,
        fetchedAt: live.fetchedAt || null,
      } : null,
      sealed,
      started,
      result: res ? {
        score: res.score,
        had: res.had,
        hhad: res.hhad,
        goalLine: res.goalLine,
        ht: res.ht,
        pred,
        hit,
        yellow,
        yellowHit: !!(yellow && hit),
        market,
        text: market === 'HAD'
          ? `${res.score}${res.had === 'H' ? ' 主胜' : res.had === 'A' ? ' 主负' : res.had === 'D' ? ' 平' : ''}`
          : `${res.score}${res.hhad === 'H' ? ' 让主' : res.hhad === 'A' ? ' 让客' : res.hhad === 'D' ? ' 让平' : ''}`,
      } : null,
    };
  });

  return {
    date,
    generatedAt: new Date().toISOString(),
    scoreGeneratedAt: (scoreFile && scoreFile.generatedAt) || null,
    scoreVersion: (scoreFile && scoreFile.version) || null,
    summary: {
      total: matches.length,
      scored: rows.filter(r => r.total != null).length,
      best: rows.filter(r => r.total != null).sort((a, b) => b.total - a.total)[0] || null,
      realOpen, realWin, realLoss,
      virtualOpen, virtualEnd,
      accHit, accDone, yellowHit, yellowDone,
      accPct: accDone ? Math.round(accHit / accDone * 100) : null,
    },
    table,
  };
}

function safeReadJSON(p) {
  try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; }
  catch { return null; }
}

/** 汇总所有投注数据供 API / 页面使用 */
function buildSummary() {
  const ledger = safeReadJSON(join(BET_DIR, 'ledger.json')) || { startBankroll: 0, cash: 0, inPlay: [], history: [] };
  const bankroll = safeReadJSON(join(BET_DIR, 'bankroll.json')) || { cash: 0, sequence: [] };

  const bets = [];
  if (existsSync(join(BET_DIR, 'bets'))) {
    for (const f of readdirSync(join(BET_DIR, 'bets')).filter(f => f.endsWith('.json')).sort()) {
      const b = safeReadJSON(join(BET_DIR, 'bets', f));
      if (b) bets.push(b);
    }
  }

  const analysis = [];
  if (existsSync(join(BET_DIR, 'analysis'))) {
    for (const f of readdirSync(join(BET_DIR, 'analysis')).filter(f => f.endsWith('.json')).sort()) {
      const a = safeReadJSON(join(BET_DIR, 'analysis', f));
      if (a) analysis.push(a);
    }
  }

  return { generatedAt: new Date().toISOString(), ledger, bankroll, bets, analysis };
}

/** 读取自我升级数据（已并入日记：data/diary/scoring-upgrade.json） */
function buildMistakes() {
  const base = safeReadJSON(join(DIARY_DIR, 'scoring-upgrade.json')) || { rules: [], mistakes: [], checklist: [] };
  return base;
}

/** 把日记 bets 字段解析为页面可直接渲染的对象
 *  支持三种存储格式:
 *  1. 显示对象 {id,status,stake,return,legs} —— 原样透传(08-24/25/26)
 *  2. 单号字符串 "bet-011" —— 查 bet 档案
 *  3. 精简对象 {betId:20,...} —— 查 bet 档案
 */
function resolveJournalBets(journal) {
  if (!journal || !Array.isArray(journal.bets)) return journal;

  // 建立 betId 查找表
  const betLookup = {};
  const betsDir = join(BET_DIR, 'bets');
  if (existsSync(betsDir)) {
    for (const f of readdirSync(betsDir).filter(f => f.endsWith('.json'))) {
      const b = safeReadJSON(join(betsDir, f));
      if (b) {
        betLookup[b.betId] = b;
        betLookup[f.replace('.json', '')] = b;      // bet-020
        betLookup[f.replace('.json', '').replace('bet-', '')] = b; // 020
      }
    }
  }

  /** 由 bet 档案 → 页面显示对象。状态按 profit/return 与 stake 推断(兼容比分/中奖/undefined result) */
  const toDisplay = (b) => {
    if (!b) return null;
    let status = 'active';
    if (b.status === 'void' || b.status === 'cancelled') status = 'void';
    else if (b.status === 'settled') {
      const ret = b.returnAmount ?? 0;
      const p = b.profit ?? (ret - b.stake);
      status = p > 0 ? 'win' : p < 0 ? 'loss' : (ret > 0 && ret === b.stake ? 'void' : p === 0 && b.stake === 0 ? 'win' : 'loss');
    }
    let legs = '';
    if (Array.isArray(b.legs)) {
      legs = b.legs.map(l => l.pick || `${l.home}${l.vs || '×'}${l.away}`).join('<br>');
    }
    return { id: b.betId, status, stake: b.stake, return: b.returnAmount ?? null, legs };
  };

  const resolved = journal.bets.map(raw => {
    if (typeof raw === 'string') {
      // "bet-020" 或 "020" 或 "20"
      const key = raw.replace(/^bet-/i, '');
      return toDisplay(betLookup[raw] || betLookup[key] || betLookup[Number(key)]);
    }
    if (raw && typeof raw === 'object') {
      // 已是显示对象(有 id + stake + status) → 透传
      if (raw.id != null && raw.stake != null && raw.status != null) return raw;
      // 精简对象 {betId:20,...}
      const full = betLookup[raw.betId] || betLookup['bet-' + String(raw.betId).padStart(3, '0')] || betLookup['bet-' + raw.betId];
      return toDisplay(full) || {
        id: raw.betId ?? raw.id,
        status: raw.status === 'open' ? 'active' : (raw.status || 'active'),
        stake: raw.stake,
        return: raw.returnAmount ?? raw.return ?? null,
        legs: raw.pick || '',
      };
    }
    return null;
  }).filter(Boolean);

  return { ...journal, bets: resolved };
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = decodeURIComponent(url.pathname);

  // API endpoints
  if (path === '/api/summary') {
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(buildSummary()));
    return;
  }
  if (path === '/api/mistakes') {
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(buildMistakes()));
    return;
  }
  if (path === '/api/diary') {
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    // 直接扫描 journals 目录，不依赖手写 metadata.json（自动包含新日记）
    const journalsDir = join(DIARY_DIR, 'journals');
    const dates = existsSync(journalsDir)
      ? readdirSync(journalsDir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map(f => f.slice(0, 10)).sort()
      : [];
    const journals = [];
    for (const d of dates) {
      const j = safeReadJSON(join(journalsDir, `${d}.json`));
      if (j) journals.push(resolveJournalBets(j));
    }
    res.end(JSON.stringify({ metadata: { availableDates: dates }, journals }));
    return;
  }
  if (path.startsWith('/api/diary/')) {
    const date = path.replace('/api/diary/', '');
    const j = safeReadJSON(join(DIARY_DIR, 'journals', `${date}.json`));
    if (!j) { res.writeHead(404); res.end('{}'); return; }
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(resolveJournalBets(j)));
    return;
  }
  if (path === '/api/days') {
    const days = listDays();
    const todayFiles = days.map(d => {
      const sc = loadDayScores(d);
      return { date: d, matches: loadDayMatches(d).length, scoreFile: !!sc, scoreGeneratedAt: (sc && sc.generatedAt) || null };
    }).sort((a, b) => a.date < b.date ? -1 : 1);
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ days: todayFiles }));
    return;
  }
  if (path === '/api/score-status') {
    const st = safeReadJSON(join(SCORES_DIR, '_status.json')) || { ok: null };
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(st));
    return;
  }
  if (path === '/api/health') {
    // 健康检查：前端目录 + 数据新鲜度（today/scores最新日期），便于发现“多天未更新”
    const days = listDays();
    const st = safeReadJSON(join(SCORES_DIR, '_status.json')) || null;
    const health = {
      ok: true,
      at: new Date().toISOString(),
      publicDir: PUBLIC_DIR,
      latestDay: days.length ? days[days.length - 1] : null,
      days: days.length,
      scoreStatus: st ? { ok: st.ok, date: st.date || null, at: st.at || null, fetched: st.fetched ?? null } : null,
    };
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(health));
    return;
  }
  if (path.startsWith('/api/day/')) {
    const date = path.replace('/api/day/', '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !loadDayMatches(date).length) { res.writeHead(404); res.end('{}'); return; }
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(buildDayView(date)));
    return;
  }
  if (path === '/api/live/refresh') {
    refreshLiveScores();
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, at: new Date().toISOString() }));
    return;
  }
  if (path.startsWith('/api/live/')) {
    const date = path.replace('/api/live/', '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { res.writeHead(404); res.end('{}'); return; }
    const live = loadLiveScores(date) || { matches: {} };
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(live));
    return;
  }

  // 静态文件
  let filePath = path === '/' ? join(PUBLIC_DIR, 'index.html') : join(PUBLIC_DIR, path);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  if (!existsSync(filePath) || filePath.endsWith('/')) {
    res.writeHead(404); res.end('<h2>404 Not Found</h2> <a href="/">回到账单</a>'); return;
  }

  const ext = extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(readFileSync(filePath));
});

/** 后台刷新实时比分（进程内跑，不另开 node 窗口）。失败静默，不阻塞网页 */
let liveRefreshing = false;
async function refreshLiveScores() {
  if (liveRefreshing) return;
  liveRefreshing = true;
  try { await fetchLiveScores(); } catch {} finally { liveRefreshing = false; }
}
setInterval(refreshLiveScores, 30000);
refreshLiveScores();

server.on('error', e => {
  console.error('[服务器错误]', e.message);
  if (e.code === 'EADDRINUSE') console.error(`端口 ${PORT} 被占用，请换端口: node server.js 9001`);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🏆 竞彩助手账单服务已启动:`);
  console.log(`   前端目录: ${PUBLIC_DIR}`);
  console.log(`   本机访问: http://127.0.0.1:${PORT}`);
  console.log(`   公网访问: http://127.0.0.1:${PORT}`);
  console.log(`   API数据:  http://127.0.0.1:${PORT}/api/summary\n`);
});