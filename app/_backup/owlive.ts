// owlive.ts - 完整查 2041302 行 + 数据库时钟
import { query } from '../src/server/db/pool.js';
async function run() {
  const now = await query(`SELECT now() t, (now() AT TIME ZONE 'UTC+8') bj`);
  console.log('数据库时钟 now()=', now.rows[0].t.toISOString(), '北京=', now.rows[0].bj.toISOString());
  const r = await query(`SELECT * FROM live_scores WHERE match_id='2041302'`);
  console.log(JSON.stringify(r.rows[0], (k, v) => v instanceof Date ? v.toISOString() : v, 1));
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });