// ops.ts — 研判层写入接口（给无人值守会话用；机械层在 /api/trigger/*）
// 设计原则：
//   1) 只开「纸面钱 + 文本」两类写入：虚拟注、日记。真注 /api/bet 需要显式 confirmed=true 且过五门禁校验。
//   2) 幂等：同场已有未结虚拟注 → 直接返回原记录，不重复开注（防重入）。
//   3) 全 ASCII 报错信息可读；中文只出现在业务文案里。
import { query, withTransaction } from './db/pool.js';
import {
  getDayMatches, getDayScores, getEuropeanOdds, insertVirtual, upsertVirtual, upsertBet, upsertDoc, getDoc, getOddsHistory,
} from './db/store.js';
import { evaluateM04 } from '../../tools/m04.js';
import type { MatchRow, ScoreRow } from '../shared/types.js';

const BJ = 8 * 3600_000;
export const bjToday = (t = Date.now()) => new Date(t + BJ).toISOString().slice(0, 10);

async function body(req: import('node:http').IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('bad json body'); }
}

/** 下一个虚拟注 ID：vb-(max 数字后缀 + 1)，兼容历史裸数字 ID */
async function nextVirtualId(): Promise<string> {
  const r = await query(`SELECT id FROM virtual_bets`);
  let max = 0;
  for (const x of r.rows) {
    const m = String(x.id).match(/(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `vb-${max + 1}`;
}

/** 打开一注虚拟注（纸面钱，自动流程允许）。同场已有 open 注则幂等返回。 */
export async function opVirtual(b: any): Promise<unknown> {
  const matchId = String(b.matchId || '').trim();
  const pick = String(b.pick || '').trim();
  if (!matchId) throw new Error('matchId required');
  if (!pick) throw new Error('pick required');
  const odds = Number(b.odds);
  if (!(odds > 1) || !Number.isFinite(odds) || odds > 1000) throw new Error('odds must be in (1,1000]');
  const confidence = b.confidence != null ? Number(b.confidence) : undefined;
  if (confidence != null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 100)) {
    throw new Error('confidence must be 0..100');
  }

  const dup = await query(
    `SELECT id, status, pick, odds FROM virtual_bets WHERE match_id=$1 AND status IN ('open','pending') LIMIT 1`,
    [matchId]);
  if (dup.rows.length) return { ok: true, skipped: true, reason: 'already open', id: dup.rows[0].id };

  const m = await query(`SELECT * FROM matches WHERE match_id=$1`, [matchId]);
  if (!m.rows[0]) throw new Error('match not found: ' + matchId);
  const row: any = m.rows[0];

  // 同场并发开注可能算出同一个 id：INSERT 冲突就重算，绝不 upsert 覆盖别人的注
  for (let attempt = 0; attempt < 4; attempt++) {
    const id = await nextVirtualId();
    const v = {
      id, matchId, matchNum: row.num, league: row.league, home: row.home, away: row.away,
      matchTime: row.match_time, kickoff: row.kickoff ? new Date(row.kickoff).toISOString() : undefined,
      confidence, myView: String(b.myView || ''), analysis: String(b.analysis || ''),
      pick, odds, reviewHook: String(b.reviewHook || ''),
      status: 'open', placedAt: new Date().toISOString(),
    };
    if (await insertVirtual(v)) return { ok: true, id, pick, odds, matchNum: row.num };
  }
  throw new Error('virtual id conflict, retry later');
}

/** 撤销未结虚拟注（自检/误建清理；已结算的拒删，保复盘可追溯） */
export async function opVirtualDelete(q: { id?: string; matchId?: string }): Promise<unknown> {
  const id = String(q.id || '').trim();
  const matchId = String(q.matchId || '').trim();
  if (!id && !matchId) throw new Error('id or matchId required');
  const r = await query(
    `DELETE FROM virtual_bets WHERE (id=$1 OR match_id=$2) AND status IN ('open','pending') RETURNING id, match_num, pick, odds`,
    [id || null, matchId || null]);
  return { ok: true, deleted: r.rows.map((x: any) => ({ id: x.id, num: x.match_num, pick: x.pick, odds: Number(x.odds) })) };
}

/** 追加一条日记（read-merge-write：upsertDoc 是整body替换，必须先读） */
export async function opDiary(b: any): Promise<unknown> {
  const date = String(b.date || bjToday());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('bad date');
  const text = String(b.text || '').trim();
  if (!text) throw new Error('text required');
  const key = `journal:${date}`;
  const prev: any = (await getDoc(key)) ?? { date, title: '', bets: [], content: [] };
  if (typeof prev !== 'object' || prev === null) throw new Error('journal corrupted: ' + key);
  if (!Array.isArray(prev.content)) prev.content = [];
  if (b.title) prev.title = String(b.title);
  const bjhm = new Date(Date.now() + BJ).toISOString().slice(11, 16);
  prev.content.push({ time: String(b.time || bjhm), type: String(b.type || 'note'), text });
  await upsertDoc(key, prev);
  return { ok: true, key, entries: prev.content.length };
}

/** 真注下单：必须 confirmed=true，且服务端自查五门禁（分/R5/EV/欧赔/让球含"让"），任一不过就拒绝 */
export async function opBet(b: any): Promise<unknown> {
  if (b.confirmed !== true) return { ok: false, rejected: ['confirmed=true required（无人值守流程禁止下真注）'] };

  // ── 输入校验：金额/赔率/场次号/日期（脏数据进账本比不下单更糟） ──
  const num = String(b.num || '').trim();
  if (!/^\d{3}$/.test(num)) return { ok: false, rejected: ['num 需为三位场次号，如 006'] };
  const day = String(b.date || bjToday());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, rejected: ['date 需为 YYYY-MM-DD'] };
  const stake = b.stake == null ? 50 : Number(b.stake);
  if (!Number.isInteger(stake) || stake < 1 || stake > 300) return { ok: false, rejected: ['stake 需为 1~300 的整数'] };
  const odds = Number(b.odds);
  if (!Number.isFinite(odds) || odds <= 1 || odds > 1000) return { ok: false, rejected: ['odds 需在 (1,1000] 区间'] };
  const pick = String(b.pick || '').trim();
  if (!pick) return { ok: false, rejected: ['pick required'] };

  const gate: any = await opGate({ date: day, num });
  const g: any = gate;
  const fails: string[] = [];
  if (!g.score || g.score.total < 48) fails.push('score<48');
  if (!g.r5) fails.push('R5窗外');
  if (!g.europe) fails.push('无欧赔');
  if (!(g.m04 && g.m04.eligible)) fails.push('EV门未过:' + (g.m04?.reason ?? '?'));
  if (g.market === 'HHAD' && !pick.includes('让')) fails.push('让球选向须含「让」');
  if (fails.length) return { ok: false, rejected: fails, gate: g };
  if (!g.matchId) return { ok: false, rejected: ['match not found'], gate: g };

  // 注单落账 + 资金扣减必须同事务；日累计与现金在账本行锁内判断
  return withTransaction(async (c) => {
    const br = await c.query(`SELECT cash FROM bankroll WHERE id=1 FOR UPDATE`);
    const cash = Number(br.rows[0]?.cash ?? 0);

    const dup = await c.query(
      `SELECT bet_id FROM bets
        WHERE status IN ('open','settled','void')
          AND legs->0->>'matchId' = $1
          AND (placed_at AT TIME ZONE 'Asia/Shanghai')::date = $2::date
        LIMIT 1`,
      [g.matchId, day]);
    if (dup.rows.length) return { ok: false, rejected: [`单场一单：该场已有 bet-${dup.rows[0].bet_id}`], gate: g };

    const spent = await c.query(
      `SELECT COALESCE(SUM(stake),0) s FROM bets
        WHERE status IN ('open','settled') AND (placed_at AT TIME ZONE 'Asia/Shanghai')::date = $1::date`,
      [day]);
    if (Number(spent.rows[0].s) + stake > 300) return { ok: false, rejected: ['单日累计>300'], gate: g };
    if (stake > cash) return { ok: false, rejected: ['现金不足'], gate: g };

    const idr = await c.query(`SELECT nextval('bets_bet_id_seq') n`);
    const betId = Number(idr.rows[0].n);
    const leg: any = { matchId: g.matchId, num, market: g.market, side: g.pred, pick, odds,
      line: g.goalLine, kickoff: g.kickoff, hoursToKickoff: g.hoursToKickoff };
    const theory = `分${g.score.total}(${g.score.band}) ${pick}@${odds} EV${g.m04?.jcEv != null ? (g.m04.jcEv * 100).toFixed(1) + '%' : '-'}`;

    await c.query(
      `INSERT INTO bets (bet_id, type, settle_market, stake, total_odds, potential_return, placed_at,
         status, legs, theory, status_note)
       VALUES ($1,$2,$3,$4,$5,$6,now(),'open',$7::jsonb,$8,$9)`,
      [betId, 'single', '竞彩欧赔结算', stake, odds, +(stake * odds).toFixed(2),
        JSON.stringify([leg]), theory, 'ops API 下单（五门禁已过）']);

    await c.query(
      `UPDATE bankroll SET cash = cash - $1, total_staked = total_staked + $1, updated_at = now() WHERE id=1`,
      [stake]);

    return { ok: true, betId, stake, odds, pick, num, gate: { score: g.score.total, r5: g.r5, m04: g.m04 } };
  });
}

/** 五门禁体检：给某个场次号算分/欧赔/M-04 判定/亚盘结算价（研判用，GET） */
export async function opGate(q: { date?: string; num?: string; matchId?: string }): Promise<unknown> {
  const date = q.date || bjToday();
  const num = String(q.num || '');
  const matches = await getDayMatches(date);
  const scores = await getDayScores(date);
  const sm = new Map(scores.map(s => [s.num, s]));
  const mm: MatchRow | undefined = q.matchId
    ? matches.find(m => m.matchId === q.matchId)
    : matches.find(m => m.num === num);
  if (!mm) return { ok: false, reason: 'match not found', date, num };

  const score = (sm.get(mm.num) as ScoreRow | undefined) ?? null;
  const kickoff = mm.kickoff ? new Date(mm.kickoff).getTime() : null;
  const hours = kickoff != null && Number.isFinite(kickoff) ? (kickoff - Date.now()) / 3600000 : null;

  const eu = await getEuropeanOdds(mm.matchId);
  const europe = eu ? { home: Number(eu.home), draw: Number(eu.draw), away: Number(eu.away) } : null;

  // 亚盘结算价（欧亚结算改投用）：只取 AH 市场最新主/客水，别把 HAD 胜平负赔率当成亚盘价
  const hist = await getOddsHistory(mm.matchId);
  let ah: { line: number | null; home: number | null; away: number | null } = { line: null, home: null, away: null };
  for (const h of hist) {
    const mk = String(h.market || '').toUpperCase();
    if (mk !== 'AH' && mk !== 'ASI' && !mk.includes('AH')) continue;
    const side = String(h.side || '');
    if (side === 'h') ah.home = h.odds;
    else if (side === 'a') ah.away = h.odds;
  }

  const market = (score?.market || 'HAD') as 'HAD' | 'HHAD';
  const pred = (score?.pred || '') as 'H' | 'A';
  const odds = Number(score?.odds ?? 0);
  const gl = Number.isFinite(parseFloat(String(mm.hhad?.goalLine ?? ''))) ? parseFloat(String(mm.hhad?.goalLine)) : 0;
  const r5 = hours != null && hours >= 0.5 && hours <= 8;

  // 改投结算价必须取「被选方向」的价：押客队就用客水，用主水算 EV 是错的
  const settleOdds = pred === 'H' ? ah.home : ah.away;

  const m04 = evaluateM04({
    score: score?.total ?? 0, line: gl, market, side: pred || 'H', jcOdds: odds,
    europe, settleOdds, hoursToKickoff: hours,
  });

  return {
    ok: true, date, num: mm.num, matchId: mm.matchId, league: mm.league,
    home: mm.home, away: mm.away, kickoff: mm.kickoff, matchTime: mm.matchTime,
    hoursToKickoff: hours != null ? +hours.toFixed(2) : null, r5,
    score: score ? { total: score.total, band: score.band, dir: score.dir, odds: score.odds, market, pred } : null,
    goalLine: gl, europe, asian: ah, m04,
    note: 'M-04 settleEv 对 quarter 盘偏乐观（M-03），只信整数盘；实战研判以 jcEv+手动分拆为准',
  };
}

export { body as readJsonBody };
