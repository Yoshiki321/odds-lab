/**
 * 球队 Elo 滚动计算（v1 · 只入库不接评分）
 *
 * 输入：data/history/football/*.json（官方历史赛果，2026-01-01 起）+ PG results 表（近两日终场）
 * 算法：标准三结果 Elo，K=40，主场优势 +100，平局按 0.5 处理（eloratings.net 流派）
 * 输出：team_elo 表 upsert（elo / n / last_at），home_elo/away_elo 首版不做分区评分，填 elo 占位
 *
 * 用法：
 *   npx tsx tools/elo.ts           # 全量重算
 *   npx tsx tools/elo.ts --debug   # 打印 top 队伍
 *
 * 注意：
 * - 球队 key 用中文全名（history allHomeTeam / PG matches.home 归一化），跨源同一队若名称写法不同
 *   会各算各的，后续接评分时用匹配层（normName）再做归并。
 * - 语料 2680（history）+ ~68（PG results），9 个月，足够 bootstrap。
 */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { query, pool } from '../src/server/db/pool.js';
import { saveElo } from '../src/server/db/store.js';

const HISTORY_DIR = 'C:/zwkj/竞彩助手/data/history/football';
const K = 40;
const HOME_ADV = 100;
const START_ELO = 1500;

interface FinMatch {
  matchId: string;
  date: string;          // 'YYYY-MM-DD'（PG 取北京时区 kickoff 日）
  num: number;           // 日内排序（history matchNum / PG num）
  league: string;
  home: string;
  away: string;
  outcome: 'H' | 'D' | 'A';
}

/** 归一化球队名：去空格、去尾 FC/队 后缀、大写拉丁 */
function normName(n: string): string {
  return n.replace(/\s+/g, '').replace(/FC$/i, '').replace(/队$/g, '').toLowerCase();
}

/** 读取 PG results + matches，补最近两天终场 */
async function loadPgResults(): Promise<FinMatch[]> {
  const r = await query(
    `SELECT m.match_id, m.home, m.away, m.league, m.kickoff, m.num, res.had
       FROM results res JOIN matches m USING (match_id)
      WHERE res.had IN ('H','D','A')`);
  return r.rows.map((m: any) => {
    const dt = new Date(m.kickoff);
    const beijing = new Date(dt.getTime() + 8 * 3600 * 1000);
    const date = beijing.toISOString().slice(0, 10);
    return {
      matchId: String(m.match_id),
      date,
      num: Number(m.num ?? 0),
      league: m.league ?? '',
      home: m.home,
      away: m.away,
      outcome: m.had as 'H' | 'D' | 'A',
    };
  });
}

/** 读取 data/history/football 官方历史赛果 */
function loadHistory(): FinMatch[] {
  const out: FinMatch[] = [];
  if (!fs.existsSync(HISTORY_DIR)) return out;
  const files = fs.readdirSync(HISTORY_DIR).filter(f => /^\d{4}-\d{2}-\d{2}/.test(f)).sort();
  for (const f of files) {
    let d: any;
    try { d = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, f), 'utf-8')); } catch { continue; }
    for (const m of (d.matches ?? [])) {
      if (!m.winFlag || m.winFlag === '') continue;
      if (!m.allHomeTeam || !m.allAwayTeam) continue;
      out.push({
        matchId: String(m.matchId),
        date: m.matchDate || f.slice(0, 10),
        num: Number(m.matchNum ?? 0),
        league: m.leagueName ?? m.leagueNameAbbr ?? '',
        home: m.allHomeTeam,
        away: m.allAwayTeam,
        outcome: m.winFlag as 'H' | 'D' | 'A',
      });
    }
  }
  return out;
}

interface TeamStat { elo: number; n: number; lastAt: string | null; league: string }

async function run(): Promise<{ matches: number; teams: number }> {
  const pg = await loadPgResults();
  const hist = loadHistory();
  const byId = new Map<string, FinMatch>();
  for (const m of [...hist, ...pg]) {
    const prev = byId.get(m.matchId);
    if (!prev || m.num > prev.num || (m.num === prev.num && m.date > prev.date)) byId.set(m.matchId, m);
  }
  const all = [...byId.values()].sort((a, b) => a.date === b.date ? a.num - b.num : a.date < b.date ? -1 : 1);
  const teams = new Map<string, TeamStat>();
  const init = (name: string, league: string): TeamStat => {
    const key = normName(name);
    let t = teams.get(key);
    if (!t) { t = { elo: START_ELO, n: 0, lastAt: null, league }; teams.set(key, t); }
    if (!t.league && league) t.league = league;
    return t;
  };
  for (const m of all) {
    const h = init(m.home, m.league);
    const a = init(m.away, m.league);
    const E_h = 1 / (1 + Math.pow(10, (a.elo - (h.elo + HOME_ADV)) / 400));
    const E_a = 1 - E_h;
    const [wh, wa] = m.outcome === 'H' ? [1, 0] : m.outcome === 'A' ? [0, 1] : [0.5, 0.5];
    h.elo += K * (wh - E_h);
    a.elo += K * (wa - E_a);
    h.n += 1; a.n += 1;
    h.lastAt = m.date; a.lastAt = m.date;
  }
  // 入库
  for (const [key, t] of teams) {
    await saveElo({ team: key, league: t.league, elo: Math.round(t.elo), homeElo: Math.round(t.elo), awayElo: Math.round(t.elo), n: t.n, lastAt: t.lastAt });
  }
  const debug = process.argv.includes('--debug');
  if (debug) {
    const sorted = [...teams.entries()].sort((a, b) => b[1].elo - a[1].elo).slice(0, 10);
    console.log('teams:', teams.size, '| matches:', all.length);
    for (const [k, t] of sorted) console.log(`  ${k.padEnd(14)} elo=${t.elo.toFixed(0)}  n=${t.n}  ${t.league}`);
  } else {
    console.log(`Elo 全量重算完成: ${all.length} 场 进 ${teams.size} 队 (n>=2: ${[...teams.values()].filter(t => t.n >= 2).length})`);
  }
  return { matches: all.length, teams: teams.size };
}

/** 供 refresh.ts 接线调用：不关连接池（共享） */
export async function computeEloAndSave(): Promise<{ matches: number; teams: number }> {
  return run();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().then(() => pool().end()).catch(e => { console.error('elo failed:', e); process.exit(1); });
}
