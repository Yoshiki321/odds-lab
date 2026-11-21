/**
 * 回填历史让球赔率(hhadList) - 快速版
 *
 * 对每个matchId调用 getFixedBonusV1 获取 hhadList/hadList/matchResultList，
 * 合并到已有缓存文件或新建。
 *
 * 用法: node backfill-hhad.js
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, 'data/history/_odds_cache');
const HIST_DIR = join(__dirname, 'data/history/football');
mkdirSync(CACHE_DIR, { recursive: true });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0';
const REF = 'https://www.sporttery.cn/jc/zqdz/';

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'referer': REF, 'user-agent': UA, 'accept': 'application/json, text/javascript, */*; q=0.01' } }, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch { reject(new Error(`JSON parse fail: ${d.slice(0,200)}`)); }
      });
    }).on('error', reject);
  });
}

async function get(url, retries = 2) {
  for (let i = 0; i < retries; i++) {
    try { return await httpGet(url); }
    catch (e) { if (i === retries - 1) throw e; await new Promise(r => setTimeout(r, 500)); }
  }
}

// 1. 收集所有 matchId
const allMatches = [];
const histFiles = readdirSync(HIST_DIR).filter(f => f.endsWith('.json') && /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
for (const f of histFiles) {
  try {
    const d = JSON.parse(readFileSync(join(HIST_DIR, f), 'utf8'));
    for (const m of (d.matches || [])) {
      if (m.matchId) allMatches.push({ id: String(m.matchId), date: m.matchDate, home: m.allHomeTeam, away: m.allAwayTeam });
    }
  } catch(e) {}
}
console.log(`[回填] 历史共 ${allMatches.length} 场`);

// 2. 过滤需要回填的（已有oddsHistory的跳过）
const existing = new Map();
for (const f of readdirSync(CACHE_DIR).filter(f => f.endsWith('.json'))) {
  const id = f.replace('.json','');
  try {
    const d = JSON.parse(readFileSync(join(CACHE_DIR, f), 'utf8'));
    if (d.oddsHistory?.hhadList || d.matchResultList) {
      existing.set(id, 'has');
    } else {
      existing.set(id, 'partial');
    }
  } catch(e) { existing.set(id, 'corrupt'); }
}

const toFetch = allMatches.filter(m => {
  const status = existing.get(m.id);
  return !status || status === 'partial' || status === 'corrupt';
});
console.log(`[回填] 已有完整数据: ${allMatches.length - toFetch.length} | 需回填: ${toFetch.length}`);

// 3. 协作：每场单独调 API，300ms 间隔
let done = 0, fail = 0, skip = 0;
const start = Date.now();
const BATCH = 200;

for (const m of toFetch) {
  const url = `https://webapi.sporttery.cn/gateway/uniform/football/getFixedBonusV1.qry?clientCode=3001&matchId=${m.id}`;
  const cachePath = join(CACHE_DIR, `${m.id}.json`);

  try {
    const j = await get(url);
    if (j.success && j.value) {
      // 合并已有
      let existing = {};
      if (existsSync(cachePath)) {
        try { existing = JSON.parse(readFileSync(cachePath, 'utf8')); } catch(e) {}
      }
      // 只保留亮点字段，不覆盖已有crsList等
      const out = {
        ...existing,
        matchId: m.id,
        homeTeam: m.home,
        awayTeam: m.away,
        oddsHistory: j.value.oddsHistory || existing.oddsHistory || {},
        matchResultList: j.value.matchResultList || existing.matchResultList || [],
        hhadUpdatedAt: new Date().toISOString()
      };
      writeFileSync(cachePath, JSON.stringify(out, null, 2));
      done++;
    } else {
      // 比赛不可用，标记
      if (!existsSync(cachePath)) {
        writeFileSync(cachePath, JSON.stringify({ matchId: m.id, noData: true, fetchedAt: new Date().toISOString() }));
      }
      skip++;
    }
  } catch(e) {
    fail++;
    if (!existsSync(cachePath)) {
      try { writeFileSync(cachePath, JSON.stringify({ matchId: m.id, noData: true, error: e.message, fetchedAt: new Date().toISOString() })); } catch(e2) {}
    }
  }

  if ((done + skip) % BATCH === 0 || (done + skip) === toFetch.length) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(0);
    const rate = (done / (Date.now() - start) * 1000).toFixed(1);
    console.log(`[回填] ${done + skip}/${toFetch.length} | 成功: ${done} | 失败: ${fail} | 跳过: ${skip} | ${elapsed}s | ${rate}场/秒`);
  }
  await new Promise(r => setTimeout(r, 300));
}

const elapsed = ((Date.now() - start) / 1000).toFixed(0);
console.log(`\n[回填] 完成! 成功: ${done} | 失败: ${fail} | 跳过: ${skip} | 耗时: ${elapsed}s`);