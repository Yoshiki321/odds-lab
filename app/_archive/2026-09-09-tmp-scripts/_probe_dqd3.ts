const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
async function probe(id:string){
  const url=`https://www.dongqiudi.com/magicball/v1/match/app/detail?id=${id}&app=dqd&lang=zh-cn`;
  const r=await fetch(url,{headers:{'user-agent':UA,referer:'https://www.dongqiudi.com/'}});
  const j=await r.json();
  const d=j?.data?.match ?? j?.data ?? j;
  const mf=d?.matchFormation;
  console.log('top-level keys of detail:', Object.keys(d||{}).join(','));
  console.log('matchFormation json:', JSON.stringify(mf).slice(0,800));
}
probe('2041360').catch(e=>console.error('ERR',e?.message));
