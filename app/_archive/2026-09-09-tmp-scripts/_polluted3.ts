import { pool } from '../../src/server/db/pool.js';
import { writeFileSync } from 'node:fs';
async function main() {
  const p = pool();
  // 当前 round>1 未标记的帧
  const unmarked = await p.query(`SELECT match_id, scan_round, total, band, dims->'value'->>'note' note FROM scores WHERE match_date='2026-09-12' AND scan_round>1 AND dims->'value'->>'note' NOT LIKE '旧轮帧%' ORDER BY scan_round, match_id`);
  console.log('未标记 round>1 帧:', unmarked.rows.length);
  for (const r of unmarked.rows) console.log(`  r${r.scan_round} ${r.match_id} ${r.total} ${r.band} ${r.note}`);
  if (!unmarked.rows.length) { console.log('无剩余污染帧'); await p.end(); return; }
  // 追加备份（避免覆盖已有备份）
  const prev = JSON.parse(require('node:fs').readFileSync('C:/zwkj/竞彩助手/data/backup/scores-polluted-0912.json', 'utf8'));
  prev.extra = prev.extra ?? [];
  for (const r of unmarked.rows) prev.extra.push(r);
  writeFileSync('C:/zwkj/竞彩助手/data/backup/scores-polluted-0912.json', JSON.stringify(prev, null, 2));
  // 全部 round>1 标废弃（非破坏）
  const upd = await p.query(
    `UPDATE scores SET dims = jsonb_set(dims, '{value,note}', '"旧轮帧:让球EV符号污染已废弃(2026-09-12修复)"'::jsonb)
     WHERE match_date='2026-09-12' AND scan_round>1 AND dims->'value'->>'note' NOT LIKE '旧轮帧%'`);
  console.log('本次标记:', upd.rowCount);
  const left = await p.query(`SELECT count(*) n FROM scores WHERE match_date='2026-09-12' AND scan_round>1 AND dims->'value'->>'note' NOT LIKE '旧轮帧%'`);
  console.log('残留未标记:', left.rows[0].n);
  await p.end();
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
