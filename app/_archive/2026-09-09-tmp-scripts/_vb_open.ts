import { query, pool } from '../../src/server/db/pool.js';
const r = await query(
  `SELECT vb.id, vb.match_num, vb.home, vb.away, vb.pick, vb.odds, vb.status, vb.my_view,
          to_char(vb.kickoff AT TIME ZONE 'Asia/Shanghai', 'MM-DD HH24:MI') ko, vb.review_hook
     FROM virtual_bets vb
    WHERE vb.status = 'open'
    ORDER BY vb.kickoff NULLS LAST, vb.id`);
console.log('在途虚拟注:', r.rows.length);
for (const x of r.rows) {
  console.log(`  ${x.id} ${x.match_num} ${x.home} vs ${x.away} [${x.ko}] pick=${x.pick}@${x.odds} view="${String(x.my_view || '').slice(0, 40)}" hook="${String(x.review_hook || '').slice(0, 40)}"`);
}
await pool().end();