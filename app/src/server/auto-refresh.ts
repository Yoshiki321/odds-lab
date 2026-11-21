// auto-refresh.ts — 开盘兜底 + 整点刷新（共享单一互斥锁防止多路并发 refresh 冲突）
import { getDayMatches } from './db/store.js';
import { refresh } from '../../tools/refresh.js';

const BJ = 8 * 3600_000;
const bjDate = (t = Date.now()) => new Date(t + BJ).toISOString().slice(0, 10);
const bjHM = (t = Date.now()) => new Date(t + BJ).toISOString().slice(11, 16);

let refreshInFlight = false;
async function runRefreshExclusive(date: string, tag: string) {
  if (refreshInFlight) {
    console.log(`[${tag}] 已有 refresh 正在执行，跳过本次`);
    return null;
  }
  refreshInFlight = true;
  try {
    return await refresh(date);
  } finally {
    refreshInFlight = false;
  }
}

/** 距下一个 13:05（北京）的毫秒数 */
function msUntilNext1305(): number {
  const now = Date.now();
  const b = new Date(now + BJ);
  const target = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate(), 13, 5, 0) - BJ;
  return (target <= now ? target + 24 * 3600_000 : target) - now;
}

async function tick(reason: string): Promise<void> {
  try {
    const date = bjDate();
    const ms = await getDayMatches(date);
    if (ms.length) {
      console.log(`[auto-refresh] ${date} 已有${ms.length}场，跳过（数据已在，无需补跑）`);
      return;
    }
    console.log(`[auto-refresh] ${date} 当日无场次，补跑 refresh（${reason}）`);
    const r = await runRefreshExclusive(date, 'auto-refresh');
    if (r) console.log(`[auto-refresh] 补跑完成 抓${r.fetched}场 报错${r.errors.length}项`);
  } catch (e: any) {
    console.error('[auto-refresh] 失败:', e?.message || e);
  }
}

export function startAutoRefresh(): void {
  const loop = () => {
    void tick('13:05例行检查').finally(() => {
      setTimeout(loop, msUntilNext1305());
    });
  };
  setTimeout(loop, msUntilNext1305());
  setTimeout(() => {
    if (bjHM() >= '13:05') void tick('启动补检');
    else console.log('[auto-refresh] 未过今日13:05，等待定时轮');
  }, 60 * 1000);
  console.log('[auto-refresh] 开盘兜底已启动（每日13:05北京检查）');
}

export function startHourlyRefresh(): void {
  const tickHourly = async () => {
    try {
      const r = await runRefreshExclusive(bjDate(), 'hourly-refresh');
      if (r) console.log(`[hourly-refresh] 完成 抓${r.fetched}场 报错${r.errors.length}项`);
    } catch (e: any) {
      console.error('[hourly-refresh] 失败:', e?.message || e);
    }
  };
  const msToNextHour = () => Math.ceil((Date.now() + 1) / 3600000) * 3600000 - Date.now();
  setTimeout(function loop() { void tickHourly().finally(() => setTimeout(loop, 3600000)); }, msToNextHour());
  setTimeout(() => void tickHourly(), 90 * 1000);
  console.log('[hourly-refresh] 整点刷新已启动（每小时一次+启动90s补跑，共享互斥锁）');
}
