// prompt.ts - LLM 分析提示词模板（预写好，扫描时替换实时水位）
// 需求：「Prompt 预写，只有实时水位数据需要在扫描时替换」

export interface MatchPromptData {
  matchId: string;
  num: string;
  league: string;
  home: string;
  away: string;
  kickoff: string;
  had: { h?: string; d?: string; a?: string };
  hhad: { h?: string; d?: string; a?: string; goalLine?: string };
  hadBase: { h?: string; d?: string; a?: string };
  hhadBase: { h?: string; d?: string; a?: string; goalLine?: string };
}

/** 构建单场分析 prompt（模板固定，填入实时盘口数据） */
export function buildMatchPrompt(m: MatchPromptData): string {
  return `# 竞彩盘口分析

## 比赛信息
- 场次：${m.num} ${m.league}
- 对阵：${m.home} vs ${m.away}
- 开赛：${m.kickoff}

## 当前盘口
胜平负 HAD: 主 ${m.had.h} / 平 ${m.had.d} / 客 ${m.had.a}
让球盘 HHAD(${m.hhad.goalLine || '0'}): 主 ${m.hhad.h} / 平 ${m.hhad.d} / 客 ${m.hhad.a}

## 初盘（对照降水基线）
胜平负首盘: 主 ${m.hadBase?.h} / 平 ${m.hadBase?.d} / 客 ${m.hadBase?.a}
让球首盘(${m.hhadBase?.goalLine || '0'}): 主 ${m.hhadBase?.h} / 平 ${m.hhadBase?.d} / 客 ${m.hhadBase?.a}

## 分析要求
请按 6 维评分框架分析（总分上限 100，正好对齐引擎口径）：
1. 推荐方向（主胜/主负/客+1胜/客-1胜/客受让等）
2. 6 维评分明细
3. 分析理由（盘口变化、大众偏差、赛制特点）
4. 让球盘深口(让≥2)一律退回同侧胜平负，不打让胜/让负

分值口径（合计 100）:
- drop 降水（0-22）：对首盘降多少(0-16) + 变盘形态是否同向(0-4) + 时间早晚(0-2)
- confirm 确认（0-12）：四源确认——HHAD低赔侧 / HAD低赔侧 / 大众支持侧 / 机构概率侧；4源=12、3源=10、2源=7、1源=4、0源=0
- model 模型（0-22）：M1 P2a_gl1完整=22 / M2 四维偏差(≥19pp)=18 / M3 冷门错杀=12 / M4 让-1陷阱=8 / 降水规则=10 / M5比分=6
- history 历史（0-12）：联赛基准样本(n≥20=6/≥10=4/有=2/无=1) + 平局高发联赛-2~-4 + 受让豁免+2
- risk 风险（0-22，扣分制）：深盘-6 / 强强-3 / 次级低赔主场-5 / 平局结构-2~-4 / 临场追尾-3 / 大众拥挤-2 / 全局平局杠杆-3
- value 价值（0-10）：严格EV = 官方去水概率×赔率-1；EV≥10%=10、≥5%=8、≥0=6、≥-5%=4、≥-10%=2、更差=0
  买低赔大热必约等于0分；无去水概率时按赔率档只给 2-3 基础分

输出 JSON：
{
  "dir": "主胜",
  "market": "HAD",
  "pred": "H",
  "odds": 2.15,
  "drop": 15,
  "confirm": 8,
  "model": 12,
  "history": 6,
  "risk": 6,
  "value": 6,
  "total": 53,
  "band": "弱",
  "dims": {
    "drop": {"score": 15, "max": 22, "note": "首盘1.95→1.70 降水0.25 同向变盘"},
    "confirm": {"score": 8, "max": 12, "note": "3源确认"},
    "model": {"score": 12, "max": 22, "note": "四维偏差"},
    "history": {"score": 6, "max": 12, "note": "主队主场4胜2平"},
    "risk": {"score": 6, "max": 22, "note": "次级联赛低赔主场 -5"},
    "value": {"score": 6, "max": 10, "note": "去水概率×赔率 EV≥0"}
  },
  "reasoning": "..."
}
档位: total>=80 加注 | 70-79 实单 | 60-69 候选 | 40-59 弱 | <40 放弃
`;
}
