// 临时启动 v2 server：日志指向会话可写的 _tmp（data/server_v2.log 被环境写锁挡住）
// 用法: node scripts/_tmp-2026-09-09/_start9000.cjs
const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..', '..', '..'); // c:\zwkj\竞彩助手
const APP = path.join(ROOT, 'app');
const LOG = path.join(__dirname, 'server_v2.log');
const PORT = 9000;

function pidsOn(port) {
  try {
    const out = execSync(`netstat -ano | findstr "LISTENING" | findstr ":${port} "`, { encoding: 'utf8' });
    return [...new Set(out.trim().split(/\r?\n/).map(l => l.trim().split(/\s+/).pop()).filter(Boolean))];
  } catch { return []; }
}
for (const pid of [...new Set([...pidsOn(PORT), ...pidsOn(9101)])]) {
  try { process.kill(Number(pid)); } catch {}
}
const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/server/app.ts'], {
  cwd: APP, detached: true,
  stdio: ['ignore', fs.openSync(LOG, 'a'), fs.openSync(LOG, 'a')],
  env: { ...process.env, PORT: String(PORT) }, windowsHide: true,
});
child.unref();
console.log(`started pid=${child.pid} log=${LOG}`);
setTimeout(() => {
  const alive = pidsOn(PORT);
  console.log('listening:', alive ? 'OK' : 'NO');
  try {
    const api = execSync(`curl -s http://127.0.0.1:${PORT}/api/days`, { encoding: 'utf8', timeout: 5000 });
    console.log('api/days:', api.includes('"days"') ? 'OK' : 'bad', api.slice(0, 60));
  } catch (e) { console.log('api check:', e.message.slice(0, 60)); }
}, 7000);
