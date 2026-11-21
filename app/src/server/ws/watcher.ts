// watcher.ts - change_log 哨兵轮询：发现新变更 → Hub.broadcast 推全量快照
// refresh/结算等写库后 markChange()，本进程每 3s 拉一次新行触发推送
import { query } from '../db/pool.js';
import type { Hub } from './hub.js';

const SCOPES = new Set(['day', 'summary', 'status', 'live']);

export function startChangeWatcher(hub: Hub): void {
  let lastId = 0;
  const tick = async () => {
    try {
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
  };
  setTimeout(() => void tick(), 2000);
  setInterval(() => void tick(), 3000);
}