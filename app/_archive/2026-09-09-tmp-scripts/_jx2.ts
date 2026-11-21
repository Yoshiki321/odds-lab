const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const r=await fetch('https://www.dongqiudi.com/magicball/v1/list/match_list?language=zh-CN&cmp_type=soccer&tab_type=all',{headers:{'user-agent':UA,referer:'https://www.dongqiudi.com/'}});
const j=await r.json();
const m=(j?.data?.matches||[]).filter(m=>/江原/.test((m.team_A?.name||'')+(m.team_B?.name||'')))[0];
console.log('full:', JSON.stringify(m).slice(0,700));
