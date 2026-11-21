import { query, pool } from '../../src/server/db/pool.js';
(async () => {
  const r = await query(
    `SELECT num, match_id, home, away,
            to_char(kickoff AT TIME ZONE 'Asia/Shanghai','MM-DD HH24:MI') AS ko
       FROM matches WHERE match_date='2026-09-11' ORDER BY num`);
  for (const x of r.rows) console.log(x.num, x.match_id, x.home + '-' + x.away, x.ko);
  await pool().end();
})().catch(e => { console.error(e.message); process.exit(1); });
