-- Odds-Lab v2 PG Schema
-- 迁移由 src/server/db/migrate.ts 幂等执行（CREATE TABLE IF NOT EXISTS）
-- 数据库: jc_assistant  (UTF8)

-- 全部采用 UTC timestamptz 存储；北京时间 = +08:00，展示层换算

-- ============ 场次 ============
CREATE TABLE IF NOT EXISTS matches (
  match_id      VARCHAR(20) PRIMARY KEY,
  match_date    DATE        NOT NULL,          -- 竞彩销售日 (北京)
  num           VARCHAR(10) NOT NULL,          -- 周日006
  league        VARCHAR(32) DEFAULT '',
  home          VARCHAR(64) DEFAULT '',
  away          VARCHAR(64) DEFAULT '',
  kickoff       TIMESTAMPTZ,                   -- 开赛时刻（北京，UTC 存储）
  had           JSONB,                         -- 胜平负当前盘
  hhad          JSONB,                         -- 让球当前盘
  had_base      JSONB,                         -- 首见盘（对照降水基线）
  hhad_base     JSONB,
  first_seen_at TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (match_date, match_id)
);

-- matches 表已存在时补 support 列（幂等）
ALTER TABLE IF EXISTS matches ADD COLUMN IF NOT EXISTS support JSONB;

CREATE INDEX IF NOT EXISTS idx_matches_date ON matches (match_date);

