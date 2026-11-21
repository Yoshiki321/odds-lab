const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const id='54363272'; // 江原 vs 全北
const tries=[
  `https://www.dongqiudi.com/ws-news/match/${id}`,
  `https://match-info.dongqiudi.com/match/dqd/${id}.json`,
  `https://www.dongqiudi.com/api/match/detail/${id}`,
  `https://m.dongqiudi.com/data/match/${id}`,
];
for(const url of tries){
  try{
    const r=await fetch(url,{headers:{'user-agent':UA,referer:'https://www.dongqiudi.com/'},signal:AbortSignal.timeout(8000)});
    if(!r.ok){ console.log('HTTP',r.status,url.slice(0,70)); continue; }
    const txt=await r.text();
    console.log('OK',txt.length,'bytes',url.slice(0,70));
    const hasLineup=/首发|lineup|starting|阵容/i.test(txt);
    if(!hasLineup&&txt.length>6000) console.log('  (no lineup keyword)');
    else if(hasLineup){ console.log('  !! has lineup keyword, sample:',txt.slice(0,400)); }
  }catch(e){ console.log('ERR',url.slice(0,70),e?.message?.slice(0,60)); }
}
