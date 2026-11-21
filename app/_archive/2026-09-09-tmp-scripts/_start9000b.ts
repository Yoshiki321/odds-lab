import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSync } from 'node:fs';
const HERE = dirname(fileURLToPath(import.meta.url));
const APP = dirname(dirname(HERE));
const log = join(HERE, '_app9000.log');
const fd = openSync(log, 'a');
const child = spawn(process.execPath, [join(APP, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(APP, 'src', 'server', 'app.ts')], {
  cwd: APP, detached: true, windowsHide: true,
  stdio: ['ignore', fd, fd],
});
child.on('error', e => { console.log('spawn error:', e.message); });
child.unref();
console.log('[start9000b] spawned ->', log);
setTimeout(() => process.exit(0), 3000);
