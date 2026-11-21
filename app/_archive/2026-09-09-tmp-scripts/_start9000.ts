import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
const APP = dirname(dirname(fileURLToPath(import.meta.url)));
const probe = (port: number): Promise<boolean> => new Promise(res => {
  const req = https.get(`https://127.0.0.1:${port}/api/days`, { rejectUnauthorized: false, timeout: 15000 }, r => {
    r.resume(); r.on('end', () => res(true));
  });
  req.on('error', () => res(false));
});
const child = spawn(process.execPath, [join(APP, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(APP, 'src', 'server', 'app.ts')], {
  cwd: APP, detached: true, stdio: 'ignore', windowsHide: true,
});
child.unref();
console.log('[start9000] 已 spawn app.ts new');
const t0 = Date.now(); let ok = false;
while (Date.now() - t0 < 60000) { if (await probe(9000)) { ok = true; break; } await new Promise(r => setTimeout(r, 2000)); }
console.log(ok ? '[start9000] 9000 已恢复' : '[start9000] 60s 未探测到');
process.exit(0);
