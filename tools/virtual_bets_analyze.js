/**
 * virtual_bets_analyze.js — 为虚拟注补充深度分析（我的判断 + 复盘钩子）
 *
 * 把批量创建的机械虚拟注升级为「有立场、有理由、可复盘」的判断注。
 *
 * 用法:
 *   node tools/virtual_bets_analyze.js
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const VDIR = join(ROOT, 'data', 'virtual');

// 每场的深度分析（以「主队vs客队」为 key）
const ANALYSES = {
  '热刺 vs 查尔顿': {
    myView: '热刺让2球太重，不看好赢盘，买让球负(查尔顿+2)',
    analysis: '热刺gl-2盘，HHAD 2.4/4.0/2.16。查尔顿英甲，热刺英超强队，但让2球=需净胜3球。英超杯赛热刺常轮换，英甲球队防守密集，2球盘很难穿。机构给让球负2.16偏高，说明市场也认为难穿。',
    reviewHook: '验证：强队vs低级别杯赛，让2球是否值得买让球负',
  },
  '纽卡斯尔 vs 西布罗姆': {
    myView: '纽卡让1球，看好主胜但让球负有机会',
    analysis: '纽卡gl-1，HHAD 1.8/3.7/3.3。西布罗姆英冠中游。纽卡主场对英冠队让1球1.8，主队赢盘概率高，但让球负3.3赔率更高风险也高。',
    reviewHook: '验证：英超对英冠让1球，主队能否净胜2球',
  },
  '雅典AEK vs 索列夫': {
    myView: 'AEK主胜1.36太热，谨慎看好',
    analysis: 'AEK让1球，HHAD 2.33/3.1/2.65。索列夫保加利亚球队，欧冠资格赛。AEK希腊豪门主场，1.36主胜偏热但基本面支持。',
    reviewHook: '验证：欧冠资格赛强主场热门是否过热',
  },
  '采列 vs 布拉迪斯': {
    myView: '采列主胜2.2有价值，看好',
    analysis: '采列gl-1，HHAD 4.7/3.9/1.52。采列斯洛文尼亚球队，布拉迪斯斯洛伐克。两队接近，采列主场2.2有吸引力，让球盘客队1.52热。',
    reviewHook: '验证：势均力敌欧冠资格赛，主队主场价值',
  },
  '维京 vs 萨迪纳摩': {
    myView: '维京主胜2.23有价值，看好',
    analysis: '维京gl-1，HHAD 4.75/4.05/1.49。维京挪威，萨迪纳摩克罗地亚。萨迪纳摩客场1.49极热，维京北欧主场2.23有冷门价值。',
    reviewHook: '验证：客队过热的主场价值',
  },
  '里昂 vs 费内巴切': {
    myView: '里昂主胜1.78正常，看好',
    analysis: '里昂gl-1，HHAD 3.46/3.55/1.79。费内巴切土耳其强队，里昂法甲。欧冠资格赛，里昂主场1.78合理，费内巴切有客场能力。',
    reviewHook: '验证：法甲vs土超强队对决',
  },
  '普雷斯顿 vs 埃弗顿': {
    myView: 'P2a_gl1核心信号，买让球负(埃弗顿+1=需净胜2)，看好',
    analysis: '普雷斯顿gl+1，HHAD 2.58/3.5/2.2，HAD 6.0/4.2/1.38。埃弗顿英超vs普雷斯顿英冠。这是P2a_gl1核心命中：让球+1 + 非单关 + 非五大。但英联杯轮换风险大，埃弗顿客场大胜能力存疑。',
    reviewHook: '验证：P2a_gl1信号(让球+1)在英联杯轮换环境是否有效',
  },
  '皇马 vs 皇家社会': {
    myView: '皇马主胜1.14超低赔，让球负有机会',
    analysis: '皇马gl-1，HHAD 1.52/4.35/4.15。皇家社会西甲劲旅，皇马主场1.14超热。让1球后1.52，皇家社会有能力逼平，让球负4.15有机会。',
    reviewHook: '验证：超级热门让1球，客队能否逼平',
  },
  '帕梅拉斯 vs 桑托斯': {
    myView: 'P2a信号，买让球负(桑托斯+1)，中等看好',
    analysis: '帕梅拉斯gl-1，HHAD 2.6/3.15/2.35。帕梅拉斯巴甲豪门vs桑托斯，巴西杯。巴甲球队差距不大，帕梅拉斯让1球2.35，桑托斯防守稳固有机会。',
    reviewHook: '验证：巴甲豪门让1球，客队受让价值',
  },
  '达伽马 vs 维多利亚': {
    myView: 'P2a信号，买让球负(维多利亚+1)，中等看好',
    analysis: '达伽马gl-1，HHAD 2.7/3.2/2.25。达伽马vs维多利亚，巴西杯。达伽马让1球2.25，维多利亚弱旅但受让+1有机会。',
    reviewHook: '验证：巴甲中游让1球弱旅，受让价值',
  },
  '塞尔塔 vs 奥萨苏纳': {
    myView: '塞尔塔主胜1.78，正常但西甲冷门多，中性',
    analysis: '塞尔塔gl-1，HHAD 3.7/3.3/1.8。奥萨苏纳西甲中游客场硬。塞尔塔主场1.78合理，但西甲首轮冷门多。',
    reviewHook: '验证：西甲主队热门首轮稳定性',
  },
  '巴萨 vs 毕尔巴鄂': {
    myView: '巴萨主胜1.2超低赔，让球负(毕尔巴鄂+1)有机会',
    analysis: '巴萨gl-1，HHAD 1.68/3.9/3.6。毕尔巴鄂西甲硬骨头，主场强势。巴萨客场1.2超热，毕尔巴鄂防守反击有机会让球负。',
    reviewHook: '验证：超低赔主队+硬客场，让球负价值',
  },
  '巴西国际 vs 格雷米奥': {
    myView: 'P2a信号，买让球负(格雷米奥+1)，中等看好',
    analysis: '巴西国际gl-1，HHAD 3.5/3.25/1.87。巴西国际vs格雷米奥，巴甲德比。格雷米奥受让+1，巴西德比激烈难大胜。',
    reviewHook: '验证：巴甲德比让1球，客队受让价值',
  },
};

// 读取所有虚拟注，按主客队名补充分析
const files = readdirSync(VDIR).filter(f => f.endsWith('.json') && !f.startsWith('.'));
for (const f of files) {
  const p = join(VDIR, f);
  const bet = JSON.parse(readFileSync(p, 'utf8'));
  const key = `${bet.home} vs ${bet.away}`;
  const a = ANALYSES[key];
  if (a) {
    bet.myView = a.myView;
    bet.analysis = a.analysis;
    bet.reviewHook = a.reviewHook;
    writeFileSync(p, JSON.stringify(bet, null, 2), 'utf8');
    console.log(`✅ ${key} → ${a.myView}`);
  } else {
    console.log(`⚠️ 未匹配: ${key}`);
  }
}

console.log('\n虚拟注深度分析补充完成');
