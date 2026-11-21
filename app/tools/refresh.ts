// refresh.ts - 抓当日盘 → 合入 PG → 重算评分 → 拉已开奖赛果 → 上报信息源状态 → WS 哨兵
// 对标 tools/refresh_scores.cjs 完整移植；LLM cron 调用，不是网页/server 自己打分
// 用法: node app/tools/refresh.ts [YYYY-MM-DD]
import { setSourceStatus, upsertMatch } from '../src/server/db/store.js';
import { markChange, query } from '../src/server/db/pool.js';
import { fetchTodayOdds } from './fetch-today.js';
import { scoreDay } from './score.js';
import { fetchResultsAndStore } from './fetch-results.js';
import { fetchLiveAndStore } from './fetch-live.js';
import { fetchSupportAndStore } from './fetch-support.js';
import { backfillOddsHistory } from './fetch-odds-history.js';
import { fetchEuropeOdds } from './fetch-europe-odds.js';
import { fetchLineups } from './fetch-lineups.js';
import { computeAndSave } from './history-stats.js';
import { snapshotDay } from './snapshot.js';
import { computeEloAndSave } from './elo.js';
import { planDay } from '../src/server/scheduler/planner.js';
import type { RawMatch } from '../src/shared/types.js';

const bjDate = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

/** 把 sporttery 原始行 upsert 进 PG（had_base/hhad_base 由 COALESCE 保留首见盘） */
export async function storeMatches(matches: RawMatch[]): Promise<number> {
  for (const m of matches) {
    await upsertMatch({
      matchId: String(m.matchId), matchDate: m.matchDate || bjDate(), num: m.num,
      league: m.league || '', home: m.home || '', away: m.away || '',
      kickoff: '', had: m.had || null, hhad: m.hhad || null,
      hadBase: m.had || null, hhadBase: m.hhad || null,
      matchTime: m.matchTime,
      updatedAt: new Date().toISOString(),
    });
  }
  return matches.length;
}

