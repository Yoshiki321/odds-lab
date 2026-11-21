/**
 * snapshot_inventory.ts — 26 个快照的时间证据清单（只读，不改原始文件）
 * 用法: node app/tools/snapshot_inventory.ts
 * 输出: data/experiment_survival_100/dataset/snapshot_inventory.json
 *
 * 分级（按"比赛"计数，互斥）：
 *  - strict        oddsMs <= nameMs 且 |mtime - nameMs| <= 120s（内容不晚于声称采集时刻）
 *  - doubtful      oddsMs > nameMs（内容晚于文件名时间，无法证明当时可用）
 *  - noKickoff     缺开赛时间
 *  - noResult      历史文件里无该场赛果
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const ODDS_DIR = 'data/odds';
const HIST_DIR = 'data/history/football';
const OUT = 'data/experiment_survival_100/dataset/snapshot_inventory.json';
const TZ = '+08:00';

function parseName(name: string) {
  const m = name.match(/football_all_(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})-(\d{2})\.json$/);
  if (!m) return null;
  return { date: m[1], time: `${m[2]}:${m[3]}:${m[4]}` };
}
const ts = (d: string, t: string) => Date.parse(`${d}T${t}${TZ}`);
function hasResult(date: string, matchId: string) {
  const p = join(HIST_DIR, `${date}.json`);
  if (!existsSync(p)) return false;
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'));
    const m = (j.matches || []).find((x: any) => String(x.matchId) === String(matchId));
    return !!(m && m.poolStatus === 'Payout' && m.sectionsNo999 && m.winFlag);
  } catch { return false; }
}

const files = existsSync(ODDS_DIR) ? readdirSync(ODDS_DIR).filter((f) => /^football_all_.*\.json$/.test(f)) : [];
const inventory: any[] = [];
const totals = { strict: 0, doubtful: 0, noKickoff: 0, noResult: 0 };
let totalMatches = 0;

for (const f of files) {
  const p = join(ODDS_DIR, f);
  const name = parseName(f);
  const st = statSync(p);
  const hash = createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16);
  const j = JSON.parse(readFileSync(p, 'utf8'));
  const nameMs = name ? ts(name.date, name.time) : NaN;
  const mtimeMs = st.mtimeMs;
  const per = { file: f, nameTime: name ? `${name.date}T${name.time}${TZ}` : null, nameMs, mtime: new Date(mtimeMs).toISOString(), deltaNameVsMtimeSec: name ? Math.round((mtimeMs - nameMs) / 1000) : null, sha256_16: hash, matches: 0, strict: 0, doubtful: 0, noKickoff: 0, noResult: 0, oddsLaterThanName: 0 };
  for (const g of j?.value?.matchInfoList || []) {
    for (const m of g.subMatchList || []) {
      per.matches++; totalMatches++;
      if (!m.matchDate || !m.matchTime || !m.had?.updateDate || !m.had?.updateTime) { per.noKickoff++; totals.noKickoff++; continue; }
      const kickMs = ts(m.matchDate, m.matchTime);
      const oddsMs = ts(m.had.updateDate, m.had.updateTime);
      if (oddsMs > nameMs) { per.doubtful++; per.oddsLaterThanName++; totals.doubtful++; continue; }
      if (!hasResult(m.matchDate, m.matchId)) { per.noResult++; totals.noResult++; continue; }
      if (Number.isFinite(kickMs) && oddsMs < kickMs) { per.strict++; totals.strict++; }
      else { per.doubtful++; totals.doubtful++; }
    }
  }
  inventory.push(per);
}

const out = {
  generatedAt: new Date().toISOString(),
  countingUnit: '比赛（同一场只计一次；同一场在多个快照出现会被多次计数，见下）',
  note: '文件级清单与比赛级分级混在一个结构里；totals 按“快照×场次”计数，不是独立比赛数',
  files: inventory,
  totals,
  totalMatchesSeen: totalMatches,
  distinctFiles: inventory.length,
  distinctMatches: (() => {
    const s = new Set<string>();
    for (const f of files) {
      try {
        const j = JSON.parse(readFileSync(join(ODDS_DIR, f), 'utf8'));
        for (const g of j?.value?.matchInfoList || []) for (const m of g.subMatchList || []) s.add(String(m.matchId));
      } catch {}
    }
    return s.size;
  })(),
};
mkdirSync('data/experiment_survival_100/dataset', { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');

console.log(JSON.stringify({
  files: out.distinctFiles,
  matchesSeenAcrossFiles: out.totalMatchesSeen,
  distinctMatchIds: out.distinctMatches,
  totals,
  worstDelta: inventory.map((x) => ({ f: x.file, delta: x.deltaNameVsMtimeSec, doubtful: x.doubtful })).filter((x) => x.doubtful > 0).slice(0, 10),
  out: OUT,
}, null, 2));
