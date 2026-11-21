// engine-check.ts - 评分引擎 v2.1 关键规则断言（纯函数，不写库）
// 权重 22/12/22/12/22/10，档位 58/48/40/30；R_draw 两阶段（≥0.7弃投 / 0.5-0.7候选压47）
// 覆盖: 降水选侧/DROP 量级表/深盘退回/v1.6 下盘保护化/M1 模型命中/首盘标记/平局两阶段A+B
// 用法: npx tsx scripts/engine-check.ts
import { scoreMatch } from '../tools/score.js';
import type { MatchRow } from '../src/shared/types.js';

// 固定 now：kickoff 统一 2026-09-15T12:00Z，开赛前 36h → drop 时间分=2、无临场追尾扣分，断言不随 wall-clock 腐烂
const NOW = '2026-09-14T00:00:00.000Z';

function mk(p: Partial<MatchRow> & { matchId: string }): MatchRow {
  return {
    num: p.num || '测试001', league: p.league || '测试联', home: p.home || '主队', away: p.away || '客队',
    matchDate: '2026-09-15', kickoff: '2026-09-15T12:00:00.000Z', matchTime: '12:00:00',
    had: p.had || null, hhad: p.hhad || null, hadBase: p.hadBase || null, hhadBase: p.hhadBase || null,
    updatedAt: '', ...p,
  };
}
const sc = (p: Partial<MatchRow> & { matchId: string }) => scoreMatch(mk(p), { now: NOW });
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

console.log('== 案例1：主胜降水 0.40（首盘 2.10→1.70）→ 选中主胜，v2.1 drop=16(量级14+形态0+时间2) ==');
{
  const r = sc({
    matchId: 't1', had: { h: '1.70', d: '3.40', a: '4.50' }, hhad: { goalLine: '0', h: '1.75', d: '3.30', a: '4.00' },
    hadBase: { h: '2.10', d: '3.20', a: '3.00' }, hhadBase: { goalLine: '0', h: '2.00', d: '3.30', a: '3.10' },
  });
  if ('note' in r) { ok('案例1 出分', false, JSON.stringify(r)); }
  else {
    ok('方向=主胜', r.dir === '主胜' && r.pred === 'H', r.dir);
    ok('降水维度=16', r.analysis?.dims?.drop?.score === 16, `drop=${r.analysis?.dims?.drop?.score}`);
    ok('总分=55(实单)', r.total === 55 && r.band === '✅实单', `total=${r.total} band=${r.band}`);
    ok('带首盘基线标记', r.hasBaseMark === 'v');
  }
}

console.log('== 案例2：主队受让+1 客队降水 0.40 → M1 弱化命中，退回主负，R_draw 0.9 → 弃投 ==');
{
  const r = sc({
    matchId: 't2', league: '非五联赛', had: { h: '2.60', d: '3.10', a: '1.90' }, hhad: { goalLine: '+1', h: '2.05', d: '3.20', a: '2.90' },
    hadBase: { h: '2.60', d: '3.10', a: '2.10' }, hhadBase: { goalLine: '+1', h: '1.90', d: '3.20', a: '3.30' },
  });
  if ('note' in r) { ok('案例2 出分', false, JSON.stringify(r)); }
  else {
    ok('方向=主负（退回胜平负）', r.dir === '主负' && r.pred === 'A', r.dir);
    ok('M1 弱化=18（无变盘轨迹）', r.model === 18, `model=${r.model}`);
    ok('弃投·平局（压47）', r.total === 47 && r.band === '❌弃投·平局', `total=${r.total} band=${r.band}`);
  }
}

console.log('== 案例5：d=3.28 在 v2.1 五因子下 R=0.8 → 同样弃投（v1.8 的阶段B边界已上移） ==');
{
  const r = sc({
    matchId: 't5', league: '非五联赛', had: { h: '2.60', d: '3.28', a: '1.90' }, hhad: { goalLine: '+1', h: '2.05', d: '3.20', a: '2.90' },
    hadBase: { h: '2.60', d: '3.28', a: '2.10' }, hhadBase: { goalLine: '+1', h: '1.90', d: '3.20', a: '3.30' },
  });
  if ('note' in r) { ok('案例5 出分', false, JSON.stringify(r)); }
  else {
    ok('R 0.8 弃投（压47）', r.total === 47 && r.band === '❌弃投·平局', `total=${r.total} band=${r.band}`);
  }
}

