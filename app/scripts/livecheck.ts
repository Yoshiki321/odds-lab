// livecheck.ts - 检查 0906 晚场 live_scores 脏数据与 res 缺失
import { query } from '../src/server/db/pool.js';
async function run() {
  const live = await query(`
    SELECT m.num, m.home, m.away,
           to_char(m.kickoff AT TIME ZONE 'UTC+8','HH24:MI') ko,
           l.score, l.ht, l.status st, l.status_name stn,
           r.score rscore, r.fetched_at
    FROM matches m
    LEFT JOIN live_scores l ON l.match_id = m.match_id
    LEFT JOIN results r ON r.match_id = m.match_id
    WHERE to_char(m.match_date,'YYYY-MM-DD')='2026-09-06'
    ORDER BY m.num`);
  for (const r of live.rows) {
    console.log((r.num||'').padEnd(4), (r.home+'vs'+r.away).padEnd(18),
      r.ko, '| live', String(r.score), String(r.stn).padEnd(4),
      `| res ${r.rscore ?? '-'}`, r.fetched_at?.toISOString?.().slice(11,19) ?? '');
  }
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });