import { pool } from '../src/server/db/pool.js';
const p = pool();
const WD = ['周日','周一','周二','周三','周四','周五','周六'];
const fmt = d => d.toISOString().slice(0, 10);
const r = await p.query(`SELECT num, kickoff, match_date FROM matches ORDER BY kickoff`);
let bad = 0, tot = 0;
for (const x of r.rows) {
  tot++;
  const k = new Date(x.kickoff);
  const bj = new Date(k.getTime() + 8 * 3600_000);
  const numWD = String(x.num).slice(0, 2);
  const bjDay = Number(bj.toISOString().slice(8, 10)), bjMon = Number(bj.toISOString().slice(5, 7)), bjYear = Number(bj.toISOString().slice(0, 4));
  const d = new Date(Date.UTC(bjYear, bjMon - 1, bjDay));
  const wdIdx = WD.indexOf(numWD);
  const curDow = d.getUTCDay();
  let diff = wdIdx - curDow;
  if (diff > 3) diff -= 7; else if (diff < -3) diff += 7;
  const sale = new Date(Date.UTC(bjYear, bjMon - 1, bjDay + diff));
  const saleDate = fmt(sale);
  const stored = x.match_date instanceof Date ? fmt(x.match_date) : String(x.match_date).slice(0, 10);
  if (saleDate !== stored) {
    bad++;
    console.log('✗', String(x.num).padEnd(6), 'stored', stored, '应为', saleDate, '| 北京开赛', bj.toISOString().slice(5, 16));
  }
}
console.log(`\n总数 ${tot}，错位 ${bad}`);
await p.end(); process.exit(0);
