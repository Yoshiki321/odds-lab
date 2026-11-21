// league_backfill.ts — 按官方编号(matchId)对正 PG matches.league
// 官方依据: data/history/football/*.json 的 leagueNameAbbr（与计算器 leagueAbbName 同词表）
// 用法: npx tsx scripts/_tmp-2026-09-14/league_backfill.ts        (只审计打印差异)
//       npx tsx scripts/_tmp-2026-09-14/league_backfill.ts --apply (按 match_id 回写)
// 未来场次（历史无记录）跳过：它们每次 refresh 会被官方盘覆盖，自愈。
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '../../src/server/db/pool.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HIST = join(ROOT, 'data', 'history', 'football');

// 同一 matchId 取已开奖行优先，否则末行
function loadOfficial(): Map<string, string> {
  const m = new Map<string, string>();
  const settled = new Set<string>();
  for (const f of readdirSync(HIST).filter(x => /^\d{4}-\d{2}-\d{2}\.json$/.test(x))) {
    let j: any;
    try { j = JSON.parse(readFileSync(join(HIST, f), 'utf8')); } catch { continue; }
    for (const r of (j.matches || [])) {
      if (r.matchId == null || !r.leagueNameAbbr) continue;
      const k = String(r.matchId);
      if (r.matchResultStatus === '2' || r.poolStatus === 'Payout') { m.set(k, r.leagueNameAbbr); settled.add(k); }
      else if (!settled.has(k)) m.set(k, r.leagueNameAbbr);
    }
  }
  return m;
}

const rows = (await query('SELECT match_id, num, league, home, away FROM matches')).rows as any[];
const off = loadOfficial();
console.log('official=' + off.size + ' pg=' + rows.length);
const diffs = [];
for (const r of rows) {
  const want = off.get(String(r.match_id));
  if (!want || want === r.league) continue;
  diffs.push({ id: String(r.match_id), num: r.num, from: r.league, to: want, vs: r.home + '-' + r.away });
}
console.log('diffs=' + diffs.length);
for (const d of diffs) console.log(d.id, d.num, d.from + '→' + d.to, d.vs);

if (process.argv.includes('--apply')) {
  let n = 0;
  for (const d of diffs) {
    await query('UPDATE matches SET league=$2 WHERE match_id=$1', [d.id, d.to]);
    n++;
  }
  console.log('updated=' + n);
}
process.exit(0);
