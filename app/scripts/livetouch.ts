// livetouch.ts - 查看 live_scores 最近更新时间戳，判断 poller 是否存活
import { query } from '../src/server/db/pool.js';
async function run() {
  const r = await query(`
    SELECT to_char(max(fetched_at) AT TIME ZONE 'UTC+8','MM-DD HH24:MI:SS') latest,
           count(*) FILTER (WHERE fetched_at > now() - interval '5 minutes') recent5,
           count(*) total
    FROM live_scores`);
  console.log(JSON.stringify(r.rows[0]));
  const per = await query(`
    SELECT source, to_char(max(fetched_at) AT TIME ZONE 'UTC+8','HH24:MI:SS') latest, count(*) n
    FROM live_scores GROUP BY source`);
  console.table(per.rows);
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });