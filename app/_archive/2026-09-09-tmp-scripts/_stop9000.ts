// 只停本项目 9000 v2 server（restart.ts 同逻辑）；不起新进程（由调用方决定）
import { spawnSync } from 'node:child_process';
const pid = Number(process.argv[2]);
if (!pid || !Number.isInteger(pid)) { console.error('用法: _stop9000.ts <PID>'); process.exit(2); }
const out = spawnSync('netstat', ['-ano'], { encoding: 'utf8', timeout: 5000 });
const re = new RegExp(`:9000\s+\S+\s+LISTENING\s+${pid}`);
const still = out.stdout?.match(re);
if (!still) { console.log(`[stop9000] ${pid} 未在 9000 LISTENING，跳过`); process.exit(0); }
console.log(`[stop9000] kill ${pid}...`);
try { process.kill(pid); } catch (e: any) { console.error('kill 异常:', e.message); process.exit(1); }
// 等待端口释放（最多 10s）
for (let i = 0; i < 50; i++) {
  await new Promise(r => setTimeout(r, 200));
  const chk = spawnSync('netstat', ['-ano'], { encoding: 'utf8', timeout: 5000 });
  const gone = !chk.stdout?.match(re);
  if (gone) { console.log(`[stop9000] 端口已释放 (${new Date().toISOString()})`); process.exit(0); }
}
console.log('[stop9000] 10s 内端口未释放'); process.exit(1);
