import { fairProbForPick, fitLambdas, skellamLe } from '../../tools/ev-fit.js';

// 奥格斯堡-勒沃库森: 欧赔 3.70/4.10/1.85, hhad goalLine +1, 方向 主+1胜 (dropSide H)
const fair1 = { home: 1/3.70, draw: 1/4.10, away: 1/1.85 };
// 去水
const z = fair1.home + fair1.draw + fair1.away;
const fair = { home: fair1.home/z, draw: fair1.draw/z, away: fair1.away/z };
console.log('fair去水:', fair.home.toFixed(3), fair.draw.toFixed(3), fair.away.toFixed(3));

const lam = fitLambdas(fair);
console.log('fitLambdas:', lam ? `lh=${lam.lh.toFixed(3)} la=${lam.la.toFixed(3)} err=${lam.err.toFixed(4)}` : 'null');

// 受让方主+1胜: gln=+1, H
const pH = fairProbForPick(fair, 'H', 'HHAD', +1);
console.log('主+1胜 P =', pH != null ? pH.toFixed(3) : 'null', '(期望 ~0.45-0.50)');

// 客-1胜(同场对应) gln=+1, A
const pA = fairProbForPick(fair, 'A', 'HHAD', +1);
console.log('客-1胜 P =', pA != null ? pA.toFixed(3) : 'null');

// 对照: 平手胜平负
const pHAD = fairProbForPick(fair, 'H', 'HAD', 0);
const pAHAD = fairProbForPick(fair, 'A', 'HAD', 0);
console.log('胜平负 主胜 P =', pHAD?.toFixed(3), '客胜 P =', pAHAD?.toFixed(3));
