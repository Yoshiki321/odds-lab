import https from 'node:https';
function fetch(url){return new Promise((res,rej)=>{https.get(url,{headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',referer:'https://www.okooo.com/',accept:'text/html'},timeout:15000},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res({status:r.statusCode,body:d}))}).on('error',rej).on('timeout',()=>{})})}
// 常见的okooo比赛日历接口(桌面版/手机版)
const urls = [
 'https://www.okooo.com/soccer/match/result/',
 'https://www.okooo.com/livecenter/',
 'https://www.okooo.com/soccer/livecenter/',
 'https://m.okooo.com/soccer/',
];
for (const u of urls) {
  const r = await fetch(u);
  console.log(u, '->', r.status, 'len', r.body.length);
}
