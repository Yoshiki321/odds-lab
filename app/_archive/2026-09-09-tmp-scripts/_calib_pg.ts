import { getDayResults } from '../src/server/db/store.js';
import { scoreDay } from '../tools/score.js';

async function main() {
  const days = ['2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08'];
  const all: { date: string; r: any; res: any }[] = [];
  for (const d of days) {
    const rows = await scoreDay(d, 1, `${d}T18:00:00+08:00`);
    const results = await getDayResults(d);
    for (const r of rows) all.push({ date: d, r, res: results[r.matchId] });
  }
  all.sort((a, b) => b.r.total - a.r.total);
  function status(r: any, res: any): '✅' | '❌' | '·' {
    if (!res) return '·';
    const key = r.market === 'HHAD' ? (res.hhad ?? res.had) : (res.had ?? res.hhad);
    if (!key) return '·';
    return key === r.pred ? '✅' : '❌';
  }
  let out = '';
  for (const { date, r, res } of all) {
    const name = (r.home + '-' + r.away).padEnd(16);
    const score = res ? `${res.had ?? ''}/${res.hhad ?? ''}(${res.score ?? ''})` : '未开';
    out += `${String(r.total).padStart(3)} ${status(r, res)} ${r.num} ${name} ${date} ${(r.dir + '@' + r.odds).padEnd(16)} ${r.band.padEnd(10)} 实盘${score}\n`;
  }
  console.log(out);
  console.log('TOTAL', all.length);
  const tiers = [50, 48, 46, 44, 42, 40, 38, 36, 34, 32, 30];
  for (const t of tiers) {
    const seg = all.filter((x) => x.r.total >= t);
    let hit = 0, miss = 0, pend = 0;
    for (const { r, res } of seg) {
      const s = status(r, res);
      if (s === '✅') hit++;
      else if (s === '❌') miss++;
      else pend++;
    }
    console.log(`≥${t}: ${seg.length}场 ✅${hit} ❌${miss} ·${pend} => 命中率 ${hit}/(${hit + miss}) = ${hit + miss ? Math.round((100 * hit) / (hit + miss)) : 0}%`);
  }
  process.exit(0);
}
main();
