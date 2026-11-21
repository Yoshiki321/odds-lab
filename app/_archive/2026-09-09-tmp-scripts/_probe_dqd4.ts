const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
async function probe(id:string){
  const url=`https://www.dongqiudi.com/magicball/v1/match/app/detail?id=${id}&app=dqd&lang=zh-cn`;
  const r=await fetch(url,{headers:{'user-agent':UA,referer:'https://www.dongqiudi.com/'}});
  const j=await r.json();
  const d=j?.data?.match ?? j?.data ?? j;
  console.log('== matchOdds:', JSON.stringify(d?.matchOdds).slice(0,400));
  console.log('== matchSample status:', d?.matchSample?.status, 'gameweek:', d?.matchSample?.gameweek);
  const ms=d?.matchSample;
  if(ms){ console.log('matchSample keys:', Object.keys(ms).join(',')); }
}
probe('2041360').catch(e=>console.error('ERR',e?.message));
