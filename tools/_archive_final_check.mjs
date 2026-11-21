import https from 'https';
import fs from 'fs';

function get(id) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'webapi.sporttery.cn',
      path: `/gateway/uniform/football/getFixedBonusV1.qry?clientCode=3001&matchId=${id}`,
      headers: { 'User-Agent': 'Mozilla/5.0', referer: 'https://www.sporttery.cn/jc/zqdz/' }
    };
    https.get(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

// 今日盘7场 + 对比早盘快照
const today = JSON.parse(fs.readFileSync('./data/today/2026-09-03.json', 'utf8'));
const ms = today.matches || today.list || [];

for (const m of ms) {
  const id = m.matchId;
  try {
    const j = JSON.parse(await get(id));
    const v = j.value || {};
    const oh = v.oddsHistory || {};
    // 首盘 vs 末条
    const hadList = oh.hadList || [];
    const hhadList = oh.hhadList || [];
    const h0 = hadList[0], hL = hadList[hadList.length - 1];
    const hh0 = hhadList[0], hhL = hhadList[hhadList.length - 1];
    const s999 = v.sectionsNo999 || '';
    const mrl = v.matchResultList || [];
    const settledCodes = mrl.map(x => x.code).join(',');
    console.log(`=== ${m.num} ${m.home} vs ${m.away} (${id}) kickoff=${m.matchTime} s999=${s999} 开奖:[${settledCodes}]`);
    if (h0 && hL) {
      const dh = +hL.h - +h0.h, da = +hL.a - +h0.a;
      console.log(`  HAD  首盘 h${h0.h}/d${h0.d}/a${h0.a} → 临场 h${hL.h}/d${hL.d}/a${hL.a} | 主Δ${dh>0?'+':''}${dh} 客Δ${da>0?'+':''}${da}`);
    }
    if (hh0 && hhL) {
      const dh = +hhL.h - +hh0.h, da = +hhL.a - +hh0.a;
      console.log(`  HHAD ${hh0.goalLine||''} 首盘 h${hh0.h}/d${hh0.d}/a${hh0.a} → 临场 h${hhL.h}/d${hhL.d}/a${hhL.a} | 主Δ${dh>0?'+':''}${dh} 客Δ${da>0?'+':''}${da}`);
    }
  } catch (e) {
    console.log(`=== ${m.num} ${m.home} ${e.message}`);
  }
}
