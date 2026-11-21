import { query } from '../src/server/db/pool.js';
async function run() {
  const t = await query(`SELECT to_regclass('public.bankroll')`);
  if (t.rows[0].to_regclass) {
    const b = await query(`SELECT * FROM bankroll ORDER BY updated_at DESC LIMIT 3`);
    console.table(b.rows.map(r => ({ ...r, updated_at: r.updated_at?.toISOString?.() })));
  } else console.log('no bankroll table');
  const bets = await query(`SELECT bet_id, stake, total_odds, status, return_amount, profit, placed_at, settled_at FROM bets ORDER BY placed_at DESC LIMIT 8`);
  console.table(bets.rows.map(r => ({ ...r, placed_at: r.placed_at?.toISOString?.() })));
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
