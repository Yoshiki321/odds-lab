// fetch_okooo_live.js — 澳客(okooo)比分直播：抓当日进行中/已完场实时比分
// 用法: node tools/fetch_okooo_live.js [date] [--force]
// 输出: data/live/okooo_<date>.json → { fetchedAt, matches: { 竞彩matchId: { okScore, okHalf, okStatus, okStatusName } } }
// 与 sporttery 数据合并由 tools/fetch_live_scores.cjs 完成（有实时分则覆盖 score/status）
// 反爬节流: 距上次成功抓取 <120s 不重抓（读上次缓存直接合并输出），--force 可跳过
import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TODAY_DIR = join(ROOT, 'data', 'today');
const LIVE_DIR = join(ROOT, 'data', 'live');
if (!existsSync(LIVE_DIR)) mkdirSync(LIVE_DIR, { recursive: true });

function latestTodayDate() {
  const files = readdirSync(TODAY_DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  if (!files.length) throw new Error('data/today 无日期文件');
  return files[files.length - 1].slice(0, 10);
}

// 队名别名：okooo 用常见名/全名，竞彩(today)用简称，统一成竞彩简称做匹配
const ALIAS = {
  '狼队': '伍尔弗', '狼队汉普顿': '伍尔弗', '伍尔弗汉普顿': '伍尔弗',
  '热刺': '托特纳姆', '托特纳姆热刺': '托特纳姆',
  '鹿岛鹿角': '鹿岛', '浦和红钻': '浦和', '横滨水手': '横滨',
};
const normName = n => ALIAS[n] || n;

// 状态文本 → 中文状态名
function mapStatus(t) {
  const s = String(t || '').trim();
  if (!s) return null;
  if (s === '未') return '未开赛';
  if (s === '中') return '进行中';
  if (s === '完') return '已完场';
  if (/^\d+/.test(s)) return '进行中'; // 分钟数：24' / 90'
  return s;
}

async function fetchOkooo() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-gpu', '--disable-software-rasterizer', '--mute-audio'],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  try {
    await page.goto('https://www.okooo.com/livecenter/football/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    const pageTitle = await page.title();
    if (pageTitle === '405') throw new Error('okooo 反爬 405，保留旧缓存');
    const rows = await page.evaluate(() => {
      const out = [];
      for (const tr of document.querySelectorAll('tr.each_match')) {
        const mid = tr.getAttribute('matchid');
        if (!mid) continue;
        // 行内有多个 td.graytx（checkbox 列/时间列），取内容形如 "09-06 19:00" 的那个
        const timeTds = tr.querySelectorAll('td.graytx');
        let timeCell = '';
        for (const td of timeTds) {
          const t = (td.innerText || '').trim();
          if (/^\d{2}-\d{2}\s+\d{2}:\d{2}/.test(t)) { timeCell = t; break; }
        }
        const m = timeCell.match(/(\d{2}:\d{2})$/);
        const time = m ? m[1] : '';
        const statusEl = tr.querySelector('.ctrl_time');
        const homeEl = tr.querySelector('.ctrl_homename');
        const awayEl = tr.querySelector('.ctrl_awayname');
        const hsEl = tr.querySelector('.ctrl_homescore');
        const asEl = tr.querySelector('.ctrl_awayscore');
        out.push({
          okoooId: mid,
          league: tr.getAttribute('type') || '',
          time,
          status: statusEl ? statusEl.innerText.trim() : '',
          home: homeEl ? homeEl.innerText.trim() : '',
          away: awayEl ? awayEl.innerText.trim() : '',
          hs: hsEl ? hsEl.innerText.trim() : '',
          as: asEl ? asEl.innerText.trim() : '',
          half: tr.getAttribute('data-hs') || '',
        });
      }
      return out;
    });
    return rows;
  } finally {
    await browser.close();
  }
}

