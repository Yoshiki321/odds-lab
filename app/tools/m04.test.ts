/**
 * m04.test.ts — M-04 门控测试（node 24 直跑：node app/tools/m04.test.ts）
 * 区分：本测试只验证"门控纯函数"；是否被服务端/定时流程实际调用属于集成问题，不在本测试范围。
 */
import { evaluateM04, type M04Input } from './m04.ts';

let pass = 0; const fails: string[] = [];
function t(name: string, fn: () => void) {
  try { fn(); pass++; console.log('ok - ' + name); }
  catch (e: any) { fails.push(name + ': ' + e.message); console.error('FAIL - ' + name + '\n' + e.message); }
}
function eq(a: any, b: any, msg: string) { if (a !== b) throw new Error(`${msg}: 实际=${a} 期望=${b}`); }

const base: M04Input = {
  score: 55, line: 1, market: 'HHAD', side: 'A',
  jcOdds: 1.75, europe: { home: 3.4, draw: 3.3, away: 2.1 },
  settleOdds: 3.9, hoursToKickoff: 4,
};

t('分数不足 → 不通过', () => {
  const d = evaluateM04({ ...base, score: 47 });
  eq(d.eligible, false, 'eligible'); eq(d.reason, 'score<48', 'reason');
});

t('时间窗之外 → 不通过', () => {
  eq(evaluateM04({ ...base, hoursToKickoff: 0.4 }).reason, 'R5时间窗外', '过早');
  eq(evaluateM04({ ...base, hoursToKickoff: 8.1 }).reason, 'R5时间窗外', '过晚');
  eq(evaluateM04({ ...base, hoursToKickoff: null }).reason, 'R5时间窗外', '缺失');
});

t('竞彩赔率缺失/非法 → 不通过', () => {
  eq(evaluateM04({ ...base, jcOdds: Number.NaN }).eligible, false, 'NaN');
  eq(evaluateM04({ ...base, jcOdds: 1 }).eligible, false, '≤1');
});

t('欧赔缺失 → 不通过', () => {
  eq(evaluateM04({ ...base, europe: null }).reason, '独立欧赔缺失', 'null');
  eq(evaluateM04({ ...base, europe: { home: 3.4, draw: 0, away: 2.1 } }).eligible, false, '含0');
});

t('竞彩本身非负 EV → 不通过（无需改投）', () => {
  const d = evaluateM04({ ...base, jcOdds: 8.0, settleOdds: 3.9 });
  eq(d.eligible, false, 'eligible');
  if (d.jcEv === null || d.jcEv < 0) throw new Error('jcEv 应 ≥0: ' + d.jcEv);
});

t('欧亚结算赔率缺失 → 不通过', () => {
  eq(evaluateM04({ ...base, settleOdds: null }).reason, '欧亚结算赔率缺失', 'reason');
});

t('非整数盘无法计算概率 → 不通过（安全失败）', () => {
  const d = evaluateM04({ ...base, line: 0.5, market: 'HHAD' });
  eq(d.eligible, false, 'eligible');
  if (!/公平概率计算失败|走水概率不可计算/.test(d.reason)) throw new Error('reason 异常: ' + d.reason);
});

t('合法场景：竞彩负EV 但欧亚正EV → 通过', () => {
  const d = evaluateM04(base);
  eq(d.eligible, true, 'eligible: ' + d.reason);
  if (d.jcEv === null || d.jcEv >= 0) throw new Error('jcEv 应 <0');
  if (d.settleEv === null || d.settleEv < 0) throw new Error('settleEv 应 ≥0');
});

t('自检：evaluateM04 是纯函数（同输入同输出）', () => {
  const a = evaluateM04(base);
  const b = evaluateM04(base);
  eq(JSON.stringify(a), JSON.stringify(b), '确定性');
});

console.log(`\nPASS ${pass} 组, FAIL ${fails.length}`);
if (fails.length) { console.error(fails.join('\n')); process.exit(1); }
