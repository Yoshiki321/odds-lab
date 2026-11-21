/**
 * tools/okooo_scraper.js — 从 okooo.com 获取亚盘、近况、欧赔数据
 *
 * 用法:
 *   node tools/okooo_scraper.js match <matchId>     # 查看比赛详情
 *   node tools/okooo_scraper.js match <matchId> --force  # 强制刷新缓存
 *
 * 页面结构:
 *   Table 5:  竞足标记（"单场"=单关可投）
 *   Table 6:  世界排名
 *   Table 7:  积分榜（全部）
 *   Table 8:  积分榜（数据行）
 *   Table 9:  主队近期战绩（含亚盘数据）
 *   Table 10: 客队近期战绩（含亚盘数据）
 *
 * 战绩行结构:
 *   联赛 | 时间 | 主队 | 比分 | 客队 | 半场 | 99家主 | 99家平 | 99家客 | 365终指 | 让球盘口 | 让球赔率 | 亚盘结果(赢/输/走)
 */

import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE_DIR = join(ROOT, 'data', 'okooo_cache');

if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });

function cachePath(matchId) {
  return join(CACHE_DIR, `${matchId}.json`);
}

function readCache(matchId) {
  const f = cachePath(matchId);
  if (!existsSync(f)) return null;
  let d;
  try { d = JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
  // 校验：反爬 405 页或空壳缓存当无效（防止命中奇怪 ID 的坏缓存）
  if (isBadCache(d)) return null;
  return d;
}

// 坏缓存判定: 反爬页(标题405/被阻断) 或 无任何比赛内容(空 homeRecent/awayRecent/standings)
function isBadCache(d) {
  if (!d) return true;
  const t = (d.title || '') + ' ' + (d.pageTitle || '');
  if (d.url && (d.url.includes('405') || t.includes('405') || t.includes('阻断'))) return true;
  const home = (d.homeRecent || []).length;
  const away = (d.awayRecent || []).length;
  const st = (d.standings || []).length;
  const ranks = (d.worldRankings || []).length;
  if (home + away + st + ranks === 0 && !d.homeTeam) return true;  // 空壳
  return false;
}

function writeCache(matchId, data) {
  writeFileSync(cachePath(matchId), JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Parse a single match row from the history table
 * @param {string[]} cells - Array of cell text from the row
 */
function parseMatchRow(cells, team) {
  if (cells.length < 10) return null;

  // Indexed structure:
  // 0: 联赛, 1: 时间, 2: 主队, 3: 比分, 4: 客队, 5: 半场
  // 6: 99家主, 7: 99家平, 8: 99家客, 9: 365终指
  // 10+: 让球盘口, 让球赔率, 亚盘结果

  const league = cells[0].trim();
  const date = cells[1].trim();
  const homeTeam = cells[2].trim();
  const score = cells[3].trim();
  const awayTeam = cells[4].trim();
  const halfScore = cells[5]?.trim() || '';

  // Parse score
  let homeScore = null, awayScore = null;
  const scoreMatch = score.match(/(\d+)-(\d+)/);
  if (scoreMatch) {
    homeScore = parseInt(scoreMatch[1]);
    awayScore = parseInt(scoreMatch[2]);
  }

  // Parse 99家平均终指 (odds 6, 7, 8)
  const odds99Home = parseFloat(cells[6]);
  const odds99Draw = parseFloat(cells[7]);
  const odds99Away = parseFloat(cells[8]);

  // 365终指 (index 9)
  const odds365 = parseFloat(cells[9]);

  // 让球盘口 and 让球赔率 (10, 11)
  let handicap = '', handicapOdds = '', asianResult = '';
  // Find the 让球盘口 cell - it's after the numeric odds
  let handicapIdx = 10;
  while (handicapIdx < cells.length) {
    const val = cells[handicapIdx].trim();
    // Skip empty cells
    if (!val) { handicapIdx++; continue; }
    // Check if it's a handicap value (contains 平/半/球 or similar)
    if (/[平半球让受一/两]/.test(val) || /^\d+\.\d+$/.test(val)) {
      if (/[平半球让受一/两]/.test(val)) {
        handicap = val;
      } else if (/^\d+\.\d+$/.test(val)) {
        handicapOdds = val;
      }
    } else if (/^(赢|输|走)$/.test(val)) {
      asianResult = val;
    }
    handicapIdx++;
  }

  return {
    team,
    league,
    date,
    homeTeam,
    homeScore,
    awayScore,
    awayTeam,
    halfScore,
    odds99Home,
    odds99Draw,
    odds99Away,
    odds365,
    handicap,
    handicapOdds,
    asianResult: asianResult || null
  };
}

/**
 * 抓取 okooo 比赛历史页面
 * @param {string} matchId - okooo 比赛ID
 * @param {boolean} force - 强制刷新缓存
 */
export async function scrapeMatch(matchId, force = false, shared = null) {
  if (!force) {
    const cached = readCache(matchId);
    if (cached) return cached;
  }

  const url = `https://www.okooo.com/soccer/match/${matchId}/history/`;
  const browser = shared?.browser || await chromium.launch({ headless: true });
  const page = shared?.page || await browser.newPage();
  page.setDefaultTimeout(30000);

  // 反爬限速重试：间歇性 405，最多试 3 次，间隔递增
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    if (attempt > 1) {
      await new Promise(r => setTimeout(r, attempt * 2500));
      try { await page.reload({ waitUntil: 'domcontentloaded' }); } catch { await page.goto(url, { waitUntil: 'domcontentloaded' }); }
    } else {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
    }
    await page.waitForTimeout(3000);

    const result = await page.evaluate((mid) => {
      const tables = document.querySelectorAll('table');
      const data = { matchId: mid, url: window.location.href, pageTitle: document.title };

      // ----- 反爬判定 -----
      if (document.title.trim() === '405') return { matchId: mid, url: window.location.href, pageTitle: '405', blocked: true };

      // ----- 基本信息 -----
      const title = document.title;
      const titleMatch = title.match(/^(.+?)(?:vs|VS)(.+?)比赛历史/);
      if (titleMatch) {
        data.homeTeam = titleMatch[1].trim();
        data.awayTeam = titleMatch[2].trim();
      }

      // ----- 世界排名（Table 6 索引在积分榜前，用赛果比分行后的第一个"世界排名"表） -----
      let rankTable = null;
      tables.forEach((t, i) => {
        if (i >= 6 && i < 9 && t.innerText.includes('世界排名')) rankTable = t;
      });
      if (rankTable) {
        const rows = rankTable.querySelectorAll('tr');
        data.worldRankings = [];
        rows.forEach(tr => {
          const cells = tr.querySelectorAll('td, th');
          if (cells.length >= 2) {
            const team = cells[0].innerText.trim();
            const rank = cells[1].innerText.trim();
            if (team && rank && team !== '球队') {
              data.worldRankings.push({ team, rank: parseInt(rank) || rank });
            }
          }
        });
      }

      // ----- Table 8: 积分榜 -----
      if (tables[8]) {
        const rows = tables[8].querySelectorAll('tr');
        data.standings = [];
        rows.forEach(tr => {
          const cells = tr.querySelectorAll('td');
          if (cells.length >= 7) {
            const rank = parseInt(cells[0].innerText.trim());
            const team = cells[1].innerText.trim();
            const games = parseInt(cells[2].innerText.trim());
            const wins = parseInt(cells[3].innerText.trim());
            const draws = parseInt(cells[4].innerText.trim());
            const losses = parseInt(cells[5].innerText.trim());
            const points = parseInt(cells[6].innerText.trim());
            if (team && !isNaN(rank)) {
              data.standings.push({ rank, team, games, wins, draws, losses, points });
            }
          }
        });
      }

      // ----- Table 9 & 10: 近期战绩 -----
      data.homeRecent = [];
      data.awayRecent = [];

      for (let tIdx = 9; tIdx <= 10; tIdx++) {
        if (!tables[tIdx]) continue;

        // 获取表头中的球队名
        const header = tables[tIdx].querySelector('.tableh th.lstitle');
        const teamName = header ? header.childNodes[0]?.textContent?.trim() : '';

        // 获取表头列名（用于解析列索引）
        const headerRow = tables[tIdx].querySelector('tr.tableh th[colspan] ~ tr, tr:first-child');
        const headerCells = tables[tIdx].querySelectorAll('tr:first-child th');

        // 获取所有数据行
        const rows = tables[tIdx].querySelectorAll('tr:not(.tableh)');
        const matches = [];

        rows.forEach(tr => {
          const cells = tr.querySelectorAll('td');
          if (cells.length < 7) return;

          // 联赛名可能在class=zq或td里
          const league = cells[0]?.innerText?.trim() || '';
          // 跳过无效行
          if (!league || league === '联赛' || league === '包含本场' || league === '全部场地' || league === '主场' || league === '客场') return;
          if (league.includes('6场') || league.includes('10场') || league.includes('20场') || league.includes('更多')) return;
          if (league.includes('全赛事') || league.includes('本赛事') || league.includes('非友谊赛')) return;

          // 提取纯文本单元格
          const cellTexts = Array.from(cells).map(c => c.innerText.trim()).filter(t => t.length > 0);

          // 至少需要：联赛, 日期, 主队, 比分, 客队, 半场
          if (cellTexts.length < 6) return;

          const match = {
            team: teamName,
            league: cellTexts[0],
            date: cellTexts[1],
            homeTeam: cellTexts[2],
            score: cellTexts[3],
            awayTeam: cellTexts[4],
            halfScore: cellTexts[5] || '',
          };

          // Parse score
          const sp = match.score.match(/(\d+)-(\d+)/);
          if (sp) {
            match.homeScore = parseInt(sp[1]);
            match.awayScore = parseInt(sp[2]);
          }

          // 找欧赔和亚盘数据
          // 格式: 联赛 | 日期 | 主队 | 比分 | 客队 | 半场 | 99家主 | 99家平 | 99家客 | 365终指 | 让球盘口 | 让球赔率 | 亚盘结果
          match.odds99Home = parseFloat(cellTexts[6]) || null;
          match.odds99Draw = parseFloat(cellTexts[7]) || null;
          match.odds99Away = parseFloat(cellTexts[8]) || null;
          match.odds365 = parseFloat(cellTexts[9]) || null;

          // 找后面的让球盘口和亚盘结果
          for (let i = 10; i < cellTexts.length; i++) {
            const v = cellTexts[i];
            if (/[平半球让受一/两]/.test(v) && !/^\d+\.\d+$/.test(v)) {
              match.handicap = v;
            } else if (/^\d+\.\d+$/.test(v)) {
              match.handicapOdds = v;
            } else if (/^(赢|输|走)$/.test(v)) {
              match.asianResult = v;
            }
          }

          matches.push(match);
        });

        if (teamName === data.homeTeam || tIdx === 9) {
          data.homeRecent = matches;
        } else {
          data.awayRecent = matches;
        }
      }

      // ----- 主客队概况 -----
      // 主页面上方有球队概况表格
      for (let tIdx = 0; tIdx <= 3; tIdx++) {
        if (!tables[tIdx]) continue;
        const text = tables[tIdx].innerText;
        if (text.includes('总') && text.includes('胜') && text.includes('负')) {
          const lines = text.split('\n').filter(l => l.trim());
          const summary = {};
          lines.forEach(l => {
            if (l.includes('总')) {
              const m = l.match(/总\s+(\d+胜\d+平\d+负)\s+(\d+分)\s+(\d+名)/);
              if (m) { summary.total = m[1]; summary.points = m[2]; summary.rank = m[3]; }
            }
            if (l.includes('主')) {
              const m = l.match(/主\s+(\d+胜\d+平\d+负)/);
              if (m) summary.home = m[1];
            }
            if (l.includes('客')) {
              const m = l.match(/客\s+(\d+胜\d+平\d+负)/);
              if (m) summary.away = m[1];
            }
          });
          if (tIdx === 0) data.homeSummary = summary;
          else if (tIdx === 1) data.awaySummary = summary;
        }
      }

      return data;
    }, matchId);

    // 校验结果有效性：反爬/空壳一律不写缓存、抛错（防坏缓存污染）
    if (result.blocked || isBadCache(result)) {
      if (result.blocked) {
        throw new Error(`okooo 405 反爬拦截 matchId=${matchId}（URL=${result.url}）。若此 ID 来自竞彩网(sporttery)，它不是 okooo ID——用 "node tools/okooo_scraper.js resolve 队名" 或 "tonight" 自动映射真实 ID。`);
      }
      throw new Error(`数据为空 matchId=${matchId}（可能 405 或页面结构变化），未写缓存`);
    }

    writeCache(matchId, result);
    if (!shared) await browser.close();
    return result;

  } catch (e) {
    lastErr = e;
    if (attempt < 3 && e.message.includes('405 反爬')) continue;  // 限速 → 重试
    break;
  }
  }
  if (!shared) await browser.close();
  throw new Error(`抓取失败 matchId=${matchId}: ${lastErr?.message || 'unknown'}`);
}

// ----- ID 映射（竞彩 → okooo） -----

// 常见简称差异（okooo 竞彩页 vs 竞彩官方全名）
const TEAM_ALIAS = {
  '艾禾': '埃弗斯贝格', '埃沃': '埃弗斯贝格', '埃沃斯堡': '埃弗斯贝格',
  '莱比': '莱比锡', '莱红牛': '莱比锡',
  '福伦': '福伦丹', '鹿特': '鹿特丹', '兹沃': '兹沃勒',
  '利雅': '利雅得', '纽卡': '纽卡斯尔', '伯恩': '伯恩茅斯',
  '不来': '云达不莱梅', '门兴': '门兴',
  '狼队': '伍尔弗汉普顿', '伍尔弗': '狼队',
  '帕尔': '帕尔梅拉斯', '帕梅拉斯': '帕尔梅拉斯', '帕梅': '帕尔梅拉斯',
};

function nameMatches(a, b) {
  if (!a || !b) return false;
  const norm = s => s.replace(/[\s·FCSC]/g, '');
  const A = norm(a), B = norm(b);
  if (A === B) return true;
  if (A.length >= 2 && B.length >= 2 && (A.includes(B) || B.includes(A))) return true;
  // 别名展开
  const expA = TEAM_ALIAS[A] ? [A, TEAM_ALIAS[A], norm(TEAM_ALIAS[A])] : [A];
  const expB = TEAM_ALIAS[B] ? [B, TEAM_ALIAS[B], norm(TEAM_ALIAS[B])] : [B];
  for (const x of expA) for (const y of expB) {
    if (x.length >= 2 && y.length >= 2 && (x.includes(y) || y.includes(x))) return true;
  }
  return false;
}

/** 读 okooo 竞彩列表（比赛ID映射源）。不缓存时抓。 */
async function loadJingcaiList(force = false) {
  const { scrapeJingcaiList } = await import('./okooo_jingcai.js');
  return scrapeJingcaiList(force);
}

/** 在 okooo 竞彩列表里按队名找比赛的 okooo ID（返回数组，可能多个候选） */
function findOkoooId(jingcai, home, away) {
  const hits = (jingcai.matches || []).filter(m =>
    nameMatches(m.homeTeam, home) && nameMatches(m.awayTeam, away));
  return hits;
}

/** resolve: 输入竞彩 matchId 或队名，输出 okooo ID */
export async function resolveMatch(keyword, force = false) {
  const jingcai = await loadJingcaiList(force);
  const kw = String(keyword);
  const isId = /^\d{6,8}$/.test(kw);
  let candidates = [];
  if (isId) {
    // 1) 可能是竞彩 matchId → 从 data/today 反查队名再映射
    const todayDir = join(ROOT, 'data', 'today');
    let home = '', away = '';
    if (existsSync(todayDir)) {
      const files = readdirSync(todayDir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse();
      for (const f of files) {
        const raw = JSON.parse(readFileSync(join(todayDir, f), 'utf8'));
        const list = raw.matches || raw.list || raw;
        const hit = list.find(m => String(m.matchId) === kw);
        if (hit) { home = hit.home || hit.homeTeam; away = hit.away || hit.awayTeam; break; }
      }
    }
    if (home) candidates = findOkoooId(jingcai, home, away);
    // 2) 直接就是 okooo ID（1开头 且在列表里）
    if (!candidates.length && kw.startsWith('1')) {
      const direct = (jingcai.matches || []).find(m => String(m.matchId) === kw);
      candidates = direct ? [direct] : [{ matchId: kw, order: '', league: '', homeTeam: '', awayTeam: '', note: '直接作为 okooo ID' }];
    }
  } else {
    // 队名 → 主或客命中
    candidates = (jingcai.matches || []).filter(m =>
      nameMatches(m.homeTeam, kw) || nameMatches(m.awayTeam, kw));
  }
  return candidates.map(c => ({
    order: c.order, league: c.league, homeTeam: c.homeTeam, awayTeam: c.awayTeam,
    matchId: c.matchId, single: c.single, note: c.note
  }));
}

/**
 * 批量抓今晚盘场次（竞彩官方数据 → 映射 okooo ID → 抓历史/欧亚盘）
 * @param {boolean} force - 强制刷新所有缓存
 */
export async function scrapeTonight(force = false) {
  const todayDir = join(ROOT, 'data', 'today');
  let todayFile = null;
  if (existsSync(todayDir)) {
    const files = readdirSync(todayDir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse();
    todayFile = files[0] ? join(todayDir, files[0]) : null;
  }
  if (!todayFile) throw new Error('data/today/ 无当日盘数据，先跑 node scraper.js today');

  const raw = JSON.parse(readFileSync(todayFile, 'utf8'));
  const matches = (raw.matches || raw.list || raw).filter(m => /^周/.test(String(m.num)));
  const jingcai = await loadJingcaiList(force);

  const out = [];
  let ok = 0, miss = 0;

  // 复用单个浏览器（避免每场重开 playwright）
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  const shared = { browser, page };

  for (const m of matches) {
    const home = m.home || m.homeTeam || '';
    const away = m.away || m.awayTeam || '';
    const hits = findOkoooId(jingcai, home, away);
    if (!hits.length) { miss++; out.push({ ...m, okoooId: null, error: 'okooo 列表未匹配到' }); continue; }

    const id = hits[0].matchId;
    let d = null;
    const cached = readCache(id);
    if (!force && cached) {
      d = cached;
    } else {
      console.log(`  [抓取] ${m.num} ${home}-${away} okooo:${id}`);
      try { d = await scrapeMatch(id, force, shared); } catch (e) { d = { error: e.message }; }
    }

    if (d && !d.error) {
      ok++;
      // 本场亚盘 = 近期战绩表首行（"包含本场"）
      const first = (d.homeRecent || [])[0] || {};
      out.push({
        num: m.num, league: m.league || hits[0].league, home, away,
        matchDate: m.matchDate, matchTime: m.matchTime || m.time,
        okoooId: id, homeTeam: d.homeTeam, awayTeam: d.awayTeam,
        handicap: first.handicap || null, handicapOdds: first.handicapOdds || null,
        odds365: first.odds365 || null,
        odds99: first.odds99Home ? [first.odds99Home, first.odds99Draw, first.odds99Away] : null,
        homeRecent5: summarizeAsian(d.homeRecent, home),
        awayRecent5: summarizeAsian(d.awayRecent, away),
        standings: (d.standings || []).slice(0, 5),
      });
    } else {
      miss++;
      out.push({ num: m.num, league: m.league || hits[0].league, home, away, okoooId: id, error: d?.error || '未知' });
    }
  }
  await browser.close();
  return { date: todayFile.split('/').pop().split('\\').pop(), total: matches.length, ok, miss, matches: out };
}

function summarizeAsian(rows, team) {
  if (!rows || !rows.length) return null;
  const recent = rows.slice(0, 5).filter(r => r.asianResult);
  return {
    total: recent.length,
    wins: recent.filter(r => r.asianResult === '赢').length,
    losses: recent.filter(r => r.asianResult === '输').length,
    draws: recent.filter(r => r.asianResult === '走').length,
  };
}

// ----- CLI -----
const cliPath = process.argv[1]?.replace(/\\/g, '/').split('/').pop();
if (process.argv[1] && import.meta.url.replace(/\\/g, '/').endsWith(cliPath)) {
  const cmd = process.argv[2];
  const arg = process.argv[3];

  if (cmd === 'match' && arg) {
    scrapeMatch(arg, process.argv.includes('--force'))
      .then(d => {
        console.log(`\n=== ${d.homeTeam} vs ${d.awayTeam} ===`);
        console.log(`竞彩: ${d.singleMatch ? '单关 ✅' : '非单关'} | 世界排名: ${d.worldRankings?.map(r => `${r.team}#${r.rank}`).join(', ')}`);

        // 近10场亚盘统计
        const homeRecent = d.homeRecent?.slice(0, 10) || [];
        const awayRecent = d.awayRecent?.slice(0, 10) || [];

        if (homeRecent.length) {
          const wins = homeRecent.filter(m => m.asianResult === '赢').length;
          const losses = homeRecent.filter(m => m.asianResult === '输').length;
          const draws = homeRecent.filter(m => m.asianResult === '走').length;
          console.log(`\n📊 ${d.homeTeam} 近10场亚盘: ${wins}赢 ${draws}走 ${losses}输`);
          homeRecent.forEach(m => {
            console.log(`  ${m.date} ${m.league} ${m.homeTeam} ${m.score} ${m.awayTeam} | 亚盘:${m.handicap||'-'} ${m.handicapOdds||'-'} ${m.asianResult||'-'}`);
          });
        }

        if (awayRecent.length) {
          const wins = awayRecent.filter(m => m.asianResult === '赢').length;
          const losses = awayRecent.filter(m => m.asianResult === '输').length;
          const draws = awayRecent.filter(m => m.asianResult === '走').length;
          console.log(`\n📊 ${d.awayTeam} 近10场亚盘: ${wins}赢 ${draws}走 ${losses}输`);
          awayRecent.forEach(m => {
            console.log(`  ${m.date} ${m.league} ${m.homeTeam} ${m.score} ${m.awayTeam} | 亚盘:${m.handicap||'-'} ${m.handicapOdds||'-'} ${m.asianResult||'-'}`);
          });
        }

        // 积分榜
        if (d.standings?.length) {
          console.log(`\n🏆 积分榜前6:`);
          d.standings.slice(0, 6).forEach(s => {
            console.log(`  #${s.rank} ${s.team} ${s.games}场 ${s.wins}胜 ${s.draws}平 ${s.losses}负 ${s.points}分`);
          });
        }
      })
      .catch(e => console.error(e.message));
  } else if (cmd === 'tonight') {
    scrapeTonight(process.argv.includes('--force')).then(r => {
      console.log(`\n════════ 今晚盘 okooo 欧亚盘 · ${r.date} ════════`);
      console.log(`共 ${r.total} 场 | 成功 ${r.ok} | 失败 ${r.miss}\n`);
      r.matches.forEach(m => {
        if (m.error) { console.log(`❌ ${m.num} ${m.league} ${m.home}-${m.away} | okooo:${m.okoooId||'?'} | ${m.error}`); return; }
        const hj = m.handicap ? `${m.handicap}@${m.handicapOdds||''}` : '无让球';
        const o365 = m.odds365 ? `365终指:${m.odds365}` : '';
        const o99 = m.odds99 ? `99家欧赔:${m.odds99.join('/')}` : '';
        const hr = m.homeRecent5 ? `主亚盘${m.homeRecent5.wins}赢${m.homeRecent5.draws}走${m.homeRecent5.losses}输` : '';
        const ar = m.awayRecent5 ? `客亚盘${m.awayRecent5.wins}赢${m.awayRecent5.draws}走${m.awayRecent5.losses}输` : '';
        console.log(`${m.num} ${m.league} ${m.home}-${m.away} ${m.matchTime||''} | okooo:${m.okoooId}`);
        console.log(`   让球: ${hj} | ${o365} | ${o99}`);
        console.log(`   ${hr} | ${ar}`);
      });
    }).catch(e => console.error('tonight 失败:', e.message));
  } else if (cmd === 'resolve' && arg) {
    resolveMatch(arg, process.argv.includes('--force')).then(cands => {
      if (!cands.length) return console.log(`未在 okooo 竞彩列表找到 "${arg}"`);
      console.log(`\n"${arg}" → okooo 比赛映射:`);
      cands.forEach(c => console.log(`  ${c.order||''} ${c.league||''} ${c.homeTeam}-${c.awayTeam} | okooo ID: ${c.matchId}${c.single?' 单关':''}`));
    }).catch(e => console.error(e.message));
  } else {
    console.log('用法:');
    console.log('  node tools/okooo_scraper.js match <matchId>   # 查看比赛详情(直接访问 okooo ID)');
    console.log('  node tools/okooo_scraper.js tonight [--force] # 批量抓今晚盘(自动映射竞彩→okooo)');
    console.log('  node tools/okooo_scraper.js resolve <队名/竞彩ID>  # 查比赛映射到 okooo ID');
  }
}