console.log('== 案例5b：阶段B（R=0.6，主客差0.3+盘口同侧）→ 压47 候选·平局 ==');
{
  const r = sc({
    matchId: 't5b', league: '非五联赛', had: { h: '2.60', d: '3.50', a: '2.30' }, hhad: { goalLine: '+1', h: '2.90', d: '3.20', a: '2.05' },
    hadBase: { h: '2.60', d: '3.50', a: '2.50' }, hhadBase: { goalLine: '+1', h: '2.70', d: '3.20', a: '2.45' },
  });
  if ('note' in r) { ok('案例5b 出分', false, JSON.stringify(r)); }
  else {
    ok('候选·平局（压47）', r.total === 47 && r.band === '⏳候选·平局', `total=${r.total} band=${r.band}`);
  }
}

console.log('== 案例6：v1.8 受让方（平局=让球赢）不受平局过滤误伤 ==');
{
  const r = sc({
    matchId: 't6', league: '英超', had: { h: '2.55', d: '3.10', a: '2.45' }, hhad: { goalLine: '+1', h: '1.90', d: '3.20', a: '3.10' },
    hadBase: { h: '3.00', d: '3.10', a: '2.20' }, hhadBase: { goalLine: '+1', h: '1.70', d: '3.20', a: '3.40' },
  });
  if ('note' in r) { ok('案例6 出分', false); }
  else {
    ok('下盘保护化不受平局过滤（受让平局=赢）', r.band.indexOf('平局') === -1 && r.betNote === '下盘保护化', `band=${r.band} betNote=${r.betNote}`);
  }
}

console.log('== 案例3：深盘让-2 主队降水 → 退回主胜，不押让胜 ==');
{
  const r = sc({
    matchId: 't3', had: { h: '1.95', d: '3.60', a: '3.40' }, hhad: { goalLine: '-2', h: '2.30', d: '3.60', a: '2.40' },
    hadBase: { h: '2.10', d: '3.60', a: '3.20' }, hhadBase: { goalLine: '-2', h: '2.50', d: '3.60', a: '2.20' },
  });
  if ('note' in r) { ok('案例3 出分', false); }
  else {
    ok('方向=主胜（退回，market=HAD）', r.market === 'HAD' && r.dir === '主胜', `${r.market} ${r.dir}`);
  }
}

console.log('== 案例4b：v1.6 下盘保护化：主队受让+1 主胜裸信号@2.55 + 受让盘1.90 → 改投主+1胜 ==');
{
  const r = sc({
    matchId: 't4b', had: { h: '2.55', d: '3.10', a: '2.45' }, hhad: { goalLine: '+1', h: '1.90', d: '3.20', a: '3.10' },
    hadBase: { h: '3.00', d: '3.10', a: '2.20' }, hhadBase: { goalLine: '+1', h: '1.70', d: '3.20', a: '3.40' },
  });
  if ('note' in r) { ok('案例4b 出分', false, JSON.stringify(r)); }
  else {
    ok('改投主+1胜', r.dir === '主+1胜' && r.market === 'HHAD', `${r.dir} ${r.market}`);
    ok('标记下盘保护化', r.betNote === '下盘保护化', r.betNote || '');
  }
}

console.log('== 案例4：首盘（无 base）→ 标记 ! 且降水量级=0 ==');
{
  const r = sc({
    matchId: 't4', had: { h: '1.90', d: '3.30', a: '3.60' }, hhad: { goalLine: '0', h: '1.95', d: '3.30', a: '3.30' },
  });
  if ('note' in r) { ok('案例4 出分', false); }
  else {
    ok('首盘标记=!', r.hasBaseMark === '!', r.hasBaseMark);
    ok('dropNote=首盘', r.dropNote === '首盘', r.dropNote);
  }
}

console.log(`\n${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
