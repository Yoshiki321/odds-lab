const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
async function main(){
  const r=await fetch('https://www.dongqiudi.com/magicball/v1/list/match_list?language=zh-CN&cmp_type=soccer&tab_type=all',{headers:{'user-agent':UA,referer:'https://www.dongqiudi.com/'}});
  const j:any=await r.json(); const all=j?.data?.matches||[];
  for(const t of ['皇家马德里','皇马','国米','国际米兰','胡拜尔','胡巴卡德','吉达国民']){
    const hit=all.filter((m:any)=>`${m.team_A?.name}${m.team_B?.name}`.includes(t));
    for(const m of hit) console.log(`${t}: ${m.team_A?.name} vs ${m.team_B?.name} | ${m.status} | ${new Date(m.match_timestamp*1000).toISOString()}`);
  }
}
main();
