const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const r=await fetch('https://www.dongqiudi.com/magicball/v1/list/match_list?language=zh-CN&cmp_type=soccer&tab_type=all',{headers:{'user-agent':UA,referer:'https://www.dongqiudi.com/'}});
const j=await r.json();
const matches=(j?.data?.matches||[]);
const names=matches.map(m=>(m.team_A?.name||'')+' vs '+(m.team_B?.name||''));
console.log('total today dqd:',matches.length);
console.log(names.slice(0,12).join(' | '));
const tw=matches.filter(m=>/特温特|那不勒斯/.test((m.team_A?.name||'')+(m.team_B?.name||'')));
console.log('targets:',tw.length);
for(const m of tw){
  const id=m.match_id;
  const rr=await fetch(`https://www.dongqiudi.com/magicball/v1/match/app/detail?id=${id}&app=dqd&lang=zh-cn`,{headers:{'user-agent':UA,referer:'https://www.dongqiudi.com/'}});
  const jj=await rr.json();
  const d=jj?.data?.match ?? jj?.data ?? jj;
  const mf=d?.matchFormation;
  console.log('\n',m.team_A?.name,'vs',m.team_B?.name,'status',m.match_status);
  if(mf){ console.log('MF keys:',Object.keys(mf).join(',')); console.log(JSON.stringify(mf,null,1).slice(0,1800)); }
  else console.log('matchFormation null');
}
