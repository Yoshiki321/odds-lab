// 尝试从 sporttery 获取当天/临场比赛列表
import https from 'node:https';
function fetch(url){return new Promise((res,rej)=>{https.get(url,{headers:{'User-Agent':'Mozilla/5.0',referer:'https://www.sporttery.cn/jc/zqdz/'},timeout:15000},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}})}).on('error',rej).on('timeout',()=>{})})}
// 竞彩全部场次接口
const j=await fetch('https://webapi.sporttery.cn/gateway/uniform/football/getMatchListV1.qry?clientCode=3001&matchPage=1&matchBeginDate=2026-08-30&matchEndDate=2026-08-31');
console.log('getMatchListV1 success:', j.success, 'code:', j.errorCode, j.errorMessage);
if(j.success){
  const v=j.value;
  console.log('keys:', Object.keys(v));
  const m=v.matchResult||v.matchList||[];
  console.log('count:', Array.isArray(m)?m.length:typeof m);
}
