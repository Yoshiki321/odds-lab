// fetch_live_scores.cjs — 抓 sporttery 比分直播 → 合入 data/live/<date>.json
// 用法: node tools/fetch_live_scores.cjs [YYYY-MM-DD]
// 无参数：按 matchId 合入各比赛实际开赛日期文件（比赛开始 → 记录封盘）
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const LIVE_DIR = path.join(ROOT, 'data', 'live');
const TODAY_DIR = path.join(ROOT, 'data', 'today');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0';

if (!fs.existsSync(LIVE_DIR)) fs.mkdirSync(LIVE_DIR, { recursive: true });

function httpGet(url, referer) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'referer': referer, 'user-agent': UA, 'accept': 'application/json, text/javascript, */*; q=0.01' } }, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch { reject(new Error(`JSON 解析失败: ${url} → ${d.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

/** 归一化 matchNumStr（可能 "周日001" / "6008" / "周六008"）→ 竞彩编号 */
function normalizeNumStr(s) {
  if (!s) return '';
  const m = String(s).match(/^(周[六日一二三四五]|周)\s*(\d{1,3})$/);
  return m ? `周${m[1].slice(1)}${String(m[2]).padStart(3, '0')}` : String(s);
}

/** 从 live 原始结构提取 match → {numStr, matchId, score, ht, status, statusName} */
function extractLive(j) {
  const out = [];
  const groups = (j && j.value && j.value.matchInfoList) || [];
  for (const g of groups) {
    for (const m of (g.subMatchList || [])) {
      if (!m || m.matchId == null) continue;
      out.push({
        matchNumStr: normalizeNumStr(m.matchNumStr),
        matchNum: m.matchNum,
        matchDate: m.matchDate,
        matchTime: m.matchTime,
        matchId: String(m.matchId),
        home: m.homeTeamAbbName || m.homeTeamAllName || '',
        away: m.awayTeamAbbName || m.awayTeamAllName || '',
        score: (m.sectionsNo999 || '').trim(),
        ht: (m.sectionsNo1 || '').trim(),
        status: String(m.matchStatus || ''),
        statusName: m.matchStatusName || '',
        league: m.leagueAbbName || '',
      });
    }
  }
  return out;
}

/** 把实时数据按比赛 matchDate 合入对应 data/live/<date>.json，并标记封盘 */
function mergeByDate(rows, nowIso) {
  const byDate = {};
  const sealed = [];
  for (const r of rows) {
    const d = r.matchDate || 'none';
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(r);
    if (r.score) sealed.push(r); // 有比分 = 已开赛（封盘）
  }
  const files = [];
  for (const [date, list] of Object.entries(byDate)) {
    const file = path.join(LIVE_DIR, `${date}.json`);
    files.push(file);
    const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { matches: {} };
    const byId = prev.matches || {};
    let updated = 0;
    for (const r of list) {
      const k = r.matchId;
      const old = byId[k];
      byId[k] = old ? { ...old, ...r, lastSeen: nowIso } : { ...r, lastSeen: nowIso };
      if (old && (old.score !== r.score || old.status !== r.status)) updated++;
    }
    fs.writeFileSync(file, JSON.stringify({ fetchedAt: nowIso, matches: byId }, null, 1), 'utf8');
  }
  return { sealed, files };
}

async function fetchLiveScores() {
  const nowIso = new Date().toISOString();
  const rows = [];
  let err = null;
  for (let page = 1; page <= 3; page++) {
    let j;
    try {
      j = await httpGet(
        `https://webapi.sporttery.cn/gateway/uniform/fb/getMatchDataPageListV1.qry?method=all&pageSize=50&pageNo=${page}`,
        'https://www.sporttery.cn/jc/zqbfzb/'
      );
    } catch (e) {
      err = e; continue;
    }
    if (!j || j.success !== true) { err = new Error('接口返回非成功 ' + JSON.stringify(j && { errorCode: j.errorCode, errorMessage: j.errorMessage }).slice(0, 120)); continue; }
    rows.push(...extractLive(j));
    const total = (j.value && j.value.total) || 0;
    if ((j.value && j.value.nextPage === false) || rows.length >= total) break;
  }
  if (!rows.length) throw new Error((err && err.message) || '返回空场次');
  const { sealed, files } = mergeByDate(rows, nowIso);
  // 只合已有澳客缓存，不在这里启动浏览器（Windows 会弹控制台）
  let okoooHit = 0;
  for (const f of files) { const h = mergeOkooo(f, path.basename(f, '.json')); okoooHit += h; }
  return { rows: rows.length, sealed: sealed.length, files, okoooHit };
}

/** 合并 okooo 实时比分：有实时比分/状态则覆盖 sporttery 的(进行中竞彩官方不开分，okooo 是唯一实时来源) */
function latestTodayDate() {
  const files = fs.readdirSync(TODAY_DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  return files[files.length - 1].slice(0, 10);
}

function mergeOkooo(file, date) {
  const okoooFile = path.join(LIVE_DIR, `okooo_${date}.json`);
  if (!fs.existsSync(okoooFile)) return 0;
  let okooo;
  try { okooo = JSON.parse(fs.readFileSync(okoooFile, 'utf8')).matches || {}; } catch { return 0; }
  const live = JSON.parse(fs.readFileSync(file, 'utf8'));
  let changed = 0;
  for (const [id, v] of Object.entries(okooo)) {
    const cur = live.matches && live.matches[id];
    if (!cur) continue;
    if (v.okScore) { cur.score = v.okScore; cur.scoreFrom = 'okooo'; }
    if (v.okStatusName) cur.statusName = v.okStatusName;
    if (v.okHalf) cur.ht = v.okHalf;
    cur.okoo = v; cur.okooAt = new Date().toISOString();
    changed++;
  }
  if (changed) fs.writeFileSync(file, JSON.stringify(live, null, 1), 'utf8');
  return changed;
}

if (require.main === module) {
  const dateStr = latestTodayDate();
  fetchLiveScores()
    .then(r => {
      console.log(`[比分直播] sporttery ${r.rows} 场 已开赛封盘 ${r.sealed} 场 · okooo 合并 ${r.okoooHit} 场`);
    })
    .catch(e => { console.error('信息源错误 sporttery.score:', e.message || e); process.exit(1); });
}

module.exports = { fetchLiveScores };
