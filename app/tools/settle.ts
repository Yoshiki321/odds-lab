// settle.ts — 结算工具（结构化玩法结算 + 事务记账）
//
// 规则层在 src/shared/settlement.ts（纯函数、可单测）；本文件只做 IO 与记账。
// 幂等：只对 status='open' 的注单生效，且靠 `UPDATE ... WHERE status='open' RETURNING` 兜住并发/重复触发。
// 记账：注单状态变更 + bankroll 资金变动必须在同一事务里（见 withTransaction）。
// 判不了就转人工（outcome='manual'），绝不猜——猜错一次账就废了。
import { getAllBets, getAllVirtual, upsertVirtual } from '../src/server/db/store.js';
import type { BetRow, VirtualRow } from '../src/shared/types.js';
import { query, withTransaction, markChange } from '../src/server/db/pool.js';
import {
  settle as settleRule, normalizeMarket, normalizeSide, parsePickLine, toHomeLine,
  isSettledOutcome, type Market, type Side, type SettleOutcome,
} from '../src/shared/settlement.js';

export function parseScore(s: string): [number, number] | null {
  const m = String(s || '').match(/(\d+)\s*[:：\-]\s*(\d+)/);
  if (!m) return null;
  return [parseInt(m[1]), parseInt(m[2])];
}

interface FinalResult { score: string; had: string | null; hhad: string | null; goalLine: string | null }

async function finalOf(matchId: string): Promise<FinalResult | null> {
  const r = await query(`SELECT score, had, hhad, goal_line FROM results WHERE match_id = $1`, [matchId]);
  if (!r.rows[0] || !r.rows[0].score) return null;
  const [h, a] = parseScore(r.rows[0].score) ?? [NaN, NaN];
  if (!Number.isInteger(h) || !Number.isInteger(a)) return null; // 比分异常 = 不算终场
  return {
    score: String(r.rows[0].score),
    had: r.rows[0].had ?? null,
    hhad: r.rows[0].hhad ?? null,
    goalLine: r.rows[0].goal_line ?? null,
  };
}

/** 判定一注真注的结算口径；无法判定返回 null（转人工） */
function resolveBetLeg(b: BetRow, leg: any, fin: FinalResult): { market: Market; side: Side; line?: number | null } | null {
  const pick = String(leg?.pick || '');
  const home = String(leg?.home || '');
  const away = String(leg?.away || '');
  const market = normalizeMarket({ market: leg?.market, settleMarket: b.settleMarket, pick });
  if (!market) return null;
  const side = normalizeSide(market, String(leg?.side || pick), home, away);
  if (!side) return null;

  if (market === 'AH' || market === 'OU') {
    let line: number | null = Number.isFinite(Number(leg?.line)) ? Number(leg.line) : null;
    if (line == null) {
      const pickLine = parsePickLine(pick);
      if (pickLine == null) return null;
      line = market === 'AH' ? toHomeLine(pickLine, side) : pickLine;
    }
    return { market, side, line };
  }
  return { market, side };
}

/**
 * 单注落账：注单状态 + bankroll 同事务。
 * 返回 null 表示该单已被别的流程结掉（幂等跳过）。
 */
async function commitBetSettlement(
  b: BetRow, fin: FinalResult, verdict: SettleOutcome, returnAmt: number, odds: number,
): Promise<number | null> {
  const stake = Number(b.stake);
  const profit = +(returnAmt - stake).toFixed(2);
  const nowIso = new Date().toISOString();
  return withTransaction(async (c) => {
    const upd = await c.query(
      `UPDATE bets
          SET status='settled', status_note=$2, result=$3::jsonb, return_amount=$4, profit=$5,
              settled_at=now(), settle=$6::jsonb, updated_at=now()
        WHERE bet_id=$1 AND status='open'
        RETURNING bet_id`,
      [b.betId, verdict.reason, JSON.stringify(fin.score), returnAmt, profit,
        JSON.stringify({
          market: verdict.reason, pick: b.legs?.[0]?.pick, score: fin.score,
          outcome: verdict.outcome, multiplier: verdict.multiplier, odds, note: verdict.reason,
        })]);
    if (!upd.rowCount) return null; // 已被其他流程结算

    const cur = await c.query(`SELECT cash FROM bankroll WHERE id=1 FOR UPDATE`);
    const cashBefore = Number(cur.rows[0]?.cash ?? 0);
    const balance = +(cashBefore + returnAmt).toFixed(2);
    const hist = JSON.stringify([{ date: nowIso, type: 'IN', note: `bet-${b.betId} ${verdict.reason}`, amount: returnAmt, balance }]);
    await c.query(
      `UPDATE bankroll
          SET cash = cash + $1,
              settled_profit = settled_profit + $2,
              total_returned = total_returned + $1,
              history = COALESCE(history, '[]'::jsonb) || $3::jsonb,
              updated_at = now()
        WHERE id = 1`,
      [returnAmt, profit, hist]);
    return b.betId;
  });
}

