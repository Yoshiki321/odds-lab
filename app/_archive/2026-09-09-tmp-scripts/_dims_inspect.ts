import { query } from '../src/server/db/pool.js';

async function main() {
  const ids = ['2041346', '2041288', '2041323', '2041327', '2041335', '2041267', '2041312', '2041321', '2041326', '2041342', '2041339'];
  const matches = await query('SELECT match_id, num, home, away, league FROM matches WHERE match_id = ANY($1::varchar[])', [ids]);
  const mm = new Map(matches.rows.map(r => [r.match_id, r]));
  for (const id of ids) {
    const s = await query("SELECT total, dims, analysis, dir, odds, band, risk FROM scores WHERE match_id = $1 ORDER BY analyzed_at DESC LIMIT 1", [id]);
    const r = s.rows[0];
    if (!r) { console.log('NO SCORE', id); continue; }
    const m = mm.get(id);
    const d = r.dims ?? {};
    const flat: any = {};
    const walk = (o: any, p = '') => { for (const k of Object.keys(o)) { const v = o[k]; if (v && typeof v === 'object') walk(v, p + k + '.'); else flat[p + k] = v; } };
    walk(d);
    console.log(`--- ${id} ${m?.num ?? '?'} ${m?.home}-${m?.away} total=${r.total} ${r.dir}@${r.odds} ${r.band}`);
    console.log('   dims:', Object.entries(flat).map(([k, v]) => `${k}=${v}`).join('  '));
    if (r.analysis) console.log('   analysis:', JSON.stringify(r.analysis).slice(0, 300));
  }
  process.exit(0);
}
main();
