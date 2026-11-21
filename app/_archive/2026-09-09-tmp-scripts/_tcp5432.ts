import net from 'node:net';
const s = new net.Socket();
const t0 = Date.now();
s.setTimeout(6000);
s.once('connect', () => { console.log(`TCP 5432 可连接 ${Date.now()-t0}ms`); s.destroy(); process.exit(0); });
s.once('timeout', () => { console.log(`TCP 5432 超时(${Date.now()-t0}ms)`); s.destroy(); process.exit(1); });
s.once('error', e => { console.log(`TCP 5432 error: ${e.message}`); process.exit(1); });
s.connect(5432, '127.0.0.1');
