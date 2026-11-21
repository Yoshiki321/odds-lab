import { pool } from '../../src/server/db/pool.js';
import { evaluateM04 } from '../../tools/m04.js';
async function main() {
  const p = pool();
  // 取 09-13 全 24 场均评估 M-04 闸门
  const q = `
    SELECT s.match_id, m.num, s.match_date, m.league, m.home, m.away, m.kickoff,
           s.total, s.band, s.dir, s.market, s.pred, s.odds,
           e.home_odds, e.draw_odds, e.away_odds,
           h.line, h.home_odds ah_odds, h.away_odds aa_odds, h.odds_type
    FROM scores s
    JOIN matches m ON m.match_id = s.match_id
    LEFT JOIN europe_odds e ON e.match_id = s.match_id
    LEFT JOIN LATERAL (
      SELECT line, home_odds, away_odds, odds_type FROM handicap_odds_history hh
      WHERE hh.match_id = s.match_id AND hh.market='AH'
      ORDER BY observed_at DESC LIMIT 1
    ) h ON true
    WHERE s.match_date='2026-09-13' AND s.scan_round=1
    ORDER BY s.total DESC`;
  const r = await p.query(q);
  const now = Date.now();
  for (const x of r.rows) {
    const hrs = x.kickoff ? ((+new Date(x.kickoff) - now)/3600000).toFixed(1) : '?';
    const gln = x.market === 'HHAD' ? (x.pred === 'H' ? -1 : 1) * 1 : 0; // 推断(容错)
    // settleOdds: 亚盘受让侧赔率（模拟 M-04 下注口径）
    const settleOdds = x.h ? (x.pred==='H' ? +x.ah_odds : +x.aa_odds) : null;
    const dec = evaluateM04({
      score: x.total, line: gln, market: x.market, side: x.pred==='H'?'H':'A',
      jcOdds: x.odds, europe: (x.home_odds && x.draw_odds && x.away_odds) ? { home:+x.home_odds, draw:+x.draw_odds, away:+x.away_odds } : null,
      settleOdds: settleOdds || null, hoursToKickoff: x.kickoff ? +hrs : null,
    });
    const eu = x.home_odds ? `${x.home_odds}/${x.draw_odds}/${x.away_odds}` : '无';
    const ah = x.h ? `AH${x.line} 主${x.ah_odds}/客${x.aa_odds}(${x.odds_type})` : '无亚盘';
    console.log(`${x.num} ${String(x.total).padStart(2)}${x.band} ${x.dir.padEnd(8)}@${x.odds} 距开${hrs}h ${x.league}/${x.home}-${x.away}`);
    console.log(`   欧赔${eu} | ${ah} | M-04: ${dec.eligible ? '✅'+dec.reason : '⛔'+dec.reason} (jcEV=${dec.jcEv!=null?(dec.jcEv*100).toFixed(1)+'%':'?'} settleEV=${dec.settleEv!=null?(dec.settleEv*100).toFixed(1)+'%':'?'})`);
  }
  await p.end();
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
