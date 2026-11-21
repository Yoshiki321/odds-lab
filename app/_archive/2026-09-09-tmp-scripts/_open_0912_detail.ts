import { pool } from '../../src/server/db/pool.js';
(async () => {
  const p = pool();
  const ids = ['2041408', '2041434', '2041433'];
  for (const id of ids) {
    const s = await p.query(`
      SELECT total, band, dir, odds, drop_amt, confirm, model, history, risk, value, dims, analysis
      FROM scores WHERE match_id = $1 ORDER BY analyzed_at DESC LIMIT 1`, [id]);
    const r = s.rows[0];
    if (!r) { console.log(id, 'NO SCORE'); continue; }
    console.log('===', id, r.dir, r.total, r.band, '@' + r.odds);
    console.log('   dims:', JSON.stringify(r.dims));
    const o = await p.query(`
      SELECT home_odds, draw_odds, away_odds, odds_type, source, observed_at
      FROM europe_odds_history WHERE match_id = $1 AND home_odds IS NOT NULL
      ORDER BY observed_at DESC LIMIT 6`, [id]);
    console.log('   eu:', JSON.stringify(o.rows));
    // handicap history to check deep line distortion
    const h = await p.query(`
      SELECT line, home_odds, away_odds, odds_type, observed_at
      FROM handicap_odds_history WHERE match_id = $1
      ORDER BY observed_at DESC LIMIT 6`, [id]);
    console.log('   ah:', JSON.stringify(h.rows));
  }
  await p.end();
})().catch(e => { console.error(e); process.exit(1); });
