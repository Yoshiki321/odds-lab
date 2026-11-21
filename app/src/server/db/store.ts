// PG 数据访问层：读写匹配/评分/比分/赛果/注单，并产出与旧 server 同构的视图
// 视图形状 = 旧 server.js buildDayView/buildSummary，前端零改动可用
import { query } from './pool.js';
import type {
  MatchRow, OddsBlock, ScoreRow, LiveRow, ResultRow,
  BetRow, VirtualRow, LedgerRow, BankrollRow,
  SupportRates, BaseRate, OddsHistEntry,
} from '../../shared/types.js';

const idKey = (id: unknown) => (id == null ? null : String(id));

// 扫描计划读写（拆分在 store-scan.ts，统一从 store.js 出口）
export { upsertScanPlan, getScanPlan, saveScanResult, listPendingScans } from './store-scan.js';

// ---------------- 写入 ----------------

function parseKickoff(m: MatchRow): string | null {
  if (m.kickoff) return m.kickoff;
  const d = m.matchDate, t = m.matchTime;
  if (!d || !t) return null;
  const is24 = /^24:00(:00)?$/.test(t);
  const ok = /^\d{1,2}:\d{2}(:\d{2})?$/.test(t) && !is24;
  const tt = ok ? t : '00:00:00';
  const base = new Date(`${d}T${tt.length === 5 ? tt + ':00' : tt}+08:00`);
  if (isNaN(base.getTime())) return null;
  // 24:00 为次日 00:00（原逻辑误记当日 00:00，提前了整整 24 小时）
  const fixed = is24 ? new Date(base.getTime() + 86400_000) : base;
  return fixed.toISOString();
}

const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 竞彩比赛日（销售日）＝编号前缀周几对应那天，跨午夜场归前一天。
 *  例：周日001~周日024 全部归周日；kickoff 周一 00:30 的「周一001」归周一。
 *  注意：不能直接用接口 matchDate（那是北京自然开赛日）。 */
export function salesDateOf(num: string, kickoff: Date | null): string | null {
  if (!num || !kickoff || isNaN(kickoff.getTime())) return null;
  const bj = new Date(kickoff.getTime() + 8 * 3600_000);
  const wd = WD.indexOf(num.slice(0, 2));
  if (wd < 0) return bj.toISOString().slice(0, 10); // 无前缀 → 北京自然日
  const dow = bj.getUTCDay(); // 0=Sun..6=Sat，与 WD 下标对齐
  let diff = wd - dow;
  if (diff > 3) diff -= 7; else if (diff < -3) diff += 7;
  const d = new Date(Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate() + diff));
  return d.toISOString().slice(0, 10);
}

export async function upsertMatch(m: MatchRow): Promise<void> {
  const kickoff = parseKickoff(m);
  const matchDate = salesDateOf(m.num, kickoff ? new Date(kickoff) : null) ?? m.matchDate;
  await query(`
    INSERT INTO matches (match_id, match_date, num, league, home, away, kickoff, had, hhad, had_base, hhad_base, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
    ON CONFLICT (match_id) DO UPDATE SET
      match_date=$2, num=$3, league=$4, home=$5, away=$6, kickoff=$7, had=$8, hhad=$9,
      had_base=COALESCE(NULLIF(matches.had_base, 'null'::jsonb), $10::jsonb),
      hhad_base=COALESCE(NULLIF(matches.hhad_base, 'null'::jsonb), $11::jsonb),
      updated_at=now()
  `, [m.matchId, matchDate, m.num, m.league, m.home, m.away, kickoff,
      m.had == null ? null : JSON.stringify(m.had),
      m.hhad == null ? null : JSON.stringify(m.hhad),
      m.hadBase == null ? null : JSON.stringify(m.hadBase),
      m.hhadBase == null ? null : JSON.stringify(m.hhadBase)]);
}

/** 兜底补录（可以过时，不能缺少）：比分/赛果链路见到的未知竞彩场只插不盖。
 *  在售池（getMatchCalculatorV1）开赛即下架，开赛前没见过的场赛后永远补不回来；
 *  比分池（getMatchDataPageListV1）含已开赛/已完成场，是唯一的补录源。
 *  语义：无行则插（盘口置空，展示为未评分但不缺席）；已有行绝不动（ON CONFLICT DO NOTHING，
 *  不碰赔率/基线）。返回 true=本次新插。 */
export async function ensureMatch(m: { matchId: string; matchDate: string; num: string; league: string; home: string; away: string; matchTime?: string }): Promise<boolean> {
  let kickoff: string | null = null;
  if (m.matchDate && m.matchTime && /^\d{1,2}:\d{2}(:\d{2})?$/.test(m.matchTime)) {
    const t = m.matchTime.length === 5 ? m.matchTime + ':00' : m.matchTime;
    const iso = new Date(`${m.matchDate}T${t}+08:00`);
    if (!isNaN(iso.getTime())) kickoff = iso.toISOString();
  }
  const matchDate = salesDateOf(m.num, kickoff ? new Date(kickoff) : null) ?? m.matchDate;
  const r = await query(`
    INSERT INTO matches (match_id, match_date, num, league, home, away, kickoff, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, now())
    ON CONFLICT (match_id) DO NOTHING
  `, [m.matchId, matchDate, m.num, m.league, m.home, m.away, kickoff]);
  return (r.rowCount ?? 0) > 0;
}

