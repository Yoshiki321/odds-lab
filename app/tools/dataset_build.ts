/**
 * dataset_build.ts — 构建防泄漏逐场数据集（赛前独赢）
 * 用法: node app/tools/dataset_build.ts
 * 输出: data/experiment_survival_100/dataset/rows.jsonl + stats.json
 *
 * 时点规则（严格）：
 *  - captureMs  = 快照文件最后写入时间（实际拿到数据的时刻）
 *  - oddsMs     = 该场 had 的 updateDate+updateTime（数据源声称的赔率时刻）
 *  - predictMs  = max(captureMs, oddsMs) —— 只有到这一刻，这份赔率才确实可获得
 *  - 必须 predictMs < kickoffMs，否则丢弃（无法证明赛前可用）
 *  - 赛果从 data/history/football/<matchDate>.json 取，与预测记录分开存
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface Row {
  matchId: string;
  league: string;
  home: string;
  away: string;
  homeId: string;
  awayId: string;
  kickoffMs: number;
  predictMs: number;
  captureMs: number;
  oddsMs: number;
  source: string;
  market: 'HAD';
  side: 'H' | 'D' | 'A';
  line: null;
  odds: number;
  pBaseline: number;
  outcome: 0 | 1;
  score: string;
  /** 原始时间字符串，便于审计时区 */
  raw: { capture: string; oddsUpdate: string; kickoff: string };
}

const ODDS_DIR = 'data/odds';
const HIST_DIR = 'data/history/football';
const OUT_DIR = 'data/experiment_survival_100/dataset';

const TZ = '+08:00';
function parseBJ(date: string, time: string): number {
  const d = Date.parse(`${date}T${time}${TZ}`);
  return d;
}
function parseFileName(name: string): { date: string; time: string } | null {
  const m = name.match(/football_all_(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})-(\d{2})\.json$/);
  if (!m) return null;
  return { date: m[1], time: `${m[2]}:${m[3]}:${m[4]}` };
}
function fileMtimeMs(p: string): number { return statSync(p).mtimeMs; }
function readJson(p: string): any { return JSON.parse(readFileSync(p, 'utf8')); }

function loadResult(matchDate: string, matchId: string): { score: string; winFlag: string } | null {
  const p = join(HIST_DIR, `${matchDate}.json`);
  if (!existsSync(p)) return null;
  const j = readJson(p);
  const arr = j.matches || [];
  const m = arr.find((x: any) => String(x.matchId) === String(matchId));
  if (!m) return null;
  if (m.poolStatus !== 'Payout' || !m.sectionsNo999 || !m.winFlag) return null;
  return { score: m.sectionsNo999, winFlag: m.winFlag };
}

export function impliedProbs(h: number, d: number, a: number): { h: number; d: number; a: number } | null {
  if (![h, d, a].every((x) => Number.isFinite(x) && x > 1)) return null;
  const inv = [1 / h, 1 / d, 1 / a];
  const z = inv[0] + inv[1] + inv[2];
  return { h: inv[0] / z, d: inv[1] / z, a: inv[2] / z };
}

export function rowKey(r: Pick<Row, 'matchId' | 'kickoffMs' | 'market' | 'side' | 'line' | 'predictMs'>): string {
  return `${r.matchId}|${r.kickoffMs}|${r.market}|${r.side}|${r.line ?? 'null'}|${r.predictMs}`;
}

/** 防泄漏判定：四个时间必须都是有限数值；预测必须早于开赛；数据时点不得晚于预测时点 */
export function isLeakFree(r: Pick<Row, 'kickoffMs' | 'predictMs' | 'captureMs' | 'oddsMs'>): { ok: boolean; reason?: string } {
  const fields: Array<[string, unknown]> = [
    ['kickoffMs', r.kickoffMs], ['predictMs', r.predictMs], ['captureMs', r.captureMs], ['oddsMs', r.oddsMs],
  ];
  for (const [name, v] of fields) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, reason: `${name} 非有限数值（${String(v)}）` };
  }
  if (r.predictMs >= r.kickoffMs) return { ok: false, reason: '预测不早于开赛' };
  if (r.captureMs > r.predictMs) return { ok: false, reason: '采集时点晚于预测时点' };
  if (r.oddsMs > r.predictMs) return { ok: false, reason: '赔率时点晚于预测时点' };
  return { ok: true };
}

