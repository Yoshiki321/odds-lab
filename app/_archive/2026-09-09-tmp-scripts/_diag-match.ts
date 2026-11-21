import { query } from '../../src/server/db/pool.js';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
async function main() {
  const db = await import('../../src/server/db/pool.js');
  const r = await query(`SELECT num, league, home, away, kickoff FROM matches WHERE match_date >= '2026-09-08' ORDER BY match_date, kickoff`);
  console.log('=== PG 场次 ===');
  for (const x of r.rows) console.log(`${x.num} ${String(x.league).padEnd(6)} ${x.home} vs ${x.away} @${new Date(x.kickoff).toISOString().slice(11, 16)}Z`);
  const res = await fetch('https://www.dongqiudi.com/magicball/v1/list/match_list?language=zh-CN&cmp_type=soccer&tab_type=all', { headers: { 'user-agent': UA, referer: 'https://www.dongqiudi.com/' } });
  const j: any = await res.json();
  const mb = (j?.data?.matches || []).filter((m: any) => m.score_odds?.spot?.[1] && m.status !== 'Played');
  console.log('=== magicball Fixture 带欧赔 ===');
  for (const m of mb) console.log(`${m.team_A?.name} vs ${m.team_B?.name} | ${new Date(m.match_timestamp * 1000).toISOString().slice(11, 16)}Z | ${m.league_name} | spot=${m.score_odds.spot[1]}`);
  await (await db.pool()).end();
}
main().catch(e => { console.error(e); process.exit(1); });