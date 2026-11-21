// store-scan.ts - scan_plans 表读写（与 store.ts 同属数据层，拆分避免单个文件臃肿）
import { query } from './pool.js';
import type { ScanPlan } from '../../shared/types.js';

/** DATE/timestamptz → 'YYYY-MM-DD'（pg 可能返回 string 或 Date，统一手剪） */
function dstr(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.slice(0, 10);
  const d = new Date(v as string | Date);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 计划 id '2026-09-08-s3' → scanRound 3（score 表 UNIQUE(match_id, scan_round) 用） */
function roundOfId(id: string): number {
  const m = id.match(/-s(\d+)$/);
  return m ? Number(m[1]) : 1;
}

function mapScanPlan(x: any): ScanPlan {
  return {
    id: x.id,
    matchDate: dstr(x.match_date),
    scanAt: new Date(x.scan_at).toISOString(),
    labels: x.labels ?? [], batch: x.batch ?? [],
    status: x.status, created_at: new Date(x.created_at).toISOString(),
    scanRound: roundOfId(x.id),
    kickoff: x.kickoff ? new Date(x.kickoff).toISOString() : undefined,
  };
}

export async function upsertScanPlan(p: ScanPlan): Promise<void> {
  // 已执行(done/skipped)的计划绝不能被刷新回 pending —— 否则 scan worker 会重跑
  // 13:00 开盘预扫(scanRound=1)，用 analyzeBatch 覆盖 scoreDay 刚写的 round-1 主评分。
  // 只更新 batch/labels/kickoff，status 由 INSERT 分支或显式 saveScanResult 控制。
  await query(`
    INSERT INTO scan_plans (id, match_date, scan_at, labels, batch, status, kickoff, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (id) DO UPDATE SET labels=$4, batch=$5, kickoff=$7
  `, [p.id, p.matchDate, p.scanAt, p.labels, JSON.stringify(p.batch), p.status, p.kickoff || null, p.created_at]);
}

export async function getScanPlan(id: string): Promise<ScanPlan | null> {
  const r = await query('SELECT * FROM scan_plans WHERE id = $1', [id]);
  if (!r.rows[0]) return null;
  return mapScanPlan(r.rows[0]);
}

export async function saveScanResult(id: string, res: { status: string; scores: string[]; runAt: string }): Promise<void> {
  await query(
    `UPDATE scan_plans SET status=$2, result=$3, ran_at=$4 WHERE id=$1`,
    [id, res.status, JSON.stringify(res), res.runAt]);
}

export async function listPendingScans(untilIso: string): Promise<ScanPlan[]> {
  const r = await query(
    `SELECT * FROM scan_plans WHERE status='pending' AND scan_at <= $1 ORDER BY scan_at`, [untilIso]);
  return r.rows.map(mapScanPlan);
}