export async function pushOddsHistory(matchId: string, entries: { market: string; side: string; odds: number; observedAt?: string }[]): Promise<void> {
  if (!entries.length) return;
  const client = await (await import('./pool.js')).pool().connect();
  try {
    for (const e of entries) {
      await client.query(
        'INSERT INTO odds_history (match_id, market, side, odds, observed_at) VALUES ($1,$2,$3,$4,$5)',
        [matchId, e.market, e.side, e.odds, e.observedAt ?? null]);
    }
  } finally { client.release(); }
}

/** 欧洲市场赔率（懂球帝 magicball 欧赔，每场每源覆盖式快照） */
export async function upsertEuropeanOdds(matchId: string, o: { home: number; draw: number; away: number }, source = 'dongqiudi'): Promise<void> {
  await query(`
    INSERT INTO europe_odds (match_id, home_odds, draw_odds, away_odds, source, observed_at)
    VALUES ($1::varchar, $2, $3, $4, $5::varchar, now())
    ON CONFLICT (match_id, source) DO UPDATE SET
      home_odds=EXCLUDED.home_odds, draw_odds=EXCLUDED.draw_odds,
      away_odds=EXCLUDED.away_odds, observed_at=now()
  `, [matchId, o.home, o.draw, o.away, source]);
}

/** 读某场当前欧洲赔率（含去水隐含概率，value 维度用） */
export async function getEuropeanOdds(matchId: string): Promise<{ home: number; draw: number; away: number; prob: { h: number; d: number; a: number }; source: string; observedAt: string } | null> {
  const r = await query('SELECT home_odds, draw_odds, away_odds, source, to_char(observed_at, \'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"\') observed_at FROM europe_odds WHERE match_id=$1', [matchId]);
  const row = r.rows[0];
  if (!row) return null;
  const home = Number(row.home_odds), draw = Number(row.draw_odds), away = Number(row.away_odds);
  if (!home || !draw || !away) return null;
  const inv = 1 / home + 1 / draw + 1 / away;
  return { home, draw, away, prob: { h: 1 / home / inv, d: 1 / draw / inv, a: 1 / away / inv }, source: row.source, observedAt: row.observed_at };
}

/** matches.support upsert（保持 had_base 等首见语义，support 只覆盖当轮）。
 *  match_date 用子查询保底（行已存在走 DO UPDATE；不存在兜底插入接口不存在该场） */
export async function upsertSupport(matchId: string, support: SupportRates): Promise<void> {
  // 仅更新已存在的竞彩场次，禁止写入残缺幽灵行
  await query(`
    UPDATE matches SET support=$2::jsonb, updated_at=now() WHERE match_id=$1::varchar
  `, [matchId, support == null ? null : JSON.stringify(support)]);
}

// ---------------- 新增渠道（历史积累层） ----------------

/** 欧赔轨迹追加（origin=初盘 / spot=即时），每次刷新一行 */
export async function appendEuropeanOddsHistory(
  matchId: string,
  o: { home: number; draw: number; away: number },
  oddsType: 'origin' | 'spot',
  source = 'dongqiudi',
): Promise<void> {
  await query(
    'INSERT INTO europe_odds_history (match_id, home_odds, draw_odds, away_odds, odds_type, source, observed_at) VALUES ($1,$2,$3,$4,$5,$6, now())',
    [matchId, o.home, o.draw, o.away, oddsType, source]);
}

/** 亚盘/大小球轨迹追加（magicball score_odds origin/spot 的 [0]/[2]） */
export async function appendHandicapOddsHistory(
  matchId: string,
  m: { market: 'AH' | 'OU'; line: number; home: number; away: number },
  oddsType: 'origin' | 'spot',
  source = 'dongqiudi',
): Promise<void> {
  await query(
    `INSERT INTO handicap_odds_history (match_id, market, line, home_odds, away_odds, odds_type, source, observed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now())`,
    [matchId, m.market, m.line, m.home, m.away, oddsType, source]);
}

/** 多时点评分快照落帧（score_snapshots）；value_ev 传小数（0.12=+12%） */
export async function snapshotScore(s: {
  matchId: string; snapshotAt: string; hoursToKo: number | null; slot: string; scanRound: number;
  total: number; band: string; dir: string; market: string; pred: string; odds: number | null;
  dropAmt: number; valueEv: number | null; score: unknown; had: string; hhad: string;
  europe: string; support: string; hasBaseMark: string;
}): Promise<void> {
  await query(
    `INSERT INTO score_snapshots
       (match_id, snapshot_at, hours_to_ko, slot, scan_round, total, band, dir, market, pred, odds,
        drop_amt, value_ev, score, had, hhad, europe, support, has_base_mark)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [s.matchId, s.snapshotAt, s.hoursToKo, s.slot, s.scanRound, s.total, s.band, s.dir, s.market,
     s.pred, s.odds, s.dropAmt, s.valueEv, JSON.stringify(s.score), s.had, s.hhad, s.europe, s.support,
     s.hasBaseMark]);
}

/** 读某场多时点评分快照（升序时间） */
export async function getScoreSnapshots(matchId: string): Promise<any[]> {
  const r = await query(
    `SELECT snapshot_at, hours_to_ko, slot, scan_round, total, band, dir, odds, value_ev, score, had, hhad, europe
     FROM score_snapshots WHERE match_id=$1 ORDER BY snapshot_at ASC`, [matchId]);
  return r.rows.map(x => ({ ...x, value_ev: x.value_ev == null ? null : Number(x.value_ev), odds: x.odds == null ? null : Number(x.odds) }));
}

/** 球队 Elo upsert */
export async function saveElo(e: { team: string; league: string; elo: number; homeElo: number; awayElo: number; n: number; lastAt: string | null }): Promise<void> {
  await query(
    `INSERT INTO team_elo (team, league, elo, home_elo, away_elo, n, last_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now())
     ON CONFLICT (team) DO UPDATE SET
       league=$2, elo=$3, home_elo=$4, away_elo=$5, n=$6, last_at=$7, updated_at=now()`,
    [e.team, e.league, e.elo, e.homeElo, e.awayElo, e.n, e.lastAt]);
}

/** 临场首发/伤停 upsert */
export async function upsertLineups(matchId: string, lineups: { homeFirst11: unknown; awayFirst11: unknown; injuries: unknown }): Promise<void> {
  await query(
    `INSERT INTO match_lineups (match_id, home_first11, away_first11, injuries, fetched_at)
     VALUES ($1,$2,$3,$4, now())
     ON CONFLICT (match_id) DO UPDATE SET
       home_first11=$2, away_first11=$3, injuries=$4, fetched_at=now()`,
    [matchId, JSON.stringify(lineups.homeFirst11 ?? null), JSON.stringify(lineups.awayFirst11 ?? null), JSON.stringify(lineups.injuries ?? null)]);
}

/** 某场 odds_history 最近一条 observed_at（增量追加守卫） */
export async function maxOddsHistoryAt(matchId: string): Promise<string | null> {
  const r = await query('SELECT MAX(observed_at) m FROM odds_history WHERE match_id = $1', [matchId]);
  const m = r.rows[0]?.m;
  return m == null ? null : new Date(m).toISOString();
}

/** 批量写联赛基线（评分前置步骤，history-stats 产出） */
export async function saveBaseRates(rates: BaseRate[]): Promise<void> {
  if (!rates.length) return;
  for (const r of rates) {
    await query(`
      INSERT INTO base_rates (league, draw_rate, home_rate, away_rate, n, window_days, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6, now())
      ON CONFLICT (league) DO UPDATE SET
        draw_rate=$2, home_rate=$3, away_rate=$4, n=$5, window_days=$6, updated_at=now()
    `, [r.league, r.drawRate, r.homeRate, r.awayRate, r.n, 60]);
  }
}

export async function saveScore(r: ScoreRow): Promise<void> {
  // match_date 从 matches 表取权威值（比赛日），避免依赖 r.time（那是开赛时刻展示用）
  // 参数显式 cast：同参数多上下文（SELECT 列表 + WHERE）需给 PG 唯一边界
  await query(`
    INSERT INTO scores (match_id, match_date, scan_round, dir, market, pred, odds, drop_amt,
      confirm, model, history, risk, value, total, band, drop_note, has_base_mark, dims, analysis, from_source, analyzed_at)
    SELECT $1::varchar, m.match_date, $2::int, $3::varchar, $4::varchar, $5::varchar,
      $6::numeric, $7::numeric, $8::int, $9::int, $10::int, $11::int, $12::int, $13::int,
      $14::varchar, $15::varchar, $16::varchar, $17::jsonb, $18::jsonb, $19::varchar, now()
    FROM matches m WHERE m.match_id = $1::varchar
    ON CONFLICT (match_id, scan_round) DO UPDATE SET
      dir=EXCLUDED.dir, market=EXCLUDED.market, pred=EXCLUDED.pred, odds=EXCLUDED.odds,
      drop_amt=EXCLUDED.drop_amt, confirm=EXCLUDED.confirm, model=EXCLUDED.model, history=EXCLUDED.history,
      risk=EXCLUDED.risk, value=EXCLUDED.value, total=EXCLUDED.total, band=EXCLUDED.band,
      drop_note=EXCLUDED.drop_note, has_base_mark=EXCLUDED.has_base_mark,
      dims=EXCLUDED.dims, analysis=EXCLUDED.analysis, from_source=EXCLUDED.from_source, analyzed_at=now()
  `, [
    r.matchId, r.scanRound ?? 1,
    r.dir, r.market, r.pred, r.odds ?? null, r.dropAmt ?? 0, r.confirm ?? 0, r.model ?? 0,
    r.history ?? 0, r.risk ?? 0, r.value ?? 0, r.total, r.band ?? '', r.dropNote ?? '', r.hasBaseMark ?? 'v',
    r.analysis ? JSON.stringify(r.analysis.dims) : null,
    r.analysis ? JSON.stringify({ reasoning: r.analysis.reasoning, from: r.analysis.from, generatedAt: r.analysis.generatedAt }) : null,
    r.analysis?.from ?? 'engine',
  ]);
}

export async function upsertLive(l: LiveRow): Promise<void> {
  await query(`
    INSERT INTO live_scores (match_id, score, ht, status, status_name, source, fetched_at)
    VALUES ($1,$2,$3,$4,$5,$6, now())
    ON CONFLICT (match_id) DO UPDATE SET score=$2, ht=$3, status=$4, status_name=$5, source=$6, fetched_at=now()
  `, [l.matchId, l.score, l.ht, l.status, l.statusName, l.source]);
}

export async function upsertResult(r: ResultRow): Promise<void> {
  await query(`
    INSERT INTO results (match_id, score, had, hhad, goal_line, ht, fetched_at)
    VALUES ($1,$2,$3,$4,$5,$6, now())
    ON CONFLICT (match_id) DO UPDATE SET score=$2, had=$3, hhad=$4, goal_line=$5, ht=$6, fetched_at=now()
  `, [r.matchId, r.score, r.had, r.hhad, r.goalLine, r.ht ?? null]);
}

export async function upsertBet(b: BetRow): Promise<void> {
  await query(`
    INSERT INTO bets (bet_id, type, settle_market, stake, total_odds, potential_return, placed_at,
      status, legs, theory, status_note, result, return_amount, profit, settled_at, settle, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now())
    ON CONFLICT (bet_id) DO UPDATE SET
      type=$2, settle_market=$3, stake=$4, total_odds=$5, potential_return=$6, placed_at=$7,
      status=$8, legs=$9, theory=$10, status_note=$11, result=$12, return_amount=$13, profit=$14,
      settled_at=$15, settle=$16, updated_at=now()
  `, [b.betId, b.type ?? '', b.settleMarket ?? '', b.stake, b.totalOdds ?? null, b.potentialReturn ?? null,
      b.placedAt ?? null, b.status, JSON.stringify(b.legs ?? []), b.theory ?? '', b.statusNote ?? '',
      b.result ? JSON.stringify(b.result) : null, b.returnAmount ?? null, b.profit ?? null,
      b.settledAt ?? null, b.settle ? JSON.stringify(b.settle) : null]);
}

export async function upsertVirtual(v: VirtualRow): Promise<void> {  await query(`
    INSERT INTO virtual_bets (id, match_id, match_num, league, home, away, match_time, kickoff,
      confidence, my_view, analysis, pick, odds, review_hook, status, placed_at, settled_at, result)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    ON CONFLICT (id) DO UPDATE SET
      match_id=$2, match_num=$3, status=$15, review_hook=$14, result=$18, settled_at=$17
  `, [v.id, v.matchId != null ? String(v.matchId) : null, v.matchNum ?? null, v.league ?? null,
      v.home ?? null, v.away ?? null, v.matchTime ?? null, v.kickoff ?? null, v.confidence ?? null,
      v.myView ?? '', v.analysis ?? '', v.pick ?? '', v.odds ?? null, v.reviewHook ?? '',
      v.status ?? 'open', v.placedAt ?? null, v.settledAt ?? null, v.result ? JSON.stringify(v.result) : null]);
}

/** 只插入、不覆盖：并发开虚拟注时用，返回 false 表示 id 已被占用（调用方重算 id） */
export async function insertVirtual(v: VirtualRow): Promise<boolean> {
  const r = await query(`
    INSERT INTO virtual_bets (id, match_id, match_num, league, home, away, match_time, kickoff,
      confidence, my_view, analysis, pick, odds, review_hook, status, placed_at, settled_at, result)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `, [v.id, v.matchId != null ? String(v.matchId) : null, v.matchNum ?? null, v.league ?? null,
      v.home ?? null, v.away ?? null, v.matchTime ?? null, v.kickoff ?? null, v.confidence ?? null,
      v.myView ?? '', v.analysis ?? '', v.pick ?? '', v.odds ?? null, v.reviewHook ?? '',
      v.status ?? 'open', v.placedAt ?? null, v.settledAt ?? null, v.result ? JSON.stringify(v.result) : null]);
  return (r.rowCount ?? 0) === 1;
}

export async function saveBankroll(b: BankrollRow): Promise<void> {
  await query(`
    INSERT INTO bankroll (id, target, start_bankroll, epoch, epoch_note, cash, settled_profit,
      total_staked, total_returned, in_play, bets, history, updated_at)
    VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
    ON CONFLICT (id) DO UPDATE SET target=$1, start_bankroll=$2, epoch=$3, epoch_note=$4, cash=$5,
      settled_profit=$6, total_staked=$7, total_returned=$8, in_play=$9, bets=$10, history=$11, updated_at=now()
  `, [b.target, b.startingBankroll, b.epoch, b.epochNote ?? '', b.cash, b.settledProfit ?? 0,
      b.totalStaked ?? 0, b.totalReturned ?? 0, JSON.stringify(b.inPlay ?? []), JSON.stringify(b.bets ?? []),
      JSON.stringify(b.sequence ?? [])]);
}

export async function setSourceStatus(ok: boolean, errors: { source: string; message: string }[], detail?: unknown): Promise<void> {
  await query(`
    INSERT INTO source_status (id, ok, errors, detail, updated_at) VALUES (1,$1,$2,$3, now())
    ON CONFLICT (id) DO UPDATE SET ok=$1, errors=$2, detail=$3, updated_at=now()
  `, [ok, JSON.stringify(errors), JSON.stringify(detail ?? {})]);
}

/** 读写文档（日记 / 自我升级 / mistakes），body 为任意 JSON */
export async function upsertDoc(name: string, body: unknown): Promise<void> {
  await query(`
    INSERT INTO docs (name, body, updated_at) VALUES ($1,$2, now())
    ON CONFLICT (name) DO UPDATE SET body=$2, updated_at=now()
  `, [name, JSON.stringify(body)]);
}


export async function getDoc(name: string): Promise<unknown | null> {
  const r = await query('SELECT body FROM docs WHERE name = $1', [name]);
  return r.rows[0]?.body ?? null;
}

export async function listDocs(prefix: string): Promise<string[]> {
  const r = await query(`SELECT name FROM docs WHERE name LIKE $1 ORDER BY name DESC`, [`${prefix}%`]);
  return r.rows.map(x => x.name.slice(prefix.length));
}

// ---------------- 读取 ----------------

/** 当日全部场次的 support 快照（matchId → SupportRates） */
export async function getSupportMap(date: string): Promise<Record<string, SupportRates>> {
  const r = await query('SELECT match_id, support FROM matches WHERE match_date = $1', [date]);
  const out: Record<string, SupportRates> = {};
  for (const x of r.rows) if (x.support) out[x.match_id] = x.support;
  return out;
}

/** 单场完整变盘轨迹（降序时间） */
export async function getOddsHistory(matchId: string): Promise<OddsHistEntry[]> {
  const r = await query(
    'SELECT market, side, odds, observed_at FROM odds_history WHERE match_id = $1 ORDER BY observed_at ASC',
    [matchId]);
  return r.rows.map((x: any) => ({
    market: x.market, side: x.side, odds: Number(x.odds),
    observedAt: x.observed_at ? new Date(x.observed_at).toISOString() : '',
  }));
}

/** 全部联赛基线（评分时按联赛查找） */
export async function loadBaseRates(): Promise<Record<string, BaseRate>> {
  const r = await query('SELECT league, draw_rate, home_rate, away_rate, n FROM base_rates');
  const out: Record<string, BaseRate> = {};
  for (const x of r.rows) {
    out[x.league] = {
      league: x.league, drawRate: Number(x.draw_rate),
      homeRate: Number(x.home_rate), awayRate: Number(x.away_rate), n: Number(x.n),
    };
  }
  return out;
}

/** 滚动平局率：最近已完成销售日（有赛果）的平局占比，用于平局风险基准。
 *  beforeDate 可选：只统计该日之前的销售日（当日盘口尚未开赛）。 */
export async function getRollingDrawRate(beforeDate?: string, days = 2): Promise<{ rate: number; n: number; from: string[] }> {
  const rows = beforeDate
    ? await query(`
      SELECT to_char(m.match_date,'YYYY-MM-DD') d,
             count(*) FILTER (WHERE r.had = 'D') AS draws,
             count(*) AS total
      FROM results r JOIN matches m ON m.match_id = r.match_id
      WHERE r.had IS NOT NULL AND m.match_date < $1
      GROUP BY m.match_date ORDER BY m.match_date DESC LIMIT $2
    `, [beforeDate, days])
    : await query(`
      SELECT to_char(m.match_date,'YYYY-MM-DD') d,
             count(*) FILTER (WHERE r.had = 'D') AS draws,
             count(*) AS total
      FROM results r JOIN matches m ON m.match_id = r.match_id
      WHERE r.had IS NOT NULL
      GROUP BY m.match_date ORDER BY m.match_date DESC LIMIT $1
    `, [days]);
  const total = rows.rows.reduce((a: number, x: any) => a + Number(x.total), 0);
  const draws = rows.rows.reduce((a: number, x: any) => a + Number(x.draws), 0);
  return {
    rate: total ? draws / total : 0,
    n: total,
    from: rows.rows.map((x: any) => x.d),
  };
}

export async function listDays(): Promise<{ date: string; matches: number; scoreFile: boolean }[]> {
  const r = await query(`
    SELECT to_char(match_date,'YYYY-MM-DD') d, count(*) c,
      (SELECT count(*) FROM scores s2 WHERE s2.match_date = matches.match_date) scored
    FROM matches GROUP BY match_date ORDER BY match_date
  `);
  return r.rows.map(x => ({ date: x.d, matches: Number(x.c), scoreFile: Number(x.scored) > 0 }));
}

export async function getDayMatches(date: string): Promise<MatchRow[]> {
  const r = await query(`SELECT * FROM matches WHERE match_date = $1 ORDER BY kickoff`, [date]);
  return r.rows.map(mapMatch);
}
/** pg DATE/TIMESTAMPTZ → 字符串（DATE 转 JS Date 会因时区漂移，统一字符串安全） */
function dstr(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.slice(0, 10);
  const d = new Date(v as string | Date);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function tstr(v: unknown): string | null {
  if (v == null) return null;
  return new Date(v as string | Date).toISOString();
}
/** kickoff(UTC ISO) → 北京 HH:MM:SS（展示用，避免 DATE 时区漂移） */
function bjtime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(11, 19);
  const p = (n: number) => String(n).padStart(2, '0');
  const t = new Date(d.getTime() + 8 * 3600_000);
  return `${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}`;
}
function mapMatch(x: any): MatchRow {
  const kickoff = tstr(x.kickoff) || '';
  return {
    matchId: x.match_id, matchDate: dstr(x.match_date),
    num: x.num, league: x.league, home: x.home, away: x.away,
    kickoff, matchTime: bjtime(kickoff),
    had: x.had, hhad: x.hhad, hadBase: x.had_base, hhadBase: x.hhad_base,
    support: x.support ?? null,
    updatedAt: tstr(x.updated_at) || '',
  };
}

export async function getDayScores(date: string): Promise<ScoreRow[]> {
  const r = await query(`
    SELECT s.*, m.league, m.home, m.away, m.num, m.kickoff FROM scores s
    JOIN matches m ON m.match_id = s.match_id
    WHERE s.match_date = $1 ORDER BY s.total DESC, s.analyzed_at DESC`, [date]);
  // 主评分 = 当日全量基准（scan_round=1，scoreDay 每日整日重算）；
  // 临场轮（>1，凌晨 worker 扫描旧盘口）不作为页面主评分。
  // rule: round 1 优先；多个 round 1 取最新；某天无 round 1 则取最大 round 的最新 analyzed_at
  const latest = new Map<string, any>();
  for (const x of r.rows) {
    const prev = latest.get(x.match_id);
    if (!prev) { latest.set(x.match_id, x); continue; }
    const xBase = Number(x.scan_round) === 1, pBase = Number(prev.scan_round) === 1;
    const xT = new Date(x.analyzed_at).getTime(), pT = new Date(prev.analyzed_at).getTime();
    if (xBase !== pBase) { if (xBase) latest.set(x.match_id, x); }
    else if (xBase) { if (xT > pT) latest.set(x.match_id, x); }
    else if (Number(x.scan_round) > Number(prev.scan_round)) latest.set(x.match_id, x);
  }
  return [...latest.values()].map((x: any) => mapScore(x));
}
function mapScore(x: any): ScoreRow {
  return {
    num: x.num, league: x.league, home: x.home, away: x.away, time: bjtime(x.kickoff).slice(0, 5),
    matchId: x.match_id, dir: x.dir, odds: Number(x.odds), dropAmt: Number(x.drop_amt ?? 0),
    hasBaseMark: x.has_base_mark === '!' ? '!' : 'v', dropNote: x.drop_note ?? '',
    confirm: Number(x.confirm), model: Number(x.model), history: Number(x.history),
    risk: Number(x.risk), value: Number(x.value), total: Number(x.total), band: x.band ?? '',
    market: x.market, pred: x.pred, had: {}, hhad: {}, base: null,
    analysis: x.analysis ? { ...x.analysis, dims: x.dims ?? {} } : null,
    scanRound: Number(x.scan_round),
  };
}

export async function getDayLive(date: string): Promise<Record<string, LiveRow>> {
  const r = await query(`
    SELECT ls.* FROM live_scores ls JOIN matches m ON m.match_id = ls.match_id WHERE m.match_date = $1`, [date]);
  const out: Record<string, LiveRow> = {};
  for (const x of r.rows) out[x.match_id] = {
    matchId: x.match_id, score: x.score, ht: x.ht, status: x.status, statusName: x.status_name,
    source: x.source, fetchedAt: x.fetched_at ? new Date(x.fetched_at).toISOString() : '',
  };
  return out;
}

export async function getDayResults(date: string): Promise<Record<string, ResultRow>> {
  const r = await query(`
    SELECT res.* FROM results res JOIN matches m ON m.match_id = res.match_id WHERE m.match_date = $1`, [date]);
  const out: Record<string, ResultRow> = {};
  for (const x of r.rows) out[x.match_id] = {
    matchId: x.match_id, score: x.score, had: x.had, hhad: x.hhad, goalLine: x.goal_line, ht: x.ht,
  };
  return out;
}

export async function getAllBets(): Promise<BetRow[]> {
  const r = await query('SELECT * FROM bets ORDER BY bet_id');
  return r.rows.map((x: any) => ({
    betId: Number(x.bet_id), type: x.type ?? '', settleMarket: x.settle_market, stake: Number(x.stake),
    totalOdds: x.total_odds ? Number(x.total_odds) : undefined,
    potentialReturn: x.potential_return ? Number(x.potential_return) : undefined,
    placedAt: x.placed_at ? new Date(x.placed_at).toISOString() : '', status: x.status,
    legs: x.legs ?? [], theory: x.theory ?? '', statusNote: x.status_note ?? '',
    result: x.result, returnAmount: x.return_amount != null ? Number(x.return_amount) : undefined,
    profit: x.profit != null ? Number(x.profit) : undefined,
    settledAt: x.settled_at ? new Date(x.settled_at).toISOString() : undefined, settle: x.settle,
  }));
}

export async function getAllVirtual(): Promise<VirtualRow[]> {
  const r = await query('SELECT * FROM virtual_bets ORDER BY id');
  return r.rows.map((x: any) => ({
    id: x.id, date: (x.match_id ? null : x.match_num), matchNum: x.match_num, league: x.league,
    home: x.home, away: x.away, matchTime: x.match_time, matchId: x.match_id, kickoff: x.kickoff,
    confidence: x.confidence != null ? Number(x.confidence) : undefined, myView: x.my_view,
    analysis: x.analysis, pick: x.pick, odds: x.odds != null ? Number(x.odds) : undefined,
    reviewHook: x.review_hook, status: x.status, placedAt: x.placed_at ? new Date(x.placed_at).toISOString() : '',
    result: x.result,
  }));
}

export async function getBankroll(): Promise<BankrollRow | null> {
  const r = await query('SELECT * FROM bankroll WHERE id = 1');
  const x = r.rows[0];
  if (!x) return null;
  return {
    cash: Number(x.cash), startingBankroll: Number(x.start_bankroll), target: Number(x.target),
    epoch: x.epoch, epochNote: x.epoch_note, sequence: x.history ?? [],
    settledProfit: Number(x.settled_profit ?? 0),
    totalStaked: Number(x.total_staked ?? 0),
    totalReturned: Number(x.total_returned ?? 0),
  } as any;
}

export async function getSourceStatus(): Promise<{ ok: boolean; errors: { source: string; message: string }[] } | null> {
  const r = await query('SELECT * FROM source_status WHERE id = 1');
  const x = r.rows[0];
  if (!x) return null;
  return { ok: x.ok, errors: x.errors ?? [] };
}

/** /api/live/:date 返回「旧版同构」{fetchedAt, matches} */
export async function getLive(date: string): Promise<{ fetchedAt: string; matches: Record<string, LiveRow> }> {
  const matches = await getDayLive(date);
  return { fetchedAt: new Date().toISOString(), matches };
}

/** /api/mistakes 与 /api/diary 系（兼容旧前端接口形状） */
export async function buildMistakes(): Promise<unknown> {
  return (await getDoc('mistakes')) ?? { rules: [], mistakes: [], checklist: [] };
}

export async function getDiaryList(): Promise<{ journals: { date: string }[] }> {
  const dates = await listDocs('journal:');
  return { journals: dates.sort().map(date => ({ date })) };
}

export async function getDiary(date: string): Promise<unknown> {
  return (await getDoc('journal:' + date)) ?? null;
}

export async function getScoreVersion(): Promise<string> {
  const s = await query(`SELECT from_source, max(analyzed_at) t FROM scores GROUP BY from_source ORDER BY t DESC LIMIT 1`);
  return s.rows[0]?.from_source === 'llm' ? 'v2-llm' : 'v2.1';
}

// ---------------- 组装视图（与旧 server.js 同构） ----------------

/** 单日视图：matches + scores + virtual/bets 标注 + live + results */
export async function buildDayView(date: string): Promise<unknown> {
  const matches = await getDayMatches(date);
  const rows = await getDayScores(date);
  const allVirtual = await getAllVirtual();
  const allBets = await getAllBets();
  const results = await getDayResults(date);
  const live = await getDayLive(date);
  const nowMs = Date.now();

  const dayIds = new Set(matches.map(m => idKey(m.matchId)));
  const virtualById = new Map(), virtualByNum = new Map();
  for (const v of allVirtual) {
    const k = idKey(v.matchId);
    if (k && dayIds.has(k)) virtualById.set(k, v);
    else if (!k && v.matchNum) virtualByNum.set(v.matchNum, v);
  }
  const betsById = new Map(), betsByNum = new Map();
  for (const b of allBets) {
    for (const leg of (b.legs || [])) {
      const k = idKey(leg.matchId);
      if (k && dayIds.has(k)) { if (!betsById.has(k)) betsById.set(k, []); betsById.get(k).push(b); }
      else if (!k && leg.matchNum) { if (!betsByNum.has(leg.matchNum)) betsByNum.set(leg.matchNum, []); betsByNum.get(leg.matchNum).push(b); }
    }
  }

  let realOpen = 0, realWin = 0, realLoss = 0, virtualOpen = 0, virtualEnd = 0;
  let accHit = 0, accDone = 0, yellowHit = 0, yellowDone = 0;

  const scoreByMatch = new Map(rows.map(s => [s.matchId, s]));
  const table = matches.map(m => {
    const num = m.num, mid = idKey(m.matchId);
    const score = (mid && scoreByMatch.get(mid)) || null;
    const v = (mid && virtualById.get(mid)) || virtualByNum.get(num) || null;
    const bets = (mid && betsById.get(mid)) || betsByNum.get(num) || [];
    const res = (mid && results[mid]) || null;
    const liveRow = (mid && live[mid]) || null;
    const kickMs = m.kickoff ? new Date(m.kickoff).getTime() : NaN;
    const started = !!(res || (liveRow && liveRow.score) || (Number.isFinite(kickMs) && nowMs >= kickMs));
    const sealed = started;
    const pred = score?.pred ?? null;
    const market = score?.market || 'HHAD';
    const actual = res ? (market === 'HAD' ? res.had : res.hhad) : null;
    const yellow = !!score && score.total != null && score.total >= 60 && score.total < 80;
    const hit = !!(res && pred && actual && pred === actual);
    if (res && pred && actual) { accDone++; if (hit) accHit++; if (yellow) { yellowDone++; if (hit) yellowHit++; } }
    for (const b of bets) { if (b.status === 'open') realOpen++; else ((b.profit ?? 0) > 0 ? realWin++ : realLoss++); }
    if (v) { v.status === 'open' ? virtualOpen++ : virtualEnd++; }

    return {
      num, match: { ...m, matchId: m.matchId, num, league: m.league, home: m.home, away: m.away, matchDate: m.matchDate, matchTime: m.matchTime || (m.kickoff || '').slice(11, 19) },
      score, virtual: v, bets, sealed, started,
      live: liveRow ? { score: liveRow.score, ht: liveRow.ht, status: liveRow.statusName || liveRow.status, fetchedAt: liveRow.fetchedAt } : null,
      result: res ? {
        score: res.score, had: res.had, hhad: res.hhad, goalLine: res.goalLine, ht: res.ht, pred, hit, yellow,
        yellowHit: !!(yellow && hit), market,
        text: market === 'HAD'
          ? `${res.score}${res.had === 'H' ? ' 主胜' : res.had === 'A' ? ' 主负' : res.had === 'D' ? ' 平' : ''}`
          : `${res.score}${res.hhad === 'H' ? ' 让主' : res.hhad === 'A' ? ' 让客' : res.hhad === 'D' ? ' 让平' : ''}`,
      } : null,
    };
  });

  const scoredRows = rows.filter(r => r.total != null);
  return {
    date,
    generatedAt: new Date().toISOString(),
    scoreGeneratedAt: new Date().toISOString(),
    scoreVersion: 'v2.1',
    summary: {
      total: matches.length,
      scored: scoredRows.length,
      best: scoredRows.length ? [...scoredRows].sort((a, b) => b.total - a.total)[0] : null,
      realOpen, realWin, realLoss, virtualOpen, virtualEnd, accHit, accDone, yellowHit, yellowDone,
      accPct: accDone ? Math.round(accHit / accDone * 100) : null,
    },
    table,
  };
}

/** 全量汇总（同旧 buildSummary） */
export async function buildSummary(): Promise<unknown> {
  const bank = await getBankroll();
  const bets = await getAllBets();
  const inPlay = bets.filter(b => b.status === 'open');
  const cash = bank?.cash ?? 0;
  return {
    generatedAt: new Date().toISOString(),
    ledger: {
      target: bank?.target ?? 10000,
      startBankroll: bank?.startingBankroll ?? 1000,
      epoch: bank?.epoch ?? '', epochNote: bank?.epochNote ?? '',
      cash,
      inPlay: inPlay.map(b => b.betId),
      inPlayAmount: +inPlay.reduce((s, b) => s + Number(b.stake || 0), 0).toFixed(2),
      settledProfit: Number((bank as any)?.settledProfit ?? 0),
      totalStaked: Number((bank as any)?.totalStaked ?? 0),
      totalReturned: Number((bank as any)?.totalReturned ?? 0),
      bets: inPlay.map(b => b.betId), history: bank?.sequence ?? [],
      lastUpdated: new Date().toISOString(),
    },
    bankroll: { cash, startBankroll: bank?.startingBankroll, target: bank?.target, epoch: bank?.epoch, epochNote: bank?.epochNote, sequence: bank?.sequence ?? [] },
    bets,
    analysis: [],
  };
}