/* _check_pg.cjs — 扫描计划 + 重跑轨迹 */
const { Pool } = require('pg');
const cfg = require('../config/db.json');
const p = new Pool(cfg);
(async () => {
  const pl = await p.query(`SELECT id, to_char(scan_at,'MM-DD HH24:MI') at, labels, status,
    to_char(created_at,'MM-DD HH24:MI') c, to_char(ran_at,'MM-DD HH24:MI') ran
    FROM scan_plans WHERE match_date='2026-09-08' ORDER BY scan_at`);
  console.log('== 扫描计划 ==');
  for (const r of pl.rows) console.log(JSON.stringify(r));
  const cg = await p.query(`SELECT to_char(at,'MM-DD HH24:MI:SS') at, scope, ref
    FROM change_log ORDER BY id DESC LIMIT 12`);
  console.log('== 最近 change_log ==');
  for (const r of cg.rows) console.log(JSON.stringify(r));
  const oh = await p.query(`SELECT to_char(observed_at,'MM-DD HH24:MI') at, market, side, odds
    FROM odds_history WHERE match_id='2041345' ORDER BY observed_at, market LIMIT 60`);
  console.log('== 2041345 赔率轨迹 ==');
  for (const r of oh.rows) console.log(JSON.stringify(r));
  await p.end();
})().catch(e => console.error('[check]', e.message));