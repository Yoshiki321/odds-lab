import { query } from '../../src/server/db/pool.js';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
function normName(s: unknown): string {
  return String(s ?? '').replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/\s+/g, '').replace(/[A-Z]/g, c => c.toLowerCase());
}
function namesOverlap(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  return a.length >= 4 && b.length >= 4 && (a.includes(b.slice(0, 2)) && b.includes(a.slice(0, 2)));
}
async function main() {
  const now = Date.now();
  const r = await query(`SELECT match_id, kickoff, home, away, num FROM matches WHERE kickoff BETWEEN to_timestamp($1/1000.0) - interval '36 hours' AND to_timestamp($1/1000.0) + interval '60 hours'`, [now]);
  const up = r.rows.map((x: any) => ({ matchId: String(x.match_id), kickoffMs: new Date(x.kickoff).getTime(), home: normName(x.home), away: normName(x.away), label: `${x.num} ${x.home} vs ${x.away}` }));
  const j: any = await (await fetch('https://www.dongqiudi.com/magicball/v1/list/match_list?language=zh-CN&cmp_type=soccer&tab_type=all', { headers: { 'user-agent': UA, referer: 'https://www.dongqiudi.com/' } })).json();
  const mb = (j?.data?.matches || []) as any[];
  // 定位 皇马 magicball 行
  const m = mb.find((x: any) => `${x.team_A?.name}${x.team_B?.name}`.includes('皇家马德里') && !`${x.team_A?.name}${x.team_B?.name}`.includes('U19'))!;
  const tsMs = Number(m.match_timestamp) * 1000;
  const k = Math.floor(tsMs / (90 * 60000));
  const cand = up.filter(u => Math.floor(u.kickoffMs / (90 * 60000)) === k && Math.abs(u.kickoffMs - tsMs) <= 45 * 60000);
  console.log('皇马 magicball:', `${m.team_A?.name} vs ${m.team_B?.name}`, new Date(tsMs).toISOString());
  console.log('时间窗候选:', cand.map((u: any) => `${u.label} [${u.home} vs ${u.away}] kickoff ${new Date(u.kickoffMs).toISOString()}`));
  const homeN = normName(m.team_A?.name), awayN = normName(m.team_B?.name);
  console.log('归一:', homeN, awayN);
  for (const u of cand as any[]) {
    console.log(`  vs ${u.label}: 主${namesOverlap(u.home, homeN)} 客${namesOverlap(u.away, awayN)}`);
  }
  await (await import('../../src/server/db/pool.js')).pool().end();
}
main();
