// restart.ts - 重启 v2：停 9000 本进程（本项目进程）→ 后台起 app.ts → 验证 API
// 安全：只 kill 9000 监听 PID（本项目 v2），不 taskkill 不碰系统进程
import { execSync, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const APP = dirname(dirname(fileURLToPath(import.meta.url)));

function pidsOn(port: number): string[] {
  try {
    const out = execSync(`netstat -ano | findstr "LISTENING" | findstr ":${port} "`, { encoding: 'utf8', timeout: 5000 });
    return [...new Set(out.trim().split(/\r?\n/).map(l => l.trim().split(/\s+/).pop()).filter((x): x is string => !!x))];
  } catch { return []; }
}

const waitGone = async (port: number) => {
  const t0 = Date.now();
  while (pidsOn(port).length && Date.now() - t0 < 8000) await new Promise(r => setTimeout(r, 200));
};

const probe = (port: number): Promise<boolean> => new Promise(res => {
  https.get(`https://127.0.0.1:${port}/api/days`, { rejectUnauthorized: false, timeout: 8000 }, r => {
    r.resume(); r.on('end', () => res(true));
  }).on('error', () => res(false));
});

async function main() {
  // 停
  const pids = pidsOn(9000);
  if (pids.length) {
    console.log('[restart] 停止 9000:', pids.join(','));
    for (const pid of pids) { try { process.kill(Number(pid)); } catch {} }
    await waitGone(9000);
  }
  // 起
  console.log('[restart] 启动 v2...');
  const child = spawn(process.execPath, [join(APP, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(APP, 'src', 'server', 'app.ts')], {
    cwd: APP, detached: true, stdio: 'ignore', windowsHide: true,
  });
  child.unref();
  // 验证
  const t0 = Date.now();
  let ok = false;
  while (Date.now() - t0 < 20000) {
    if (await probe(9000)) { ok = true; break; }
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log(ok ? '[restart] v2 已恢复 9000 (新代码生效)' : '[restart] 20s 未等起，请手动查');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });