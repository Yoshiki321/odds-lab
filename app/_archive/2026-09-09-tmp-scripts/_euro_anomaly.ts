/** 诊断：09-09 最终评分 note "无欧赔可比" vs europe_odds 快照存在 —— 读哪个 scan_round 丢的 */
import { pool } from '../../src/server/db/pool.js';

(async () => {
  const p = pool();
  const m = await p.query("SELECT match_id, num, home, away FROM matches WHERE match_date='2026-09-09' ORDER BY num");
  for (const r of m.rows) {
    const s = await p.query(
      `SELECT scan_round, to_char(analyzed_at,'MM-DD HH24:MI') t, value, dims->'value'->>'note' note FROM scores WHERE match_id=$1 ORDER BY scan_round DESC, analyzed_at DESC LIMIT 3`, [r.match_id]);
    const e = await p.query(
      `SELECT to_char(observed_at,'MM-DD HH24:MI') t, home_odds, draw_odds, away_odds FROM europe_odds WHERE match_id=$1`, [r.match_id]);
    const eh = await p.query(`SELECT count(*) c FROM europe_odds_history WHERE match_id=$1`, [r.match_id]);
    const eu = e.rows[0];
    console.log(
      r.num.padEnd(7), `${r.home}-${r.away}`.padEnd(16),
      '| euro:', eu ? `${eu.t} ${eu.home_odds}/${eu.draw_odds}/${eu.away_odds}` : 'NONE'.padEnd(15),
      '| hist', eh.rows[0].c,
      '| rounds:');
    for (const x of s.rows) console.log('    r'+x.scan_round, x.t, 'value='+x.value, 'note=['+(x.note||'')+']');
  }
  await p.end();
})().catch(e => { console.error(e); process.exit(1); });
