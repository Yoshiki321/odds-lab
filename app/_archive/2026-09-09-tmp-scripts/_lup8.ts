const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
// sporttery 官方 matchId 2041356 = 江原 vs 全北 (北京18:30)
const tries=[
  'https://webapi.sporttery.cn/gateway/df/match/getMatchInfoV1.qry?matchId=2041356',
  'https://webapi.sporttery.cn/gateway/df/match/getMatchScheduleV1.qry?param=90%2C0%2C1',
];
for(const url of tries){
  try{
    const r=await fetch(url,{headers:{'user-agent':UA,'referer':'https://www.sporttery.cn/','accept':'application/json'},signal:AbortSignal.timeout(8000)});
    const txt=await r.text();
    const keys=Object.keys(JSON.parse(txt)?.value||{});
    console.log('HTTP',r.status,url.slice(0,80),'| value keys:',keys.slice(0,12).join(','));
    const has=/(首发|lineup|阵容|first)/i.test(txt);
    if(has) console.log('  !! lineup keyword:',txt.slice(0,500));
  }catch(e){ console.log('ERR',url.slice(0,80),e?.message?.slice(0,60)); }
}
