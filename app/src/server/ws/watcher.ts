// watcher.ts - change_log 哨兵轮询：发现新变更 → Hub.broadcast 推全量快照
// refresh/结算等写库后 markChange()，本进程每 3s 拉一次新行触发推送
import { query } from '../db/pool.js';
import type { Hub } from './hub.js';

const SCOPES = new Set(['day', 'summary', 'status', 'live']);

export function startChangeWatcher(hub: Hub): void {
  let lastId: number | null = null;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      // 启动时从当前 MAX(id) 起跳，避免重启重放全表历史记录
      if (lastId === null) {
        const init = await query(`SELECT COALESCE(MAX(id), 0) AS m FROM change_log`);
        lastId = Number(init.rows[0]?.m ?? 0);
        return;
      }
      const r = await query(
        `SELECT id, scope, ref FROM change_log WHERE id > $1 AND scope = ANY($2) ORDER BY id LIMIT 100`,
        [lastId, [...SCOPES]]);
      for (const row of r.rows) {
        lastId = Number(row.id);
        const scope = String(row.scope) as 'day' | 'summary' | 'status' | 'live';
        const ref = String(row.ref);
        if (scope === 'live') hub.broadcastSync('day', ref);
        else hub.broadcastSync(scope, scope === 'day' ? ref : 'global');
      }
    } catch { /* 表未建/连不上时静默，下一轮重试 */ }
    finally { running = false; }
  };
  setTimeout(() => void tick(), 2000);
  setInterval(() => void tick(), 3000);
}