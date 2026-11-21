// 确认后 kill 本项目 v2 server PID（restart.ts 同逻辑：只动 9000 本项目进程）
const pid = Number(process.argv[2]);
if (!pid) { console.error('需要 PID'); process.exit(2); }
try { process.kill(pid); console.log(`[kill9000] ${pid} SIGTERM 已发送 ${new Date().toISOString()}`); }
catch (e: any) { console.error('[kill9000]', e.message); process.exit(1); }
setTimeout(() => process.exit(0), 2000);
