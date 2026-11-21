import { query, pool } from '../../src/server/db/pool.js';
const picks = [
  { id:'2041364', name:'巴黎圣曼 vs 布拉迪斯', market:'HHAD -3', odds:1.74 },
  { id:'2041362', name:'那不勒斯 vs 阿森纳', market:'HAD 主负', odds:1.45 },
  { id:'2041370', name:'切尔西 vs 利兹联', market:'HAD 主胜', odds:1.36 },
];
const r = await query(`SELECT match_id, home_odds, draw_odds, away_odds, source, observed_at FROM europe_odds WHERE match_id = ANY($1)`, [picks.map(p=>p.id)]);
const byId = new Map(r.rows.map(x=>[x.match_id,x]));
const deVig = (h:number,d:number,a:number) => {
  const sum = 1/h + 1/d + 1/a;
  return { ph:(1/h)/sum, pd:(1/d)/sum, pa:(1/a)/sum };
};
for (const p of picks) {
  const e = byId.get(p.id);
  if (!e) { console.log(`${p.name}: 无欧赔`); continue; }
  const { ph, pd, pa } = deVig(Number(e.home_odds), Number(e.draw_odds), Number(e.away_odds));
  // 主负=away, 主胜=home
  const pDir = p.market.startsWith('HHAD') ? null : p.market.includes('主负') ? pa : ph;
  const ev = pDir === null ? null : pDir * p.odds - 1;
  console.log(`${p.name} 竞彩${p.market}@${p.odds} | 欧赔 ${e.home_odds}/${e.draw_odds}/${e.away_odds} 去水 ${(ph*100).toFixed(1)}/${(pd*100).toFixed(1)}/${(pa*100).toFixed(1)} | 方向P=${pDir===null?'-':(pDir*100).toFixed(1)}% EV=${ev===null?'-（需Skellam）':(ev*100).toFixed(1)}%`);
}
await pool().end();
