import https from 'node:https';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0';
function get(url) { return new Promise((res, rej) => {
  https.get(url, { headers: { referer: 'https://www.sporttery.cn/jc/zqsgkj/', 'user-agent': UA } }, r => { let d=''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch(e){ rej(e); } }); }).on('error', rej);
}); }
async function main() {
  const j = await get('https://webapi.sporttery.cn/gateway/uniform/football/getUniformMatchResultV1.qry?matchBeginDate=2026-09-06&matchEndDate=2026-09-06&pageSize=50&pageNo=1&isFix=0&matchPage=1&pcOrWap=1');
  const list = (j.value?.matchResult || []);
  console.log('total', j.value?.total);
  for (const m of list) {
    const num = String(m.matchNumStr || '');
    if (num >= '周日017') console.log(m.matchNumStr, m.matchId, 'status', m.matchResultStatus, m.poolStatus, m.sectionsNo999, m.matchDate);
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
