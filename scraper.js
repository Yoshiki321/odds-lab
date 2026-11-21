/**
 * 竞彩网全量数据抓取器
 * 数据源: sporttery.cn 官方竞彩网关 (webapi.sporttery.cn)
 *
 * 覆盖数据域:
 *  1. 即时赔率(全部玩法池) - football / basketball getMatchCalculatorV1
 *  2. 历史赛果(竞彩足球/篮球, 2016 至今) - getUniformMatchResultV1
 *  3. 联赛资料(赛程/战绩, 按赛季) - league/getMatchResultV1
 *  4. 支持比例/百分比(胜平负/让球/篮球) - getVoteV1 + getSupportRateV1
 *  5. 比分直播(实时事件) - uniform/fb/* (仅当前进行中赛事)
 *
 * 用法:
 *  node scraper.js all          # 抓全部
 *  node scraper.js odds         # 即时赔率
 *  node scraper.js history      # 历史赛果(默认最近90天)
 *  node scraper.js league       # 联赛资料(全部联赛/赛季)
 *  node scraper.js support      # 支持比例
 *  node scraper.js live         # 比分直播
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'data');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0';
const REF = 'https://www.sporttery.cn/';
const POOL_PATHS = {
  football: ['channel=c&poolCode=hhad,had', 'channel=c'],                    // 胜平负 / 混合(全池)
  basketball: ['channel=c&poolCode=mnl', 'channel=c&poolCode=mnl,hdc,hilo,wnm'], // 胜负 / 混合
};

mkdirSync(OUT, { recursive: true });

function httpGet(url, referer = REF) {
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

/** 通用重试包装 */
async function getRetry(url, referer, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try { return await httpGet(url, referer); }
    catch (e) {
      if (i === retries - 1) throw e;
      await sleep(1000 * (i + 1));
    }
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** 写入 JSON(默认美化, raw 为压缩) */
function save(name, obj, { raw = false } = {}) {
  const path = join(OUT, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, raw ? null : 2, raw ? 0 : 2), 'utf8');
  return path;
}

/** 追加一行(日志/增量) */
function log(name, line) {
  const path = join(OUT, 'logs', name);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, line + '\n', 'utf8');
}

/** 增量:读取已有文件里的 key 集合 */
function loadKeys(name, keyBuilder) {
  const path = join(OUT, name);
  if (!existsSync(path)) return new Set();
  try {
    const arr = JSON.parse(readFileSync(path, 'utf8'));
    return new Set(arr.map(keyBuilder));
  } catch { return new Set(); }
}

/* ============ 1. 即时赔率 ============ */

async function scrapeOdds() {
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const tasks = [];
  for (const [sport, links] of Object.entries(POOL_PATHS)) {
    links.forEach((q, i) => tasks.push({
      sport, key: `${sport}_${i === 0 ? 'spf' : 'all'}`, url: `https://webapi.sporttery.cn/gateway/uniform/${sport === 'football' ? 'football' : 'basketball'}/getMatchCalculatorV1.qry?${q}`
    }));
  }
  const results = {};
  for (const t of tasks) {
    const j = await getRetry(t.url);
    results[t.key] = j.code ?? j.errorCode ?? j;
    save(`odds/${t.key}_${stamp}.json`, j, { raw: true });
    save(`odds/_latest/${t.key}.json`, j);
    const n = j.value?.matchInfoList?.reduce((a, blk) => a + (blk.subMatchList?.length || 0), 0) ?? 0;
    console.log(`[赔率] ${t.key}: ${n} 场`);
    await sleep(500);
  }
  return results;
}

/* ============ 2. 历史赛果 ============ */

const FOOTBALL_RESULT = 'https://webapi.sporttery.cn/gateway/uniform/football/getUniformMatchResultV1.qry';
const BASKETBALL_RESULT = 'https://webapi.sporttery.cn/gateway/uniform/basketball/getUniformMatchResultV1.qry';

