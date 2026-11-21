// 下注/结算/记账集成测试（只跑隔离测试库，不碰生产库）
// 运行：先设 JC_DB_* 环境变量指向测试库，再 npx tsx --test tests/betting.test.ts
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, query, pool } from '../src/server/db/pool.js';
import { opBet, bjToday } from '../src/server/ops.js';
import { settleReal } from '../tools/settle.js';
import { upsertEuropeanOdds } from '../src/server/db/store.js';

const DB = process.env.JC_DB_NAME || '';
if (!/test/i.test(DB)) {
  throw new Error(`拒绝在非测试库上跑集成测试（JC_DB_NAME=${DB}）`);
}

const TODAY = bjToday();

async function reset(): Promise<void> {
  await query(`TRUNCATE matches, scores, europe_odds, odds_history, bets, virtual_bets,
    bankroll, results, score_snapshots, docs RESTART IDENTITY CASCADE`);
  await query(`INSERT INTO bankroll (id, target, start_bankroll, cash, settled_profit, total_staked, total_returned)
    VALUES (1, 10000, 1000, 1000, 0, 0, 0)`);
}

/** 造一场「五门禁全过」的场次：分55/R5窗内/欧赔齐全/M-04 正EV（押客队） */
async function seedMatch(i: number): Promise<{ matchId: string; num: string }> {
  const num = String(i).padStart(3, '0');
  const matchId = `T${num}`;
  await query(
    `INSERT INTO matches (match_id, match_date, num, league, home, away, kickoff, had, hhad)
     VALUES ($1,$2,$3,'测试联赛',$4,$5, now() + interval '4 hours',
       '{"h":"5.50","d":"3.80","a":"1.55"}'::jsonb, '{"goalLine":"0","h":"1.90","d":"3.30","a":"1.80"}'::jsonb)`,
    [matchId, TODAY, num, `主队${i}`, `客队${i}`]);
  await query(
    `INSERT INTO scores (match_id, match_date, scan_round, dir, market, pred, odds, total, band)
     VALUES ($1,$2,1,'客胜','HAD','A',1.50,55,'48-57')`,
    [matchId, TODAY]);
  await upsertEuropeanOdds(matchId, { home: 5.5, draw: 3.8, away: 1.55 });
  // 亚盘客水 3.0：押客队时结算价必须用客水（旧代码误用主水）
  await query(`INSERT INTO odds_history (match_id, market, side, odds) VALUES ($1,'AH','a',3.00)`, [matchId]);
  return { matchId, num };
}

before(async () => { await migrate(); });
beforeEach(async () => { await reset(); });
after(async () => { await pool().end(); });

test('下单入参校验：缺 confirmed / 金额非法 / 赔率非法 都拒绝', async () => {
  const { num } = await seedMatch(1);
  assert.equal((await opBet({ num, pick: '客胜', odds: 1.9, stake: 50 }) as any).ok, false);
  assert.equal((await opBet({ confirmed: true, num, pick: '客胜', odds: 1.9, stake: 0 }) as any).ok, false);
  assert.equal((await opBet({ confirmed: true, num, pick: '客胜', odds: 0, stake: 50 }) as any).ok, false);
  assert.equal((await opBet({ confirmed: true, num: '6', pick: '客胜', odds: 1.9, stake: 50 }) as any).ok, false);
});

