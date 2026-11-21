/**
 * 临场首发/伤停管道（尽力而为，抓不到=正常降级，绝不报信息源错误）
 *
 * 流程：
 *   1. 取竞彩开赛窗口 [-60min, +2h] 的场次（临场才有首发价值）
 *   2. 拉 magicball 列表 → 时间桶+队名互含匹配到 dqd match_id
 *   3. 拉 match detail 的 matchFormation，非空对象 → upsertLineups
 *
 * 现状（2026-09-09 实测）：magicball 对 511 场全返回 null formation，
 *   首发数据源暂缺 → 工具每天自动跑通了，但入库行数长期为 0 属已知上限。
 *   升级路径：playwright 抓 okooo 阵容页 live.okooo.com/match/{sid}.shtml（跟随 fetch_okooo_live.js）。
 *
 * 用法：npx tsx tools/fetch-lineups.ts
 */
import { query } from '../src/server/db/pool.js';
import { upsertLineups } from '../src/server/db/store.js';
import { normName, namesOverlap } from './fetch-europe-odds.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const LIST_URL = 'https://www.dongqiudi.com/magicball/v1/list/match_list?language=zh-CN&cmp_type=soccer&tab_type=all';

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { 'user-agent': UA, referer: 'https://www.dongqiudi.com/' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export interface LineupFeed {
  window: number;       // 窗口内竞彩场次
  dqdFound: number;     // 匹配到 dqd 场次
  fetched: number;      // 详情抓取成功
  stored: number;       // formation 非空入库
}

export async function fetchLineups(): Promise<LineupFeed> {
  const feed: LineupFeed = { window: 0, dqdFound: 0, fetched: 0, stored: 0 };
  const now = Date.now();
  const r = await query(
    `SELECT match_id, kickoff, home, away, num FROM matches
     WHERE kickoff BETWEEN to_timestamp($1/1000.0) - interval '60 minutes' AND to_timestamp($1/1000.0) + interval '2 hours'`,
    [now]);
  const up = r.rows.map((x: any) => ({
    matchId: String(x.match_id), kickoffMs: new Date(x.kickoff).getTime(),
    home: normName(x.home), away: normName(x.away), num: x.num,
  }));
  feed.window = up.length;
  if (!up.length) return feed; // 非临场时段无事可做

  const j = await getJson(LIST_URL);
  const buckets = new Map<number, typeof up>();
  for (const u of up) {
    const k = Math.floor(u.kickoffMs / (90 * 60_000));
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(u);
  }
  const dqdSeen = new Set<string>();
  for (const m of (j?.data?.matches ?? []) as any[]) {
    const tsMs = Number(m.match_timestamp) * 1000;
    if (!isFinite(tsMs)) continue;
    const cand = (buckets.get(Math.floor(tsMs / (90 * 60_000))) || [])
      .filter(u => Math.abs(u.kickoffMs - tsMs) <= 45 * 60_000);
    const homeN = normName(m.team_A?.name), awayN = normName(m.team_B?.name);
    const ok = cand.filter(u => namesOverlap(u.home, homeN) && namesOverlap(u.away, awayN));
    if (!ok.length || dqdSeen.has(m.match_id)) continue;
    dqdSeen.add(m.match_id);
    feed.dqdFound++;
    try {
      const d: any = await getJson(`https://www.dongqiudi.com/magicball/v1/match/app/detail?id=${m.match_id}&app=dqd&lang=zh-cn`);
      const mf = d?.data?.match?.matchFormation ?? d?.data?.matchFormation ?? d?.matchFormation;
      feed.fetched++;
      if (mf && typeof mf === 'object' && Object.keys(mf).length) {
        await upsertLineups(ok[0].matchId, { homeFirst11: mf, awayFirst11: null, injuries: null });
        feed.stored++;
      }
    } catch { /* 静默降级：首发抓不到不算信息源错误 */ }
  }
  return feed;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('fetch-lineups.ts')) {
  fetchLineups().then(f => console.log(
    `首发 ${f.stored} 场 (窗口${f.window} 匹配${f.dqdFound} 抓取${f.fetched})`
  )).catch(e => console.error('首发管道失败:', e?.message || e)); // 不 exit 非 0：降级项不打断 refresh
}