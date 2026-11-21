import { query, pool } from '../../src/server/db/pool.js';
async function main(){
  const now = new Date();
  const r = await query(`SELECT m.num, m.home, m.away, m.kickoff, m.match_id FROM matches m WHERE m.match_date='2026-09-09' AND m.kickoff > now() AND m.kickoff <= now() + interval '8 hours' ORDER BY m.kickoff`);
  console.log('今日剩余场次中 8h 窗口内 (' + now.toLocaleString('zh-CN',{hour12:false}) + '):');
  for (const x of r.rows) console.log(x.num, x.home+'-'+x.away, 'kickoff=', String(x.kickoff));
  await pool().end();
}
main();
