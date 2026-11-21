// history-stats.ts — 联赛基准率（历史胜平负概率）→ base_rates 缓存
// 数据源：data/history/football/<date>.json（每日赛果，含 winFlag H/D/A）
// 滚动窗口默认最近 60 天（含当日已完结部分），供评分 history 维做贝叶斯先验
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveBaseRates } from '../src/server/db/store.js';
import type { BaseRate } from '../src/shared/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const HIST_DIR = join(ROOT, 'data', 'history', 'football');

/** 读取窗口内全部赛果（winFlag 有效才计）；返回按联赛聚合 */
export function loadHistoryWindow(days = 60, beforeDate?: string): { league: string; winFlag: string; matchDate: string }[] {
  if (!existsSync(HIST_DIR)) return [];
  const files = readdirSync(HIST_DIR)
    .filter(x => /^\d{4}-\d{2}-\d{2}\.json$/.test(x))
    .filter(x => x.slice(0, 10) <= (beforeDate ?? '2999-12-31'))
    .sort()
    .slice(-days);
  const out: { league: string; winFlag: string; matchDate: string }[] = [];
  for (const f of files) {
    let d: any;
    try { d = JSON.parse(readFileSync(join(HIST_DIR, f), 'utf8')); } catch { continue; }
    const matches: any[] = Array.isArray(d) ? d : (d.matches || d.value || []);
    for (const m of matches) {
      const wf = m.winFlag;
      if (wf !== 'H' && wf !== 'D' && wf !== 'A') continue;
      out.push({ league: m.leagueNameAbbr || m.leagueName || '', winFlag: wf, matchDate: m.matchDate || f.slice(0, 10) });
    }
  }
  return out;
}

/** 按联赛聚合 → BaseRate[]（n<MIN 也输出，评分端自行回退全局均值） */
export function computeBaseRates(days = 60, beforeDate?: string): BaseRate[] {
  const rows = loadHistoryWindow(days, beforeDate);
  const agg = new Map<string, { total: number; draw: number; home: number; away: number }>();
  for (const r of rows) {
    const a = agg.get(r.league) ?? { total: 0, draw: 0, home: 0, away: 0 };
    a.total++;
    if (r.winFlag === 'D') a.draw++;
    else if (r.winFlag === 'H') a.home++;
    else a.away++;
    agg.set(r.league, a);
  }
  return [...agg.entries()].map(([league, a]) => ({
    league,
    drawRate: a.total ? a.draw / a.total : 0,
    homeRate: a.total ? a.home / a.total : 0,
    awayRate: a.total ? a.away / a.total : 0,
    n: a.total,
  }));
}

export async function computeAndSave(days = 60, beforeDate?: string): Promise<{ leagues: number; matches: number }> {
  const rates = computeBaseRates(days, beforeDate);
  await saveBaseRates(rates);
  return { leagues: rates.length, matches: rates.reduce((a, r) => a + r.n, 0) };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('history-stats.ts')) {
  const arg = process.argv[2];
  const days = arg && /^\d+$/.test(arg) ? +arg : 60;
  computeAndSave(days).then(r => {
    console.log(`联赛基准率 ${r.leagues} 个联赛 / 采样 ${r.matches} 场（滚动${days}天）`);
  }).catch(e => { console.error('history-stats 失败:', e.message || e); process.exit(1); });
}