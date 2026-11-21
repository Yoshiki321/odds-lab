// one-live.ts - 单查 2041302 的 live_scores 行与更新时刻
import { query } from '../src/server/db/pool.js';
async function run() {
  const r = await query(`SELECT match_id, score, ht, status, status_name, source,
    to_char(fetched_at AT TIME ZONE 'UTC+8','HH24:MI:SS') fetched
    FROM live_scores WHERE match_id='2041302'`);
  console.log(JSON.stringify(r.rows[0], null, 1));
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });