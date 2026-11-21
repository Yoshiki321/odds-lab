import { pool } from '../../src/server/db/pool.js';
(async () => {
  const p = pool();
  const r = await p.query(`
    SELECT r.match_id, m.home, m.away, r.score, r.had, r.hhad, r.fetched_at
    FROM results r JOIN matches m ON m.match_id = r.match_id
    WHERE r.fetched_at::date = CURRENT_DATE AND r.fetched_at >= now() - interval '90 minutes'
    ORDER BY r.fetched_at DESC LIMIT 10`);
  console.log(JSON.stringify(r.rows, null, 1));
  await p.end();
})().catch(e => { console.error(e); process.exit(1); });
