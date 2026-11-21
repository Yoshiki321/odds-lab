// 一次性核查：桑托斯vs帕梅(2041233)官方赔率变动 + 终场判定
import https from 'https';

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

(async () => {
  const raw = await get(2041233);
  const j = JSON.parse(raw);
  const v = j.value || {};
  console.log('=== top === success:', j.success, 'err:', j.errorCode, j.errorMessage);
  console.log('value keys:', Object.keys(v));

  // 1) 官方终场判定
  const mrl = v.matchResultList || [];
  console.log('=== matchResultList (' + mrl.length + ') ===');
  for (const m of mrl) {
    console.log(' ', JSON.stringify(m));
  }

  // 2) oddsHistory 里 HAD / HHAD 序列
  const oh = v.oddsHistory || {};
  console.log('=== HAD sequence ===');
  for (const o of (oh.hadList || [])) console.log('  ', o.time, 'h:', o.h, 'd:', o.d, 'a:', o.a, '|', o.goalLine);
  console.log('=== HHAD sequence ===');
  for (const o of (oh.hhadList || [])) console.log('  ', o.time, 'h:', o.h, 'd:', o.d, 'a:', o.a, '| gl:', o.goalLine);

  // 3) sectionsNo999 实时比分（不用于结算）
  console.log('=== sectionsNo999 ===');
  console.log(JSON.stringify(v.sectionsNo999 || {}).slice(0, 400));
})();