/** 结算所有在途真注；返回 {settled, pending, manual, cashDelta} */
export async function settleReal(): Promise<{ settled: number; pending: number; manual: number; cashDelta: number }> {
  const bets = (await getAllBets()).filter(b => b.status === 'open');
  let settled = 0, pending = 0, manual = 0, cashDelta = 0;

  for (const b of bets) {
    const legs = Array.isArray(b.legs) ? (b.legs as any[]) : [];
    if (legs.length !== 1) { manual++; console.log(`  [人工] bet-${b.betId} 非单关(legs=${legs.length})，转人工核对防止串关误结`); continue; }
    const leg = legs[0];
    if (!leg || !leg.matchId) { manual++; console.log(`  [人工] bet-${b.betId} 缺少 matchId，跳过`); continue; }

    const fin = await finalOf(String(leg.matchId));
    if (!fin) { pending++; continue; }

    const odds = Number(b.totalOdds ?? 0);
    const rule = resolveBetLeg(b, leg, fin);
    if (!rule) {
      manual++;
      console.log(`  [人工] bet-${b.betId} 结算口径无法判定：market=${b.settleMarket} pick=${leg.pick}`);
      continue;
    }

    const verdict = settleRule({
      market: rule.market, side: rule.side, odds,
      homeScore: parseScore(fin.score)![0], awayScore: parseScore(fin.score)![1],
      line: rule.line ?? null, finalHad: fin.had, finalHhad: fin.hhad,
    });

    if (!isSettledOutcome(verdict.outcome)) {
      manual++;
      console.log(`  [人工] bet-${b.betId} ${verdict.reason}`);
      continue;
    }

    const stake = Number(b.stake);
    const returnAmt = +(stake * verdict.multiplier).toFixed(2);
    const done = await commitBetSettlement(b, fin, verdict, returnAmt, odds);
    if (done == null) { pending++; continue; } // 已被别的流程结掉，不计入本次

    settled++;
    cashDelta = +(cashDelta + returnAmt).toFixed(2);
    console.log(`  [${verdict.outcome}] bet-${b.betId} ${leg.home} ${fin.score} ${leg.away} | ${leg.pick} -> ${verdict.outcome} 返还${returnAmt} 净${returnAmt - stake >= 0 ? '+' : ''}${+(returnAmt - stake).toFixed(2)}`);
  }
  return { settled, pending, manual, cashDelta };
}

/** 结算所有在途虚拟注；判不了的一律保持 open（不写 void 糊过去） */
export async function settleVirtual(): Promise<{ settled: number; unresolved: number }> {
  const all = await getAllVirtual();
  const open = all.filter(v => v.status === 'open' || v.status === 'pending');
  let settled = 0, unresolved = 0;

  for (const v of open) {
    if (!v.matchId) { unresolved++; continue; }
    const fin = await finalOf(String(v.matchId));
    if (!fin) continue; // 未终场，下次再来

    const pick = v.pick || '';
    const market = normalizeMarket({ pick });
    const side = market ? normalizeSide(market, pick, v.home || '', v.away || '') : null;
    if (!market || !side) { unresolved++; console.log(`  [人工] 虚拟 ${v.matchNum || v.id} pick=${pick} 无法判定玩法/方向`); continue; }

    let line: number | null = null;
    if (market === 'AH' || market === 'OU') {
      const pickLine = parsePickLine(pick);
      if (pickLine == null) { unresolved++; continue; }
      line = market === 'AH' ? toHomeLine(pickLine, side) : pickLine;
    }

    const verdict = settleRule({
      market, side, odds: v.odds,
      homeScore: parseScore(fin.score)![0], awayScore: parseScore(fin.score)![1],
      line, finalHad: fin.had, finalHhad: fin.hhad,
    });
    if (!isSettledOutcome(verdict.outcome)) { unresolved++; continue; }

    // 展示层只认 win/loss/void/open；半赢半输归到对应的赢/输
    const status = verdict.outcome === 'win' || verdict.outcome === 'halfwin' ? 'win'
      : verdict.outcome === 'loss' || verdict.outcome === 'halfloss' ? 'loss' : 'void';
    await upsertVirtual({ ...(v as VirtualRow), status, settledAt: new Date().toISOString(), result: fin.score });
    settled++;
    console.log(`  [${verdict.outcome}] ${v.matchNum || v.id} ${v.home} ${fin.score} ${v.away} | ${pick} -> ${verdict.outcome}`);
  }
  return { settled, unresolved };
}

/** 一起跑：真注 + 虚拟注 */
export async function settleAll(): Promise<{
  real: { settled: number; pending: number; manual: number; cashDelta: number };
  virtual: { settled: number; unresolved: number };
}> {
  const real = await settleReal();
  const virtual = await settleVirtual();
  await markChange('summary', 'global');
  return { real, virtual };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('settle.ts')) {
  settleAll().then(r => {
    console.log(`\n真注已结 ${r.real.settled} / 待终场 ${r.real.pending} / 待人工 ${r.real.manual} | 虚拟注已结 ${r.virtual.settled} / 待人工 ${r.virtual.unresolved}`);
  }).catch(e => { console.error('结算失败:', e); process.exit(1); });
}
