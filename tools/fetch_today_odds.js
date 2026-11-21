/**
 * fetch_today_odds.js — 获取今日竞彩盘口数据（比赛计算器接口）
 *
 * 数据源: sporttery.cn getMatchCalculatorV1
 * 每场含 had(hf/df/af), hhad(hf/df/af), poolList(单关状态), vote
 *
 * 用法:
 *   node tools/fetch_today_odds.js           # 抓取并保存今日盘口
 *   node tools/fetch_today_odds.js --json    # 只输出JSON到stdout
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'data', 'today');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0';
const REF = 'https://www.sporttery.cn/';

function httpGet(url, referer = REF) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'referer': referer, 'user-agent': UA, 'accept': 'application/json, text/javascript, */*; q=0.01' } }, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch { reject(new Error(`JSON parse fail: ${url}`)); }
      });
    }).on('error', reject);
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * 获取今日全部比赛盘口
 * @returns [{ matchId, league, home, away, had, hhad, single, poolList, vote }]
 */
export async function fetchTodayOdds() {
  const url = 'https://webapi.sporttery.cn/gateway/uniform/football/getMatchCalculatorV1.qry?channel=c&poolCode=hhad,had';
  const j = await httpGet(url);
  if (!j.success) throw new Error('API fail: ' + j.errorMessage);

  const matches = [];
  for (const blk of (j.value?.matchInfoList || [])) {
    for (const m of (blk.subMatchList || [])) {
      const pools = m.poolList || [];
      const poolStatus = {};
      for (const p of pools) poolStatus[p.poolCode] = p.single;

      matches.push({
        matchId: String(m.matchId),
        num: m.matchNumStr || m.matchNum,
        league: m.leagueAbbName,
        home: m.homeTeamAbbName,
        away: m.awayTeamAbbName,
        matchDate: m.matchDate,
        matchTime: m.matchTime,
        had: m.had || null,
        hhad: m.hhad || null,
        single: poolStatus,
        poolList: m.poolList || [],
        vote: m.vote || {},
      });
    }
  }
  return matches;
}

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');

  fetchTodayOdds().then(matches => {
    if (asJson) {
      console.log(JSON.stringify(matches, null, 2));
      return;
    }
    if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    writeFileSync(join(OUT_DIR, `${stamp}.json`), JSON.stringify({ fetchedAt: new Date().toISOString(), matches }, null, 2), 'utf8');
    writeFileSync(join(OUT_DIR, '_latest.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), matches }, null, 2), 'utf8');

    console.log(`=== 今日竞彩盘口 (${matches.length}场) ===\n`);
    for (const m of matches) {
      const gl = m.hhad?.goalLine || '';
      const single = m.single?.HAD === 1 ? '【单】' : '  ';
      console.log(`${m.num?.padEnd(10)} ${single} ${m.league?.padEnd(8)} ${m.home?.padEnd(8)} vs ${m.away?.padEnd(8)}`);
      console.log(`   HAD: ${m.had?.h} ${m.had?.d} ${m.had?.a} | HHAD: ${m.hhad?.h} ${m.hhad?.d} ${m.hhad?.a} | gl ${gl}`);
    }
    console.log(`\n已保存: data/today/${stamp}.json`);
  }).catch(e => {
    console.error('失败:', e.message);
    process.exit(1);
  });
}

if (process.argv[1]?.endsWith('fetch_today_odds.js')) main();