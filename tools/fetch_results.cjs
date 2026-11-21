// fetch_results.cjs — 抓已开奖赛果写入 data/results/<date>.json
// 用法: node tools/fetch_results.cjs [YYYY-MM-DD]
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const TODAY_DIR = path.join(ROOT, 'data', 'today');
const OUT_DIR = path.join(ROOT, 'data', 'results');
const REF = 'https://www.sporttery.cn/jc/zqsgkj/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0';

function latestTodayDate() {
  const files = fs.readdirSync(TODAY_DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  if (!files.length) throw new Error('no today files');
  return files[files.length - 1].slice(0, 10);
}
function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { referer: REF, 'user-agent': UA, accept: 'application/json' } }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch { reject(new Error('JSON fail ' + url)); }
      });
    }).on('error', reject);
  });
}

(async () => {
  const arg = process.argv[2];
  const date = arg && /^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : latestTodayDate();
  const today = JSON.parse(fs.readFileSync(path.join(TODAY_DIR, date + '.json'), 'utf8'));
  const matches = today.matches || [];
  const dates = [...new Set(matches.map(m => m.matchDate).filter(Boolean))].sort();
  const begin = dates[0] || date;
  const end = dates[dates.length - 1] || date;
  const ids = new Set(matches.map(m => String(m.matchId || '')).filter(Boolean));

  const raw = [];
  for (let page = 1; page <= 8; page++) {
    const url = `https://webapi.sporttery.cn/gateway/uniform/football/getUniformMatchResultV1.qry?matchBeginDate=${begin}&matchEndDate=${end}&pageSize=50&pageNo=${page}&isFix=0&matchPage=1&pcOrWap=1`;
    const j = await httpGet(url);
    const list = (j && j.value && j.value.matchResult) || [];
    if (!list.length) break;
    raw.push(...list);
    if (list.length < 50) break;
  }

  const byId = {};
  for (const r of raw) {
    const id = String(r.matchId || '');
    if (!id || (ids.size && !ids.has(id))) continue;
    const score = r.sectionsNo999 || '';
    const done = String(r.matchResultStatus) === '2' || r.poolStatus === 'Payout';
    if (!done || !score) continue;
    const m = String(score).match(/(\d+)\s*[:\-]\s*(\d+)/);
    const hg = m ? +m[1] : null, ag = m ? +m[2] : null;
    const gl = parseFloat(r.goalLine);
    let hhad = null;
    if (hg != null && !isNaN(gl)) {
      const v = hg + gl - ag;
      hhad = v > 0 ? 'H' : v < 0 ? 'A' : 'D';
    }
    byId[id] = {
      matchId: id,
      num: r.matchNumStr,
      score,
      had: r.winFlag || null,
      hhad,
      goalLine: r.goalLine || null,
      ht: r.sectionsNo1 || '',
    };
  }

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = { date, begin, end, fetchedAt: new Date().toISOString(), count: Object.keys(byId).length, byId };
  fs.writeFileSync(path.join(OUT_DIR, date + '.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log(`赛果 ${date} ${begin}~${end} 已开奖 ${out.count} 场`);
})().catch(e => {
  console.error('信息源错误 getUniformMatchResultV1:', e.message || e);
  process.exit(1);
});
