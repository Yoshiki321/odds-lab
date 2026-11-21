// restart_server.cjs — 重启本项目Odds-Lab服务器（优雅：杀旧实例→等端口释放→拉起→自检）
// 用法: node tools/restart_server.cjs [port]   （默认 9000）
// 目的: 避免直接 rm/taskkill 系统级命令，仅操作本项目自身进程（安全配置允许范围）
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2] || 9000);
const ROOT = path.join(__dirname, '..');
const LOG = path.join(ROOT, 'data', 'server.log');

// 1. 找本项目的 node server（监听指定端口者），仅杀这些
function pidsOn(port) {
  try {
    const out = execSync(`netstat -ano | findstr "LISTENING" | findstr ":${port} "`, { encoding: 'utf8' });
    return [...new Set(out.trim().split(/\r?\n/).map(l => l.trim().split(/\s+/).pop()).filter(Boolean))];
  } catch { return []; }
}

const targets = [...new Set([...pidsOn(PORT), ...pidsOn(9000), ...pidsOn(9101)])];
if (!targets.length) {
  console.log('未发现运行中的项目服务器，直接启动。');
} else {
  console.log('回收本项目旧 server 进程:', targets.join(', '));
  for (const pid of targets) {
    try { process.kill(Number(pid)); } catch (e) { console.log('  PID', pid, '跳过:', e.message); }
  }
  // 等端口释放（最多 6s）
  const t0 = Date.now();
  while (pidsOn(PORT).length && Date.now() - t0 < 6000) { pause(150); }
}

// 2. 拉起新服务器（detached，独立于本会话存活）
// v2：跑 TS+PG 版（app/src/server/app.ts，PORT 环境变量控制；tsx 作为本地依赖拉起）
// 注意：生产跑 v2（app/src/server/app.ts 独占 9000）；根 server.js 为 v1 遗留（前端目录自动回落 app/public），仅本地排障用，不在生产启动
const APP = path.join(ROOT, 'app');
const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/server/app.ts'], {
  cwd: APP, detached: true,
  stdio: ['ignore', fs.openSync(path.join(ROOT, 'data', 'server_v2.log'), 'a'), fs.openSync(path.join(ROOT, 'data', 'server_v2.log'), 'a')],
  env: { ...process.env, PORT: String(PORT) }, windowsHide: true,
});
child.unref();
console.log(`已启动 v2 server (app/src/server/app.ts) port=${PORT} (pid ${child.pid})`);

// 3. 自检（tsx 冷启动需数秒，别急着判失败）
pause(7000);
const alive = pidsOn(PORT).length;
console.log('端口监听:', alive ? `OK (pid ${pidsOn(PORT).join(',')})` : '未监听!');
try {
  const api = execSync(`curl -s http://127.0.0.1:${PORT}/api/days`, { encoding: 'utf8', timeout: 5000 });
  const ok = api.includes('"days"');
  console.log(`API /api/days: ${ok ? 'OK ✓ (' + (api.match(/"days":\[.*?\]/) || ['?'])[0].slice(0, 80) + '...)' : '异常'}`);
} catch (e) { console.log('API 自检异常:', e.message); }

function pause(ms) { const b = Date.now(); while (Date.now() - b < ms) {} }