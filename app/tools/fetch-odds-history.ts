// fetch-odds-history.ts — getFixedBonusV1 回填 odds_history（完整变盘轨迹，增量追加）
// 每次刷新抓全量 hadList/hhadList，只追加 observed_at > 表内最大值的行（幂等）
// observed_at 取接口 updateDate+updateTime（北京时间）
import https from 'node:https';
import { getDayMatches, maxOddsHistoryAt } from '../src/server/db/store.js';
import { pushOddsHistory } from '../src/server/db/store.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0';
const REF = 'https://www.sporttery.cn/jc/zqsgkj/';

function httpGet(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { referer: REF, 'user-agent': UA, accept: 'application/json' }, timeout: 15000 }, res => {
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch { reject(new Error('JSON fail ' + url)); }
      });
    }).on('error', reject);
  });
}

const bjDate = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** 北京时间 "2026-09-08" + "10:23" → UTC ISO */
function toISO(date: string, time: string): string {
  if (!date) return new Date().toISOString();
  const t = time && /^\d{2}:\d{2}/.test(time) ? time.slice(0, 8) : '09:00:00';
  const d = new Date(`${date}T${t}+08:00`);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/** 抓一场盘口变化，只追加比表内最大 observed_at 新的行。返回新增条数 */
async function fetchMatchIncremental(matchId: string): Promise<number> {
  const j = await httpGet(`https://webapi.sporttery.cn/gateway/uniform/football/getFixedBonusV1.qry?clientCode=3001&matchId=${matchId}`);
  const oh = j?.value?.oddsHistory;
  if (!oh) return 0;
  const maxAt = await maxOddsHistoryAt(matchId);
  const maxMs = maxAt ? new Date(maxAt).getTime() : 0;
  const entries: { market: 'HAD' | 'HHAD'; side: 'h' | 'd' | 'a'; odds: number; observedAt: string }[] = [];
  for (const market of ['HAD', 'HHAD'] as const) {
    const list = oh[market === 'HAD' ? 'hadList' : 'hhadList'] || [];
    for (const e of list) {
      const t = toISO(e.updateDate, e.updateTime);
      const ts = new Date(t).getTime();
      if (isNaN(ts) || ts <= maxMs) continue; // 幂等：只取比现有更新的一帧
      for (const side of ['h', 'd', 'a'] as const) {
        const v = parseFloat(e[side]);
        if (!isNaN(v)) entries.push({ market, side, odds: v, observedAt: t });
      }
    }
  }
  if (entries.length) await pushOddsHistory(matchId, entries);
  return entries.length;
}

/** 并发增量回填当日全部场次（每次都抓，追加新变化）。返回 {written, skipped, failed} */
export async function backfillOddsHistory(date = bjDate(), concurrency = 4): Promise<{ date: string; written: number; skipped: number; failed: string[] }> {
  const matches = await getDayMatches(date);
  const jobs = matches.map(m => m.matchId);

  let written = 0, skipped = 0, failed = 0;
  const failedIds: string[] = [];
  let idx = 0;
  async function worker() {
    while (idx < jobs.length) {
      const id = jobs[idx++];
      try {
        const n = await fetchMatchIncremental(id);
        if (n > 0) written += n; else skipped++;
      } catch { failed++; failedIds.push(id); }
      await sleep(80);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length || 1) }, worker));
  return { date, written, skipped, failed: failedIds };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('fetch-odds-history.ts')) {
  const arg = process.argv[2];
  const date = arg && /^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : bjDate();
  backfillOddsHistory(date).then(r => {
    console.log(`变盘轨迹 ${r.date} 新增${r.written}条 无变化${r.skipped}场 失败${r.failed.length}场${r.failed.length ? ':' + r.failed.join(',') : ''}`);
  }).catch(e => { console.error('信息源错误 getFixedBonusV1:', e.message || e); process.exit(1); });
}