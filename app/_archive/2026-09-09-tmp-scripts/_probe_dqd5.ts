const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
async function probe(){
  const url='https://www.dongqiudi.com/magicball/v1/list/match_list?language=zh-CN&cmp_type=soccer&tab_type=all';
  const r=await fetch(url,{headers:{'user-agent':UA,referer:'https://www.dongqiudi.com/'}});
  const j=await r.json();
  const mb=(j?.data?.matches||[]).filter(m=>m.match_id==='2041360'||m.id==='2041360'||String(m.match_timestamp).length>0).slice(0,60);
  // find 特温特
  const tw=mb.find(m=>/特温特|特文特|Twente/i.test((m.team_A?.name||'')+(m.team_B?.name||'')));
  if(tw){ console.log('FOUND 特温特 match, score_odds:', JSON.stringify(tw.score_odds).slice(0,600)); }
  else { console.log('not in list; sample score_odds:', JSON.stringify(mb[0]?.score_odds).slice(0,400)); }
}
probe().catch(e=>console.error('ERR',e?.message));