/** 完整刷新管线（供 CLI / cron 调用） */
export async function refresh(argDate?: string): Promise<{ date: string; fetched: number; errors: { source: string; message: string }[] }> {
  const errors: { source: string; message: string }[] = [];
  const date = argDate && /^\d{4}-\d{2}-\d{2}$/.test(argDate) ? argDate : bjDate();

  // 1. 抓当日盘（sporttery 计算器）
  let matches: RawMatch[];
  try {
    matches = await fetchTodayOdds();
    if (!matches.length) throw new Error('返回空场次');
  } catch (e: any) {
    errors.push({ source: 'sporttery.getMatchCalculatorV1', message: e?.message || String(e) });
    await setSourceStatus(false, errors);
    await markChange('status', 'global');
    console.error('信息源错误 sporttery:', e?.message || e);
    return { date, fetched: 0, errors };
  }

  // 2. 合入 PG（merge 新字段覆盖旧；base 首见盘定格）
  const fetched = await storeMatches(matches);

  // 2.1 评分前置数据（支持率 / 变盘轨迹 / 联赛基线）——任一失败只记不阻断，评分端自动降级
  try {
    const sr = await fetchSupportAndStore();
    console.log(`支持率 ${sr.ok}场`);
  } catch (e: any) { errors.push({ source: 'sporttery.getSupportRateV1', message: e?.message || String(e) }); }
  try {
    const oh = await backfillOddsHistory();
    console.log(`变盘轨迹 ${oh.written}条 跳过${oh.skipped}场`);
  } catch (e: any) { errors.push({ source: 'sporttery.getFixedBonusV1', message: e?.message || String(e) }); }
  try {
    const eu = await fetchEuropeOdds();
    console.log(`欧洲赔率 ${eu.written}场 (magicball ${eu.matched}匹配/无欧赔${eu.skippedNoEuro})`);
    if (eu.warns.length) console.log(`欧赔警告 ${eu.warns.length}: ` + eu.warns.slice(0, 3).join(' | '));
  } catch (e: any) { errors.push({ source: 'dongqiudi.magicball', message: e?.message || String(e) }); }
  try {
    const hs = await computeAndSave(60);
    console.log(`联赛基线 ${hs.leagues}个/${hs.matches}场`);
  } catch (e: any) { errors.push({ source: 'history-stats', message: e?.message || String(e) }); }
  // 2.1b 临场首发/伤停（增强项：非空才入库，抓不到静默降级，不进 source_status）
  try {
    const lp = await fetchLineups();
    if (lp.stored) console.log(`首发 ${lp.stored} 场 (窗口${lp.window} 匹配${lp.dqdFound})`);
  } catch (e: any) { console.warn('[refresh] lineups:', e?.message); }

  // 3. 重算当日评分（按竞彩销售日逐日）
  // 注意：不能直接取接口 matchDate（北京自然开赛日，跨午夜场归属会错），
  //     这里从 PG 反查本次上市场次归位后的 sales date（salesDateOf 已落库到 match_date）
  const ids = matches.map(m => String(m.matchId));
  const rd = await query(`SELECT DISTINCT to_char(match_date,'YYYY-MM-DD') d FROM matches WHERE match_id = ANY($1::varchar[])`, [ids]);
  const dates = rd.rows.map(x => x.d).sort();
  if (!dates.length) dates.push(date);
  let scoreErr: string | null = null;
  for (const d of dates) {
    try {
      const rows = await scoreDay(d);
      console.log(`信息值评分 ${d} ${rows.length} 场`);
      // 3b 多时点评分快照（历史积累层：破 level-1 quote 不阻断，挂掉只记一行）
      try { const n = await snapshotDay(d); console.log(`评分快照 ${d} 落帧${n}场`); }
      catch (e: any) { console.warn('[refresh] snapshot:', e?.message); }
    } catch (e: any) { scoreErr = e?.message || String(e); }
  }
  if (scoreErr) {
    errors.push({ source: 'score_sat_full', message: scoreErr.slice(0, 500) });
    await setSourceStatus(false, errors, { fetched, dates });
    await markChange('status', 'global');
    console.error('评分失败:', scoreErr);
    return { date, fetched, errors };
  }

  // 4. 拉已开奖赛果（失败只记不阻断，评分是主产出）
  for (const d of dates) {
    try {
      const r = await fetchResultsAndStore(d);
      console.log(`赛果 ${r.begin}~${r.end} 已开奖 ${r.count} 场`);
    } catch (e: any) {
      errors.push({ source: 'sporttery.getUniformMatchResultV1', message: e?.message || String(e) });
    }
  }

  // 5. 生成扫描计划（需求2：13:00 预扫 → 20:00 首扫 → 各临场批；按比赛日逐日）
  for (const d of dates) {
    try { await planDay(d); } catch (e: any) { console.error('[refresh] planDay:', e?.message); }
  }

  // 5.5 刷新实时比分（live_scores；server 另有 60s 轮询，这里定时任务顺带补一次）
  try {
    const lr = await fetchLiveAndStore();
    console.log(`比分 ${lr.rows} 场 已开${lr.sealed} 场 okooo合并${lr.okoooHit} 补录${lr.backfilled}`);
  } catch (e: any) {
    errors.push({ source: 'sporttery.getMatchDataPageListV1', message: e?.message || String(e) });
  }

  // 5.6 球队 Elo 滚动重算（只入库不接评分；挂掉不阻断）
  try {
    const el = await computeEloAndSave();
    console.log(`Elo ${el.matches}场 → ${el.teams}队`);
  } catch (e: any) { console.warn('[refresh] elo:', e?.message); }

  // 6. 上报信息源状态 + WS 哨兵
  await setSourceStatus(errors.length === 0, errors, { fetched, dates });
  await markChange('day', date);
  await markChange('status', 'global');
  console.log(`平台已更新 ${date} 抓${fetched}场`);
  return { date, fetched, errors };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('refresh.ts')) {
  refresh(process.argv[2]).then(r => {
    if (r.errors.length) process.exitCode = 1;
  }).catch(e => { console.error('刷新失败:', e); process.exit(1); });
}