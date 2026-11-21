// db-test.ts - PG 连接诊断（不打印任何密码内容，只输出成败分类）
// 用法: npx tsx scripts/db-test.ts
import { loadDbConfig } from '../src/server/db/pool.js';
import pg from 'pg';
import net from 'node:net';

async function main() {
  const cfg = loadDbConfig();
  console.log(`目标: ${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database} (ssl=${!!cfg.ssl})`);

  // 1. 端口探测
  const portOk = await new Promise<boolean>(resolve => {
    const s = net.connect(Number(cfg.port), cfg.host);
    s.setTimeout(1500, () => { s.destroy(); resolve(false); });
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
  });
  console.log(`[1] 端口 ${cfg.host}:${cfg.port} 可连接: ${portOk ? 'YES' : 'NO'}`);
  if (!portOk) { console.log('    → PG 服务未运行或端口不同（本机可能不是 5432）'); return; }

  // 2. 连接 + 认证
  const c = new pg.Client({ ...cfg, connectionTimeoutMillis: 4000 });
  try {
    await c.connect();
    const r = await c.query('SELECT current_database() db, current_user usr, version() v');
    console.log(`[2] 连接成功: db=${r.rows[0].db} user=${r.rows[0].usr}`);
    console.log(`    PG ${r.rows[0].v.split(' ').slice(0, 2).join(' ')}`);
  } catch (e: any) {
    console.log(`[2] 连接失败: ${e.message}`);
    const m = String(e.message || '');
    if (/password|Password|authentication|SCRAM|SASL/i.test(m)) console.log('    → 认证被拒：密码与 postgres 用户不符');
    else if (/database .* does not exist/i.test(m)) console.log('    → 数据库 ' + cfg.database + ' 不存在（需先 createdb）');
    else if (/ECONNREFUSED|timeout/i.test(m)) console.log('    → PG 服务未启动');
    else console.log('    → 其他错误，看上行原始信息');
    return;
  } finally { await c.end().catch(() => {}); }

  // 3. 检查核心表是否存在
  try {
    const r = await c.query(`SELECT count(*) FROM information_schema.tables WHERE table_schema='public'`);
    console.log(`[3] public schema 现有表: ${Number(r.rows[0].count)} 张`);
  } catch {}
}

main().catch(e => { console.error('诊断脚本异常:', e.message); process.exit(1); });