// 探测 okooo 全量比赛(非竞彩)列表接口
import https from 'node:https';
function fetch(url){return new Promise((res,rej)=>{https.get(url,{headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',referer:'https://www.okooo.com/'},timeout:15000},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res({status:r.statusCode,body:d})}catch(e){rej(e)}})}).on('error',rej).on('timeout',()=>{})})}
const urls = [
 'https://www.okooo.com/soccer/',
 'https://www.okooo.com/soccer/today/',
 'https://www.okooo.com/soccer/schedule/',
 'https://www.okooo.com/analysis/',
];
for (const u of urls) {
  const r = await fetch(u);
  console.log(u, '->', r.status, 'len', r.body.length);
  // 检查是否包含比赛信息或是否被拦截
  const blocked = r.body.includes('访问被阻断') || r.body.includes('EdgeOne') || r.body.includes('安全');
  console.log('  blocked:', blocked);
}
