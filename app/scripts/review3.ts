// review3.ts - 六维明细 vs 命中
import { query } from '../src/server/db/pool.js';
async function run() {
  const r = await query(`
    SELECT m.num, m.home, m.away, sc.total, sc.pred, sc.market, sc.dims, sc.drop_amt, sc.drop_note,
           res.score, res.had, res.hhad,
           CASE WHEN sc.market='HAD' THEN (sc.pred=res.had) WHEN sc.market='HHAD' THEN (sc.pred=res.hhad) END hit
    FROM scores sc JOIN matches m ON m.match_id=sc.match_id
    LEFT JOIN results res ON res.match_id=sc.match_id
    WHERE sc.match_date='2026-09-06' AND sc.scan_round=1 AND sc.total>=40
    ORDER BY sc.total DESC`);
  const rows: any[] = r.rows;
  // 六维各维度命中率 x <-- 先看 drop 分配
  const categories: Record<string, { hit: number; miss: number }> = {};
  for (const x of rows) {
    const dims = x.dims || {};
    for (const k of ['drop', 'risk', 'model', 'value', 'confirm', 'history']) {
      const sc = dims[k]?.score || 0;
      const top = k === 'drop' ? sc >= 1 : k === 'model' ? sc >= 4 : k === 'confirm' ? sc >= 4 : k === 'risk' ? sc >= 6 : k === 'value' ? sc >= 3 : sc >= 4;
      const key = `${k}${top ? ' 高' : ' 低'}`;
      const c = (categories[key] = categories[key] || { hit: 0, miss: 0 });
      if (x.hit === true) c.hit++; else if (x.hit === false) c.miss++;
    }
  }
  console.log('六维 高/低 → 命中率:');
  for (const [k, v] of Object.entries(categories)) {
    console.log(' ', k.padEnd(8), `${v.hit}/${v.hit + v.miss} = ${Math.round((v.hit / (v.hit + v.miss)) * 100)}%`);
  }
  console.log('\n各场（≥40分）drop/confirm/model:');
  for (const x of rows) {
    const dims = x.dims || {};
    console.log((x.hit === true ? '✅' : '❌'), x.num, (x.home+'v'+x.away).padEnd(15), String(x.total)+'分',
      'drop', dims.drop?.score, 'risk', dims.risk?.score, 'model', dims.model?.score, 'conf', dims.confirm?.score, '范文',
      String(x.drop_note||'').padEnd(8), '|', x.score, x.had ?? '');
  }
  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });