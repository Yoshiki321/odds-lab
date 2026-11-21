// refresh_scores.cjs — 抓当日盘 → 合入 today 文件 → 重算评分
// 给 LLM cron 调用，不是网页/server 自己打分
// 用法: node tools/refresh_scores.cjs [YYYY-MM-DD]
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TODAY_DIR = path.join(ROOT, 'data', 'today');
const SCORE_DIR = path.join(ROOT, 'data', 'scores');
const STATUS = path.join(SCORE_DIR, '_status.json');

function beijingDate() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
function listTodayDates() {
  if (!fs.existsSync(TODAY_DIR)) return [];
  return fs.readdirSync(TODAY_DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
}
function latestTodayDate() {
  const files = listTodayDates();
  return files.length ? files[files.length - 1].slice(0, 10) : beijingDate();
}
function writeStatus(obj) {
  if (!fs.existsSync(SCORE_DIR)) fs.mkdirSync(SCORE_DIR, { recursive: true });
  fs.writeFileSync(STATUS, JSON.stringify({ at: new Date().toISOString(), ...obj }, null, 2), 'utf8');
}

(async () => {
  const arg = process.argv[2];
  const errors = [];
  let matches = [];
  try {
    const { fetchTodayOdds } = await import('./fetch_today_odds.js');
    matches = await fetchTodayOdds();
  } catch (e) {
    errors.push({ source: 'sporttery.getMatchCalculatorV1', message: e.message || String(e) });
    writeStatus({ ok: false, errors, date: null });
    console.error('信息源错误 sporttery:', e.message || e);
    process.exit(1);
  }
  if (!Array.isArray(matches) || !matches.length) {
    errors.push({ source: 'sporttery.getMatchCalculatorV1', message: '返回空场次' });
    writeStatus({ ok: false, errors, date: null });
    console.error('信息源错误 sporttery: 返回空场次');
    process.exit(1);
  }

  let date = arg && /^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : beijingDate();
  const destPath = path.join(TODAY_DIR, date + '.json');
  const dest = fs.existsSync(destPath) ? JSON.parse(fs.readFileSync(destPath, 'utf8')) : { matches: [] };
  const destIds = new Set((dest.matches || []).map(m => String(m.matchId || '')).filter(Boolean));
  const hit = matches.filter(m => destIds.has(String(m.matchId || ''))).length;
  if (!arg && destIds.size && hit < Math.min(3, matches.length) * 0.3) {
    date = beijingDate();
  }

  const outPath = path.join(TODAY_DIR, date + '.json');
  const prev = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : { matches: [] };
  const byId = new Map((prev.matches || []).map(m => [String(m.matchId || m.num), m]));
  let updated = 0;
  for (const m of matches) {
    const k = String(m.matchId || m.num);
    const old = byId.get(k);
    byId.set(k, old ? { ...old, ...m } : m);
    if (old) updated++;
  }
  const merged = { fetchedAt: new Date().toISOString(), matches: [...byId.values()] };
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2), 'utf8');
  fs.writeFileSync(path.join(TODAY_DIR, '_latest.json'), JSON.stringify(merged, null, 2), 'utf8');

  // 首见盘：每场只记第一次赔率，后续刷新不覆盖（评分降水的对照基线）
  const snapDir = path.join(TODAY_DIR, 'snapshots');
  if (!fs.existsSync(snapDir)) fs.mkdirSync(snapDir, { recursive: true });
  const firstPath = path.join(snapDir, date + '.first.json');
  const firstDoc = fs.existsSync(firstPath) ? JSON.parse(fs.readFileSync(firstPath, 'utf8')) : { date, matches: {} };
  if (!firstDoc.matches || Array.isArray(firstDoc.matches)) firstDoc.matches = {};
  let seeded = 0;
  for (const m of merged.matches) {
    const id = String(m.matchId || '');
    if (!id || firstDoc.matches[id]) continue;
    firstDoc.matches[id] = {
      num: m.num, home: m.home, away: m.away, matchId: id,
      firstSeen: merged.fetchedAt, had: m.had || null, hhad: m.hhad || null,
    };
    seeded++;
  }
  if (seeded) {
    firstDoc.date = date;
    fs.writeFileSync(firstPath, JSON.stringify(firstDoc, null, 2), 'utf8');
  }

  const scored = spawnSync(process.execPath, [path.join(__dirname, 'score_sat_full.cjs'), date], {
    cwd: ROOT, encoding: 'utf8', timeout: 30000, maxBuffer: 2e6,
  });
  if (scored.status !== 0) {
    errors.push({ source: 'score_sat_full', message: (scored.stderr || scored.stdout || scored.error || 'exit ' + scored.status).toString().slice(0, 500) });
    writeStatus({ ok: false, date, fetched: matches.length, updated, errors });
    console.error(scored.stdout || '');
    console.error(scored.stderr || scored.error);
    process.exit(1);
  }

  const results = spawnSync(process.execPath, [path.join(__dirname, 'fetch_results.cjs'), date], {
    cwd: ROOT, encoding: 'utf8', timeout: 45000, maxBuffer: 2e6,
  });
  if (results.status !== 0) {
    errors.push({ source: 'sporttery.getUniformMatchResultV1', message: (results.stderr || results.stdout || 'exit ' + results.status).toString().slice(0, 400) });
    console.error('赛果抓取失败:', results.stderr || results.stdout);
  } else {
    console.log((results.stdout || '').trim());
  }

  writeStatus({ ok: errors.length === 0, date, fetched: matches.length, updated, errors, scoreLog: (scored.stdout || '').trim().split('\n')[0] });
  console.log(scored.stdout || '');
  console.log(`平台已更新 ${date} 抓${matches.length}场 覆盖${updated}场`);
})().catch(e => {
  writeStatus({ ok: false, errors: [{ source: 'refresh_scores', message: e.message || String(e) }] });
  console.error(e);
  process.exit(1);
});
