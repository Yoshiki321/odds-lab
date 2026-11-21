/**
 * tools/match_crosswalk.cjs — 跨源赛事唯一映射引擎（竞彩 / 开云 / 懂球帝 / 澳客 / Understat）
 *
 * 对齐铁律：
 *  1) 开赛绝对时间差 <= 30 分钟
 *  2) 主客队名同时命中（支持统一别名库与归一化去空格/全半角）
 *  3) 必须唯一命中（cand.length === 1）；出现多候选歧义直接拒绝并标记 ambiguous，绝不猜第一条
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_STORE = path.join(ROOT, "data", "experiment_survival_100", "crosswalk.json");
const MAX_KICKOFF_DIFF_MS = 30 * 60_000;

/** 统一高频中英文别名组（同组内任两词等价） */
const ALIAS_GROUPS = [
  ["曼城", "曼彻斯特城", "manchester city", "man city"],
  ["曼联", "曼彻斯特联", "manchester united", "man utd"],
  ["阿森纳", "阿仙奴", "arsenal"],
  ["利物浦", "liverpool"],
  ["切尔西", "车路士", "chelsea"],
  ["热刺", "托特纳姆热刺", "tottenham", "tottenham hotspur"],
  ["纽卡斯尔", "纽卡斯尔联", "newcastle", "newcastle united"],
  ["皇马", "皇家马德里", "real madrid"],
  ["巴萨", "巴塞罗那", "barcelona"],
  ["马竞", "马德里竞技", "atletico madrid"],
  ["拜仁", "拜仁慕尼黑", "bayern munich"],
  ["多特", "多特蒙德", "borussia dortmund"],
  ["莱红牛", "rb莱比锡", "莱比锡红牛", "rb leipzig"],
  ["巴黎", "巴黎圣日耳曼", "大巴黎", "psg", "paris saint-germain"],
  ["国米", "国际米兰", "inter", "inter milan"],
  ["尤文", "尤文图斯", "juventus"],
  ["ac米兰", "米兰", "ac milan"],
  ["那不勒斯", "napoli"],
  ["萨巴赫", "沙巴巴库"],
  ["德尔瓦耶", "山谷独立"],
  ["老鹰", "亚特兰大老鹰", "atlanta hawks"],
  ["黄蜂", "夏洛特黄蜂", "charlotte hornets"],
  ["湖人", "洛杉矶湖人", "los angeles lakers"],
  ["凯尔特人", "波士顿凯尔特人", "boston celtics"],
  ["勇士", "金州勇士", "golden state warriors"],
];

const ALIAS_MAP = new Map();
ALIAS_GROUPS.forEach((grp, idx) => {
  for (const name of grp) ALIAS_MAP.set(normName(name), idx);
});

function normName(s) {
  return String(s || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[·•\.\-_'’`]/g, "")
    .replace(/(足球俱乐部|fc|cf|sc|ac|afc)$/i, "");
}

function teamMatch(a, b) {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ga = ALIAS_MAP.get(na);
  const gb = ALIAS_MAP.get(nb);
  if (ga !== undefined && ga === gb) return true;
  // 仅当长度 >= 3 时允许严格前缀/包含匹配，且拒绝 U19/U21/B队 跨梯队误配
  const youthRe = /(u\d{2}|青年|预备|女足|b队|ii)$/i;
  if (youthRe.test(na) !== youthRe.test(nb)) return false;
  if (na.length >= 3 && nb.length >= 3 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}

/**
 * 将 target（如开云/懂球帝单场）与 candidates（竞彩/基准场次列表）做严格唯一匹配
 * @returns {{ status: 'matched'|'unmatched'|'ambiguous', match: object|null, candidatesCount: number }}
 */
function alignMatch(target, candidates) {
  const tKo = Number(target.kickoffMs);
  if (!Number.isFinite(tKo)) return { status: "unmatched", match: null, candidatesCount: 0 };
  const hits = [];
  for (const c of candidates || []) {
    const cKo = Number(c.kickoffMs);
    if (!Number.isFinite(cKo)) continue;
    if (Math.abs(cKo - tKo) > MAX_KICKOFF_DIFF_MS) continue;
    if (teamMatch(target.home, c.home) && teamMatch(target.away, c.away)) {
      hits.push(c);
    }
  }
  if (hits.length === 1) return { status: "matched", match: hits[0], candidatesCount: 1 };
  if (hits.length > 1) return { status: "ambiguous", match: null, candidatesCount: hits.length };
  return { status: "unmatched", match: null, candidatesCount: 0 };
}

function buildCanonicalId(kickoffMs, home, away) {
  const day = new Date(kickoffMs).toISOString().slice(0, 10);
  return `${day}_${normName(home)}_vs_${normName(away)}`;
}

function loadCrosswalk(file = DEFAULT_STORE) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return { version: "crosswalk-v1", updatedAt: null, items: {} }; }
}

function saveCrosswalk(cw, file = DEFAULT_STORE) {
  cw.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(cw, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

module.exports = {
  normName,
  teamMatch,
  alignMatch,
  buildCanonicalId,
  loadCrosswalk,
  saveCrosswalk,
  MAX_KICKOFF_DIFF_MS,
};
