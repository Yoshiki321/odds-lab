import { pool } from '../../src/server/db/pool.js';
import { writeFileSync, readFileSync } from 'node:fs';
async function main() {
  const p = pool();
  const unmarked = await p.query(`SELECT match_id, scan_round, total, band, dims->'value'->>'note' note FROM scores WHERE match_date='2026-09-12' AND scan_round>1 AND dims->'value'->>'note' NOT LIKE '旧轮帧%' ORDER BY scan_round, match_id`);
  console.log('未标记 round>1 帧:', unmarked.rows.length);
  const file = 'C:/zwkj/竞彩助手/data/backup/scores-polluted-0912.json';
  const prev = JSON.parse(readFileSync(file, 'utf8'));
  prev.extra = (prev.extra ?? []).concat(unmarked.rows);
  writeFileSync(file, JSON.stringify(prev, null, 2));
  console.log('备份已追加 extra:', unmarked.rows.length, '->', file);
  const upd = await p.query(
    `UPDATE scores SET dims = jsonb_set(dims, '{value,note}', '"旧轮帧:让球EV符号污染已废弃(2026-09-12修复)"'::jsonb)
     WHERE match_date='2026-09-12' AND scan_round>1 AND dims->'value'->>'note' NOT LIKE '旧轮帧%'`);
  console.log('本次标记废弃:', upd.rowCount);
  const left = await p.query(`SELECT count(*) n FROM scores WHERE match_date='2026-09-12' AND scan_round>1 AND dims->'value'->>'note' NOT LIKE '旧轮帧%'`);
  console.log('残留未标记:', left.rows[0].n);
  await p.end();
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
