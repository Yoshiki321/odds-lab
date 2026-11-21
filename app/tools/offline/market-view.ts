/**
 * 看盘口（纯本地）：从 data/today、data/scores、data/odds 快照读盘，不开服务、不联网。
 *
 * 用法：
 *   npx tsx tools/offline/market-view.ts                 # 最近一天的盘口 + 评分
 *   npx tsx tools/offline/market-view.ts --date 2026-09-06
 *   npx tsx tools/offline/market-view.ts --moves         # 同一天多次快照的变盘（初盘 → 最新）
 *   npx tsx tools/offline/market-view.ts --moves --min 0.1
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(HERE, '..', '..', '..', 'data'); // app/tools/offline → 项目/data

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : def;
}
const has = (name: string) => process.argv.includes('--' + name);

function readJson(p: string): any | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}
function pad(s: string | number, n: number): string {
  const str = String(s ?? '');
  // 中文按 2 列宽对齐
  const width = [...str].reduce((w, ch) => w + (/[\u4e00-\u9fa5\uff00-\uffef]/.test(ch) ? 2 : 1), 0);
  return str + ' '.repeat(Math.max(0, n - width));
}
const num = (v: any): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const f2 = (v: any) => (num(v) == null ? '—' : Number(v).toFixed(2));

function latestTodayDate(): string | null {
  const dir = path.join(DATA, 'today');
  if (!fs.existsSync(dir)) return null;
  const dates = fs.readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  return dates.length ? dates[dates.length - 1].replace('.json', '') : null;
}

function printBoard(date: string): void {
  const today = readJson(path.join(DATA, 'today', `${date}.json`));
  if (!today?.matches?.length) {
    console.log(`[盘口] ${date} 没有 data/today 数据（本地文件缺失）`);
    return;
  }
  const scores = readJson(path.join(DATA, 'scores', `${date}.json`));
  const scoreByNum = new Map<string, any>();
  for (const r of scores?.rows ?? []) scoreByNum.set(String(r.num), r);

  console.log(`\n盘口 ${date} · ${today.matches.length} 场 · 抓取于 ${today.fetchedAt ?? '?'}`);
  console.log(pad('场次', 10) + pad('联赛', 8) + pad('主队', 12) + pad('客队', 12) + pad('开赛', 8) +
    pad('胜平负(主/平/客)', 20) + pad('让球线', 8) + pad('让球(主/平/客)', 20) + pad('分', 4) + pad('方向', 6) + '档位');
  for (const m of today.matches) {
    const had = m.had ?? {}, hhad = m.hhad ?? {};
    const line = String(hhad.goalLineValue ?? hhad.goalLine ?? '—');
    const s = scoreByNum.get(String(m.num));
    console.log(
      pad(m.num, 10) + pad(m.league, 8) + pad(m.home, 12) + pad(m.away, 12) +
      pad(String(m.matchTime ?? '').slice(0, 5), 8) +
      pad(`${f2(had.h)}/${f2(had.d)}/${f2(had.a)}`, 20) +
      pad(line, 8) +
      pad(`${f2(hhad.h)}/${f2(hhad.d)}/${f2(hhad.a)}`, 20) +
      pad(s?.total ?? '—', 4) + pad(s?.dir ?? '—', 6) + (s?.band ?? ''));
  }
  const scored = (scores?.rows ?? []).length;
  console.log(`\n评分覆盖 ${scored} 场${scored ? `（版本 ${scores?.version ?? '?'}，生成于 ${scores?.generatedAt ?? '?'}）` : ''}`);
  if (!scored) console.log('提示：这天没有评分文件，只有盘口。看盘口够用，判断分要另跑评分。');
}

interface MoveRow { num: string; league: string; home: string; away: string; from: any; to: any; tFrom: string; tTo: string }

function collectMoves(date: string): MoveRow[] {
  const dir = path.join(DATA, 'odds');
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.startsWith('football_all_') && f.endsWith('.json')).sort();
  const byMatch = new Map<string, { t: string; row: any }[]>();
  for (const f of files) {
    const j = readJson(path.join(dir, f));
    const stamp = (f.match(/football_all_(.*)\.json/)?.[1] ?? '').replace(/-/g, ':');
    for (const info of j?.value?.matchInfoList ?? []) {
      if (String(info.businessDate) !== date) continue;
      for (const sm of info.subMatchList ?? []) {
        const key = String(sm.matchId);
        if (!byMatch.has(key)) byMatch.set(key, []);
        byMatch.get(key)!.push({ t: stamp, row: sm });
      }
    }
  }
  const out: MoveRow[] = [];
  for (const [, list] of byMatch) {
    list.sort((a, b) => a.t.localeCompare(b.t));
    if (list.length < 2) continue;
    const first = list[0].row, last = list[list.length - 1].row;
    out.push({
      num: last.matchNumStr ?? last.matchNum ?? '', league: last.leagueAbbName ?? '',
      home: last.homeTeamAbbName ?? '', away: last.awayTeamAbbName ?? '',
      from: first, to: last, tFrom: list[0].t, tTo: list[list.length - 1].t,
    });
  }
  return out;
}

function printMoves(date: string, min = 0.03): void {
  const moves = collectMoves(date);
  if (!moves.length) {
    console.log(`\n[变盘] ${date} 没有可对比的快照（需要同一天至少 2 份 data/odds/football_all_*）`);
    return;
  }
  const rows = moves.map(m => {
    const dh = (num(m.to.had?.h) ?? 0) - (num(m.from.had?.h) ?? 0);
    const dd = (num(m.to.had?.d) ?? 0) - (num(m.from.had?.d) ?? 0);
    const da = (num(m.to.had?.a) ?? 0) - (num(m.from.had?.a) ?? 0);
    const lf = String(m.from.hhad?.goalLineValue ?? m.from.hhad?.goalLine ?? '');
    const lt = String(m.to.hhad?.goalLineValue ?? m.to.hhad?.goalLine ?? '');
    const lh = (num(m.to.hhad?.h) ?? 0) - (num(m.from.hhad?.h) ?? 0);
    const la = (num(m.to.hhad?.a) ?? 0) - (num(m.from.hhad?.a) ?? 0);
    return { m, dh, dd, da, lf, lt, lh, la, max: Math.max(Math.abs(dh), Math.abs(dd), Math.abs(da), Math.abs(lh), Math.abs(la)) };
  }).filter(r => r.max >= min || r.lf !== r.lt)
    .sort((a, b) => b.max - a.max);

  console.log(`\n变盘 ${date} · ${moves.length} 场有连续快照 · 展示 ${rows.length} 场（阈值 Δ${min} 或换线）`);
  if (!rows.length) { console.log('这段时间盘口基本没动。'); return; }
  console.log(pad('场次', 10) + pad('联赛', 8) + pad('主 vs 客', 24) + pad('主/平/客 Δ', 20) + pad('让球线', 12) + pad('让球水 Δ', 12) + '窗口');
  for (const r of rows) {
    const lineTxt = r.lf === r.lt ? (r.lf || '—') : `${r.lf || '—'}→${r.lt || '—'}`;
    console.log(
      pad(r.m.num, 10) + pad(r.m.league, 8) +
      pad(`${r.m.home} vs ${r.m.away}`, 24) +
      pad(`${r.dh >= 0 ? '+' : ''}${r.dh.toFixed(2)}/${r.dd >= 0 ? '+' : ''}${r.dd.toFixed(2)}/${r.da >= 0 ? '+' : ''}${r.da.toFixed(2)}`, 20) +
      pad(lineTxt, 12) +
      pad(`${r.lh >= 0 ? '+' : ''}${r.lh.toFixed(2)}/${r.la >= 0 ? '+' : ''}${r.la.toFixed(2)}`, 12) +
      `${r.m.tFrom.slice(11, 16)}→${r.m.tTo.slice(11, 16)}`);
  }
}

const date = arg('date') || latestTodayDate();
if (!date) { console.error('data/today 下没有任何日期文件'); process.exit(1); }
printBoard(date);
if (has('moves')) printMoves(date, Number(arg('min', '0.03')));
