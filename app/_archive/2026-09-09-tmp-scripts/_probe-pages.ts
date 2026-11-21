const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const base = 'https://www.dongqiudi.com/magicball/v1/list/match_list?language=zh-CN&cmp_type=soccer&tab_type=all';
async function main() {
  // 1. 看响应整体结构（找分页字段）
  const r = await fetch(base, { headers: { 'user-agent': UA, referer: 'https://www.dongqiudi.com/' } });
  const j = await r.json();
  const d = j.data || {};
  console.log('keys:', Object.keys(j).join(','), '| data keys:', Object.keys(d).join(','));
  for (const k of Object.keys(d)) {
    if (k !== 'matches' && typeof d[k] !== 'object') console.log(`  data.${k}=`, JSON.stringify(d[k]));
  }
  const all = d.matches || [];
  // 2. 搜 09-09 UCL 场次是否在任何 status 出现
  const targets = ['巴萨', '费耶诺德', '那不勒斯', '阿森纳', '利物浦', '马竞', '切尔西', '利兹', '斯图加特', '维京', '里斯本', '加拉塔萨', '巴黎'];
  for (const m of all) {
    const nm = `${m.team_A?.name} ${m.team_B?.name}`;
    if (targets.some(t => nm.includes(t))) {
      console.log(`命中: ${nm} | status=${m.status} | ts=${m.match_timestamp} ${new Date(m.match_timestamp*1000).toISOString()} | so=${JSON.stringify(m.score_odds?.spot?.[1])} hdp=${JSON.stringify(m.hdp_odds?.spot?.[0])}`);
    }
  }
}
main();