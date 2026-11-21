const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const r=await fetch('https://www.dongqiudi.com/magicball/v1/list/match_list?language=zh-CN&cmp_type=soccer&tab_type=all',{headers:{'user-agent':UA,referer:'https://www.dongqiudi.com/'}});
const j=await r.json();
const matches=(j?.data?.matches||[]);
let found=0;
for(const m of matches.slice(0,26)){
  try{
    const rr=await fetch(`https://www.dongqiudi.com/magicball/v1/match/app/detail?id=${m.match_id}&app=dqd&lang=zh-cn`,{headers:{'user-agent':UA,referer:'https://www.dongqiudi.com/'},signal:AbortSignal.timeout(6000)});
    const jj=await rr.json();
    const d=jj?.data?.match ?? jj?.data ?? jj;
    const mf=d?.matchFormation;
    if(mf&&typeof mf==='object'&&Object.keys(mf).length){
      found++; console.log('FORMATION!',m.team_A?.name,'vs',m.team_B?.name,'keys:',Object.keys(mf).join(','));
      if(found>=2) break;
    }
  }catch(e){}
}
console.log('checked 26, formation found:',found);
