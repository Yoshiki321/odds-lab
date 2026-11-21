// _diag_support.ts — 支持率接口调试（事后删除）
import { getDayMatches } from '../src/server/db/store.js';
import https from 'node:https';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0';
function httpGet(url: string): Promise<{ status?: number; body: string }> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { referer: 'https://www.sporttery.cn/', 'user-agent': UA }, timeout: 15000 }, res => {
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    }).on('error', reject);
  });
}

(async () => {
  const ms = await getDayMatches('2026-09-08');
  console.log('matches:', ms.length, ms.map(m => m.matchId).join(','));
  const url = 'https://webapi.sporttery.cn/gateway/jc/common/getSupportRateV1.qry?matchIds=' + ms.map(m => m.matchId).join(',') + '&poolCode=hhad,had&sportType=1';
  const r = await httpGet(url);
  console.log('status:', r.status);
  console.log('body head:', r.body.slice(0, 200));
  try {
    const j = JSON.parse(r.body);
    console.log('success:', j.success, 'errorMessage:', j.errorMessage, 'keys:', Object.keys(j.value || {}).length);
  } catch (e: any) { console.log('parse fail:', e.message); }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });