const UA='Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
const id='54363272';
for(const url of [`https://m.dongqiudi.com/match/${id}`,`https://www.dongqiudi.com/match/${id}`]){
  try{
    const r=await fetch(url,{headers:{'user-agent':UA},signal:AbortSignal.timeout(8000)});
    const txt=await r.text();
    console.log('HTTP',r.status,txt.length,'bytes',url);
    if(/首发|lineup|阵容|starting/i.test(txt)){
      const i=txt.search(/首发|阵容/);
      console.log('  !! has lineup keyword around:',txt.slice(Math.max(0,i-200),i+300).replace(/\s+/g,' ').slice(0,400));
    } else if(txt.length>1000) console.log('  no lineup keyword (head):',txt.slice(0,180).replace(/\s+/g,' '));
  }catch(e){ console.log('ERR',url,e?.message?.slice(0,50)); }
}
