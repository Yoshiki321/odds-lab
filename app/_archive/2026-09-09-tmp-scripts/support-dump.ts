import { pool } from '../../src/server/db/pool.js';
async function main() {
  const db = pool();
  const r = await db.query("select num, home, away, had, hhad, support from matches where num in ('周二004','周二005','周二007','周二010','周一001','周二001','周二003','周一004') order by num");
  for (const x of r.rows) {
    const s = x.support || {};
    const H = s.HHAD;
    if (!H) continue;
    console.log(`${x.num} ${x.home}-${x.away} | HAD盘口 ${JSON.stringify(x.had)}`);
    console.log(`  HHAD盘口 ${JSON.stringify(x.hhad)}`);
    console.log(`  HHAD-support win=${H.win} draw=${H.draw} lose=${H.lose} eValue=${H.eValue} hProb=${H.hProbability} dProb=${H.dProbability} aProb=${H.aProbability} hSup=${H.hSupportRate} aSup=${H.aSupportRate}`);
  }
  await db.end();
}
main().catch(e => { console.error(e); process.exit(1); });