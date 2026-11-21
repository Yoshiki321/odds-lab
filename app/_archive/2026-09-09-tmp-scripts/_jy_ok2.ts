import { query, pool } from '../../src/server/db/pool.js';
const r = await query(`SELECT m.num, m.home, m.away, res.score, res.had, res.hhad FROM results res JOIN matches m USING(match_id) WHERE m.match_id='2041356'`);
console.log('江原官方:', JSON.stringify(r.rows));
const snap = await query(`SELECT to_char(snapshot_at AT TIME ZONE 'Asia/Shanghai','HH24:MI') t, slot, total, band, dir, pred, value_ev FROM score_snapshots WHERE match_id='2041356' ORDER BY snapshot_at`);
console.log('快照序列:');
for (const s of snap.rows) console.log(`  ${s.t} ${s.slot} total=${s.total} ${s.band} dir=${s.dir} pred=${s.pred} EV=${s.value_ev}`);
await pool().end();
