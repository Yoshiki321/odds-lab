import { query } from '../../src/server/db/pool.js';
import { parseEuro } from '../../tools/fetch-europe-odds.js';
console.log('parseEuro("1.57,4.5,5.25")=', JSON.stringify(parseEuro('1.57,4.5,5.25')));
async function main() {
  const now = Date.now();
  const r = await query(`SELECT match_id, kickoff, home, away, num, match_date FROM matches WHERE kickoff BETWEEN to_timestamp($1/1000.0) - interval '36 hours' AND to_timestamp($1/1000.0) + interval '60 hours'`, [now]);
  const up = r.rows;
  console.log('候选数', up.length);
  const rows = up.filter((x: any) => x.num === '周二008');
  console.log('皇马候选:', JSON.stringify(rows));
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
  const j: any = await (await fetch('https://www.dongqiudi.com/magicball/v1/list/match_list?language=zh-CN&cmp_type=soccer&tab_type=all', { headers: { 'user-agent': UA, referer: 'https://www.dongqiudi.com/' } })).json();
  const all = j?.data?.matches || [];
  const m = all.find((x: any) => `${x.team_A?.name}${x.team_B?.name}`.includes('皇家马德里') && !`${x.team_A?.name}${x.team_B?.name}`.includes('U19'));
  console.log('magicball 皇马 ts=', m.match_timestamp, new Date(m.match_timestamp * 1000).toISOString());
  const k = Math.floor(new Date(rows[0].kickoff).getTime() / (90 * 60000));
  const tsMs = Number(m.match_timestamp) * 1000;
  const mk = Math.floor(tsMs / (90 * 60000));
  console.log('bucket PG:', k, 'MB:', mk, 'diff-min:', Math.abs(new Date(rows[0].kickoff).getTime() - tsMs) / 60000);
  await (await import('../../src/server/db/pool.js')).pool().end();
}
main();
