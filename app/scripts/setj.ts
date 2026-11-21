// setj.ts - 追加今日 journal 条目（description: 计入附录日志）
import { getDoc, upsertDoc } from '../src/server/db/store.js';
function bj() { const d = new Date(Date.now() + 8 * 3600_000); return d.toISOString().slice(11, 16); }
async function main() {
  const date = process.argv[2] || new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const text = process.argv[3];
  const type = process.argv[4] || 'summary';
  if (!text) throw new Error('缺少日记文本');
  const raw = (await getDoc('journal:' + date)) || {};
  const doc = raw as { entries?: { text: string; time: string; type: string }[] };
  const entries = Array.isArray(doc.entries) ? doc.entries : [];
  entries.push({ text, time: bj(), type });
  await upsertDoc('journal:' + date, { ...doc, entries });
  console.log(`[journal] ${date} 追加 ${entries.length} 条`);
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });