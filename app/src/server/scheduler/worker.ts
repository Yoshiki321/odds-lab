// worker.ts - 扫描计划执行器：每 60s 检查 scan_plans 里到点的 pending 计划并执行
// 服务器启动即挂在后台循环；不做结算/下单（那是 13:03/23:07 的事）
import { listPendingScans } from '../db/store.js';
import { runScan } from './planner.js';

/** 启动后台循环（不阻塞主事件循环） */
export function startScanWorker(): void {
  const tick = async () => {
    try {
      const due = await listPendingScans(new Date().toISOString());
      for (const plan of due) {
        await runScan(plan);
      }
    } catch (e: any) {
      console.error('[scheduler] tick 失败:', e.message);
    }
  };
  setTimeout(() => void tick(), 5 * 1000);   // 启动后 5s 首查
  setInterval(() => void tick(), 60 * 1000); // 之后每 60s
  console.log('[scheduler] 扫描执行器已启动');
}