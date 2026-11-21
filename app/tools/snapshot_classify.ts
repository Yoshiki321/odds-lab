/**
 * snapshot_classify.ts — 按"独立比赛"重新分类（与按快照×场次计数区分开）
 * 用法: node app/tools/snapshot_classify.ts
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ODDS = 'data/odds';
const HIST = 'data/history/football';
const OUT = 'data/experiment_survival_100/dataset/snapshot_classify.json';
const TZ = '+08:00';
const ts = (d: string, t: string) => Date.parse(`${d}T${t}${TZ}`);

function resultOf(date: string, id: string) {
  const p = join(HIST, `${date}.json`);
  if (!existsSync(p)) return null;
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'));
    const m = (j.matches || []).find((x: any) => String(x.matchId) === String(id));
    return m && m.poolStatus === 'Payout' && m.sectionsNo999 && m.winFlag ? m : null;
  } catch { return null; }
}

const perMatch = new Map<string, { strict: number; doubtful: number; noResult: number; noKickoff: number; nameTimes: number[]; kickoff?: number }>();

for (const f of readdirSync(ODDS).filter((x) => /^football_all_.*\.json$/.test(x))) {
  const m0 = f.match(/football_all_(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})-(\d{2})\.json$/);
  if (!m0) continue;
  const nameMs = Date.parse(`${m0[1]}T${m0[2]}:${m0[3]}:${m0[4]}Z`); // scraper.js uses UTC toISOString()
  let j: any; try { j = JSON.parse(readFileSync(join(ODDS, f), 'utf8')); } catch { continue; }
  for (const g of j?.value?.matchInfoList || []) for (const m of g.subMatchList || []) {
    const id = String(m.matchId);
    if (!perMatch.has(id)) perMatch.set(id, { strict: 0, doubtful: 0, noResult: 0, noKickoff: 0, nameTimes: [] });
    const rec = perMatch.get(id)!;
    if (!m.matchDate || !m.matchTime || !m.had?.updateDate || !m.had?.updateTime) { rec.noKickoff++; continue; }
    const kick = ts(m.matchDate, m.matchTime);
    const odds = ts(m.had.updateDate, m.had.updateTime);
    rec.kickoff = kick;
    if (odds > nameMs || !(odds < kick)) { rec.doubtful++; continue; }
    if (!resultOf(m.matchDate, id)) { rec.noResult++; continue; }
    rec.strict++;
    rec.nameTimes.push(nameMs);
  }
}

const distinct = [...perMatch.values()];
const cls = {
  distinctMatches: perMatch.size,
  strictOnly: distinct.filter((x) => x.strict > 0 && x.doubtful === 0).length,
  strictAndDoubtful: distinct.filter((x) => x.strict > 0 && x.doubtful > 0).length,
  doubtfulOnly: distinct.filter((x) => x.strict === 0 && x.doubtful > 0).length,
  noResultOnly: distinct.filter((x) => x.strict === 0 && x.doubtful === 0 && x.noResult > 0).length,
  noKickoffOnly: distinct.filter((x) => x.strict === 0 && x.doubtful === 0 && x.noResult === 0 && x.noKickoff > 0).length,
};
const usable = distinct.filter((x) => x.strict > 0);
const kickoffs = usable.map((x) => x.kickoff!).filter(Boolean).sort((a, b) => a - b);
const names = distinct.flatMap((x) => x.nameTimes).sort((a, b) => a - b);

const out = {
  generatedAt: new Date().toISOString(),
  counting: {
    distinctMatches: cls.distinctMatches,
    note: '本文件按“独立比赛”分类；snapshot_inventory.json 的 totals 是按“快照×场次”计数，两者不可相加',
  },
  classes: cls,
  usableMatches: usable.length,
  snapshotNameRange: names.length ? { from: new Date(names[0]).toISOString(), to: new Date(names[names.length - 1]).toISOString(), spanDays: +((names[names.length - 1] - names[0]) / 86400000).toFixed(2) } : null,
  kickoffRange: kickoffs.length ? { from: new Date(kickoffs[0]).toISOString(), to: new Date(kickoffs[kickoffs.length - 1]).toISOString(), spanDays: +((kickoffs[kickoffs.length - 1] - kickoffs[0]) / 86400000).toFixed(2) } : null,
};
writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 2));
