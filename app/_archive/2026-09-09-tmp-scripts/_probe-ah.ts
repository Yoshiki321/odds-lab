const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
async function main(){
  const r=await fetch('https://www.dongqiudi.com/magicball/v1/list/match_list?language=zh-CN&cmp_type=soccer&tab_type=all',{headers:{'user-agent':UA,referer:'https://www.dongqiudi.com/'}});
  const j:any=await r.json(); const all=j?.data?.matches||[];
  for(const t of ['布鲁日','皇家马德里','波尔图','奈梅亨','雅典AEK','里尔']){
    const m=all.find((x:any)=>`${x.team_A?.name}${x.team_B?.name}`.includes(t) && !`${x.team_A?.name}${x.team_B?.name}`.includes('U19'));
    if(!m) continue;
    console.log(`${m.team_A?.name} vs ${m.team_B?.name}`);
    console.log('  spot[0](亚盘)=', JSON.stringify(m.score_odds?.spot?.[0]), ' origin[0]=', JSON.stringify(m.score_odds?.origin?.[0]));
    console.log('  spot[1](欧1x2)=', JSON.stringify(m.score_odds?.spot?.[1]));
  }
}
main();
