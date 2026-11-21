import { pool } from '../../src/server/db/pool.js';
async function main() {
  const p = pool({ max: 1, connectionTimeoutMillis: 5000 });
  try {
    const r = await p.query('SELECT count(*) FROM pg_stat_activity');
    console.log('PG 可达。活动连接数:', r.rows[0].count);
    const idle = await p.query(`SELECT state, count(*) FROM pg_stat_activity GROUP BY state`);
    for (const x of idle.rows) console.log(`  ${x.state}: ${x.count}`);
  } catch (e: any) {
    console.error('PG 不可达:', e.message);
  } finally { await p.end(); }
}
main();
