// fetch-results.ts — 抓已开奖赛果 → upsert PG results（对标 tools/fetch_results.cjs）
// 幂等：官方未终场(status!=2 / poolStatus!=Payout) 一律跳过不写库
import https from 'node:https';
import { getDayMatches, upsertResult } from '../src/server/db/store.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0';
const REF = 'https://www.sporttery.cn/jc/zqsgkj/';

function httpGet(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { referer: REF, 'user-agent': UA, accept: 'application/json' } }, res => {
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

/** 抓日期范围内已开奖赛果并入库；返回写库场数 */
export async function fetchResultsAndStore(date = bjDate()): Promise<{ date: string; count: number; begin: string; end: string }> {
  const matches = await getDayMatches(date);
  const dates = [...new Set(matches.map(m => m.matchDate).filter(Boolean))].sort();
  const begin = dates[0] || date;
  const end = dates[dates.length - 1] || date;
  const ids = new Set(matches.map(m => String(m.matchId)).filter(Boolean));

  const raw: any[] = [];
  for (let page = 1; page <= 8; page++) {
    const url = `https://webapi.sporttery.cn/gateway/uniform/football/getUniformMatchResultV1.qry?matchBeginDate=${begin}&matchEndDate=${end}&pageSize=50&pageNo=${page}&isFix=0&matchPage=1&pcOrWap=1`;
    const j = await httpGet(url);
    const list = (j && j.value && j.value.matchResult) || [];
    if (!list.length) break;
    raw.push(...list);
    if (list.length < 50) break;
  }

  let count = 0;
  for (const r of raw) {
    const id = String(r.matchId || '');
    if (!id || (ids.size && !ids.has(id))) continue;
    const score = r.sectionsNo999 || '';
    const done = String(r.matchResultStatus) === '2' || r.poolStatus === 'Payout';
    if (!done || !score) continue; // 未终场绝不结算
    const m = String(score).match(/(\d+)\s*[:\-]\s*(\d+)/);
    const hg = m ? +m[1] : null, ag = m ? +m[2] : null;
    const gl = parseFloat(r.goalLine);
    let hhad: 'H' | 'A' | 'D' | null = null;
    if (hg != null && ag != null && !isNaN(gl)) {
      const v = hg + gl - ag;
      hhad = v > 0 ? 'H' : v < 0 ? 'A' : 'D';
    }
    await upsertResult({
      matchId: id, score,
      had: r.winFlag || null,
      hhad,
      goalLine: r.goalLine || null,
      ht: r.sectionsNo1 || '',
    });
    count++;
  }
  return { date, count, begin, end };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('fetch-results.ts')) {
  const arg = process.argv[2];
  const date = arg && /^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : bjDate();
  fetchResultsAndStore(date).then(r => {
    console.log(`赛果 ${r.date} ${r.begin}~${r.end} 已开奖 ${r.count} 场`);
  }).catch(e => { console.error('信息源错误 getUniformMatchResultV1:', e.message || e); process.exit(1); });
}