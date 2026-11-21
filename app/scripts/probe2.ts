// probe2.ts - 探官方开奖接口 09-06 全部返回，确认 018-024 是否未 Payout
import https from 'node:https';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0';
function get(url: string): Promise<any> {
  return new Promise((res, rej) => {
    https.get(url, { headers: { referer: 'https://www.sporttery.cn/jc/zqsgkj/', 'user-agent': UA } }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}
async function main() {
  const want = new Set(['2041313', '2041314', '2041315', '2041316', '2041317', '2041318', '2041319']);
  const j = await get('https://webapi.sporttery.cn/gateway/uniform/football/getUniformMatchResultV1.qry?matchBeginDate=2026-09-06&matchEndDate=2026-09-06&pageSize=50&pageNo=1&isFix=0&matchPage=1&pcOrWap=1');
  const list: any[] = j.value?.matchResult || [];
  console.log('官方开奖 total =', j.value?.total, '返回', list.length, '条');
  const hit = list.filter(m => want.has(String(m.matchId)));
  console.log('命中 018-024:', hit.length);
  for (const m of hit) console.log(' ', m.matchNumStr, m.matchId, m.matchResultStatus, m.poolStatus, m.sectionsNo999);
  // 打印所有返回的编号，方便对照
  console.log('--- 全部返回编号 ---');
  for (const m of list) console.log(' ', m.matchNumStr, m.matchId, m.matchResultStatus, m.poolStatus, m.sectionsNo999);
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });