// 信息值打分排序工具 (100分制) — 评分机制见 data/betting/scoring-system.md
// 维度: 降水/变盘35 | 方向确认20 | 模型命中20 | 历史验证10 | 风险排除10 | 赔率价值5 (+变盘加计≤3)
// 档位: >=80 加注 | 70-79 实单 | 60-69 候选(盯临场) | 40-59 弱信息 | <40 放弃
// 用法: node tools/score_sort.cjs [--detail] [--csv]
const fs = require('fs');

// 从评分机制文档读当前版本
let VERSION = 'v?';
try {
  const doc = fs.readFileSync(require('path').join(__dirname, '..', 'data', 'betting', 'scoring-system.md'), 'utf8');
  const m = doc.match(/版本:\s*\*\*(v[\d.]+)\*\*/);
  if (m) VERSION = m[1];
} catch (e) {}

const DROP = (amt, ok) => ok ? (amt>=0.5?35:amt>=0.4?32:amt>=0.3?29:amt>=0.2?26:amt>=0.1?22:amt>=0.05?15:amt>0?10:5) : 0;
const CHEK = (amt, c) => c ? (amt>=0.5?0:amt>=0.1?3:0) : 0;   // 变盘加计: 1-2次方向变盘+3
const CONFIRM = {4:20, 3:16, 2:12, 1:4, 0:0};
const MK = {20:20, 16:16, 13:13, 12:12, 6:6, 0:0};
const HISTORY = {10:10, 6:6, 2:2, 0:0};
const RISK = {10:10, 5:5, 8:8, 7:7, 6:6, 4:4, 3:3, 2:2, 0:0};
const VALUE = {5:5, 4:4, 3:3, 2:2, 0:0};
const compute = s => ({
  drop: DROP(s.drop, s.ok),
  chk: CHEK(s.drop, s.c),
  confirm: CONFIRM[s.c],
  model: MK[s.m] ?? s.m,
  history: HISTORY[s.h],
  risk: RISK[s.r],
  value: VALUE[s.v],
  total: DROP(s.drop, s.ok) + CHEK(s.drop, s.c) + CONFIRM[s.c] + (MK[s.m] ?? s.m) + HISTORY[s.h] + RISK[s.r] + VALUE[s.v]
});
const band = t => t>=80?'🔨加注':t>=70?'✅实单':t>=60?'⏳候选':t>=40?'👀弱':'❌放弃';

const F = [
 {k:'F13',n:'周五013',t:'波尔图-摩雷伦斯',d:'波尔图让-2H',o:2.03,drop:0.20,ok:1,c:2,m:0,h:6,r:0,v:5,z:'H降水0.20最强,机构加码大胜;深盘让-2穿3球风险锁死'},
 {k:'F09',n:'周五009',t:'热那亚-科莫',d:'科莫A',o:3.10,drop:0.16,ok:1,c:3,m:10,h:6,r:5,v:5,z:'A降水0.16+客胜双降三点同向,3.10高赔有值;科莫客场净胜2难'},
 {k:'F02',n:'周五002',t:'里昂-欧塞尔',d:'里昂让-1H',o:1.86,drop:0.19,ok:1,c:3,m:10,h:6,r:5,v:4,z:'H降水0.19+主胜双降三点同向;升班马摆大巴是变数'},
 {k:'F08',n:'周五008',t:'斯图加特-科隆',d:'斯图加特让-1H',o:1.97,drop:0.12,ok:1,c:3,m:10,h:6,r:5,v:4,z:'H降水0.12+主胜1.35稳三点同向;科隆防反,穿盘需耐心'},
 {k:'F04',n:'周五004',t:'利雅青年-新月',d:'新月A',o:1.56,drop:0.10,ok:1,c:3,m:10,h:2,r:5,v:4,z:'A降水0.10+客胜1.17三点同向;沙职样本少+1.56低赔'},
 {k:'F12',n:'周五012',t:'巴黎-摩纳哥',d:'巴黎让-1H',o:1.65,drop:0.05,ok:1,c:3,m:0,h:6,r:5,v:4,z:'H微降+主胜1.21三点同向;摩纳哥强,巴黎未必净胜2'},
 {k:'F10',n:'周五010',t:'伊普斯-利物浦',d:'利物浦A',o:2.04,drop:0,ok:0,c:3,m:0,h:6,r:5,v:5,z:'盘口全天没动,A@2.04有值;升班马主场常只输1球'},
 {k:'F11',n:'周五011',t:'贝蒂斯-皇马',d:'皇马A',o:1.85,drop:0.03,ok:1,c:3,m:0,h:6,r:5,v:4,z:'A微降+客胜1.30三点同向;贝蒂斯主场硬,皇马常小胜不穿'},
 {k:'F14',n:'周五014',t:'纽约城-纳什维尔',d:'纳什维尔A',o:1.33,drop:0.09,ok:1,c:2,m:0,h:6,r:5,v:2,z:'纽约城让-1H升水0.79巨幅看衰主队;但1.33低赔无价值'},
 {k:'F05',n:'周五005',t:'格勒诺布-阿纳西',d:'格勒诺布+1H',o:1.51,drop:0,ok:0,c:1,m:0,h:6,r:5,v:4,z:'+1低水1.51纹丝不动看主不败;欧赔客队微优=方向矛盾'},
 {k:'F06',n:'周五006',t:'鹿斯巴达-兹沃勒',d:'兹沃勒A',o:1.84,drop:0,ok:0,c:1,m:0,h:6,r:5,v:4,z:'主胜降水但让-1H升水=看主赢不穿;与兹沃勒方向相悖'},
 {k:'F07',n:'周五007',t:'埃门-福伦丹',d:'福伦丹A',o:1.53,drop:0,ok:0,c:1,m:0,h:6,r:5,v:4,z:'A低水1.53看主不穿;无降水无变盘纯静盘'},
 {k:'F03',n:'周五003',t:'腓特烈-博德闪耀',d:'腓特烈+2H',o:1.93,drop:0,ok:0,c:1,m:0,h:6,r:0,v:4,z:'博德巨热1.19让+2深盘;赌挪超客场翻车,无信号'},
];

const S = [
 {k:'S07',n:'周六007',t:'门兴-埃沃斯堡',d:'门兴让-1H',o:1.92,drop:0.08,ok:1,c:1,m:0,h:6,r:5,v:4,z:'H微降0.08开盘微动;升班马客场,待临场加厚'},
 {k:'S18',n:'周六018',t:'国米-那不勒斯',d:'国米让-1H',o:2.54,drop:0.09,ok:1,c:1,m:0,h:6,r:5,v:4,z:'H降0.09+国米主场,2.54有值;意甲强强难料'},
 {k:'S17',n:'周六017',t:'朗斯-洛里昂',d:'朗斯让-1H',o:2.06,drop:0.04,ok:1,c:1,m:0,h:6,r:5,v:5,z:'H微降0.04;朗斯主场打保级队,降水分量弱'},
 {k:'S11',n:'周六011',t:'勒沃库森-柏林联',d:'勒沃让-1H',o:2.00,drop:0,ok:0,c:1,m:0,h:6,r:5,v:5,z:'让-1 H@2.00有值;勒沃主场静盘待变'},
 {k:'S08',n:'周六008',t:'不来梅-莱红牛',d:'不来梅+1H',o:2.02,drop:0,ok:0,c:1,m:0,h:6,r:5,v:5,z:'受+1 H@2.02,莱红牛客强;静盘无信号'},
 {k:'S14',n:'周六014',t:'布伦特-桑德兰',d:'桑德兰A',o:2.20,drop:0,ok:0,c:1,m:0,h:6,r:5,v:5,z:'A@2.20看主不穿;盘口平,静盘'},
 {k:'S28',n:'周六028',t:'比利亚雷-拉科',d:'比利亚雷H',o:2.20,drop:0,ok:0,c:1,m:0,h:6,r:5,v:5,z:'H@2.20微优看主,2.20有值;静盘'},
 {k:'S09',n:'周六009',t:'帕德博恩-弗赖堡',d:'帕德博恩+1H',o:1.73,drop:0,ok:0,c:1,m:0,h:6,r:5,v:4,z:'受+1低水1.73看主不败;升班马主场静盘'},
 {k:'S25',n:'周六025',t:'阿贾克斯-埃因霍温',d:'阿贾克斯+1H',o:1.55,drop:0,ok:0,c:1,m:0,h:6,r:5,v:4,z:'荷兰德比受+1低水;强强对话无信号'},
 {k:'S26',n:'周六026',t:'罗马-亚特兰大',d:'亚特兰大A',o:1.92,drop:0,ok:0,c:1,m:0,h:6,r:5,v:4,z:'A@1.92看罗马不穿;意甲强强静盘'},
 {k:'S16',n:'周六016',t:'毕尔巴鄂-马竞',d:'毕尔巴鄂+1H',o:1.53,drop:0,ok:0,c:1,m:0,h:6,r:5,v:4,z:'受+1低水1.53看主不败;马竞客强静盘'},
 {k:'S20',n:'周六020',t:'赫尔城-维拉',d:'赫尔城+1H',o:1.85,drop:0,ok:0,c:1,m:0,h:6,r:5,v:4,z:'受+1 H@1.85看主不败;维拉客强静盘'},
 {k:'S22',n:'周六022',t:'巴列卡诺-桑坦德',d:'桑坦德A',o:1.58,drop:0,ok:0,c:1,m:0,h:6,r:5,v:4,z:'A低水1.58看主不穿;西甲静盘'},
 {k:'S10',n:'周六010',t:'霍芬海姆-多特',d:'霍芬海姆+1H',o:1.54,drop:0,ok:0,c:1,m:0,h:6,r:5,v:4,z:'受+1低水看主不败;多特客强静盘'},
 {k:'S01',n:'周六001',t:'福冈黄蜂-水户',d:'水户A',o:1.65,drop:0,ok:0,c:1,m:0,h:6,r:5,v:4,z:'A低水看福冈不穿;日职静盘'},
 {k:'S02',n:'周六002',t:'山形-甲府',d:'甲府A',o:1.66,drop:0,ok:0,c:1,m:0,h:6,r:5,v:4,z:'日乙静盘看主不穿'},
 {k:'S04',n:'周六004',t:'纽卡-伯恩茅斯',d:'伯恩茅斯A',o:1.60,drop:0,ok:0,c:1,m:0,h:6,r:5,v:4,z:'A低水看纽卡不穿;英超静盘'},
 {k:'S06',n:'周六006',t:'佛罗伦萨-都灵',d:'都灵A',o:1.88,drop:0,ok:0,c:1,m:0,h:6,r:5,v:4,z:'A@1.88看紫百合不穿;意甲静盘'},
 {k:'S12',n:'周六012',t:'诺丁汉-热刺',d:'热刺A',o:1.49,drop:0,ok:0,c:1,m:0,h:6,r:5,v:2,z:'A@1.49低赔无价值'},
 {k:'S15',n:'周六015',t:'富勒姆-水晶宫',d:'水晶宫A',o:1.46,drop:0,ok:0,c:1,m:0,h:6,r:5,v:2,z:'A@1.46低赔无价值'},
 {k:'S03',n:'周六003',t:'济州SK-蔚山现代',d:'济州+1H',o:1.60,drop:0,ok:0,c:1,m:3,h:2,r:0,v:4,z:'P2a gl+1外形;济州SK=盘口陷阱记忆(基本面强盘口不给力反买),risk锁0'},
 {k:'S13',n:'周六013',t:'曼城-考文垂',d:'曼城让-2H',o:2.08,drop:0.04,ok:1,c:1,m:0,h:6,r:0,v:5,z:'让-2深盘穿3球才赢,风险锁死;降0.04不够'},
 {k:'S21',n:'周六021',t:'沙尔克-拜仁',d:'拜仁A',o:1.90,drop:0,ok:0,c:1,m:0,h:6,r:0,v:4,z:'让+2深盘拜仁穿3球,风险锁死'},
 {k:'S23',n:'周六023',t:'马里迪莫-本菲卡',d:'马里迪莫+2H',o:1.98,drop:0,ok:0,c:1,m:0,h:6,r:0,v:4,z:'受+2深盘,风险锁死'},
];

const DETAIL = process.argv.includes('--detail');
const CSV = process.argv.includes('--csv');

function render(name, arr) {
  const rows = arr.map(s => ({...s, ...compute(s)}));
  rows.sort((a,b) => b.total - a.total);
  console.log('\n=== ' + name + ' ===');
  if (CSV) {
    console.log('排名,场次,对阵,方向@赔率,降水,变盘,方向确认,模型,历史,风险,价值,总分,档位');
    rows.forEach((s, i) => console.log([i+1, s.n, s.t, s.d+'@'+s.o, s.drop, s.chk, s.confirm, s.model, s.history, s.risk, s.value, s.total, band(s.total)].join(',')));
    return;
  }
  console.log('评分机制 ' + VERSION + ' | 排名 场次  对阵                方向@赔率      总分  档位    [降水/变盘/确认/模型/历史/风险/价值]');
  rows.forEach((s, i) => {
    const detail = DETAIL ? '  [' + [s.drop, s.chk, s.confirm, s.model, s.history, s.risk, s.value].join('/') + ']' : '';
    console.log(
      String(i+1).padStart(2) + '  ' + s.n + ' ' + s.t.padEnd(17) +
      (s.d+'@'+s.o).padEnd(20) +
      String(s.total).padStart(3) + '  ' + band(s.total).padEnd(5) + ' ' + s.z + detail
    );
  });
}

render('周五盘(明晨场·已过窗口·复盘用)', F);
render('周六盘(今日13:00后窗口·开盘快照)', S);

// 汇总命中档位
const all = [...F, ...S].map(s => ({...s, ...compute(s)}));
const hit = all.filter(s => s.total >= 70).sort((a,b) => b.total - a.total);
const topF = all.filter(s => s.n.startsWith('周五')).sort((a,b)=>b.total-a.total)[0];
const topS = all.filter(s => s.n.startsWith('周六')).sort((a,b)=>b.total-a.total)[0];
console.log('\n=== 达标线(70+) ===');
if (!hit.length) console.log('当前无场次达到70分实单线 | 周五盘最高 ' + (topF?.total ?? '-') + ' 分(' + (topF?.t ?? '') + ') | 周六盘最高 ' + (topS?.total ?? '-') + ' 分(' + (topS?.t ?? '') + ')');
else hit.forEach(s => console.log(s.n, s.t, s.d, '@'+s.o, s.total+'分', band(s.total)));
console.log('\n规则: >=80加注 | 70-79实单 | 60-69候选(盯临场) | 40-59弱 | <40放弃');
console.log('机制: ' + VERSION + ' 见 data/betting/scoring-system.md | --detail 看维度明细 | --csv 导出复盘');