/** 按日抓取历史赛果(增量); 数据最早 2015-01-01,更早无数据 */
async function scrapeHistory({ begin = '2015-01-01', end, sports = ['football', 'basketball'] } = {}) {
  end = end || new Date().toISOString().slice(0, 10);
  const beginDate = new Date(begin), endDate = new Date(end);
  const days = Math.round((endDate - beginDate) / 86400000) + 1;
  console.log(`[历史赛果] ${begin} → ${end} (共 ${days} 天, ${sports.join('/')})`);

  const merged = { football: [], basketball: [] };
  let cursor = beginDate;
  let dayCount = 0;

  while (cursor <= endDate) {
    const ds = cursor.toISOString().slice(0, 10);
    for (const sport of sports) {
      const base = sport === 'football' ? FOOTBALL_RESULT : BASKETBALL_RESULT;
      let pageNo = 1, total = Infinity, got = 0;
      while (got < total) {
        const url = `${base}?matchBeginDate=${ds}&matchEndDate=${ds}&leagueId=&pageSize=50&pageNo=${pageNo}&isFix=0&matchPage=1&pcOrWap=1`;
        const j = await getRetry(url, `https://www.sporttery.cn/jc/${sport === 'football' ? 'zqsgkj' : 'lqsgkj'}/`);
        if (!j.value) break;
        total = j.value.total ?? 0;
        const rows = j.value.matchResult ?? [];
        got += rows.length;
        merged[sport].push(...rows);
        if (rows.length < 50 || got >= total) break;
        pageNo++;
        await sleep(600);
      }
      // 缓存原始响应
      const byDate = merged[sport].filter(m => m.matchDate === ds);
      save(`history/${sport}/${ds}.json`, { date: ds, count: byDate.length, matches: byDate });
    }
    dayCount++;
    if (dayCount % 10 === 0) console.log(`  ...已抓 ${cursor.toISOString().slice(0,10)} (${dayCount}/${days}天)`);
    cursor.setDate(cursor.getDate() + 1);
    await sleep(400);
  }

  for (const sport of sports) {
    save(`history/${sport}/_merged_${begin.replace(/-/g,'')}_${end.replace(/-/g,'')}.json`, merged[sport]);
    console.log(`[历史赛果] ${sport}: 共 ${merged[sport].length} 条`);
  }
  return merged;
}

/* ============ 3. 联赛资料 ============ */

async function scrapeLeague() {
  const lst = await getRetry('https://webapi.sporttery.cn/gateway/uniform/football/league/getLeagueListV1.qry');
  const all = [];
  const hot = lst.value?.hot ?? [];
  const normal = lst.value?.normal ?? [];
  const other = lst.value?.other ?? [];
  const leagues = [...hot];
  normal.forEach(c => c.leagueList?.forEach(l => leagues.push(l)));
  leagues.push(...other);
  console.log(`[联赛资料] 共 ${leagues.length} 个联赛/赛事`);

  let seasonTotal = 0, matchTotal = 0;
  for (const L of leagues) {
    for (const season of L.seasonList ?? []) {
      const url = `https://webapi.sporttery.cn/gateway/uniform/football/league/getMatchResultV1.qry?seasonId=${season.seasonId}&uniformLeagueId=${L.uniformLeagueId}`;
      let j;
      try { j = await getRetry(url, 'https://www.sporttery.cn/zqlszl/'); }
      catch (e) { console.log(`  [失败] ${L.leagueAbbCnName} ${season.seasonName}`); continue; }
      const ms = (j.value?.matchList ?? []).map(d => d.subMatchList ?? []).flat();
      seasonTotal++;
      matchTotal += ms.length;
      all.push({ league: L.leagueAbbCnName, leagueId: L.uniformLeagueId, seasonId: season.seasonId, season: season.seasonName, matches: ms });
      await sleep(350);
    }
  }
  save('league/leagues.json', { fetchedAt: new Date().toISOString(), leagueCount: leagues.length, seasonTotal, matchTotal, data: all });
  console.log(`[联赛资料] 完成: ${seasonTotal} 个赛季, ${matchTotal} 场比赛`);
  return all;
}

/* ============ 4. 支持比例 ============ */

async function scrapeSupport({ begin = '2026-01-01', end } = {}) {
  end = end || new Date().toISOString().slice(0, 10);
  const pools = ['HAD', 'HHAD', 'CRS', 'TTG', 'HAFU']; // 胜平负/让球/比分/总进球/半全场
  const all = {};
  for (const pool of pools) {
    const cur = new Date(begin);
    const rows = [];
    while (cur <= new Date(end)) {
      const ds = cur.toISOString().slice(0, 10);
      let pageNo = 1, total = Infinity;
      while (pageNo * 10 - 10 < total) {
        const url = `https://webapi.sporttery.cn/gateway/uniform/football/getVoteV1.qry?poolCode=${pool}&pageSize=10&pageNo=${pageNo}&businessDate=${ds}`;
        const j = await getRetry(url, 'https://www.sporttery.cn/jc/zqspfzc/');
        if (!j.value?.matches?.list) break;
        total = j.value.matches.total ?? 0;
        rows.push(...j.value.matches.list);
        if (j.value.matches.list.length < 10) break;
        pageNo++;
        await sleep(500);
      }
      cur.setDate(cur.getDate() + 1);
      await sleep(350);
    }
    all[pool] = rows;
    save(`support/vote_${pool}_${begin}_${end}.json`, rows);
    console.log(`[支持比例] ${pool}: ${rows.length} 条`);
  }
  save('support/_merged.json', all);
  return all;
}

