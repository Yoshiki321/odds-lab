// league_suspects.ts — 列出可疑串味行：kickoff + 是否在官方历史
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '../../src/server/db/pool.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HIST = join(ROOT, 'data', 'history', 'football');
const TEAMS = ['沙尔克04', '帕德博恩', '勒芒', '特鲁瓦', '西汉姆联', '埃沃斯堡'];

const inHist = new Map<string, string>();
for (const f of readdirSync(HIST).filter((x: string) => /^\d{4}-\d{2}-\d{2}\.json$/.test(x))) {
  let j: any;
  try { j = JSON.parse(readFileSync(join(HIST, f), 'utf8')); } catch { continue; }
  for (const r of (j.matches || [])) {
    if (r.matchId != null && r.leagueNameAbbr) inHist.set(String(r.matchId), r.leagueNameAbbr);
  }
}
const rows = (await query(
  'SELECT match_id, num, league, home, away, kickoff FROM matches WHERE ' +
  TEAMS.map((t) => `(home='${t}' OR away='${t}')`).join(' OR ') + ' ORDER BY kickoff'
)).rows as any[];
for (const r of rows) {
  console.log(r.match_id, r.num, 'pg=' + r.league, 'hist=' + (inHist.get(String(r.match_id)) ?? '无记录'),
    r.home + '-' + r.away, String(r.kickoff).slice(0, 16));
}
console.log('rows=' + rows.length);
process.exit(0);
