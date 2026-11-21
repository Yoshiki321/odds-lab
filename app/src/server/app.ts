import { createServer } from 'node:http';
import { migrate } from './db/pool.js';
import { Hub } from './ws/hub.js';
import { createRouter } from './api.js';
import { startScanWorker } from './scheduler/worker.js';
import { startChangeWatcher } from './ws/watcher.js';
import { startLivePoller } from './live-poller.js';
import { startAutoRefresh, startHourlyRefresh } from './auto-refresh.js';

const PORT = Number(process.env.PORT) || 9000;
const HOST = process.env.HOST || '127.0.0.1';

async function start() {
  await migrate();
  const server = createServer();
  const hub = new Hub(server);
  const router = createRouter(hub);
  server.on('request', router);
  server.listen(PORT, HOST, () => {
    console.log(`[app] Odds-Lab v2 running on http://${HOST}:${PORT}`);
    console.log(`      WebSocket: ws://${HOST}:${PORT}/ws`);
  });

  startScanWorker();      // 扫描计划执行器（仅执行到点分析，不结算）
  startChangeWatcher(hub); // change_log 哨兵 → WS 广播
  startLivePoller();      // 实时比分轮询（每 60s 抓 sporttery → live_scores）
  startAutoRefresh();     // 开盘兜底（每日13:05北京检查，无场次才补跑 refresh）
  startHourlyRefresh();   // 整点全量刷新（每小时抓盘+评分，晚场开售自动填分）
}

start().catch(e => {
  console.error('[app] FATAL:', e);
  process.exit(1);
});