/* ============ 5. 比分直播(实时) ============ */

async function scrapeLive() {
  const d = await getRetry('https://webapi.sporttery.cn/gateway/uniform/fb/getMatchDataPageListV1.qry?method=live', 'https://www.sporttery.cn/jc/zqbfzb/');
  save('live/live.json', d);
  const n = d.value?.matchList?.length ?? 0;
  console.log(`[比分直播] ${n} 场比赛`);
  return d;
}

/* ============ 6. 传统足彩历史开奖 ============ */

const CTZC_GAMES = [
  { num: '90', name: '胜负游戏' },
  { num: '900129', name: '任选9场' },
  { num: '98', name: '6场半全场' },
  { num: '94', name: '4场进球' },
];

/** 拉一期传统足彩开奖详情 */
async function scrapeCtzcDraw(gameNum, drawNum) {
  const url = `https://webapi.sporttery.cn/gateway/lottery/getFootBallDrawInfoByDrawNumV1.qry?isVerify=1&lotteryGameNum=${gameNum}&lotteryDrawNum=${drawNum}`;
  const j = await getRetry(url, 'https://www.sporttery.cn/ctzc/ctzq/', 2);
  return j.value;
}

/** 拉最近 N 期传统足彩(覆盖销售进度: new)或指定期号(历史: backfill) */
async function scrapeCtzc({ mode = 'recent', count = 10, gameNum = '' } = {}) {
  const games = gameNum ? CTZC_GAMES.filter(g => g.num === gameNum) : CTZC_GAMES;
  const summary = [];
  const v2 = await getRetry('https://webapi.sporttery.cn/gateway/lottery/getFootBallDrawInfoV2.qry?isVerify=1&param=94,0;90,0;98,0', 'https://www.sporttery.cn/ctzc/ctzq/', 2);
  const v2v = v2.value;
  const allDraws = {
    '90': (v2v?.sfclist ?? []).map(x => ({ num: x.lotteryDrawNum, gameNum: '90' })),
    '900129': (v2v?.sfclist ?? []).map(x => ({ num: x.lotteryDrawNum, gameNum: '900129' })),
    '98': (v2v?.bqclist ?? []).map(x => ({ num: x.lotteryDrawNum, gameNum: '98' })),
    '94': (v2v?.jqclist ?? []).map(x => ({ num: x.lotteryDrawNum, gameNum: '94' })),
  };
  for (const g of games) {
    const draws = (allDraws[g.num] ?? []).slice(0, count);
    for (const d of draws) {
      const v = await scrapeCtzcDraw(d.gameNum, d.num);
      const detail = v ?? {};
      summary.push({ game: g.name, num: d.num, drawTime: detail.lotteryDrawTime, result: detail.lotteryDrawResult, verify: detail.verify });
      save(`ctzc/${g.name}/${d.num}.json`, v);
      await sleep(450);
    }
    console.log(`[传统足彩] ${g.name}: ${draws.length} 期`);
  }
  save('ctzc/_summary.json', summary);
  return summary;
}

/* ============ 主入口 ============ */

const cmd = process.argv[2] ?? 'all';
const r = { t: new Date().toISOString(), cmd };
try {
  if (cmd === 'odds' || cmd === 'all') { r.odds = await scrapeOdds(); }
  if (cmd === 'history' || cmd === 'all') {
    // all 模式默认拉近30天，快速验证；history 默认拉全量2016至今
    await scrapeHistory(cmd === 'all'
      ? { begin: new Date(Date.now() - 30 * 86400000).toISOString().slice(0,10) }
      : { begin: process.argv[3] ?? '2016-01-01' });
  }
  if (cmd === 'league' || cmd === 'all') { await scrapeLeague(); }
  if (cmd === 'support') { await scrapeSupport({ begin: process.argv[3] ?? '2026-08-01' }); }
  if (cmd === 'live' || cmd === 'all') { await scrapeLive(); }
  if (cmd === 'ctzc') { await scrapeCtzc({ count: Number(process.argv[3] ?? 10) }); }
  console.log('\n[完成]', cmd, new Date().toISOString());
} catch (e) {
  console.error('[错误]', e.message);
  log('errors.log', `${new Date().toISOString()} ${cmd} ${e.message}`);
  process.exit(1);
}