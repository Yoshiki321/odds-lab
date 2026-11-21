const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
async function main(){
  const r=await fetch('https://www.dongqiudi.com/magicball/v1/list/match_list?language=zh-CN&cmp_type=soccer&tab_type=all',{headers:{'user-agent':UA,referer:'https://www.dongqiudi.com/'}});
  const j:any=await r.json(); const all=j?.data?.matches||[];
  const m=all.find((x:any)=>`${x.team_A?.name}${x.team_B?.name}`.includes('皇家马德里') && x.status==='Played' && !`${x.team_A?.name}${x.team_B?.name}`.includes('U19'));
  console.log('皇马:', m? `${m.team_A?.name} vs ${m.team_B?.name} so=${JSON.stringify(m.score_odds?.spot?.[1])} ts=${m.match_timestamp}` : '不在列表');
  const db=await import('../../src/server/db/pool.js');
  const q=await db.query(`SELECT match_id, num, home, away, kickoff FROM matches WHERE home LIKE '%皇马%' OR away LIKE '%国米%' OR home LIKE '%皇家马德里%' OR away LIKE '%国际米兰%'`);
  console.log(q.rows);
  await db.pool().end();
}
main();
