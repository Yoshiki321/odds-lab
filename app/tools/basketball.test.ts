/**
 * basketball.test.ts — 篮球算法自检（纯函数，无真实资金）
 * 运行: node --experimental-strip-types app/tools/basketball.test.ts
 */
import {
  devigTwoWay,
  marketBaselineEv,
  isValidBasketballHandicap,
  isValidBasketballTotal,
  settleBasketballHandicap,
  settleBasketballTotal,
  settleBasketballMoneyline,
} from "./basketball.ts";

let pass = 0, fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) { pass++; } else { fail++; console.log("FAIL " + name); }
}
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

// 去水：老鹰让分 -6.5 @1.88 / 客 +6.5 @2.00
{
  const r = devigTwoWay(1.88, 2.00);
  ok(r.prob !== null, "去水概率非空");
  ok(near(r.vig!, 1 / 1.88 + 1 / 2 - 1, 1e-9), "水位计算正确");
  ok(near(r.prob!, (1 / 1.88) / (1 / 1.88 + 1 / 2), 1e-9), "去水基线概率正确");
  ok(r.prob! > 0.5, "低赔一侧(1.88)去水概率>0.5");
}
// 非法赔率 → null，不得回退
{
  ok(devigTwoWay(1, 2).prob === null, "赔率=1拒绝");
  ok(devigTwoWay(-1, 2).prob === null, "负赔率拒绝");
  ok(devigTwoWay(NaN, 2).prob === null, "NaN拒绝");
}
// 市场基线EV恒为负（去水概率代入）
{
  const r = devigTwoWay(1.88, 2.00);
  ok(marketBaselineEv(r.prob!, 1.88)! < 0, "去水后EV为负（水位劣势）");
  ok(marketBaselineEv(0.5, 2.0) === 0, "公平概率×公平赔率=0");
  ok(marketBaselineEv(1.5, 2.0) === null, "非法概率拒绝");
}
// 让分线校验
{
  ok(isValidBasketballHandicap(-6.5), "-6.5合法");
  ok(isValidBasketballHandicap(8), "整数合法");
  ok(!isValidBasketballHandicap(-6.25), ".25非法（篮球不用quarter）");
  ok(!isValidBasketballHandicap(-61), "超60拒绝");
  ok(isValidBasketballTotal(218.5), "大小分218.5合法");
  ok(!isValidBasketballTotal(-1), "负大小分拒绝");
}
// 让分结算：主队 -6.5，110-100 → 净胜10 → 让6.5后+3.5 赢
{
  const r = settleBasketballHandicap('H', -6.5, 110, 100, 1.88);
  ok(r.outcome === 'win' && near(r.pnlPerUnit!, 0.88), "让分赢");
  const l = settleBasketballHandicap('H', -6.5, 105, 100, 1.88); // 净胜5 <6.5 输
  ok(l.outcome === 'lose' && near(l.pnlPerUnit!, -1), "让分输");
  const p = settleBasketballHandicap('H', -10, 110, 100, 1.88); // 净胜10=线 走水
  ok(p.outcome === 'push' && near(p.pnlPerUnit!, 0), "让分走水");
  ok(settleBasketballHandicap('H', -6.25, 110, 100, 1.88).outcome === 'uncomputable', "quarter线不可计算");
}
// 大小分结算：218.5，110+100=210 <218.5 → 小赢大输
{
  const u = settleBasketballTotal('under', 218.5, 110, 100, 1.97);
  ok(u.outcome === 'win', "小分赢");
  const o = settleBasketballTotal('over', 218.5, 110, 100, 1.89);
  ok(o.outcome === 'lose', "大分输");
}
// 胜负结算
{
  const h = settleBasketballMoneyline('H', 110, 100, 1.39);
  ok(h.outcome === 'win' && near(h.pnlPerUnit!, 0.39), "主胜");
  ok(settleBasketballMoneyline('H', 100, 100, 1.39).outcome === 'uncomputable', "平局不可计算");
  ok(settleBasketballMoneyline('D' as any, 110, 100, 1.39).outcome === 'uncomputable', "平盘方向不可计算");
}

console.log(`basketball.test.ts PASS=${pass} FAIL=${fail}`);
if (fail > 0) process.exit(1);
