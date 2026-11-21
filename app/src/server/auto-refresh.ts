// auto-refresh.ts — 开盘兜底：每日 13:05（北京）检查当日盘，不足才补跑 refresh
// 定位是 LLM cron 的 fallback，不是替代：
//   - cron 正常时当日已有场次 → 跳过，零重复（refresh 幂等，多跑一次也无害，但能省则省）
//   - cron 到期/宿主休眠导致开盘轮空 → 自动补跑，保证新池子不断流
//   - 只做机械层（抓盘+评分+赛果+排程），不研判、不下单、不写日记——那些仍归 13:03/23:07
// 失败只记日志 + refresh 内部已写 source_status（前端红条），不抛不崩 server。
import { getDayMatches } from './db/store.js';
import { refresh } from '../../tools/refresh.js';

const BJ = 8 * 3600_000;
const bjDate = (t = Date.now()) => new Date(t + BJ).toISOString().slice(0, 10);
const bjHM = (t = Date.now()) => new Date(t + BJ).toISOString().slice(11, 16);

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
    const r = await refresh(date);
    console.log(`[auto-refresh] 补跑完成 抓${r.fetched}场 报错${r.errors.length}项`);
  } catch (e: any) {
    console.error('[auto-refresh] 失败:', e?.message || e);
  }
}

export function startAutoRefresh(): void {  const loop = () => {
    void tick('13:05例行检查').finally(() => {
      setTimeout(loop, msUntilNext1305());
    });
  };
  setTimeout(loop, msUntilNext1305());
  // 启动后 60s 补检一次：只在“已过今日13:05 且 当日无场次”时补跑（覆盖宕机错过开盘）
  setTimeout(() => {
    if (bjHM() >= '13:05') void tick('启动补检');
    else console.log('[auto-refresh] 未过今日13:05，等待定时轮');
  }, 60 * 1000);
  console.log('[auto-refresh] 开盘兜底已启动（每日13:05北京检查）');
}

/** 整点全量刷新：每小时一次机械 refresh（抓盘+评分+赛果+快照），晚场开售自动填分；
 *  与13:05兜底互补（兜底只在“当日无场”时跑一次，管不了晚场延迟开售）。
 *  防重入：上轮未完则跳过；失败只记日志，不抛不崩。 */
let hourlyRunning = false;
export function startHourlyRefresh(): void {
  const tick = async () => {
    if (hourlyRunning) { console.log('[hourly-refresh] 上轮未完，跳过'); return; }
    hourlyRunning = true;
    try {
      const r = await refresh(bjDate());
      console.log(`[hourly-refresh] 完成 抓${r.fetched}场 报错${r.errors.length}项`);
    } catch (e: any) {
      console.error('[hourly-refresh] 失败:', e?.message || e);
    } finally { hourlyRunning = false; }
  };
  const msToNextHour = () => Math.ceil((Date.now() + 1) / 3600000) * 3600000 - Date.now();
  setTimeout(function loop() { void tick().finally(() => setTimeout(loop, 3600000)); }, msToNextHour());
  setTimeout(() => void tick(), 90 * 1000); // 启动90s先跑一次，补重启断档
  console.log('[hourly-refresh] 整点刷新已启动（每小时一次+启动90s补跑）');
}
