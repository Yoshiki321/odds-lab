const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const url = 'https://www.dongqiudi.com/magicball/v1/list/match_list?language=zh-CN&cmp_type=soccer&tab_type=all';
const r = await fetch(url, { headers: { 'user-agent': UA, referer: 'https://www.dongqiudi.com/' } });
const j = await r.json();
const matches = j?.data?.matches || [];
let withEu = 0;
for (const m of matches) {
  const sp = m.score_odds?.spot?.[1];
  const or = m.score_odds?.origin?.[1];
  if (sp) {
    withEu++;
    if (withEu <= 5) {
      console.log(`${m.team_A?.name} vs ${m.team_B?.name} | status=${m.status} | ts=${m.match_timestamp} ${new Date(m.match_timestamp*1000).toISOString()}`);
      console.log('  spot[1]=', JSON.stringify(sp), ' origin[1]=', JSON.stringify(or));
    }
  }
}
console.log('欧赔场次:', withEu, '/', matches.length);