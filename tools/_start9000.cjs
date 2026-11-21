// _start9000.cjs — 启动 9000（规避被锁的 restart_server.cjs），日志写到 server_v2.log，锁则换名
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'app');
function openLog() {
  const LOG = path.join(ROOT, 'data', 'server_v2.log');
  try { return fs.openSync(LOG, 'a'); }
  catch { const alt = LOG.replace('.log', `_${Date.now()}.log`); return fs.openSync(alt, 'a'); }
}
const logFd = openLog();
const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/server/app.ts'], {
  cwd: APP, detached: true, stdio: ['ignore', logFd, logFd],
  env: { ...process.env, PORT: '9000' }, windowsHide: true,
});
child.unref();
console.log('spawned pid', child.pid, '→ log fd', logFd);