test('下单成功：扣现金、开注单；同场第二单被「单场一单」拦住', async () => {
  const { num } = await seedMatch(2);
  const r: any = await opBet({ confirmed: true, num, pick: '客胜', odds: 1.9, stake: 50 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.stake, 50);

  const cash = await query(`SELECT cash FROM bankroll WHERE id=1`);
  assert.equal(Number(cash.rows[0].cash), 950);

  const dup: any = await opBet({ confirmed: true, num, pick: '客胜', odds: 1.9, stake: 50 });
  assert.equal(dup.ok, false);
  assert.match(dup.rejected[0], /单场一单/);

  const after2 = await query(`SELECT cash, total_staked FROM bankroll WHERE id=1`);
  assert.equal(Number(after2.rows[0].cash), 950, '被拒的单不能扣钱');
  assert.equal(Number(after2.rows[0].total_staked), 50);
});

test('结算是幂等的：重复结算不会重复入账，利润按净额记', async () => {
  const { num, matchId } = await seedMatch(3);
  await opBet({ confirmed: true, num, pick: '客胜', odds: 1.9, stake: 50 });
  await query(`INSERT INTO results (match_id, score, had, hhad) VALUES ($1,'0:1','A','A')`, [matchId]);

  const first = await settleReal();
  assert.equal(first.settled, 1);
  const br = await query(`SELECT cash, settled_profit, total_returned FROM bankroll WHERE id=1`);
  assert.equal(Number(br.rows[0].cash), 1045);          // 950 + 返还 95
  assert.equal(Number(br.rows[0].settled_profit), 45);  // 净利 45，不是 95
  assert.equal(Number(br.rows[0].total_returned), 95);

  const second = await settleReal();
  assert.equal(second.settled, 0, '第二次结算必须什么都不做');
  const br2 = await query(`SELECT cash FROM bankroll WHERE id=1`);
  assert.equal(Number(br2.rows[0].cash), 1045);
});

test('让球胜平负按官方 hhad 结算，不拿 HAD 赛果顶替', async () => {
  const { matchId } = await seedMatch(4);
  await query(
    `INSERT INTO bets (bet_id, type, settle_market, stake, total_odds, potential_return, placed_at, status, legs)
     VALUES (nextval('bets_bet_id_seq'),'single','竞彩欧赔结算',50,1.75,87.5,now(),'open',$1::jsonb)`,
    [JSON.stringify([{ matchId, num: '004', market: 'HHAD', side: 'A', pick: '让负', odds: 1.75, line: 0 }])]);
  // 官方：主队 1:0 让 1 球 → 让平（D）；押「让负」应输
  await query(`INSERT INTO results (match_id, score, had, hhad, goal_line) VALUES ($1,'1:0','H','D','-1')`, [matchId]);
  const r = await settleReal();
  assert.equal(r.settled, 1);
  const bet = await query(`SELECT status, profit, return_amount FROM bets WHERE bet_id=1`);
  assert.equal(bet.rows[0].status, 'settled');
  assert.equal(Number(bet.rows[0].profit), -50);
  assert.equal(Number(bet.rows[0].return_amount), 0);
});

test('赔率缺失的注单不进结算，转人工并保持 open', async () => {
  const { matchId } = await seedMatch(5);
  await query(
    `INSERT INTO bets (bet_id, type, settle_market, stake, total_odds, placed_at, status, legs)
     VALUES (nextval('bets_bet_id_seq'),'single','竞彩欧赔结算',50,NULL,now(),'open',$1::jsonb)`,
    [JSON.stringify([{ matchId, num: '005', market: 'HAD', side: 'A', pick: '客胜' }])]);
  await query(`INSERT INTO results (match_id, score, had, hhad) VALUES ($1,'0:1','A','A')`, [matchId]);
  const r = await settleReal();
  assert.equal(r.settled, 0);
  assert.equal(r.manual, 1);
  const bet = await query(`SELECT status FROM bets WHERE bet_id=1`);
  assert.equal(bet.rows[0].status, 'open', '判不了就必须留在 open，不能猜一个结果');
});

test('并发下单不重复 ID、不超扣现金', async () => {
  const seeds = await Promise.all([1, 2, 3, 4, 5].map(i => seedMatch(10 + i)));
  const results = await Promise.all(seeds.map(s =>
    opBet({ confirmed: true, num: s.num, pick: '客胜', odds: 1.9, stake: 50 })));
  const ids = results.map((r: any) => r.betId).filter(Boolean);
  assert.equal(ids.length, 5, JSON.stringify(results));
  assert.equal(new Set(ids).size, 5, '注单 ID 必须唯一');
  const br = await query(`SELECT cash, total_staked FROM bankroll WHERE id=1`);
  assert.equal(Number(br.rows[0].cash), 750);
  assert.equal(Number(br.rows[0].total_staked), 250);
});
