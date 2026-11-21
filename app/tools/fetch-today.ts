// fetch-today.ts — sporttery getMatchCalculatorV1 抓竞彩当日盘 → upsert PG matches
// 对标 tools/fetch_today_odds.js 完整移植；base 由 upsertMatch 的 COALESCE 保留首见盘
import https from 'node:https';
import { upsertMatch } from '../src/server/db/store.js';
import type { RawMatch } from '../src/shared/types.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0';
const REF = 'https://www.sporttery.cn/';

function httpGet(url: string, referer = REF): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { referer, 'user-agent': UA, accept: 'application/json, text/javascript, */*; q=0.01' } }, res => {
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch { reject(new Error(`JSON parse fail: ${url}`)); }
      });
    }).on('error', reject);
  });
}

/** 抓当日全部比赛盘口（sporttery 计算器） */
export async function fetchTodayOdds(): Promise<RawMatch[]> {
  const url = 'https://webapi.sporttery.cn/gateway/uniform/football/getMatchCalculatorV1.qry?channel=c&poolCode=hhad,had';
  const j = await httpGet(url);
  if (!j.success) throw new Error('API fail: ' + j.errorMessage);
  const out: RawMatch[] = [];
  for (const blk of (j.value?.matchInfoList || [])) {
    for (const m of (blk.subMatchList || [])) {
      const pools = m.poolList || [];
      const poolStatus: Record<string, number> = {};
      for (const p of pools) poolStatus[p.poolCode] = p.single;
      out.push({
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
        vote: m.vote || {},
      });
    }
  }
  return out;
}

/** 抓 + 全部合入 PG（merge: 新字段覆盖旧，旧场保留） */
export async function fetchTodayAndStore(): Promise<{ date: string; fetched: number; updated: number }> {
  const matches = await fetchTodayOdds();
  if (!matches.length) throw new Error('sporttery.getMatchCalculatorV1 返回空场次');
  // 销售日推断 = 最早一场 matchDate；无则北京今日
  const date = matches.map(m => m.matchDate).filter(Boolean).sort()[0]
    || new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  let updated = 0;
  for (const mth of matches) {
    // had_base/hhad_base 由 upsertMatch 的 COALESCE 保留首见盘，这里传当前盘即首次写入时定格基线
    await upsertMatch({
      matchId: String(mth.matchId), matchDate: mth.matchDate || date, num: mth.num,
      league: mth.league || '', home: mth.home || '', away: mth.away || '',
      kickoff: '', had: mth.had || null, hhad: mth.hhad || null,
      hadBase: mth.had || null, hhadBase: mth.hhad || null,
      matchTime: mth.matchTime,
      updatedAt: new Date().toISOString(),
    });
    updated++;
  }
  return { date, fetched: matches.length, updated };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('fetch-today.ts')) {
  fetchTodayAndStore().then(r => {
    console.log(`=== 今日竞彩盘口 (${r.fetched}场 覆盖${r.updated}) ===`);
  }).catch(e => { console.error('信息源错误 sporttery.getMatchCalculatorV1:', e.message || e); process.exit(1); });
}