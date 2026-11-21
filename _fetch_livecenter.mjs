import https from 'node:https';
import { writeFileSync } from 'node:fs';
function fetch(url){return new Promise((res,rej)=>{https.get(url,{headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',referer:'https://www.okooo.com/',accept:'text/html'},timeout:20000},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res({status:r.statusCode,body:d}))}).on('error',rej).on('timeout',()=>{})})}
const r = await fetch('https://www.okooo.com/livecenter/');
writeFileSync('data/okooo_cache/livecenter_raw.html', r.body, 'utf8');
console.log('saved, len', r.body.length);
// 看关键标记
const idx = r.body.indexOf('美职');
console.log('美职 found at', idx);
