import { pool } from '../../src/server/db/pool.js';
import { writeFileSync, mkdirSync } from 'node:fs';
async function main() {
  const p = pool();
  const s = await p.query(`SELECT scan_round, count(*) n, min(dims->>'value') vmin FROM scores WHERE match_date='2026-09-12' AND scan_round>1 GROUP BY scan_round ORDER BY 1`);
  for (const r of s.rows) console.log(`r${r.scan_round}: ${r.n} 帧`);
  const all = await p.query(`SELECT id, match_id, scan_round, dir, market, pred, total, band, value, dims, analyzed_at FROM scores WHERE match_date='2026-09-12' AND scan_round>1 ORDER BY id`);
  mkdirSync('C:/zwkj/竞彩助手/data/backup', { recursive: true });
  const file = 'C:/zwkj/竞彩助手/data/backup/scores-polluted-0912.json';
  writeFileSync(file, JSON.stringify({ backed_at: new Date().toISOString(), n: all.rows.length, rows: all.rows }, null, 2));
  console.log(`备份 ${all.rows.length} 帧 -> data/backup/scores-polluted-0912.json`);

  // 非破坏修复：给污染帧 value note 打废弃标记（不删行）
  const upd = await p.query(
    `UPDATE scores SET dims = jsonb_set(dims, '{value,note}', '"旧轮帧:让球EV符号污染已废弃(2026-09-12修复)"'::jsonb)
     WHERE match_date='2026-09-12' AND scan_round>1 AND dims->'value'->>'note' LIKE '%@19:38%'`);
  console.log('已标记废弃帧:', upd.rowCount);
  const bad = await p.query(`SELECT count(*) n FROM scores WHERE match_date='2026-09-12' AND scan_round>1 AND dims->'value'->>'note' LIKE '%@19:38%'`);
  console.log('残留污染帧:', bad.rows[0].n);
  await p.end();
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
