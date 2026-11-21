/**
 * dataset.test.ts — 防泄漏与配对键测试（node 24 直跑）
 */
import { rowKey, isLeakFree, impliedProbs, type Row } from './dataset_build.ts';

let pass = 0; const fails: string[] = [];
function t(name: string, fn: () => void) {
  try { fn(); pass++; console.log('ok - ' + name); }
  catch (e: any) { fails.push(name + ': ' + e.message); console.error('FAIL - ' + name + '\n' + e.message); }
}
function eq(a: any, b: any, m: string) { if (a !== b) throw new Error(`${m}: 实际=${a} 期望=${b}`); }

const base = {
  matchId: 'M1',
  kickoffMs: Date.parse('2026-09-02T12:00:00Z'),
  predictMs: Date.parse('2026-09-01T10:00:00Z'),
  captureMs: Date.parse('2026-09-01T09:30:00Z'),
  oddsMs: Date.parse('2026-09-01T09:00:00Z'),
};

t('配对键包含 line：不同盘口线不是同一键', () => {
  const a = rowKey({ ...base, market: 'HAD', side: 'H', line: null } as any);
  const b = rowKey({ ...base, market: 'HAD', side: 'H', line: -0.5 } as any);
  const c = rowKey({ ...base, market: 'HAD', side: 'H', line: 0.5 } as any);
  if (a === b || a === c || b === c) throw new Error('不同 line 产生了相同键');
});

t('配对键包含方向：同场同线不同方向不同键', () => {
  const h = rowKey({ ...base, market: 'HAD', side: 'H', line: null } as any);
  const d = rowKey({ ...base, market: 'HAD', side: 'D', line: null } as any);
  if (h === d) throw new Error('H/D 键相同');
});

t('时区等价：同一绝对时刻不同写法产生相同键', () => {
  const a = rowKey({ ...base, market: 'HAD', side: 'H', line: null, predictMs: Date.parse('2026-09-01T10:00:00Z') } as any);
  const b = rowKey({ ...base, market: 'HAD', side: 'H', line: null, predictMs: Date.parse('2026-09-01T18:00:00+08:00') } as any);
  eq(a, b, '同一时刻应同键');
});

t('防泄漏：预测等于开赛 → 拒绝', () => {
  const r = { ...base, predictMs: base.kickoffMs };
  eq(isLeakFree(r).ok, false, '应拒绝');
});

t('防泄漏：预测晚于开赛 → 拒绝', () => {
  const r = { ...base, predictMs: base.kickoffMs + 1 };
  eq(isLeakFree(r).ok, false, '应拒绝');
});

t('防泄漏：采集时点晚于预测时点 → 拒绝', () => {
  const r = { ...base, captureMs: base.predictMs + 1 };
  eq(isLeakFree(r).ok, false, '应拒绝');
});

t('防泄漏：赔率时点晚于预测时点 → 拒绝', () => {
  const r = { ...base, oddsMs: base.predictMs + 1 };
  eq(isLeakFree(r).ok, false, '应拒绝');
});

t('防泄漏：正常赛前 → 通过', () => {
  eq(isLeakFree(base).ok, true, '应通过');
});

t('去水：三项齐全且抽水为正', () => {
  const p = impliedProbs(2.59, 2.65, 2.73)!;
  const sum = p.h + p.d + p.a;
  if (Math.abs(sum - 1) > 1e-9) throw new Error('概率和应为 1');
  const raw = 1 / 2.59 + 1 / 2.65 + 1 / 2.73;
  if (!(raw > 1)) throw new Error('原始抽水应 > 0');
});

t('去水：非法赔率返回 null', () => {
  eq(impliedProbs(0, 2.65, 2.73), null, 'h=0');
  eq(impliedProbs(NaN, 2.65, 2.73), null, 'NaN');
  eq(impliedProbs(1, 2.65, 2.73), null, 'h=1');
});

console.log(`\nPASS ${pass} 组, FAIL ${fails.length}`);
if (fails.length) { console.error(fails.join('\n')); process.exit(1); }
