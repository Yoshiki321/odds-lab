import { pool } from '../../src/server/db/pool.js';
(async () => {
  const p = pool();
  const s = await p.query(`SELECT total, band, dir, odds, drop_amt, confirm, model, history, risk, value, dims, market, pred, analyzed_at
    FROM scores WHERE match_id='2041434' ORDER BY analyzed_at DESC LIMIT 1`);
  const r = s.rows[0];
  console.log('score:', JSON.stringify({ total: r.total, band: r.band, dir: r.dir, odds: r.odds, market: r.market, pred: r.pred, value: r.value, dims: r.dims }, null, 1));
  const o = await p.query(`SELECT home_odds, draw_odds, away_odds, observed_at FROM europe_odds WHERE match_id='2041434'`);
  console.log('europe:', JSON.stringify(o.rows[0] ?? null));
  const h = await p.query(`SELECT line, home_odds, away_odds, odds_type, observed_at FROM handicap_odds_history WHERE match_id='2041434' AND observed_at >= now() - interval '6 hours' ORDER BY observed_at DESC LIMIT 4`);
  console.log('ah:', JSON.stringify(h.rows));
  const m = await p.query(`SELECT kickoff FROM matches WHERE match_id='2041434'`);
  const ko = m.rows[0]?.kickoff;
  const hrs = ko ? (new Date(ko).getTime() - Date.now()) / 3600_000 : null;
  console.log('hoursToKO:', hrs ? hrs.toFixed(2) : null);
  await p.end();
})().catch(e => { console.error(e); process.exit(1); });
