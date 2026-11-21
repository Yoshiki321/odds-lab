const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
async function probe(id:string){
  const url=`https://www.dongqiudi.com/magicball/v1/match/app/detail?id=${id}&app=dqd&lang=zh-cn`;
  const r=await fetch(url,{headers:{'user-agent':UA,referer:'https://www.dongqiudi.com/'}});
  const j=await r.json();
  const d=j?.data?.match ?? j?.data ?? j;
  const mf=d?.matchFormation;
  console.log('id',id,'matchFormation:', Array.isArray(mf)?('array len '+mf.length):(typeof mf), Object.keys(mf||{}).slice(0,24).join(','));
  const walk=(o,path='',depth=0)=>{
    if(depth>5||!o||typeof o!=='object') return;
    for(const k of Object.keys(o)){
      if(/line|starting|squad|player|formation|injur|injury|home|away/i.test(k)) console.log('  '+path+'.'+k, Array.isArray(o[k])?('arr'+o[k].length):(typeof o[k]==='object'?'obj':'val'));
      if(typeof o[k]==='object') walk(o[k],path+'.'+k,depth+1);
    }
  };
  walk(mf,'mf');
}
probe('2041360').catch(e=>console.error('ERR',e?.message));
