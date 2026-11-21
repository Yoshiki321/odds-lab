// 结算规则单测（纯函数，不碰数据库）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settle, normalizeMarket, normalizeSide, parsePickLine, toHomeLine } from '../src/shared/settlement.js';

test('玩法识别：HHAD 不会被 /had/ 模糊匹配吞成 HAD', () => {
  assert.equal(normalizeMarket({ market: 'HHAD' }), 'HHAD');
  assert.equal(normalizeMarket({ settleMarket: '竞彩让球胜平负' }), 'HHAD');
  assert.equal(normalizeMarket({ market: 'HAD' }), 'HAD');
  assert.equal(normalizeMarket({ pick: '让负' }), 'HHAD');
  assert.equal(normalizeMarket({ pick: '主胜' }), 'HAD');
  assert.equal(normalizeMarket({ pick: '多特-1.5' }), 'AH');
  assert.equal(normalizeMarket({ pick: '大2.5' }), 'OU');
  assert.equal(normalizeMarket({ pick: '' }), null);
});

test('方向识别：中文胜平负 / 让球胜平负 / 亚盘主客', () => {
  assert.equal(normalizeSide('HAD', '主胜'), 'home');
  assert.equal(normalizeSide('HAD', '客胜'), 'away');
  assert.equal(normalizeSide('HAD', '主负'), 'away');
  assert.equal(normalizeSide('HAD', '平'), 'draw');
  assert.equal(normalizeSide('HHAD', '让负'), 'away');
  assert.equal(normalizeSide('HHAD', '让胜'), 'home');
  assert.equal(normalizeSide('AH', '多特-1.5', '多特', '拜仁'), 'home');
  assert.equal(normalizeSide('AH', '拜仁+1.5', '多特', '拜仁'), 'away');
  assert.equal(normalizeSide('OU', '大2.5'), 'over');
  assert.equal(normalizeSide('OU', '小3'), 'under');
  assert.equal(normalizeSide('AH', '平手'), null); // 平手无方向，必须人工
});

test('盘口线解析与主客换算', () => {
  assert.equal(parsePickLine('多特-1.5'), -1.5);
  assert.equal(parsePickLine('多特+0.25'), 0.25);
  assert.equal(parsePickLine('让1'), -1);
  assert.equal(parsePickLine('受让1.5'), 1.5);
  assert.equal(parsePickLine('大2.75'), 2.75);
  assert.equal(toHomeLine(-1.5, 'home'), -1.5);
  assert.equal(toHomeLine(-1.5, 'away'), 1.5); // 客队让 1.5 → 主队受让 1.5
});

test('HAD：主胜命中 / 赔率缺失转人工', () => {
  const base = { homeScore: 2, awayScore: 0, finalHad: 'H', finalHhad: 'H' } as const;
  const w = settle({ market: 'HAD', side: 'home', odds: 1.9, ...base });
  assert.equal(w.outcome, 'win');
  assert.equal(w.multiplier, 1.9);

  const l = settle({ market: 'HAD', side: 'away', odds: 1.9, ...base });
  assert.equal(l.outcome, 'loss');

  const missing = settle({ market: 'HAD', side: 'home', odds: null, ...base });
  assert.equal(missing.outcome, 'manual');

  const noOfficial = settle({ market: 'HAD', side: 'home', odds: 1.9, homeScore: 1, awayScore: 1, finalHad: null, finalHhad: null });
  assert.equal(noOfficial.outcome, 'manual');
});

test('HHAD：用让球官方赛果，不拿 HAD 赛果顶替', () => {
  // 主队让 1 球，2:0 让胜，但 1:0 让平
  const win = settle({ market: 'HHAD', side: 'home', odds: 1.75, homeScore: 2, awayScore: 0, finalHad: 'H', finalHhad: 'H' });
  assert.equal(win.outcome, 'win');
  const draw = settle({ market: 'HHAD', side: 'home', odds: 1.75, homeScore: 1, awayScore: 0, finalHad: 'H', finalHhad: 'D' });
  assert.equal(draw.outcome, 'loss');
  const away = settle({ market: 'HHAD', side: 'away', odds: 2.2, homeScore: 1, awayScore: 0, finalHad: 'H', finalHhad: 'A' });
  assert.equal(away.outcome, 'win');
});

test('亚盘整数/半球盘：赢输走', () => {
  const win = settle({ market: 'AH', side: 'home', odds: 1.9, homeScore: 2, awayScore: 0, line: -1.5 });
  assert.equal(win.outcome, 'win');
  const loss = settle({ market: 'AH', side: 'home', odds: 1.9, homeScore: 1, awayScore: 0, line: -1.5 });
  assert.equal(loss.outcome, 'loss');
  const push = settle({ market: 'AH', side: 'home', odds: 1.9, homeScore: 1, awayScore: 0, line: -1 });
  assert.equal(push.outcome, 'push');
  assert.equal(push.multiplier, 1);
  const awayWin = settle({ market: 'AH', side: 'away', odds: 1.9, homeScore: 1, awayScore: 0, line: -1.5 });
  assert.equal(awayWin.outcome, 'win');
});

test('亚盘 quarter 盘：半赢 / 半输', () => {
  // 主队 -0.25，1:1 平 → 半输（0 走、0.5 输）
  const hl = settle({ market: 'AH', side: 'home', odds: 2.0, homeScore: 1, awayScore: 1, line: -0.25 });
  assert.equal(hl.outcome, 'halfloss');
  assert.equal(hl.multiplier, 0.5);

  // 主队 -0.75，1:0 → 一赢一走 → 半赢
  const hw = settle({ market: 'AH', side: 'home', odds: 2.0, homeScore: 1, awayScore: 0, line: -0.75 });
  assert.equal(hw.outcome, 'halfwin');
  assert.equal(hw.multiplier, 1.5);
});

test('大小球：赢 / 走 / 输 + quarter', () => {
  const overWin = settle({ market: 'OU', side: 'over', odds: 1.95, homeScore: 2, awayScore: 1, line: 2.5 });
  assert.equal(overWin.outcome, 'win');
  const overPush = settle({ market: 'OU', side: 'over', odds: 1.95, homeScore: 2, awayScore: 1, line: 3 });
  assert.equal(overPush.outcome, 'push');
  const underWin = settle({ market: 'OU', side: 'under', odds: 1.95, homeScore: 1, awayScore: 0, line: 2.5 });
  assert.equal(underWin.outcome, 'win');
  const overQuarter = settle({ market: 'OU', side: 'over', odds: 1.95, homeScore: 2, awayScore: 1, line: 2.75 });
  assert.equal(overQuarter.outcome, 'halfwin'); // 2.5 赢 / 3.0 走
});

test('非法输入：比分异常 / 赔率越界都转人工', () => {
  assert.equal(settle({ market: 'AH', side: 'home', odds: 1.9, homeScore: -1, awayScore: 0, line: 0 }).outcome, 'manual');
  assert.equal(settle({ market: 'AH', side: 'home', odds: 0, homeScore: 1, awayScore: 0, line: 0 }).outcome, 'manual');
  assert.equal(settle({ market: 'AH', side: 'home', odds: 1.9, homeScore: 1, awayScore: 0, line: NaN }).outcome, 'manual');
});
