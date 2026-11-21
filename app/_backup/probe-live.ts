// probe-live.ts - 探 sporttery 直播接口 3 页里有没有 2041302，以及各 matchId 的状态
import https from 'node:https';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0';
function get(url: string): Promise<any> {
  return new Promise((res, rej) => {
    https.get(url, { headers: { referer: 'https://www.sporttery.cn/jc/zqbfzb/', 'user-agent': UA, accept: 'application/json' } }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}
async function main() {
  const rows: any[] = [];
  for (let page = 1; page <= 3; page++) {
    const j = await get(`https://webapi.sporttery.cn/gateway/uniform/fb/getMatchDataPageListV1.qry?method=all&pageSize=50&pageNo=${page}`);
    for (const g of (j.value?.matchInfoList || [])) for (const m of (g.subMatchList || [])) if (m?.matchId != null) rows.push(m);
  }
  console.log('接口返回', rows.length, '场');
  const hit = rows.filter(m => String(m.matchId) === '2041302');
  console.log('含 2041302:', hit.length);
  if (hit.length) console.log('  状态:', JSON.stringify(hit[0]));
  // 09-06 竞彩场次里有哪些还出现在接口里
  const past = rows.filter(m => m.matchNumStr && /^周日/.test(String(m.matchNumStr)) && String(m.matchNumStr) !== '周日000' && String(m.matchNumStr).replace('周日','') >= '001' && String(m.matchNumStr).replace('周日','') <= '024');
  console.log('周日001-024 在接口中的:', past.length);
  for (const m of past.slice(0, 30)) console.log(' ', m.matchNumStr, String(m.matchId), m.matchStatusName, m.sectionsNo999);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });