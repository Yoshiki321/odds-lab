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

const targets = [
  { vb: 'vb-063', matchId: 2041227, pick: '萨索洛让-1(H)' },
  { vb: 'vb-064', matchId: 2041241, pick: '乌迪内斯让-1(H)' },
  { vb: 'vb-070', matchId: 2041232, pick: '弗拉门戈让-1(H)@1.60' },
  { vb: 'vb-072', matchId: 2041234, pick: 'HHAD让球负(A)@5.35' },
  { vb: 'vb-073', matchId: 2041235, pick: '新未来让-1(H)@3.00' },
  { vb: 'vb-074', matchId: 2041236, pick: 'HHAD让球负(A)@3.00' },
  { vb: 'vb-075', matchId: 2041243, pick: 'HHAD让球负(A)@2.33' },
  { vb: 'vb-076', matchId: 2041237, pick: 'HHAD让球负(A)@4.15' },
  { vb: 'vb-077', matchId: 2041238, pick: '皇社让-1(H)@3.52' },
  { vb: 'vb-078', matchId: 2041239, pick: '格雷米奥让-1(H)@6.10' }
];

for (const t of targets) {
  try {
    const raw = await get(t.matchId);
    const j = JSON.parse(raw);
    const v = j.value || {};
    const mrl = v.matchResultList || [];
    const codes = {};
    for (const m of mrl) codes[m.code] = m.combination + ' @' + m.odds;
    const s999 = v.sectionsNo999 || '';
    const settled = mrl.some(m => m.code === 'HAD') || mrl.some(m => m.code === 'HHAD');
    console.log(`${t.vb} (${t.matchId}) | ${t.pick}`);
    console.log(`   HAD:${codes['HAD'] ?? '未开奖'} HHAD:${codes['HHAD'] ?? '未开奖'} CRS:${codes['CRS'] ?? ''} TTG:${codes['TTG'] ?? ''} | s999=${s999} | isCancel=${v.isCancel}`);
    if (mrl.length) console.log(`   官方终场判定: ${settled ? '✅ 有' : '❌ 无'}`);
  } catch (e) {
    console.log(`${t.vb} (${t.matchId}) ERROR: ${e.message}`);
  }
}
