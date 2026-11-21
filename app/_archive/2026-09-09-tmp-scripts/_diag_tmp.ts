// _diag_tmp.ts — 临时诊断（事后删除）
import { query } from '../src/server/db/pool.js';
async function run() {
  const oh = await query(`SELECT count(*) c FROM odds_history WHERE match_id IN (SELECT match_id FROM matches WHERE match_date='2026-09-08')`);
  console.log('odds_history 09-08:', oh.rows[0].c);
  const res = await query(`SELECT count(*) c FROM results WHERE match_id IN (SELECT match_id FROM matches WHERE match_date='2026-09-08')`);
  console.log('results 09-08:', res.rows[0].c);
  const sc = await query(`SELECT scan_round, count(*) c FROM scores GROUP BY scan_round ORDER BY scan_round`);
  console.log('scores by scan_round:', sc.rows);
  const rnd = await query(`SELECT match_id, scan_round, count(*) FROM scores GROUP BY match_id, scan_round HAVING count(*) > 1`);
  console.log('dup scores:', rnd.rows);
  const m = await query(`SELECT num, league, home, away, had->>'d' draw, hhad->>'goalLine' gl, hhad->>'h' gh, hhad->>'a' ga FROM matches WHERE match_date='2026-09-08' ORDER BY num`);
  for (const r of m.rows) console.log(r.num, (r.league || '').padEnd(5), (r.home + '-' + r.away).padEnd(16), 'd=' + r.draw, 'gl=' + r.gl, 'gh=' + r.gh, 'ga=' + r.ga);
  const vb = await query(`SELECT id, match_num, league, home, away, pick, odds, status FROM virtual_bets ORDER BY id DESC LIMIT 15`);
  console.log('recent virtual:');
  for (const r of vb.rows) console.log(' ', r.id, r.match_num, r.home + '-' + r.away, r.pick, r.odds, r.status);
  const bets = await query(`SELECT bet_id, type, stake, status, legs FROM bets ORDER BY bet_id DESC LIMIT 8`);
  console.log('recent bets:');
  for (const r of bets.rows) console.log(' ', r.bet_id, r.type, 'stake=' + r.stake, r.status, JSON.stringify(r.legs).slice(0, 200));
  process.exit(0);
}
run().catch(e => { console.error('diag:', e.message); process.exit(1); });