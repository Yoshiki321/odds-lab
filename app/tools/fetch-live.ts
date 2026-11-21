// fetch-live.ts — 比分直播：sporttery getMatchDataPageListV1 → 合 okooo 缓存 → upsert PG live_scores
// 对标 tools/fetch_live_scores.cjs；okooo 抓取仍由 fetch_okooo_live.js（playwright 单独进程）产出缓存文件，
// 这里只读文件合并，不溅浏览器（Windows 弹窗问题）
import https from 'node:https';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { upsertLive, upsertResult, ensureMatch } from '../src/server/db/store.js';
import { query } from '../src/server/db/pool.js';
import type { LiveRow } from '../src/shared/types.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIVE_DIR = join(ROOT, 'data', 'live');

function httpGet(url: string, referer: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { referer, 'user-agent': UA, accept: 'application/json, text/javascript, */*; q=0.01' } }, res => {
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch { reject(new Error(`JSON 解析失败: ${url} → ${d.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

/** 归一化 matchNumStr（周日001/6008/周六008）→ 竞彩编号 */
export function normalizeNumStr(s: unknown): string {
  if (!s) return '';
  const m = String(s).match(/^(周[六日一二三四五]|周)\s*(\d{1,3})$/);
  return m ? `周${m[1].slice(1)}${String(m[2]).padStart(3, '0')}` : String(s);
}

interface LiveRaw {
  matchId: string;
  matchDate?: string;
  score: string;
  ht: string;
  status: string;
  statusName: string;
  num: string;      // 竞彩编号（normalizeNumStr 后；非竞彩场为空）
  league: string;
  home: string;
  away: string;
  matchTime: string;
}

function extractLive(j: any): LiveRaw[] {
  const out: LiveRaw[] = [];
  const groups = (j && j.value && j.value.matchInfoList) || [];
  for (const g of groups) {
    for (const m of (g.subMatchList || [])) {
      if (!m || m.matchId == null) continue;
      out.push({
        matchId: String(m.matchId),
        matchDate: m.matchDate,
        score: (m.sectionsNo999 || '').trim(),
        ht: (m.sectionsNo1 || '').trim(),
        status: String(m.matchStatus || ''),
        statusName: m.matchStatusName || '',
        num: normalizeNumStr(m.matchNumStr),
        league: m.leagueAbbName || '',
        home: m.homeTeamAbbName || '',
        away: m.awayTeamAbbName || '',
        matchTime: m.matchTime || '',
      });
    }
  }
  return out;
}

/** 读 okooo 缓存文件（data/live/okooo_<date>.json），按 matchId 给 score/ht/statusName 覆盖 */
function loadOkooo(dateCandidates: string[]): Record<string, any> {
  for (const d of dateCandidates) {
    const f = join(LIVE_DIR, `okooo_${d}.json`);
    if (!existsSync(f)) continue;
    try {
      const m = JSON.parse(readFileSync(f, 'utf8')).matches || {};
      if (Object.keys(m).length) return m;
    } catch { /* 缓存损坏跳过 */ }
  }
  return {};
}

const bjDate = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

/** 抓比分直播并入库；返回统计 */
export async function fetchLiveAndStore(): Promise<{ rows: number; sealed: number; okoooHit: number; backfilled: number }> {
  const rows: LiveRaw[] = [];
  let err: Error | null = null;
  for (let page = 1; page <= 3; page++) {
    try {
      const j = await httpGet(
        `https://webapi.sporttery.cn/gateway/uniform/fb/getMatchDataPageListV1.qry?method=all&pageSize=50&pageNo=${page}`,
        'https://www.sporttery.cn/jc/zqbfzb/');
      if (!j || j.success !== true) { err = new Error('接口返回非成功 ' + JSON.stringify(j && { errorCode: j.errorCode, errorMessage: j.errorMessage }).slice(0, 120)); continue; }
      rows.push(...extractLive(j));
      const total = (j.value && j.value.total) || 0;
      if ((j.value && j.value.nextPage === false) || rows.length >= total) break;
    } catch (e) { err = e as Error; continue; }
  }
  if (!rows.length) throw new Error((err && err.message) || '返回空场次');

  // okooo 缓存：比赛日 + 北京今日 + 前一日 逐一尝试
  const dates = [...new Set(rows.map(r => r.matchDate).filter((x): x is string => !!x))].concat([bjDate()]);
  const okooo = loadOkooo([...dates, new Date(Date.now() + 8 * 3600_000 - 86_400_000).toISOString().slice(0, 10)]);

  // 只保留竞彩盘场次（FK：live_scores.match_id → matches）
  const { rows: existRows } = await query('SELECT match_id FROM matches');
  const known = new Set(existRows.map(x => x.match_id));

  // 兜底补录（可以过时，不能缺少）：在售池下架的过期场（已开赛/待开奖）只在这里能见到。
  // 有标准竞彩编号才补（排除比分池自有纯数字内部码）；只插 matches 行，已有行绝不动；
  // 补完即纳入 known，后续 live/赛果推导照常走，外键不再拒绝。
  let backfilled = 0;
  for (const r of rows) {
    if (known.has(r.matchId)) continue;
    if (!/^周[六日一二三四五]\d{3}$/.test(r.num)) continue;
    try {
      const added = await ensureMatch({
        matchId: r.matchId, matchDate: r.matchDate || bjDate(), num: r.num,
        league: r.league, home: r.home, away: r.away, matchTime: r.matchTime,
      });
      if (added) {
        known.add(r.matchId);
        backfilled++;
        console.log(`[live-backfill] 补录 ${r.num} ${r.home} vs ${r.away}（${r.statusName || r.status}）`);
      }
    } catch (e: any) { console.warn('[live-backfill] 失败:', r.matchId, e?.message || e); }
  }

  let sealed = 0, okoooHit = 0;
  for (const r of rows) {
    if (!known.has(r.matchId)) continue; // 非竞彩场次跳过
    const v = okooo[r.matchId];
    // 优先级：sporttery 官方实时源优先；okooo 缓存只做 sporttery 缺分时的兜底，
    // 绝不反向覆盖（okooo 缓存可能是几小时前的旧快照，会盖掉已更新的官方比分）
    const useOkoooScore = !r.score && !!v?.okScore;
    let row: LiveRow = {
      matchId: r.matchId,
      score: r.score || v?.okScore || null,
      ht: r.ht || v?.okHalf || null,
      status: r.status || v?.okStatus || null,
      statusName: r.statusName || v?.okStatusName || null,
      source: useOkoooScore ? 'okooo' : 'sporttery',
      fetchedAt: new Date().toISOString(),
    };
    if (r.score) sealed++;
    if (useOkoooScore) okoooHit++;
    await upsertLive(row);
  }

  // 终场即赛果：status='11'（已完成）且比分合法 → 直接推导写 results（胜平负/让球方向/半场），
  // 不等竞彩官方 Payout；官方开奖后 fetchResultsAndStore 会用官方 winFlag 覆盖（同分同向）。
  // 只处理竞彩盘场次（known），非竞彩场次无 matches 行，外键会拒绝。
  // 禁止由非官方实时比分直接写入 results 表（防止未 Payout 前被 settle.ts 错结真注）；
  // 赛果统一由 fetch-results.ts 校验 poolStatus === 'Payout' 后写入。
  const doneRows: typeof rows = [];
  if (doneRows.length) {
    const { rows: glRows } = await query(`SELECT match_id, hhad FROM matches WHERE match_id = ANY($1::varchar[])`, [doneRows.map(x => x.matchId)]);
    const glMap = new Map<string, number>();
    for (const g of glRows) {
      const gl = parseFloat(g.hhad && g.hhad.goalLine);
      if (Number.isFinite(gl)) glMap.set(g.match_id, gl);
    }
    for (const d of doneRows) {
      const sm = String(d.score).match(/(\d+)\s*[:：\-]\s*(\d+)/);
      if (!sm) continue;
      const hg = +sm[1], ag = +sm[2];
      const had = hg > ag ? 'H' : hg < ag ? 'A' : 'D';
      const gl = glMap.get(d.matchId);
      let hhad: 'H' | 'A' | 'D' | null = null;
      if (gl != null && hg + gl - ag !== 0) hhad = hg + gl - ag > 0 ? 'H' : 'A';
      else if (gl != null) hhad = 'D';
      await upsertResult({ matchId: d.matchId, score: d.score, had, hhad, goalLine: gl != null ? String(gl) : null, ht: d.ht || '' });
    }
  }

  return { rows: rows.length, sealed, okoooHit, backfilled };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('fetch-live.ts')) {
  fetchLiveAndStore().then(r => {
    console.log(`[比分直播] sporttery ${r.rows} 场 已开赛封盘 ${r.sealed} 场 · okooo 合并 ${r.okoooHit} 场 · 补录 ${r.backfilled} 场`);
  }).catch(e => { console.error('信息源错误 sporttery.score:', e.message || e); process.exit(1); });
}