// 修复版重启：netstat 正则取 9000 LISTENING PID（本项目 v2）→ kill → 拉起 app.ts → 探测
import { execSync, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
const APP = dirname(dirname(fileURLToPath(import.meta.url)));

const pidsOn = (port: number): string[] => {
  try {
    const out = execSync('netstat -ano', { encoding: 'utf8', timeout: 5000 });
    const re = new RegExp(`:${port}\s+\S+\s+LISTENING\s+(\d+)`);
    return [...new Set([...out.matchAll(re)].map(m => m[1]).filter(x => x !== '0'))];
  } catch { return []; }
};
const waitGone = async (port: number) => {
  const t0 = Date.now();
  while (pidsOn(port).length && Date.now() - t0 < 10000) await new Promise(r => setTimeout(r, 200));
};
const probe = (port: number): Promise<boolean> => new Promise(res => {
  https.get(`https://127.0.0.1:${port}/api/days`, { rejectUnauthorized: false, timeout: 8000 }, r => {
    r.resume(); r.on('end', () => res(true));
  }).on('error', () => res(false));
});
async function main() {
  const pids = pidsOn(9000);
  if (pids.length) {
    console.log('[restart2] 停止 9000:', pids.join(','));
    for (const pid of pids) { try { process.kill(Number(pid)); } catch {} }
    await waitGone(9000);
  }
  console.log('[restart2] 启动 v2...');
  const child = spawn(process.execPath, [join(APP, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(APP, 'src', 'server', 'app.ts')], {
    cwd: APP, detached: true, stdio: 'ignore', windowsHide: true,
  });
  child.unref();
  const t0 = Date.now(); let ok = false;
  while (Date.now() - t0 < 25000) { if (await probe(9000)) { ok = true; break; } await new Promise(r => setTimeout(r, 1000)); }
  console.log(ok ? '[restart2] v2 已恢复 9000 (新代码生效)' : '[restart2] 等待超时，需手动查');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
