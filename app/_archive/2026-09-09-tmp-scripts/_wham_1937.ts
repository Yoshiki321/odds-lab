import { pool } from '../../src/server/db/pool.js';
(async () => {
  const p = pool();
  const s = await p.query(`
    SELECT total, band, dir, pred, odds, drop_amt, confirm, model, history, risk, value, dims, analysis
    FROM scores WHERE match_id = '2041395' ORDER BY analyzed_at DESC LIMIT 1`);
  console.log('score:', JSON.stringify(s.rows[0] ?? null));

  const e = await p.query(`
    SELECT had, score FROM results WHERE match_id = '2041395' LIMIT 3`);
  console.log('result:', JSON.stringify(e.rows[0] ?? null));

  const od = await p.query(`
    SELECT home_odds, draw_odds, away_odds, odds_type, source, observed_at FROM europe_odds_history
    WHERE match_id = '2041395' ORDER BY observed_at DESC LIMIT 1`);
  console.log('odds:', JSON.stringify(od.rows[0] ?? null));

  const w = await p.query(`
    SELECT jsonb_pretty(detail) AS w FROM score_snapshots s
    JOIN scores sc ON sc.match_id = s.match_id
    WHERE s.match_id = '2041395' ORDER BY s.snapshot_at DESC LIMIT 1`);
  if (w.rows[0]) console.log('dropped:', w.rows[0].w);
  await p.end();
})().catch(e => { console.error(e); process.exit(1); });