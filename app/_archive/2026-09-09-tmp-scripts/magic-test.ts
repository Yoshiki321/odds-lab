const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const url = 'https://www.dongqiudi.com/magicball/v1/list/match_list?language=zh-CN&cmp_type=soccer&tab_type=all';
const r = await fetch(url, { headers: { 'user-agent': UA, referer: 'https://www.dongqiudi.com/' } });
const j = await r.json();
const matches = j?.data?.matches || [];
// 找一个当场次（Fixture/比赛中）且有欧赔的
const m = matches.find((x: any) => x.score_odds?.spot?.[1]) || matches[0];
console.log('status:', m.status, '联赛:', m.competition, '|', m.team_A?.name, 'vs', m.team_B?.name);
console.log('season:', m.season, 'count:', m.count, 'kind:', m.kind);
for (const k of ['score_odds', 'hdp_odds', 'total_odds']) {
  console.log(`${k}:`, JSON.stringify(m[k]));
}
console.log('match_timestamp:', new Date(m.match_timestamp * 1000).toISOString(), 'league_name:', m.league_name, 'round_name:', m.round_name);