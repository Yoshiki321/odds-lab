// PostgreSQL 连接池 + 幂等建表
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const CFG = join(ROOT, 'config', 'db.json');
const TPL = join(ROOT, 'config', 'db.template.json');

export interface DbConfig {
  host: string; port: number; user: string; password: string; database: string; ssl?: boolean;
}

export function loadDbConfig(): DbConfig {
  // 环境变量优先：隔离测试库/临时环境不用改 config/db.json（避免碰真实凭据）
  const env = process.env;
  if (env.JC_DB_HOST || env.JC_DB_NAME || env.JC_DB_PORT || env.JC_DB_USER) {
    const cfg: DbConfig = {
      host: env.JC_DB_HOST || '127.0.0.1',
      port: Number(env.JC_DB_PORT || 5432),
      user: env.JC_DB_USER || 'postgres',
      password: env.JC_DB_PASSWORD || '',
      database: env.JC_DB_NAME || 'jc_assistant',
      ssl: env.JC_DB_SSL === '1',
    };
    console.warn(`[db] 使用环境变量配置 ${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}`);
    return cfg;
  }

  const src = env.JC_DB_CONFIG && existsSync(env.JC_DB_CONFIG) ? env.JC_DB_CONFIG : (existsSync(CFG) ? CFG : TPL);
  if (src === TPL) {
    console.warn('[db] 未找到 config/db.json，使用模板。请复制模板填好密码。');
  }
  return JSON.parse(readFileSync(src, 'utf8'));
}

let _pool: pg.Pool | null = null;
export function pool(): pg.Pool {
  if (_pool) return _pool;
  const cfg = loadDbConfig();
  _pool = new pg.Pool({ ...cfg, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 });
  _pool.on('error', err => {
    console.error('[db] idle client', err && err.message);
  });
  return _pool;
}

export async function query<T extends pg.QueryResultRow = any>(text: string, params?: unknown[]): Promise<pg.QueryResult<T>> {
  return pool().query<T>(text, params);
}

/** 幂等执行 schema.sql（整脚本为一个事务） */
export async function migrate(): Promise<void> {
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  const p = pool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('[db] schema 就绪');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * 事务封装：同一笔业务（记账 + 资金变动）必须在同一个 client 上完成。
 * fn 抛错即整体回滚。
 */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}

/** 写变更哨兵：让 WS hub 感知到某日/全局的数据变化 */
export async function markChange(scope: 'day' | 'summary' | 'status' | 'live', ref: string): Promise<void> {
  try {
    await query('INSERT INTO change_log (scope, ref) VALUES ($1, $2)', [scope, ref]);
  } catch { /* 哨兵失败不影响主流程 */ }
}