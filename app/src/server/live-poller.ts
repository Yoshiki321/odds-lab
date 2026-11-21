// live-poller.ts - 实时比分轮询：每 60s 抓 sporttery 比分直播 → upsert live_scores
// 另每 6 分钟补拉近 2 天官方开奖（results）：完场后 Payout 滞后，轮询等它落库
import { fetchLiveAndStore } from '../../tools/fetch-live.js';
import { fetchResultsAndStore } from '../../tools/fetch-results.js';
import { query } from './db/pool.js';

/** 补拉近 2 天有竞彩场次的官方开奖（幂等，未 Payout 不写库） */
async function backfillResults(): Promise<number> {
  const g = await query(`SELECT DISTINCT to_char(match_date,'YYYY-MM-DD') d FROM matches
    WHERE match_date >= ((now() AT TIME ZONE 'Asia/Shanghai')::date - 1)`);
  let n = 0;
  for (const row of g.rows) n += (await fetchResultsAndStore(row.d)).count;
  return n;
}

/** 启动核对轮询（带防重入锁与尾递归调度，失败不崩 server） */
export function startLivePoller(): void {
  let tickNo = 0;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      try {
        const r = await fetchLiveAndStore();
        console.log(`[live] ${new Date().toISOString().slice(11, 19)} 比分 ${r.rows} 场 已开${r.sealed} 场 okooo合并${r.okoooHit}`);
      } catch (e: any) {
        console.error('[live] 比分抓取失败:', e.message || e);
      }
      if (++tickNo % 6 === 0) {
        try {
          const n = await backfillResults();
          if (n) console.log(`[live] 官方开奖补拉 ${n} 场`);
        } catch (e: any) {
          console.error('[live] 开奖补拉失败:', e.message || e);
        }
      }
    } finally {
      running = false;
    }
  };
  const schedule = () => {
    void tick().finally(() => setTimeout(schedule, 60 * 1000));
  };
  setTimeout(schedule, 8 * 1000); // 启动 8s 后首抓
  console.log('[live] 比分轮询器已启动（每 60s 防重入，开奖补拉每 6min）');
}