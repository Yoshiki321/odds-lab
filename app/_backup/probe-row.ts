// probe-row.ts - 模拟 fetch-live 抓取，打印 2041302 原始行与合并结果
import { fetchLiveAndStore } from '../tools/fetch-live.js';
async function main() {
  const r = await fetchLiveAndStore();
  console.log('rows=', r.rows, 'sealed=', r.sealed, 'okoooHit=', r.okoooHit);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });