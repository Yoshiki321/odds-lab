// ws-test.ts - WebSocket 端到端验证：连接→订阅→外部写 change_log→确认收到实时推送
// 用法: npx tsx scripts/ws-test.ts [YYYY-MM-DD] [port]
import WebSocket from 'ws';
import { markChange } from '../src/server/db/pool.js';

async function main() {
  const arg = process.argv[2];
  const bj = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const date = arg && /^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : bj();
  const port = process.argv[3] || '9001';

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const got: string[] = [];
  const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    got.push(m.type);
    console.log(`  [recv] ${m.type} ${m.type === 'day' ? `view.table=${m.view?.table?.length} scoreVersion=${m.view?.scoreVersion}` : m.type === 'hello' ? 'now=' + m.now : m.type === 'status' ? 'ok=' + m.status?.ok : ''}`);
  });

  await new Promise<void>((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  console.log('[1] 已连接');

  ws.send(JSON.stringify({ action: 'sub', room: `day:${date}` }));
  ws.send(JSON.stringify({ action: 'sub', room: 'summary' }));
  ws.send(JSON.stringify({ action: 'sub', room: 'status' }));
  await wait(1500);

  console.log('[2] 订阅 3 房间，等 1.5s');
  if (!got.includes('day')) { console.error('FAIL: 未收到 day 快照'); process.exit(1); }
  console.log('[2] OK: day 快照已收');

  await markChange('day', date);
  await wait(5000);
  const dayCount = got.filter(x => x === 'day').length;
  console.log(`[3] 写变更哨兵 → 5s 内收到 day 推送 ${dayCount} 次（期望 ≥2：订阅快照 + 变更推送）`);
  if (dayCount < 2) { console.error('FAIL: 变更未触发推送'); process.exit(1); }
  console.log('[3] OK: 实时推送生效（需求1：前端不刷新页面实时变）');

  ws.close();
  console.log('\nWS 端到端通过 ✅');
  process.exit(0);
}
main().catch(e => { console.error('ws-test 失败:', e); process.exit(1); });