export function buildRows(): { rows: Row[]; stats: any } {
  const files = existsSync(ODDS_DIR)
    ? readdirSync(ODDS_DIR).filter((f) => /^football_all_.*\.json$/.test(f))
    : [];
  const rows: Row[] = [];
  const dropped = { noResult: 0, badOdds: 0, afterKickoff: 0, noTime: 0, noKickoff: 0 };
  let snapshots = 0, matchesSeen = 0;

  for (const f of files) {
    const p = join(ODDS_DIR, f);
    let j: any;
    try { j = readJson(p); } catch { continue; }
    const lists = j?.value?.matchInfoList || [];
    const nameTime = parseFileName(f);
    // scraper.js 文件名为 UTC 时间戳，优先用文件名 UTC 时间（与 mtime 误差 <=1s）
    const captureMs = nameTime ? Date.parse(`${nameTime.date}T${nameTime.time}Z`) : fileMtimeMs(p);
    snapshots++;
    for (const group of lists) {
      for (const m of group.subMatchList || []) {
        matchesSeen++;
        if (!m.matchDate || !m.matchTime) { dropped.noKickoff++; continue; }
        const kickoffMs = parseBJ(m.matchDate, m.matchTime);
        if (!Number.isFinite(kickoffMs)) { dropped.noKickoff++; continue; }
        const had = m.had || {};
        if (!had.updateDate || !had.updateTime) { dropped.noTime++; continue; }
        const oddsMs = parseBJ(had.updateDate, had.updateTime);
        if (!Number.isFinite(oddsMs)) { dropped.noTime++; continue; }
        const h = Number(had.h), d = Number(had.d), a = Number(had.a);
        const fair = impliedProbs(h, d, a);
        if (!fair) { dropped.badOdds++; continue; }
        const predictMs = Math.max(captureMs, oddsMs);
        if (!(predictMs < kickoffMs)) { dropped.afterKickoff++; continue; }
        const res = loadResult(m.matchDate, m.matchId);
        if (!res) { dropped.noResult++; continue; }
        const [hs, as] = res.score.split(':').map(Number);
        const actual: 'H' | 'D' | 'A' = hs > as ? 'H' : hs === as ? 'D' : 'A';
        const sides: Array<'H' | 'D' | 'A'> = ['H', 'D', 'A'];
        for (const side of sides) {
          rows.push({
            matchId: String(m.matchId),
            league: m.leagueAbbName || m.leagueAllName || '',
            home: m.homeTeamAbbName || m.homeTeamAllName || '',
            away: m.awayTeamAbbName || m.awayTeamAllName || '',
            homeId: String(m.homeTeamId ?? ''),
            awayId: String(m.awayTeamId ?? ''),
            kickoffMs,
            predictMs,
            captureMs,
            oddsMs,
            source: `odds/${f}`,
            market: 'HAD',
            side,
            line: null,
            odds: side === 'H' ? h : side === 'D' ? d : a,
            pBaseline: side === 'H' ? fair.h : side === 'D' ? fair.d : fair.a,
            outcome: actual === side ? 1 : 0,
            score: res.score,
            raw: {
              capture: new Date(captureMs).toISOString(),
              oddsUpdate: `${had.updateDate}T${had.updateTime}${TZ}`,
              kickoff: `${m.matchDate}T${m.matchTime}${TZ}`,
            },
          });
        }
      }
    }
  }

  // 去重：matchId+kickoff+market+side+line+predictMs
  const seen = new Set<string>();
  const uniq = rows.filter((r) => {
    if (!isLeakFree(r).ok) return false;
    const k = rowKey(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const matches = new Set(uniq.map((r) => `${r.matchId}|${r.kickoffMs}`));
  const stats = {
    snapshots,
    matchesSeen,
    rows: uniq.length,
    distinctMatches: matches.size,
    dropped,
    captureRange: uniq.length ? {
      from: new Date(Math.min(...uniq.map((r) => r.captureMs))).toISOString(),
      to: new Date(Math.max(...uniq.map((r) => r.captureMs))).toISOString(),
    } : null,
    kickoffRange: uniq.length ? {
      from: new Date(Math.min(...uniq.map((r) => r.kickoffMs))).toISOString(),
      to: new Date(Math.max(...uniq.map((r) => r.kickoffMs))).toISOString(),
    } : null,
    rowsWithLateOdds: uniq.filter((r) => r.oddsMs > r.captureMs).length,
    note: 'predictMs = max(captureMs, oddsMs)；要求 predictMs < kickoffMs',
  };
  return { rows: uniq, stats };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('dataset_build.ts')) {
  const { rows, stats } = buildRows();
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'rows.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n'), 'utf8');
  writeFileSync(join(OUT_DIR, 'stats.json'), JSON.stringify(stats, null, 2), 'utf8');
  console.log(JSON.stringify(stats, null, 2));
}
