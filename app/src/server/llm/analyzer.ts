// analyzer.ts - 批量分析引擎（调度 LLM 打分，batch 同时间场次）
// LLM 未配置 → 自动落到本地引擎 scoreMatch（评分口径与手动扫描一致，saveScore from_source=engine）
// LLM 配置后 → 同接口无缝升级，from_source=llm，dims/reasoning 落地
import { getDayMatches, saveScore, loadBaseRates, getRollingDrawRate, getEuropeanOdds } from '../db/store.js';
import { callLLM } from './adapter.js';
import { buildMatchPrompt } from './prompt.js';
import type { MatchRow, ScoreRow, AnalysisResult, BaseRate } from '../../shared/types.js';
import { scoreMatch, SCORE_VERSION } from '../../../tools/score.js';
import type { EngineRow } from '../../../tools/score.js';

/** LLM 结果转 ScoreRow（校验 6 维为正数，防 LLM 乱填） */
function llmRow(m: MatchRow, a: AnalysisResult, scanRound: number): ScoreRow {
  return {
    num: m.num, league: m.league, home: m.home, away: m.away,
    time: m.matchDate, matchId: m.matchId,
    dir: a.dir, market: a.market, pred: a.pred,
    odds: a.odds, dropAmt: a.drop,
    hasBaseMark: 'v', dropNote: '',
    confirm: Math.max(0, a.confirm), model: Math.max(0, a.model), history: Math.max(0, a.history),
    risk: Math.max(0, a.risk), value: Math.max(0, a.value), total: a.total,
    band: a.band, had: m.had || {}, hhad: m.hhad || {},
    base: { had: m.hadBase, hhad: m.hhadBase },
    analysis: a, scanRound,
  };
}

/** 引擎结果转 ScoreRow（fallback / 手动扫描同口径）；引擎已带 dims 明细则直接复用 */
function engineRow(m: MatchRow, scanRound: number, e: EngineRow): ScoreRow {
  const analysis: AnalysisResult = e.analysis ?? {
    dir: e.dir, market: e.market, pred: e.pred, odds: e.odds, drop: e.dropAmt,
    confirm: e.confirm, model: e.model, history: e.history, risk: e.risk, value: e.value,
    total: e.total, band: e.band, from: 'engine', generatedAt: new Date().toISOString(),
    dims: {
      drop: { score: e.dropAmt >= 0 ? Math.min(22, Math.round(e.dropAmt * 1)) : 0, max: 22, note: e.dropNote },
      confirm: { score: e.confirm, max: 12, note: '胜平负方向确认' },
      model: { score: e.model, max: 22, note: '模型命中' },
      history: { score: e.history, max: 12, note: '历史样本' },
      risk: { score: e.risk, max: 22, note: '赛制/深盘风险' },
      value: { score: e.value, max: 10, note: '赔率价值' },
    },
    reasoning: `引擎${SCORE_VERSION} ${e.dropNote} 方向=${e.dir}${e.betNote ? ` (${e.betNote})` : ''}`,
  };
  return {
    num: m.num, league: m.league, home: m.home, away: m.away,
    time: m.matchDate, matchId: m.matchId,
    dir: e.dir, market: e.market, pred: e.pred, odds: e.odds, dropAmt: e.dropAmt,
    hasBaseMark: e.hasBaseMark, dropNote: e.dropNote,
    confirm: e.confirm, model: e.model, history: e.history, risk: e.risk, value: e.value,
    total: e.total, band: e.band, had: m.had || {}, hhad: m.hhad || {},
    base: { had: m.hadBase, hhad: m.hhadBase },
    analysis, scanRound,
  };
}

/** 批量分析一批场次（同 kickoff 时间一起打包） */
export async function analyzeBatch(matches: MatchRow[], scanRound: number): Promise<ScoreRow[]> {
  const results: ScoreRow[] = [];
  const [baseRates, rolling] = await Promise.all([loadBaseRates(), getRollingDrawRate()]);
  for (const m of matches) {
    try {
      const prompt = buildMatchPrompt({
        matchId: m.matchId, num: m.num, league: m.league,
        home: m.home, away: m.away, kickoff: m.kickoff,
        had: m.had || {}, hhad: m.hhad || {},
        hadBase: m.hadBase || {}, hhadBase: m.hhadBase || {},
      });
      const resp = await callLLM({ model: 'gpt-4', prompt, maxTokens: 2000 });
      const score = llmRow(m, JSON.parse(resp.text) as AnalysisResult, scanRound);
      await saveScore(score);
      results.push(score);
    } catch (e: any) {
      // LLM 未配置/失败 → 引擎 fallback（from_source=engine，不丢这场的分）
      const err = e?.message || String(e);
      if (!/adapter not configured/.test(err)) console.error(`[analyzer] ${m.num} LLM:`, err);
      try {
        // value 维必须带欧赔：getEuropeanOdds 读最新快照，扫描轮与 refresh scoreDay 同口径，避免"无欧赔可比"回退分
        const europeOdds = await getEuropeanOdds(m.matchId);
        const es = scoreMatch(m, { support: m.support ?? null, baseRates, rollingDrawRate: rolling, europeOdds });
        if ('note' in es) continue;
        const score = engineRow(m, scanRound, es);
        await saveScore(score);
        results.push(score);
      } catch (e2: any) {
        console.error(`[analyzer] ${m.num} 引擎也失败:`, e2?.message);
      }
    }
  }
  return results;
}