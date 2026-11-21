import { loadBaseRates } from '../src/server/db/store.js';
(async () => {
  const br = await loadBaseRates();
  for (const k of ['英超','意甲','西甲','德甲','法甲','韩K联','巴甲']) {
    const b = br[k];
    if (b) console.log(k, 'H%', b.homeRate.toFixed(2), 'D%', b.drawRate.toFixed(2), 'A%', b.awayRate.toFixed(2), 'n', b.n);
  }
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
