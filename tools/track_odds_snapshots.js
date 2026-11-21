/**
 * track_odds_snapshots.js — 持续采集今日盘口快照，增量累积变盘历史
 *
 * getFixedBonusV1 对当日比赛返回空，无法直接拿变盘历史。
 * 变通：定时抓取 getMatchCalculatorV1 快照，累积每次变化 → 推断变盘次数/方向
 *
 * 增量模式：每次抓取只把「与上次不同」的赔率快照追加进历史数组，
 * 绝不重建基线，保证变盘历史跨重启持久累积。
 *
 * 用法:
 *   node tools/track_odds_snapshots.js              # 单次抓取+记录
 *   node tools/track_odds_snapshots.js --watch 5    # 每5分钟抓一次（循环）
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SNAP_DIR = join(ROOT, 'data', 'today', 'snapshots');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0';
const REF = 'https://www.sporttery.cn/';

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'referer': REF, 'user-agent': UA } }, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch { reject(new Error('parse fail')); }
      });
    }).on('error', reject);
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** 判断两条记录是否相同（仅比较赔率与时间，忽略方向标志） */
function same(a, b) {
  if (!a || !b) return false;
  return a.h === b.h && a.d === b.d && a.a === b.a &&
         (a.goalLine === undefined || b.goalLine === undefined || a.goalLine === b.goalLine) &&
         a.updateTime === b.updateTime;
}

/** 抓一次快照并增量累积到变更历史 */
async function capture() {
  const url = 'https://webapi.sporttery.cn/gateway/uniform/football/getMatchCalculatorV1.qry?channel=c&poolCode=hhad,had';
  const d = await httpGet(url);
  if (!d.success) throw new Error('API: ' + d.errorMessage);

  const date = new Date().toISOString().slice(0, 10);
  if (!existsSync(SNAP_DIR)) mkdirSync(SNAP_DIR, { recursive: true });
  const histFile = join(SNAP_DIR, `${date}.json`);

  // 加载已有历史（保留所有累积的变化）
  let history = {};
  if (existsSync(histFile)) {
    try { history = JSON.parse(readFileSync(histFile, 'utf8')); } catch {}
  }

  const now = new Date().toISOString();
  let changed = 0, total = 0;

  for (const blk of (d.value?.matchInfoList || [])) {
    for (const m of (blk.subMatchList || [])) {
      const mid = String(m.matchId);
      total++;
      if (!history[mid]) {
        history[mid] = {
          league: m.leagueAbbName,
          home: m.homeTeamAbbName,
          away: m.awayTeamAbbName,
          goalLine: m.hhad?.goalLine || '',
          had: [], hhad: [],
          firstSeen: now,
          lastSeen: now,
        };
      }
      const rec = history[mid];

      // HAD 增量追加
      const hadCur = {
        h: m.had?.h, d: m.had?.d, a: m.had?.a,
        hf: m.had?.hf, df: m.had?.df, af: m.had?.af,
        updateTime: m.had?.updateTime,
      };
      const lastHad = rec.had[rec.had.length - 1];
      if (!same(lastHad, hadCur)) {
        rec.had.push(hadCur);
        changed++;
      }

      // HHAD 增量追加
      const hhadCur = {
        h: m.hhad?.h, d: m.hhad?.d, a: m.hhad?.a,
        hf: m.hhad?.hf, df: m.hhad?.df, af: m.hhad?.af,
        goalLine: m.hhad?.goalLine,
        updateTime: m.hhad?.updateTime,
      };
      const lastHhad = rec.hhad[rec.hhad.length - 1];
      if (!same(lastHhad, hhadCur)) {
        rec.hhad.push(hhadCur);
        changed++;
      }

      rec.lastSeen = now;
    }
  }

  // 合并单关信息（用内部键，不走比赛循环）
  const poolFile = join(ROOT, 'data', 'today', `${date}.json`);
  if (existsSync(poolFile)) {
    try {
      const today = JSON.parse(readFileSync(poolFile, 'utf8'));
      const singleMap = {};
      for (const m of today.matches) {
        singleMap[String(m.matchId)] = m.single?.HAD === 1;
      }
      history._single = singleMap;
    } catch {}
  }

  writeFileSync(histFile, JSON.stringify({ updatedAt: now, matches: history }, null, 2), 'utf8');

  // 输出概览（只输出真实比赛，跳过内部键）
  console.log(`\n=== 盘口快照 ${now.slice(0, 19)} ===`);
  console.log(`已跟踪 ${total} 场 | 本次记录 ${changed} 次变化\n`);
  const historyMatches = history;
  for (const mid of Object.keys(historyMatches)) {
    if (mid.startsWith('_')) continue;
    const rec = historyMatches[mid];
    if (!rec || !rec.had || !rec.hhad) continue;
    const hadC = rec.had.length - 1;
    const hhadC = rec.hhad.length - 1;
    const gl = rec.goalLine;
    console.log(`  ${rec.home} vs ${rec.away} (${rec.league}) | gl:${gl} | HAD变${hadC}次 HHAD变${hhadC}次`);
    if (rec.hhad.length >= 2) {
      const first = rec.hhad[0].a, last = rec.hhad[rec.hhad.length - 1].a;
      const firstH = rec.hhad[0].h, lastH = rec.hhad[rec.hhad.length - 1].h;
      console.log(`    HHAD-A: ${first} → ${last} | 主: ${firstH} → ${lastH}`);
    }
  }
  return { total, changed };
}

async function main() {
  const args = process.argv.slice(2);
  const watchIdx = args.indexOf('--watch');
  if (watchIdx >= 0) {
    const intervalMin = parseInt(args[watchIdx + 1]) || 5;
    console.log(`▶ 持续采集模式: 每 ${intervalMin} 分钟抓一次 (Ctrl+C 退出)`);
    while (true) {
      try { await capture(); }
      catch (e) { console.error('采集失败:', e.message); }
      await sleep(intervalMin * 60000);
    }
  }
  await capture();
}

if (process.argv[1]?.endsWith('track_odds_snapshots.js')) main();