-- ============ 盘口历史（变盘轨迹）============
CREATE TABLE IF NOT EXISTS odds_history (
  id          BIGSERIAL PRIMARY KEY,
  match_id    VARCHAR(20) NOT NULL REFERENCES matches (match_id) ON DELETE CASCADE,
  market      VARCHAR(8)  NOT NULL,            -- HAD / HHAD
  side        VARCHAR(4)  NOT NULL,            -- h / d / a
  odds        NUMERIC(6,2),
  observed_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_odds_history_match ON odds_history (match_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_odds_history_obs ON odds_history (match_id, market, side, observed_at);

-- ============ 欧洲市场赔率（懂球帝 magicball 欧赔 → 独立公平概率源）============
-- 每场每源一行（覆盖式快照，非轨迹）；value 维度用它去水算 EV
CREATE TABLE IF NOT EXISTS europe_odds (
  match_id    VARCHAR(20) NOT NULL REFERENCES matches (match_id) ON DELETE CASCADE,
  home_odds   NUMERIC(8,2),
  draw_odds   NUMERIC(8,2),
  away_odds   NUMERIC(8,2),
  source      VARCHAR(16) DEFAULT 'dongqiudi',
  observed_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (match_id, source)
);

-- ============ 欧赔轨迹（追加历史；origin=初盘 / spot=即时）============
-- value 维度读当前快照 europe_odds，回测/临场对比从这里取时间序列
CREATE TABLE IF NOT EXISTS europe_odds_history (
  id          BIGSERIAL PRIMARY KEY,
  match_id    VARCHAR(20) NOT NULL REFERENCES matches (match_id) ON DELETE CASCADE,
  home_odds   NUMERIC(8,2),
  draw_odds   NUMERIC(8,2),
  away_odds   NUMERIC(8,2),
  odds_type   VARCHAR(8)  NOT NULL,             -- origin / spot
  source      VARCHAR(16) DEFAULT 'dongqiudi',
  observed_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_euro_hist_match ON europe_odds_history (match_id, odds_type, observed_at);

-- ============ 亚盘 / 大小球轨迹（magicball score_odds origin/spot 全量）============
CREATE TABLE IF NOT EXISTS handicap_odds_history (
  id          BIGSERIAL PRIMARY KEY,
  match_id    VARCHAR(20) NOT NULL REFERENCES matches (match_id) ON DELETE CASCADE,
  market      VARCHAR(4)  NOT NULL,             -- AH 亚盘 / OU 大小球
  line        NUMERIC(6,2),                     -- 让球数 / 大小盘口（负=主让，正=主受让）
  home_odds   NUMERIC(6,2),                     -- 亚盘:主水 / 大小球:大球水
  away_odds   NUMERIC(6,2),                     -- 亚盘:客水 / 大小球:小球水
  odds_type   VARCHAR(8)  NOT NULL,             -- origin / spot
  source      VARCHAR(16) DEFAULT 'dongqiudi',
  observed_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_handicap_hist_match ON handicap_odds_history (match_id, market, odds_type, observed_at);

-- ============ 多时点评分快照（每场每天多帧；回答"前置 vs 临场"）============
CREATE TABLE IF NOT EXISTS score_snapshots (
  id           BIGSERIAL PRIMARY KEY,
  match_id     VARCHAR(20) NOT NULL REFERENCES matches (match_id) ON DELETE CASCADE,
  snapshot_at  TIMESTAMPTZ DEFAULT now(),       -- 打帧时刻
  hours_to_ko  NUMERIC(5,1),                    -- 距开赛小时（负=已开）
  slot         VARCHAR(12) DEFAULT 'hourly',    -- pre-open / open / t-8h / t-4h / t-2h / t-30m / hourly / final
  scan_round   INT DEFAULT 1,
  total        INT,
  band         VARCHAR(12) DEFAULT '',
  dir          VARCHAR(16),
  market       VARCHAR(8),
  pred         VARCHAR(2),
  odds         NUMERIC(6,2),
  drop_amt     NUMERIC(6,2) DEFAULT 0,
  value_ev     NUMERIC(8,4),                    -- 打帧时 EV（百分点位，0.12=+12%）
  score        JSONB,                           -- 6 维明细 {drop,confirm,model,history,risk,value}
  had          TEXT,                            -- 胜平负快照 "主,平,客"
  hhad         TEXT,                            -- 让球快照
  europe       TEXT,                            -- 欧赔快照 "主,平,客@type"
  support      TEXT,                            -- 大众支持快照
  has_base_mark VARCHAR(2) DEFAULT 'v'
);
CREATE INDEX IF NOT EXISTS idx_score_snap_match ON score_snapshots (match_id, snapshot_at);
CREATE INDEX IF NOT EXISTS idx_score_snap_date ON score_snapshots (snapshot_at);

-- ============ 球队实力 Elo（从 PG 官方赛果滚动计算）============
CREATE TABLE IF NOT EXISTS team_elo (
  team       VARCHAR(64) NOT NULL,
  league     VARCHAR(32) DEFAULT '',
  elo        NUMERIC(8,1) DEFAULT 1500,
  home_elo   NUMERIC(8,1) DEFAULT 1500,
  away_elo   NUMERIC(8,1) DEFAULT 1500,
  n          INT DEFAULT 0,                     -- 参与场次
  last_at    TIMESTAMPTZ,                       -- 最近一场开赛时间
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (team)
);
CREATE INDEX IF NOT EXISTS idx_team_elo_league ON team_elo (league, elo DESC);

-- ============ 临场首发 / 伤停（尽力而为，抓不到为空）============
CREATE TABLE IF NOT EXISTS match_lineups (
  match_id     VARCHAR(20) PRIMARY KEY REFERENCES matches (match_id) ON DELETE CASCADE,
  home_first11 JSONB,
  away_first11 JSONB,
  injuries     JSONB,
  fetched_at   TIMESTAMPTZ DEFAULT now()
);

-- ============ 评分分析 ============
CREATE TABLE IF NOT EXISTS scores (
  id          BIGSERIAL PRIMARY KEY,
  match_id    VARCHAR(20) NOT NULL REFERENCES matches (match_id) ON DELETE CASCADE,
  match_date  DATE        NOT NULL,
  scan_round  INT         NOT NULL DEFAULT 1,   -- 第几次扫描（每日从1递进）
  dir         VARCHAR(16) NOT NULL,             -- 主胜/主负/客+1胜...
  market      VARCHAR(8)  NOT NULL DEFAULT 'HAD',
  pred        VARCHAR(2)  NOT NULL,             -- H / A / D
  odds        NUMERIC(6,2),
  drop_amt    NUMERIC(6,2) DEFAULT 0,
  confirm     INT DEFAULT 0,
  model       INT DEFAULT 0,
  history     INT DEFAULT 0,
  risk        INT DEFAULT 0,
  value       INT DEFAULT 0,
  total       INT NOT NULL,
  band        VARCHAR(8)  DEFAULT '',
  drop_note   VARCHAR(32) DEFAULT '',
  has_base_mark VARCHAR(2) DEFAULT 'v',
  dims        JSONB,                            -- 6 维明细 (AnalysisResult.dims)
  analysis    JSONB,                            -- LLM 原始回复/推理
  from_source VARCHAR(8) DEFAULT 'engine',      -- engine / llm / merge
  analyzed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (match_id, scan_round)
);
CREATE INDEX IF NOT EXISTS idx_scores_date ON scores (match_date, total DESC);

-- ============ 实时比分 ============
CREATE TABLE IF NOT EXISTS live_scores (
  match_id    VARCHAR(20) PRIMARY KEY REFERENCES matches (match_id) ON DELETE CASCADE,
  score       VARCHAR(12),
  ht          VARCHAR(12),
  status      VARCHAR(16),
  status_name VARCHAR(16),
  source      VARCHAR(16) DEFAULT 'sporttery',
  fetched_at  TIMESTAMPTZ DEFAULT now()
);

-- ============ 官方开奖 ============
CREATE TABLE IF NOT EXISTS results (
  match_id   VARCHAR(20) PRIMARY KEY REFERENCES matches (match_id) ON DELETE CASCADE,
  score      VARCHAR(12),
  had        VARCHAR(2),
  hhad       VARCHAR(2),
  goal_line  VARCHAR(8),
  ht         VARCHAR(12),
  fetched_at TIMESTAMPTZ DEFAULT now()
);

-- ============ 联赛基准率（历史胜平负概率）============
CREATE TABLE IF NOT EXISTS base_rates (
  league     VARCHAR(32) PRIMARY KEY,
  draw_rate   NUMERIC(6,4) DEFAULT 0,
  home_rate   NUMERIC(6,4) DEFAULT 0,
  away_rate   NUMERIC(6,4) DEFAULT 0,
  n           INT DEFAULT 0,              -- 采样场次数
  window_days INT DEFAULT 0,              -- 窗口天数（滚动口径）
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ============ 实单 ============
CREATE TABLE IF NOT EXISTS bets (
  bet_id          SERIAL PRIMARY KEY,
  type            VARCHAR(32) DEFAULT '',
  settle_market   VARCHAR(32) DEFAULT '',
  stake           NUMERIC(10,2) NOT NULL,
  total_odds      NUMERIC(8,2),
  potential_return NUMERIC(10,2),
  placed_at       TIMESTAMPTZ,
  status          VARCHAR(12) NOT NULL DEFAULT 'open',  -- open/settled/void/cancelled
  legs            JSONB,
  theory          TEXT DEFAULT '',
  status_note     TEXT DEFAULT '',
  result          JSONB,
  return_amount   NUMERIC(10,2),
  profit          NUMERIC(10,2),
  settled_at      TIMESTAMPTZ,
  settle          JSONB,
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ============ 虚拟注 ============
CREATE TABLE IF NOT EXISTS virtual_bets (
  id          VARCHAR(16) PRIMARY KEY,          -- vb-xxx
  match_id    VARCHAR(20) REFERENCES matches (match_id) ON DELETE SET NULL,
  match_num   VARCHAR(10),
  league      VARCHAR(32),
  home        VARCHAR(64),
  away        VARCHAR(64),
  match_time  VARCHAR(16),
  kickoff     TIMESTAMPTZ,
  confidence  INT,
  my_view     TEXT DEFAULT '',
  analysis    TEXT DEFAULT '',
  pick        TEXT DEFAULT '',
  odds        NUMERIC(6,2),
  review_hook TEXT DEFAULT '',
  status      VARCHAR(12) DEFAULT 'open',
  placed_at   TIMESTAMPTZ,
  settled_at  TIMESTAMPTZ,
  result      JSONB
);

-- ============ 账本（单行，多版本保留于 JSONB）============
CREATE TABLE IF NOT EXISTS bankroll (
  id               SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  target           NUMERIC(10,2) DEFAULT 10000,
  start_bankroll   NUMERIC(10,2) DEFAULT 1000,
  epoch            VARCHAR(16) DEFAULT '',
  epoch_note       VARCHAR(64) DEFAULT '',
  cash             NUMERIC(10,2) DEFAULT 0,
  settled_profit   NUMERIC(10,2) DEFAULT 0,
  total_staked     NUMERIC(10,2) DEFAULT 0,
  total_returned   NUMERIC(10,2) DEFAULT 0,
  in_play          JSONB DEFAULT '[]'::jsonb,
  bets             JSONB DEFAULT '[]'::jsonb,
  history          JSONB DEFAULT '[]'::jsonb,
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- ============ 扫描计划 ============
CREATE TABLE IF NOT EXISTS scan_plans (
  id          VARCHAR(32) PRIMARY KEY,           -- '2026-09-07-s1'
  match_date  DATE NOT NULL,
  scan_at     TIMESTAMPTZ NOT NULL,            -- 计划扫描时刻
  labels      TEXT[] DEFAULT '{}',
  batch       JSONB DEFAULT '[]'::jsonb,        -- matchIds
  status      VARCHAR(12) DEFAULT 'pending',    -- pending/running/done/skipped
  kickoff     TIMESTAMPTZ,                      -- 该轮对应开赛时间（临场批次）
  result      JSONB,
  created_at  TIMESTAMPTZ DEFAULT now(),
  ran_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_scan_plans_waiting ON scan_plans (scan_at) WHERE status = 'pending';

-- ============ 信息源状态 ============
CREATE TABLE IF NOT EXISTS source_status (
  id         SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ok         BOOLEAN DEFAULT true,
  errors     JSONB DEFAULT '[]'::jsonb,
  detail     JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============ 系统心跳（WS 变更哨兵用）============
CREATE TABLE IF NOT EXISTS change_log (
  id       BIGSERIAL PRIMARY KEY,
  scope    VARCHAR(16) NOT NULL,                -- day/summary/status
  ref      VARCHAR(24) NOT NULL,                -- date / 'global'
  at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_changelog_scope ON change_log (scope, ref, id DESC);

-- ============ 文档（日记日记抄/自我升级/杂项）============
CREATE TABLE IF NOT EXISTS docs (
  name       VARCHAR(48) PRIMARY KEY,           -- journal:2026-09-06 / mistakes / scoring-upgrade
  body       JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 跨源赛事唯一映射表（竞彩 / 开云 / 懂球帝 / 澳客 / Understat）
-- ============================================================
CREATE TABLE IF NOT EXISTS match_crosswalk (
  canonical_id   VARCHAR(128) PRIMARY KEY,
  kickoff_utc_ms BIGINT       NOT NULL,
  league_tier    SMALLINT,
  home_norm      VARCHAR(80)  NOT NULL,
  away_norm      VARCHAR(80)  NOT NULL,
  sporttery_id   VARCHAR(32),
  kaiyun_mid     VARCHAR(32),
  dqd_id         VARCHAR(32),
  okooo_id       VARCHAR(32),
  understat_id   VARCHAR(32),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cw_sporttery ON match_crosswalk(sporttery_id) WHERE sporttery_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cw_kaiyun    ON match_crosswalk(kaiyun_mid)   WHERE kaiyun_mid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cw_kickoff          ON match_crosswalk(kickoff_utc_ms);

-- ============================================================
-- 不可变样本外预测与 CLV（收盘价价值）审计表
-- ============================================================
CREATE TABLE IF NOT EXISTS model_predictions (
  prediction_id     VARCHAR(96) PRIMARY KEY,
  canonical_id      VARCHAR(128) NOT NULL,
  model_version     VARCHAR(48)  NOT NULL,
  predicted_at      TIMESTAMPTZ  NOT NULL,
  kickoff_at        TIMESTAMPTZ  NOT NULL,
  market            VARCHAR(16)  NOT NULL, -- HAD / HHAD / AH / OU
  side              VARCHAR(16)  NOT NULL, -- home / draw / away / over / under
  line              NUMERIC(6,2),
  p_market          NUMERIC(8,6) NOT NULL, -- Sharp/市场去水先验概率
  p_model           NUMERIC(8,6) NOT NULL, -- 残差校准后模型概率
  exec_odds         NUMERIC(8,4) NOT NULL, -- T-30 主窗口展示价
  confirm_odds_30s  NUMERIC(8,4),          -- +30s 滑点确认价
  closing_odds      NUMERIC(8,4),          -- T-2m 收盘参考价
  ev_est            NUMERIC(8,6),          -- 模型估计净 EV
  clv               NUMERIC(8,6),          -- 收盘价价值 (closingFairProb * execOdds - 1)
  outcome           VARCHAR(16),           -- win / half-win / push / half-loss / lose
  pnl_per_unit      NUMERIC(8,4),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mp_model_time ON model_predictions(model_version, predicted_at);
CREATE INDEX IF NOT EXISTS idx_mp_canonical  ON model_predictions(canonical_id);
