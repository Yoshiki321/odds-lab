import { query, pool } from '../../src/server/db/pool.js';
const q = async (t:string,p:any[]=[]) => (await query(t,p)).rows;
// 1. europe history 累积
const eh = await q(`SELECT match_id, COUNT(*) n, COUNT(DISTINCT observed_at) t FROM europe_odds_history GROUP BY match_id ORDER BY t DESC LIMIT 5`);
console.log('euro_odds_history per match (top5):', JSON.stringify(eh));
const ehTot = await q(`SELECT COUNT(*) n FROM europe_odds_history`);
console.log('euro_odds_history total rows:', ehTot[0].n);
// 2. handicap history
const hh = await q(`SELECT market, odds_type, COUNT(*) n FROM handicap_odds_history GROUP BY market, odds_type ORDER BY market`);
console.log('handicap_odds_history:', JSON.stringify(hh));
// 3. odds_history 增长
const oh = await q(`SELECT COUNT(*) n, COUNT(DISTINCT match_id) m FROM odds_history`);
console.log('odds_history total:', JSON.stringify(oh[0]));
const oh2 = await q(`SELECT match_id, COUNT(*) n FROM odds_history GROUP BY match_id ORDER BY n DESC LIMIT 3`);
console.log('odds_history top matches:', JSON.stringify(oh2));
// 4. snapshots
const ss = await q(`SELECT to_char(snapshot_at AT TIME ZONE 'Asia/Shanghai','HH24:MI') t, slot, COUNT(*) n FROM score_snapshots GROUP BY t, slot ORDER BY t LIMIT 8`);
console.log('snapshots by time:', JSON.stringify(ss));
const ss2 = await q(`SELECT COUNT(*) frames, COUNT(DISTINCT match_id) matches FROM score_snapshots`);
console.log('snapshots total:', JSON.stringify(ss2[0]));
// 5. team_elo
const el = await q(`SELECT COUNT(*) n FROM team_elo`);
console.log('team_elo rows:', el[0].n);
// 6. lineups 表（预期 0）
const lu = await q(`SELECT COUNT(*) n FROM match_lineups`);
console.log('match_lineups rows:', lu[0].n);
await pool().end();
