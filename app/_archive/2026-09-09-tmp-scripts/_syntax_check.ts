// _syntax_check.ts — 编译校验（事后删除）
import { migrate } from '../src/server/db/pool.js';
import { getRollingDrawRate, getSupportMap, loadBaseRates, saveBaseRates, upsertSupport, getOddsHistory } from '../src/server/db/store.js';

/* eslint-disable @typescript-eslint/no-unused-vars */
const probes = [getRollingDrawRate, getSupportMap, loadBaseRates, saveBaseRates, upsertSupport, getOddsHistory];
(async () => {
  await migrate();
  const r = await getRollingDrawRate('2026-09-09');
  console.log('rollingDrawRate before 09-09:', r.rate.toFixed(3), 'n=' + r.n, 'from', r.from.join(','));
  const s = await getSupportMap('2026-09-08');
  console.log('support 09-08 matches:', Object.keys(s).length);
  const br = await loadBaseRates();
  console.log('base_rates rows:', Object.keys(br).length, Object.keys(br).slice(0, 5));
  process.exit(0);
})().catch(e => { console.error('syntax-check fail:', e.message); process.exit(1); });