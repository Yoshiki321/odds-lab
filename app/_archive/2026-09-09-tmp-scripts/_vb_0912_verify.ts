import { pool } from '../../src/server/db/pool.js';
(async () => {
  const p = pool();
  const r = await p.query(`SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE status='open') AS open FROM virtual_bets WHERE id >= 'vb-153' AND id <= 'vb-164'`);
  console.log(JSON.stringify(r.rows[0]));
  // also confirm yesterday's 11 settled
  const s = await p.query(`SELECT status, COUNT(*) FROM virtual_bets WHERE id >= 'vb-141' AND id <= 'vb-152' GROUP BY status ORDER BY status`);
  console.log(JSON.stringify(s.rows));
  await p.end();
})().catch(e => { console.error(e); process.exit(1); });
