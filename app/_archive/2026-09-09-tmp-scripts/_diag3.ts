import { getDayMatches } from '../src/server/db/store.js';
(async () => {
  const ms = await getDayMatches('2026-09-08');
  for (const mid of ['2041331', '2041337']) {
    const m = ms.find(x => x.matchId === mid) ?? ms[0];
    const s = m.support as any;
    console.log(`\n== ${m.num} ${m.home}-${m.away} had[${JSON.stringify(m.had)}] hhad[${JSON.stringify(m.hhad)}]`);
    if (s) {
      const had = s.HAD, hhad = s.HHAD;
      console.log('HAD block:', had ? JSON.stringify({ hP: had.hProbability, dP: had.dProbability, aP: had.aProbability, hS: had.hSupportRate, eKey: had.eKey, eValue: had.eValue }) : 'none');
      console.log('HHAD block:', hhad ? JSON.stringify({ hP: hhad.hProbability, dP: hhad.dProbability, aP: hhad.aProbability, hS: hhad.hSupportRate, eKey: hhad.eKey, eValue: hhad.eValue }) : 'none');
    }
  }
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });