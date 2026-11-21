// ingest_legacy.ts - 首次迁移：把 data/ 目录 JSON 全部导入 PG
// 读取 data/today/*.json, data/scores/*.json, data/results/*.json,
// data/betting/bets/*.json, data/virtual/vb-*.json, data/betting/ledger.json, bankroll.json
// 批量 upsert 到 PG
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  upsertMatch, saveScore, upsertResult, upsertBet, upsertVirtual,
  saveBankroll, upsertDoc,
} from '../src/server/db/store.js';
import { query } from '../src/server/db/pool.js';

const ROOT = join(import.meta.dirname, '..', '..');
const DATA = join(ROOT, 'data');

function safeRead(p: string): any {
  try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; } catch { return null; }
}

export async function ingestLegacy() {
  console.log('[ingest] 开始导入 data/ → PG...');

  // 1. today matches
  const todayDir = join(DATA, 'today');
  if (existsSync(todayDir)) {
    for (const f of readdirSync(todayDir).filter(x => x.endsWith('.json'))) {
      const d = safeRead(join(todayDir, f));
      if (d?.matches) for (const m of d.matches) await upsertMatch(m);
    }
  }

  // 2. scores
  const scoresDir = join(DATA, 'scores');
  if (existsSync(scoresDir)) {
    for (const f of readdirSync(scoresDir).filter(x => /^\d{4}-\d{2}-\d{2}\.json$/.test(x))) {
      const d = safeRead(join(scoresDir, f));
      if (d?.rows) for (const r of d.rows) await saveScore(r);
    }
  }

  // 3. results
  const resDir = join(DATA, 'results');
  if (existsSync(resDir)) {
    for (const f of readdirSync(resDir).filter(x => x.endsWith('.json'))) {
      const d = safeRead(join(resDir, f));
      if (d?.byId) for (const k of Object.keys(d.byId)) await upsertResult(d.byId[k]);
    }
  }

  // 4. bets
  const betsDir = join(DATA, 'betting', 'bets');
  if (existsSync(betsDir)) {
    for (const f of readdirSync(betsDir).filter(x => x.startsWith('bet-') && x.endsWith('.json'))) {
      const b = safeRead(join(betsDir, f));
      if (b) await upsertBet(b);
    }
  }

  // 5. virtual（match_id 外键：引用了不存在场次的置 null 保留数据，不阻断导入）
  const virtDir = join(DATA, 'virtual');
  if (existsSync(virtDir)) {
    const { rows } = await query('SELECT match_id FROM matches');
    const matchIds = new Set(rows.map(r => r.match_id));
    for (const f of readdirSync(virtDir).filter(x => x.startsWith('vb-') && x.endsWith('.json'))) {
      const v = safeRead(join(virtDir, f));
      if (!v) continue;
      const mid = v.matchId != null ? String(v.matchId) : null;
      await upsertVirtual({ ...v, matchId: mid && matchIds.has(mid) ? mid : null, id: v.id != null ? String(v.id) : f.replace(/\.json$/, '') });
    }
  }

  // 6. bankroll & ledger
  const bankroll = safeRead(join(DATA, 'betting', 'bankroll.json'));
  if (bankroll) await saveBankroll(bankroll);

  // 7. docs: mistakes, diary journals
  const mistakes = safeRead(join(DATA, 'diary', 'scoring-upgrade.json'));
  if (mistakes) await upsertDoc('mistakes', mistakes);

  const journalsDir = join(DATA, 'diary', 'journals');
  if (existsSync(journalsDir)) {
    for (const f of readdirSync(journalsDir).filter(x => /^\d{4}-\d{2}-\d{2}\.json$/.test(x))) {
      const j = safeRead(join(journalsDir, f));
      if (j) await upsertDoc('journal:' + f.replace('.json', ''), j);
    }
  }

  console.log('[ingest] 导入完成');
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('ingest_legacy.ts')) {
  ingestLegacy().catch(e => { console.error(e); process.exit(1); });
}
