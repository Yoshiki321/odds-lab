const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const r=await fetch('https://www.dongqiudi.com/magicball/v1/list/match_list?language=zh-CN&cmp_type=soccer&tab_type=all',{headers:{'user-agent':UA,referer:'https://www.dongqiudi.com/'}});
const j=await r.json();
const m=(j?.data?.matches||[]).filter(m=>/特温特/.test((m.team_A?.name||'')+(m.team_B?.name||''))&&!/U19/.test(m.team_A?.name||''))[0];
const rr=await fetch(`https://www.dongqiudi.com/magicball/v1/match/app/detail?id=${m.match_id}&app=dqd&lang=zh-cn`,{headers:{'user-agent':UA,referer:'https://www.dongqiudi.com/'}});
const jj=await rr.json();
const d=jj?.data?.match ?? jj?.data ?? jj;
const scan=(o,path='',depth=0)=>{
  if(depth>4||!o||typeof o!=='object') return;
  for(const k of Object.keys(o)){
    const v=o[k];
    if(v===null||v===undefined) continue;
    const sig=Array.isArray(v)?('arr'+v.length):(typeof v==='object'?'obj':String(v).slice(0,30));
    if(/lineup|starting|squad|player|injur|formation|absence|xi/i.test(k)) console.log(`  ${path}.${k} = ${sig}`);
    if(typeof v==='object'&&depth<3) scan(v,path+'.'+k,depth+1);
  }
};
scan(d,'d');
console.log('--- matchLiving keys:',Object.keys(d?.matchLiving||{}).join(','));
console.log('--- matchSample keys:',Object.keys(d?.matchSample||{}).join(','));
console.log('--- matchJijin keys:',Object.keys(d?.matchJijin||{}).join(','));
