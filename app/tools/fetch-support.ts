// fetch-support.ts — getSupportRateV1 抓大众支持率/官方去水概率 → matches.support JSONB
// 接口: jc/common/getSupportRateV1.qry?matchIds=a,b&poolCode=hhad,had&sportType=1
// 返回 value["_<matchId>"] = { HAD:{hSupportRate,dProbability,...}, HHAD:{...} }
// 抓不到（空响应）= 中立，不写库也不崩（评分源C/M2/M3 自动降级）
import https from 'node:https';
import { getDayMatches, upsertSupport } from '../src/server/db/store.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0';
const REF = 'https://www.sporttery.cn/';

function httpGet(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { referer: REF, 'user-agent': UA, accept: 'application/json, text/javascript, */*; q=0.01' }, timeout: 15000 }, res => {
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch { reject(new Error(`JSON parse fail: ${url}`)); }
      });
    }).on('error', reject);
  });
}

const bjDate = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

/** 按日抓全部场次支持率并 upsert matches.support；返回成功写库场数 */
export async function fetchSupportAndStore(date = bjDate()): Promise<{ date: string; ok: number; fail: number }> {
  const matches = await getDayMatches(date);
  const ids = matches.map(m => m.matchId).filter(Boolean);
  if (!ids.length) return { date, ok: 0, fail: 0 };

  let ok = 0, fail = 0;
  for (let i = 0; i < ids.length; i += 60) {
    const chunk = ids.slice(i, i + 60);
    let j: any;
    try {
      const url = 'https://webapi.sporttery.cn/gateway/jc/common/getSupportRateV1.qry'
        + `?matchIds=${chunk.join(',')}&poolCode=hhad,had&sportType=1`;
      j = await httpGet(url);
    } catch (e: any) {
      fail += chunk.length;
      continue; // 网络/解析失败 → 中立，不崩
    }
    if (j && j.success && j.value) {
      for (const id of chunk) {
        const blk = j.value[`_${id}`] ?? j.value[id] ?? null;
        if (!blk) { fail++; continue; }
        const support = {
          HAD: blk.HAD || null,
          HHAD: blk.HHAD || null,
        };
        try { await upsertSupport(id, support); ok++; } catch (e: any) { fail++; console.error(`  support write fail ${id}:`, e.message); }
      }
    } else {
      fail += chunk.length;
    }
  }
  return { date, ok, fail };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('fetch-support.ts')) {
  const arg = process.argv[2];
  const date = arg && /^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : bjDate();
  fetchSupportAndStore(date).then(r => {
    console.log(`支持率 ${r.date} 成功${r.ok} 失败${r.fail}`);
  }).catch(e => { console.error('信息源错误 getSupportRateV1:', e.message || e); process.exit(1); });
}