// 全局共享类型（server 与 tools 共用）

/** 竞彩源场次原始盘口块 */
export interface OddsBlock {
  h?: string; d?: string; a?: string;
  hf?: string; df?: string; af?: string;
  goalLine?: string; goalLineValue?: string;
  updateDate?: string; updateTime?: string;
}

/** data/today 里的一场 */
export interface RawMatch {
  matchId: string | number;
  num: string;
  league?: string;
  home?: string;
  away?: string;
  matchDate?: string;
  matchTime?: string;
  had?: OddsBlock | null;
  hhad?: OddsBlock | null;
  single?: Record<string, number>;
  vote?: Record<string, unknown>;
}

/** 官方支持率/去水概率（getSupportRateV1 每池一块） */
export interface SupportBlock {
  h?: string; d?: string; a?: string;
  hSupportRate?: string; dSupportRate?: string; aSupportRate?: string;
  hProbability?: string; dProbability?: string; aProbability?: string;
  win?: number; draw?: number; lose?: number;
  eKey?: string; eValue?: number; absValue?: number;
}
/** matches.support = { HAD, HHAD } 两块 */
export type SupportRates = { HAD?: SupportBlock | null; HHAD?: SupportBlock | null };

/** 联赛基线（base_rates 表一行） */
export interface BaseRate {
  league: string;
  drawRate: number;   // 0-1
  homeRate: number;   // 0-1
  awayRate: number;   // 0-1
  n: number;
}

/** 盘口历史行（odds_history） */
export interface OddsHistEntry {
  market: 'HAD' | 'HHAD';
  side: 'h' | 'd' | 'a';
  odds: number;
  observedAt: string;
}

/** PG matches 行 */
export interface MatchRow {
  matchId: string;
  matchDate: string;       // YYYY-MM-DD
  num: string;             // 周日006
  league: string;
  home: string;
  away: string;
  kickoff: string;         // ISO timestamptz (北京时间)
  matchTime?: string;      // HH:MM:SS (legacy compat)
  had: OddsBlock | null;
  hhad: OddsBlock | null;
  hadBase: OddsBlock | null;
  hhadBase: OddsBlock | null;
  support?: SupportRates | null;
  updatedAt: string;
}

/** 评分引擎输入/输出 */
export interface ScoreRow {
  num: string;
  league: string;
  home: string;
  away: string;
  time: string;
  matchId: string;
  dir: string;
  odds: number;
  dropAmt: number;
  hasBaseMark: 'v' | '!';
  dropNote: string;
  confirm: number;
  model: number;
  history: number;
  risk: number;
  value: number;
  total: number;
  band: string;
  market: 'HAD' | 'HHAD';
  pred: 'H' | 'A' | 'D';
  had: OddsBlock;
  hhad: OddsBlock;
  base: { had: OddsBlock | null; hhad: OddsBlock | null } | null;
  analysis?: AnalysisResult | null;
  scanRound?: number;
}

/** LLM/引擎 分析结果：6 维 + 总分 + 方向 */
export interface AnalysisResult {
  dir: string;          // 主胜/主负/让球等（与引擎同口径）
  market: 'HAD' | 'HHAD';
  pred: 'H' | 'A' | 'D';
  odds: number;
  drop: number;
  confirm: number;
  model: number;
  history: number;
  risk: number;
  value: number;
  total: number;
  band: string;
  dims: {
    drop: { score: number; max: number; note: string };
    confirm: { score: number; max: number; note: string };
    model: { score: number; max: number; note: string };
    history: { score: number; max: number; note: string };
    risk: { score: number; max: number; note: string };
    value: { score: number; max: number; note: string };
  };
  reasoning: string;    // LLM 给的分析理由
  from: 'engine' | 'llm' | 'merge';
  generatedAt: string;
}

/** 实时比分行 */
export interface LiveRow {
  matchId: string;
  score: string | null;
  ht: string | null;
  status: string | null;
  statusName: string | null;
  source: string;
  fetchedAt: string;
}

/** 官方开奖 */
export interface ResultRow {
  matchId: string;
  score: string;
  had: 'H' | 'A' | 'D' | null;
  hhad: 'H' | 'A' | 'D' | null;
  goalLine: string | null;
  ht?: string | null;
  fetchedAt?: string;
}

/** 实单腿 */
export interface BetLeg {
  matchId?: string | number;
  matchNum?: string;
  home?: string;
  away?: string;
  league?: string;
  kickoff?: string;
  pick?: string;
  odds?: number;
  note?: string;
}

export interface BetRow {
  betId: number;
  type: string;
  settleMarket?: string;
  stake: number;
  totalOdds?: number;
  potentialReturn?: number;
  placedAt: string;
  status: 'open' | 'settled' | 'void' | 'cancelled';
  legs: BetLeg[];
  theory?: string;
  statusNote?: string;
  result?: unknown;
  hadResult?: unknown;
  hhadResult?: unknown;
  returnAmount?: number;
  profit?: number;
  settledAt?: string;
  settle?: unknown;
}

export interface VirtualRow {
  id: string;
  date?: string;
  matchNum?: string;
  league?: string;
  home?: string;
  away?: string;
  matchTime?: string;
  matchId?: string | number;
  kickoff?: string;
  confidence?: number;
  myView?: string;
  analysis?: string;
  pick?: string;
  odds?: number;
  reviewHook?: string;
  status?: string;
  placedAt?: string;
  settledAt?: string;
  result?: unknown;
}

export interface LedgerRow {
  target: number;
  startBankroll: number;
  epoch: string;
  epochNote?: string;
  cash: number;
  inPlay: number[];
  settledProfit: number;
  totalStaked: number;
  totalReturned: number;
  bets: number[];
  history: unknown[];
  lastUpdated?: string;
}

export interface BankrollRow {
  cash: number;
  startingBankroll: number;
  target: number;
  epoch: string;
  epochNote?: string;
  sequence: unknown[];
  settledProfit?: number;
  totalStaked?: number;
  totalReturned?: number;
  inPlay?: unknown[];
  bets?: unknown[];
}

/** 扫描计划（13:00 由 planner 全表生成） */
export interface ScanPlan {
  id: string;             // '2026-09-07-s1'
  matchDate: string;
  scanAt: string;         // ISO
  labels: string[];       // ['开盘预扫'] ['首次'] ['临场']
  batch: string[];        // matchIds
  status: 'pending' | 'running' | 'done' | 'skipped';
  created_at: string;
  scanRound?: number;     // score 表 UNIQUE(match_id, scan_round)
  kickoff?: string;       // 该轮对应开赛时间（临场批次）
}

/** WS 下行消息 */
export type ServerMessage =
  | { type: 'hello'; now: string }
  | { type: 'day'; date: string; view: unknown; at: string }
  | { type: 'summary'; summary: unknown; at: string }
  | { type: 'status'; status: { ok: boolean; errors: unknown[] } | null; at: string }
  | { type: 'pong'; t: number };