// settlement.ts — 结算规则纯函数（无 IO，可直接单测）
//
// 约定（务必统一，勿混用）：
//   lineHome：亚盘让球线，加到「主队」比分上的修正值。主队让球 = 负数（主 -1.5 → lineHome = -1.5）
//   OU 的 line：大小球盘口（如 2.5 / 3.0 / 2.75）
//   返还 multiplier 为「相对本金的返还倍数」：赢 = 赔率，输 = 0，走盘 = 1，半赢 = (1+赔率)/2，半输 = 0.5
//
// 无法可靠判定时返回 outcome='manual'（调用方必须保持原状态并转人工，禁止猜一个结果出来）
export type Market = 'HAD' | 'HHAD' | 'AH' | 'OU';
export type Side = 'home' | 'draw' | 'away' | 'over' | 'under';
export type Outcome = 'win' | 'loss' | 'push' | 'halfwin' | 'halfloss' | 'void' | 'manual';

export interface SettleOutcome {
  outcome: Outcome;
  /** 相对本金的返还倍数；manual/void 时无意义 */
  multiplier: number;
  reason: string;
}

const MANUAL = (reason: string): SettleOutcome => ({ outcome: 'manual', multiplier: 0, reason });

/** 市场识别：结构化字段优先；文本兜底只做精确匹配，不用 /had/ 这种会误吞 HHAD 的模糊写法 */
export function normalizeMarket(fields: { market?: string | null; settleMarket?: string | null; pick?: string | null }): Market | null {
  const m = String(fields.market || '').trim().toUpperCase();
  if (m === 'HAD' || m === 'HHAD' || m === 'AH' || m === 'OU') return m as Market;
  const sm = String(fields.settleMarket || '');
  if (/大小球|OU|over\/under/i.test(sm)) return 'OU';
  if (/亚盘|Asian|365|让球盘/i.test(sm)) return 'AH';
  if (/让球/i.test(sm)) return 'HHAD';
  if (/胜平负|HAD/i.test(sm)) return 'HAD';
  const pick = String(fields.pick || '');
  if (/(大|小)(\d+(?:\.\d+)?)/.test(pick)) return 'OU';
  // 「让胜/让平/让负」是竞彩让球胜平负，不是亚盘
  if (/让(胜|平|负)/.test(pick)) return 'HHAD';
  if (/[+-]\d+(\.\d+)?/.test(pick)) return 'AH';
  if (/主胜|客胜|主负|平局|平$/.test(pick)) return 'HAD';
  return null;
}

/** 方向识别：按玩法分别解析；解析不出来返回 null（转人工） */
export function normalizeSide(market: Market, pick: string, home = '', away = ''): Side | null {
  const p = String(pick || '').trim();
  if (!p) return null;

  if (market === 'HAD' || market === 'HHAD') {
    // 顺序很重要：先判「让X」，再判胜平负
    if (/让胜|让球胜/.test(p)) return 'home';
    if (/让平|让球平/.test(p)) return 'draw';
    if (/让负|让球负/.test(p)) return 'away';
    if (/主胜|主队胜/.test(p)) return 'home';
    if (/客胜|主负|客队胜/.test(p)) return 'away';
    if (/平局|平/.test(p) && !/平手|平半/.test(p)) return 'draw';
    if (home && p.includes(home)) return 'home';
    if (away && p.includes(away)) return 'away';
    // 只有 H / D / A 的英文写法
    if (p === 'H') return 'home';
    if (p === 'D') return 'draw';
    if (p === 'A') return 'away';
    return null;
  }

  if (market === 'OU') {
    const m = p.match(/(大|小)\s*(\d+(?:\.\d+)?)/);
    if (m) return m[1] === '大' ? 'over' : 'under';
    if (/大球|over/i.test(p)) return 'over';
    if (/小球|under/i.test(p)) return 'under';
    return null;
  }

  // AH
  if (home && p.includes(home)) return 'home';
  if (away && p.includes(away)) return 'away';
  if (/主队|主胜|上盘/.test(p)) return 'home';
  if (/客队|客胜|下盘/.test(p)) return 'away';
  return null;
}

/** 从 pick 文本取「被选球队」的让球线（负数 = 该队让球） */
export function parsePickLine(pick: string): number | null {
  const p = String(pick || '');
  const signed = p.match(/([+-])(\d+(?:\.\d+)?)/);
  if (signed) {
    let v = parseFloat(signed[1] + signed[2]);
    // 只接受 .0/.25/.5/.75 这类盘口
    v = Math.round(v * 4) / 4;
    return v;
  }
  const cn = p.match(/(受让|让)\s*(\d+(?:\.(\d+))?)/);
  if (cn) {
    const v = parseFloat(cn[2]);
    return cn[1] === '受让' ? v : -v;
  }
  if (/(平手|平手盘)/.test(p)) return 0;
  const ouLine = p.match(/(大|小)\s*(\d+(?:\.\d+)?)/);
  if (ouLine) return parseFloat(ouLine[2]);
  return null;
}

