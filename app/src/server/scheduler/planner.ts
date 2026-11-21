// planner.ts - 扫描排程（需求2：LLM 预扫描点）
// 固定扫描点：13:00 开盘预扫(detection) → 20:00 首次深化 → 各 kickoff 批次-30min 临场(最后)
// 1天 2-3 次；同 kickoff 时间的场次 batch 整合成一轮分析
// prompt 预写，扫描时只替换实时水位
import { getDayMatches, upsertScanPlan, getScanPlan, saveScanResult } from '../db/store.js';
import type { ScanPlan, MatchRow, ScoreRow } from '../../shared/types.js';
import { analyzeBatch } from '../llm/analyzer.js';
import { markChange } from '../db/pool.js';
import { snapshotDay } from '../../../tools/snapshot.js';

interface ScanSlot {
  scanAt: Date;          // ISO timestamptz 扫描时间
  label: string;         // '开盘预扫' | '首次' | '临场'
  matchIds: string[];    // 该轮要分析的场次
  kickoff?: string;      // 临场批次对应开赛时间（ISO）；全量轮（开盘/首次）为 undefined → 存 NULL
  scanRound: number;     // 每日从 1 递进（score 表 UNIQUE(match_id, scan_round)）
}

/** 把 2026-09-07T13:00:00+08:00 解析为 Date 的工具 */
function t(date: string, time: string): Date {
  return new Date(`${date}T${time}+08:00`);
}
const iso = (d: Date) => d.toISOString();

/** 生成一天扫描计划：13:00 预扫 → 20:00 首扫 → 各批 kickoff-30min 临场 */
export function buildPlan(date: string, matches: MatchRow[]): ScanSlot[] {
  const slots: ScanSlot[] = [];

  // 1) 13:00 开盘预扫（detection：全量快速过一遍，找可投方向）
  slots.push({
    scanAt: t(date, '13:00:00'), label: '开盘预扫',
    matchIds: matches.map(m => m.matchId), scanRound: 1,
  });

  // 2) 20:00 首次深化分析（全量，prompt 预写只换水位）
  slots.push({
    scanAt: t(date, '20:00:00'), label: '首次',
    matchIds: matches.map(m => m.matchId), scanRound: 2,
  });

  // 3) 各 kickoff 批次 kickoff-30min 临场（最后扫描；同 kickoff 场次合并一批）
  const byHour = new Map<string, MatchRow[]>();
  for (const m of matches) {
    const d = new Date(m.kickoff);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}`;
    if (!byHour.has(key)) byHour.set(key, []);
    byHour.get(key)!.push(m);
  }
  let round = 3;
  for (const [, ms] of [...byHour.entries()].sort()) {
    const kick = new Date(ms[0].kickoff);
    slots.push({
      scanAt: new Date(kick.getTime() - 30 * 60 * 1000), label: '临场',
      matchIds: ms.map(m => m.matchId), kickoff: kick.toISOString(), scanRound: round++,
    });
  }

  return slots;
}

/** 生成并持久化一天的扫描计划 */
export async function planDay(date: string): Promise<ScanPlan[]> {
  const matches = await getDayMatches(date);
  if (!matches.length) return []; // 无场次不排空计划
  const plans: ScanPlan[] = [];
  for (const s of buildPlan(date, matches)) {
    const p: ScanPlan = {
      id: `${date}-s${s.scanRound}`,
      matchDate: date, scanAt: iso(s.scanAt), labels: [s.label],
      batch: s.matchIds, status: 'pending', created_at: iso(new Date()),
      scanRound: s.scanRound, kickoff: s.kickoff,
    };
    await upsertScanPlan(p);
    plans.push(p);
  }
  return plans;
}

/** 到点执行一轮扫描（幂等：done 则跳过） */
export async function runScan(plan: ScanPlan): Promise<void> {
  const existing = await getScanPlan(plan.id);
  if (existing && existing.status !== 'pending') {
    console.log(`[scheduler] ${plan.id} 已执行(${existing.status})，跳过`);
    return;
  }
  const matches = await getDayMatches(plan.matchDate);
  const batch = matches.filter(m => plan.batch.includes(m.matchId));
  const scores: ScoreRow[] = await analyzeBatch(batch, plan.scanRound ?? 1);
  await saveScanResult(plan.id, { status: 'done', scores: scores.map(s => s.matchId), runAt: iso(new Date()) });
  await markChange('day', plan.matchDate);
  console.log(`[scheduler] ${plan.labels?.[0]} 完成，分析 ${scores.length}/${batch.length} 场`);
  // 临场批次(round≥3)扫描后落 final 快照帧（前置 vs 临场对比的历史积累层；挂掉不阻断）
  if ((plan.scanRound ?? 1) >= 3) {
    try { await snapshotDay(plan.matchDate); console.log(`[scheduler] 临场快照 ${plan.matchDate} 已落帧`); }
    catch (e: any) { console.warn('[scheduler] 临场快照失败:', e?.message); }
  }
}