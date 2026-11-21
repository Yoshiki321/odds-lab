import { pool } from '../../src/server/db/pool.js';
// 东京绿茵 001 方向随时间轴（每个 scan_round 帧）
const r = await pool().query(`
  SELECT s.scan_round, s.analyzed_at, s.dir, s.market, s.pred, s.odds, s.total, s.band, s.dims
  FROM scores s WHERE s.match_id='2041435' ORDER BY s.scan_round`);
for (const x of r.rows) {
  const v = x.dims?.value && typeof x.dims.value === 'object' ? ` ${x.dims.value.score}${x.dims.value.note ? ` ${x.dims.value.note}` : ''}` : '';
  console.log(`r${x.scan_round} ${String(x.analyzed_at).slice(11, 16)} dir=${x.dir.padEnd(6)} ${x.pred ? x.pred + '@' : ''}${x.odds} total=${x.total} ${x.band}${v}`);
}
await pool().end();