/** pick 线（相对被选球队）→ 主队视角 lineHome */
export function toHomeLine(pickLine: number, side: Side): number {
  return side === 'home' ? pickLine : -pickLine;
}

function isQuarter(line: number): boolean {
  return !Number.isInteger(line * 2);
}

function lineOutcome(value: number): 'win' | 'loss' | 'push' {
  return value > 0 ? 'win' : value < 0 ? 'loss' : 'push';
}

/** 两条盘口线的组合（亚盘/大小球的 0.25/0.75 半球盘） */
function combine(a: 'win' | 'loss' | 'push', b: 'win' | 'loss' | 'push', odds: number): SettleOutcome {
  const wins = (a === 'win' ? 1 : 0) + (b === 'win' ? 1 : 0);
  const losses = (a === 'loss' ? 1 : 0) + (b === 'loss' ? 1 : 0);
  if (wins === 2) return { outcome: 'win', multiplier: odds, reason: '两条线全赢' };
  if (losses === 2) return { outcome: 'loss', multiplier: 0, reason: '两条线全输' };
  if (wins === 1 && losses === 0) return { outcome: 'halfwin', multiplier: (1 + odds) / 2, reason: '一赢一走，半赢' };
  if (losses === 1 && wins === 0) return { outcome: 'halfloss', multiplier: 0.5, reason: '一输一走，半输' };
  return MANUAL(`盘口组合异常(${a}/${b})，需人工核对`);
}

function validOdds(odds: unknown): number | null {
  const n = Number(odds);
  if (!Number.isFinite(n) || n <= 1 || n > 1000) return null;
  return n;
}

/**
 * 统一结算入口。
 * @param finalHad  官方胜平负 H/D/A
 * @param finalHhad 官方让球胜平负 H/D/A
 */
export function settle(params: {
  market: Market;
  side: Side;
  odds: number | null | undefined;
  homeScore: number;
  awayScore: number;
  line?: number | null;      // AH: lineHome；OU: 盘口
  finalHad?: string | null;
  finalHhad?: string | null;
}): SettleOutcome {
  const { market, side, homeScore, awayScore } = params;
  const odds = validOdds(params.odds);
  if (odds == null) return MANUAL('赔率缺失或非法，不能结算');
  if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore) || homeScore < 0 || awayScore < 0) {
    return MANUAL('比分异常');
  }

  if (market === 'HAD' || market === 'HHAD') {
    const official = market === 'HAD' ? params.finalHad : params.finalHhad;
    if (!official || !['H', 'D', 'A'].includes(official)) return MANUAL(`缺少官方${market}赛果`);
    const want = side === 'home' ? 'H' : side === 'draw' ? 'D' : 'A';
    return official === want
      ? { outcome: 'win', multiplier: odds, reason: `${market} 命中 ${want}` }
      : { outcome: 'loss', multiplier: 0, reason: `${market} 未中 ${want}≠${official}` };
  }

  const line = Number(params.line);
  if (!Number.isFinite(line)) return MANUAL('缺少盘口线');
  if (market === 'AH' && (side !== 'home' && side !== 'away')) return MANUAL('亚盘方向无法判定');
  if (market === 'OU' && (side !== 'over' && side !== 'under')) return MANUAL('大小球方向无法判定');

  const diff = homeScore - awayScore;
  const total = homeScore + awayScore;
  const valueOf = (L: number): number => {
    if (market === 'AH') return side === 'home' ? diff + L : -(diff + L);
    return side === 'over' ? total - L : L - total;
  };

  if (isQuarter(line)) {
    const a = lineOutcome(valueOf(line - 0.25));
    const b = lineOutcome(valueOf(line + 0.25));
    return combine(a, b, odds);
  }

  const v = valueOf(line);
  if (v > 0) return { outcome: 'win', multiplier: odds, reason: `盘口命中(差值${v})` };
  if (v < 0) return { outcome: 'loss', multiplier: 0, reason: `盘口未中(差值${v})` };
  return { outcome: 'push', multiplier: 1, reason: '走盘退本金' };
}

/** 结算后的账面结论（便于复式：半赢/半输也算已结） */
export function isSettledOutcome(o: Outcome): boolean {
  return o === 'win' || o === 'loss' || o === 'push' || o === 'halfwin' || o === 'halfloss';
}
