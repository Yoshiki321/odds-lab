import pg from 'pg';
import { loadDbConfig } from '../../src/server/db/pool.js';
const cfg = loadDbConfig();
const c = new pg.Client({ ...cfg, connectionTimeoutMillis: 30000 });
const t0 = Date.now();
try {
  await c.connect();
  console.log(`PG 连接成功 ${Date.now()-t0}ms`);
  const r = await c.query('SELECT count(*) AS n FROM pg_stat_activity WHERE state IS NOT NULL');
  console.log('活动后端连接数:', r.rows[0].n);
  const u = await c.query(`SELECT datname, state, count(*) FROM pg_stat_activity WHERE state IS NOT NULL GROUP BY datname, state ORDER BY 3 DESC LIMIT 8`);
  for (const x of u.rows) console.log(`  ${x.datname}/${x.state}: ${x.count}`);
  await c.end();
  process.exit(0);
} catch (e: any) { console.error('PG 仍不可达:', e.message); process.exit(1); }
