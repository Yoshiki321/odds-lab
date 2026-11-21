import { pool } from '../../src/server/db/pool.js';
async function main() {
  const db = pool();
  const r = await db.query("select league, n, draw_rate, home_rate, away_rate, window_days, updated_at from base_rates order by n desc limit 10");
  for (const x of r.rows) console.log(`${x.league}: n=${x.n} 主=${x.home_rate} 平=${x.draw_rate} 客=${x.away_rate} (${x.updated_at})`);
  const bad = await db.query("select league, n from base_rates where n <= 3 order by n asc limit 15");
  console.log('样本不足联赛:', bad.rows.map(r => `${r.league}(${r.n})`).join(' '));
  await db.end();
}
main().catch(e => { console.error(e); process.exit(1); });