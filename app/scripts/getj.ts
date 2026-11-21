// getj.ts - 读某日 journal（docs.journal:YYYY-MM-DD）
import { getDoc } from '../src/server/db/store.js';
async function run() {
  const d = process.argv[2] || new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const doc = await getDoc('journal:' + d);
  if (!doc) { console.log(`[${d}] 无日记`); process.exit(0); }
  console.log(JSON.stringify(doc, (k, v) => v instanceof Date ? v.toISOString() : v, 1));
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });