const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
async function main(){
  const r=await fetch('https://www.dongqiudi.com/magicball/v1/list/match_list?language=zh-CN&cmp_type=soccer&tab_type=all',{headers:{'user-agent':UA,referer:'https://www.dongqiudi.com/'}});
  const j:any=await r.json(); const all=j?.data?.matches||[];
  console.log('总场次', all.length, '带欧赔', all.filter((m:any)=>m.score_odds?.spot?.[1]).length);
  const targets=['布鲁日','维拉','奈梅亨','皇马','国米','波尔图','曼城','多特','里尔','贝蒂斯','胡巴卡德','吉达国民','桑德兰','南安普敦','弗鲁米嫩','巴萨','那不勒斯','阿森纳','利物浦','马竞','切尔西','利兹','斯图加特','维京','里斯本','加拉塔萨','巴黎','费耶诺德','江原','全北'];
  for(const t of targets){
    const hit=all.filter((m:any)=>`${m.team_A?.name}${m.team_B?.name}`.includes(t));
    if(hit.length) for(const m of hit) console.log(`${t}: ${m.team_A?.name} vs ${m.team_B?.name} | ${m.status} | so=${m.score_odds?.spot?.[1]?'Y':'N'} | ${new Date(m.match_timestamp*1000).toISOString()}`);
  }
}
main();
