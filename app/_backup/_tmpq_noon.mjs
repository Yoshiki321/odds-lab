// 检验：编号周几 vs kickoff北京周几 → 应恒等（竞彩比赛日=编号日）
import { pool } from '../src/server/db/pool.js';
const p = pool();
const WD = ['周日','周一','周二','周三','周四','周五','周六'];
const r = await p.query(`SELECT num, kickoff, match_date FROM matches ORDER BY kickoff`);
let bad = 0;
for (const x of r.rows) {
  const k = new Date(x.kickoff);
  const bj = new Date(k.getTime() + 8 * 3600_000);
  const numWD = String(x.num).slice(0, 2);
  // 编号周几 → 找这个周几对应的日期：取 kickoff 所在自然日(北京)往前/后对齐
  const iso = bj.toISOString();
  const bjDay = Number(iso.slice(8, 10)), bjMon = Number(iso.slice(5, 7)), bjYear = Number(iso.slice(0, 4));
  const d = new Date(Date.UTC(bjYear, bjMon - 1, bjDay));
  // d 的 getUTCDay(): 0=Sun..6=Sat
  const wdIdx = WD.indexOf(numWD); // 周日=0，周一=1...
  // conv: getUTCDay 0(Sun)..6(Sat)；WD 周日=0...周六=6
  const curDow = d.getUTCDay();
  let diff = wdIdx - curDow;
  if (diff > 3) diff -= 7; else if (diff < -3) diff += 7;
  const sale = new Date(Date.UTC(bjYear, bjMon - 1, bjDay + diff));
  const saleDate = sale.toISOString().slice(0, 10);
  const stored = String(x.match_date).slice(0, 10);
  if (saleDate !== stored) {
    bad++;
    console.log('MISMATCH', String(x.num).padEnd(6), 'stored', stored, '应为', saleDate, '北京开赛', iso.slice(0, 16));
  }
}
console.log('bad =', bad);
const rr = await p.query(`SELECT num, count(*) FROM matches WHERE num LIKE '周日%' GROUP BY 1`); // 占位
await p.end(); process.exit(0);
