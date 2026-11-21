const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
// 1) match_list 里找 江原FC 比赛拿 dqd id
const r=await fetch('https://www.dongqiudi.com/magicball/v1/list/match_list?language=zh-CN&cmp_type=soccer&tab_type=all',{headers:{'user-agent':UA,referer:'https://www.dongqiudi.com/'}});
const j=await r.json();
const ms=(j?.data?.matches||[]).filter(m=>/江原|全北/.test((m.team_A?.name||'')+(m.team_B?.name||'')));
console.log('found dqd matches:',ms.length);
for(const m of ms) console.log('  sid',m.stage_id,'mid',m.match_id,'ts',new Date(Number(m.match_timestamp)*1000+8*3600_000).toISOString().slice(11,16),m.team_A?.name,'vs',m.team_B?.name,'score_odds?',JSON.stringify(m.score_odds).length);
if(ms.length){
  const id=ms[0].match_id;
  const url=`https://www.dongqiudi.com/magicball/v1/match/app/detail?id=${id}&app=dqd&lang=zh-cn`;
  const rr=await fetch(url,{headers:{'user-agent':UA,referer:'https://www.dongqiudi.com/'}});
  const jj=await rr.json();
  const d=jj?.data?.match ?? jj?.data ?? jj;
  console.log('detail keys:',Object.keys(d||{}).join(','));
  const mf=d?.matchFormation;
  console.log('matchFormation type:',Array.isArray(mf)?'arr'+mf.length:typeof mf);
  if(mf) console.log('MF:',JSON.stringify(mf).slice(0,1500));
}
