import { query, pool } from '../../src/server/db/pool.js';
const r = await query(`SELECT m.num, m.home, m.away, res.score, res.had, res.hhad FROM results res JOIN matches m USING(match_id) WHERE res.fetched_at > now() - interval '1 hour'`);
for (const x of r.rows) console.log(`${x.num} ${x.home} ${x.score} ${x.away} 竞彩HAD=${x.had} 让球=${x.hhad}`);
const snap = await query(`SELECT slot, total, band, dir, pred FROM score_snapshots WHERE match_id='2041356' ORDER BY snapshot_at`);
console.log('江原快照序列:');
for (const s of snap.rows) console.log(`  ${s.slot} total=${s.total} ${s.band} dir=${s.dir} pred=${s.pred}`);
await pool().end();
