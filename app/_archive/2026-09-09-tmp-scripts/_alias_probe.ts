import { query, pool } from '../../src/server/db/pool.js';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const URL = 'https://www.dongqiudi.com/magicball/v1/list/match_list?language=zh-CN&cmp_type=soccer&tab_type=all';
(async () => {
  const p = pool();
  // 盘上 09-10/09-11 场次 + 是否有欧赔
  const r = await p.query(
    `SELECT m.match_id, m.num, m.league, m.home, m.away, m.kickoff,
            to_char(m.kickoff,'MM-DD HH24:MI') ko,
            (SELECT count(*) FROM europe_odds e WHERE e.match_id=m.match_id)::int has_e
       FROM matches m
      WHERE m.match_date IN ('2026-09-10','2026-09-11')
      ORDER BY m.kickoff`);
  const miss = r.rows.filter(x => !x.has_e);
  console.log(`盘上次 ${r.rows.length}，缺欧赔 ${miss.length}：`);
  const got = r.rows.filter(x => x.has_e);
  if (got.length) console.log('已有欧赔 例:', got.slice(0, 3).map(x => `${x.num} ${x.home}-${x.away}`).join(' / '));
  // 拉 magicball 列表（与 fetch-europe-odds 相同的 UA+referer）
  const res = await fetch(URL, { headers: { 'user-agent': UA, referer: 'https://www.dongqiudi.com/' } });
  const j: any = await res.json();
  const mb = (j?.data?.matches || []) as any[];
  console.log('magicball 返回', mb.length, '场');
  for (const x of miss) {
    const koMs = new Date(x.kickoff).getTime();
    const hits = mb
      .map(m => ({ name: `${m.team_A?.name} vs ${m.team_B?.name}`, ts: Number(m.match_timestamp) * 1000, hasEU: !!m.score_odds?.spot?.[1] }))
      .filter(m => Number.isFinite(m.ts) && Math.abs(m.ts - koMs) <= 45 * 60_000);
    console.log(`${x.num} ${x.home}-${x.away} (${x.ko}) -> 候选: [${hits.map(h => `${h.name}${h.hasEU ? '' : '(无欧赔)'}`).join('] | [')}]`);
  }
  await p.end();
})().catch(e => { console.error(e.message); process.exit(1); });