function matchRow(row, today) {
  // 竞彩 today 场次 ↔ okooo 行：时间(MM:HH) + 任一队名双向/别名匹配
  const tm = String(row.time || '').slice(0, 5);
  if (!tm) return null;
  const rh = normName(row.home || '');
  const ra = normName(row.away || '');
  for (const m of today) {
    if (String(m.matchTime || '').slice(0, 5) !== tm) continue;
    const th = normName(m.home || '');
    const ta = normName(m.away || '');
    const hOK = th && (th.includes(rh) || rh.includes(th));
    const aOK = ta && (ta.includes(ra) || ra.includes(ta));
    if (hOK && aOK) return m;
  }
  return null;
}

export async function fetchOkoooLive(dateStr, { force = false, quiet = false } = {}) {
  if (!dateStr) dateStr = latestTodayDate();
  const tsFile = join(LIVE_DIR, '_okooo_ts.json');
  let last = { at: 0 };
  try { if (existsSync(tsFile)) last = JSON.parse(readFileSync(tsFile, 'utf8')); } catch {}

  const outFile = join(LIVE_DIR, `okooo_${dateStr}.json`);
  let okRows = {};
  if (!force && Date.now() - (last.at || 0) < 180000 && existsSync(outFile)) {
    okRows = JSON.parse(readFileSync(outFile, 'utf8')).matches || {};
  } else {
    const prevOk = existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')).matches || {} : {};
    try {
      const rows = await fetchOkooo();
      if (!rows.length) throw new Error('okooo 页面无比分行，保留旧缓存');
      const todayFile = join(TODAY_DIR, dateStr + '.json');
      const today = existsSync(todayFile) ? JSON.parse(readFileSync(todayFile, 'utf8')).matches || [] : [];
      const byId = {};
      for (const r of rows) {
        const m = matchRow(r, today);
        if (!m) continue;
        const hs = r.hs && !/^\s*-\s*$/.test(r.hs) ? r.hs : null;
        const as = r.as && !/^\s*-\s*$/.test(r.as) ? r.as : null;
        const score = hs && as ? `${hs}-${as}` : null;
        byId[String(m.matchId)] = {
          okScore: score,
          okHalf: r.half || null,
          okStatus: r.status || null,
          okStatusName: mapStatus(r.status),
          okLeague: r.league || null,
          okHome: r.home || null,
          okAway: r.away || null,
          okTime: r.time || null,
        };
      }
      const merged = { ...prevOk };
      for (const [id, v] of Object.entries(byId)) merged[id] = v;
      okRows = merged;
      writeFileSync(outFile, JSON.stringify({ fetchedAt: new Date().toISOString(), dateStr, matches: merged }, null, 1), 'utf8');
      writeFileSync(tsFile, JSON.stringify({ at: Date.now() }), 'utf8');
    } catch (e) {
      if (!quiet) console.error('okooo比分抓取失败:', e.message || e);
      okRows = prevOk;
      throw e;
    }
  }

  if (!quiet) {
    console.log(`[okooo比分] ${dateStr} 匹配 ${Object.keys(okRows).length} 场${force ? '(force)' : ''}`);
    for (const [id, v] of Object.entries(okRows)) {
      if (v.okScore || v.okStatusName === '进行中' || v.okStatusName === '已完场') {
        console.log(`  matchId=${id} ${v.okStatusName || ''} ${v.okScore || '(未开场)'} 半场[${v.okHalf || '-'}] ${v.okHome || ''}-${v.okAway || ''}`);
      }
    }
  }
  return okRows;
}

const isCli = process.argv[1] && /fetch_okooo_live\.js$/i.test(String(process.argv[1]).replace(/\\/g, '/'));
if (isCli) {
  const dateArg = process.argv[2];
  const dateStr = dateArg && /^\d{4}-\d{2}-\d{2}$/.test(dateArg) ? dateArg : latestTodayDate();
  fetchOkoooLive(dateStr, { force: process.argv.includes('--force') }).catch(() => process.exit(1));
}
