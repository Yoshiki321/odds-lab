// switch.ts - 一键切换：旧版 → v2 迁移
// 1. 导入 data/ → PG (ingest_legacy)
// 2. 停旧 server.js (9000) —— 只杀本项目端口进程（安全配置允许范围，不用 taskkill）
// 3. 启新 app (9000)
// 4. 验证 API 响应
import { execSync, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = dirname(dirname(fileURLToPath(import.meta.url)));   // app/
const ROOT = dirname(APP);                                       // 项目根

/** 监听指定端口的 PID 集合（netstat 只读，Windows 无参进程安全） */
function pidsOn(port: number): string[] {
  try {
    const out = execSync(`netstat -ano | findstr "LISTENING" | findstr ":${port} "`, { encoding: 'utf8' });
    return [...new Set(out.trim().split(/\r?\n/).map(l => l.trim().split(/\s+/).pop()).filter((x): x is string => !!x))];
  } catch { return []; }
}

async function switchToV2() {
  console.log('[switch] 开始迁移...');

  // 1. 导入历史数据
  console.log('[1/4] 导入 data/ → PG...');
  execSync('npm run ingest', { cwd: APP, stdio: 'inherit' });

  // 2. 停旧服务（只回收本项目 9000 端口进程）
  console.log('[2/4] 停止旧 server.js...');
  const pids = pidsOn(9000);
  if (pids.length) {
    for (const pid of pids) {
      try { process.kill(Number(pid)); console.log('  停止 PID', pid); }
      catch { console.log('  PID', pid, '跳过'); }
    }
    const t0 = Date.now();
    while (pidsOn(9000).length && Date.now() - t0 < 6000) await new Promise(r => setTimeout(r, 150));
  } else {
    console.log('  (9000 无旧服务)');
  }

  // 3. 启新服务（detached 后台，windowsHide 不弹窗）
  console.log('[3/4] 启动 v2 app...');
  const child = spawn(process.execPath, [join(APP, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(APP, 'src', 'server', 'app.ts')], {
    cwd: APP, detached: true, stdio: 'ignore', windowsHide: true,
  });
  child.unref();

  // 4. 验证
  console.log('[4/4] 验证 API...');
  await new Promise(r => setTimeout(r, 4000));
  try {
    const resp = await fetch('http://localhost:9000/api/days');
    if (resp.ok) {
      console.log('[switch] ✅ 迁移完成，v2 运行在 http://localhost:9000');
    } else {
      throw new Error(`API 返回 ${resp.status}`);
    }
  } catch (e: any) {
    console.error('[switch] ❌ API 验证失败:', e.message);
    process.exit(1);
  }
}

switchToV2().catch(e => {
  console.error('[switch] 迁移失败:', e);
  process.exit(1);
});