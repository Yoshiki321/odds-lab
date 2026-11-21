import { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildDayView, buildSummary, buildMistakes,
  listDays, getLive, getSourceStatus, getDiaryList, getDiary,
} from './db/store.js';
import { markChange } from './db/pool.js';
import type { Hub } from './ws/hub.js';
import { refresh } from '../../tools/refresh.js';
import { settleAll } from '../../tools/settle.js';
import { audit } from '../../tools/audit.js';
import { opVirtual, opVirtualDelete, opDiary, opBet, opGate, readJsonBody } from './ops.js';

const here = dirname(fileURLToPath(import.meta.url));
export const PUBLIC_DIR = resolve(here, '../../public'); // app/public —— v2 专属前端，根目录 public/ 是 v1 遗留

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function json(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function tryRead(p: string): Buffer | null {
  try { return existsSync(p) ? readFileSync(p) : null; } catch { return null; }
}

function serveStatic(res: ServerResponse, pathname: string) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1).replace(/\\/g, '/');
  const file = resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('forbidden'); return; }
  const body = tryRead(file);
  if (body == null) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404'); return; }
  const headers: Record<string, string> = { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' };
  if (extname(file) === '.html') headers['Cache-Control'] = 'no-store';
  else headers['Cache-Control'] = 'public, max-age=3600';
  res.writeHead(200, headers);
  res.end(body);
}

/** 组装 Router：把 http server 和 ws hub 接起来 */
export function createRouter(hub: Hub) {
  return async function router(req: IncomingMessage, res: ServerResponse) {
    const u = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const p = u.pathname;
    try {

    if (p === '/api/days') return json(res, 200, await listDays());
    if (p === '/api/score-status') return json(res, 200, await getSourceStatus());
    if (p === '/api/health') {
      const days = await listDays();
      const arr = (days as any).days || days || [];
      const st = await getSourceStatus().catch(() => null);
      return json(res, 200, {
        ok: true, at: new Date().toISOString(), version: 'v2',
        latestDay: arr.length ? arr[arr.length - 1].date || arr[arr.length - 1] : null,
        days: arr.length, scoreStatus: st,
      });
    }
    if (p === '/api/summary') return json(res, 200, await buildSummary());
    if (p === '/api/mistakes') return json(res, 200, await buildMistakes());

    if (p === '/api/diary' && req.method !== 'POST') return json(res, 200, await getDiaryList());
    if (p.startsWith('/api/diary/')) {
      const d = p.replace('/api/diary/', '');
      return json(res, 200, await getDiary(d));
    }

    if (p.startsWith('/api/day/')) {
      const date = p.replace('/api/day/', '');
      return json(res, 200, await buildDayView(date));
    }

    if (p.startsWith('/api/live/')) {
      const date = p.replace('/api/live/', '').split('?')[0];
      if (date === 'refresh') {
        // 主动拉一次当日比分（生产环境由 scheduler 自动，这里留手动兜底）
        await markChange('live', date);
        return json(res, 200, { ok: true, note: 'live refresh 由 scheduler 驱动' });
      }
      return json(res, 200, await getLive(date));
    }

    // ── 研判层写入（无人值守会话用；真注需 confirmed=true + 服务端五门禁自查） ──
    if (p === '/api/gate' && req.method === 'GET') {
      return json(res, 200, await opGate({ date: u.searchParams.get('date') || undefined, num: u.searchParams.get('num') || undefined, matchId: u.searchParams.get('matchId') || undefined }));
    }
    if (p === '/api/virtual' && req.method === 'POST') {
      return json(res, 200, await opVirtual(await readJsonBody(req)));
    }
    if (p === '/api/virtual' && req.method === 'DELETE') {
      return json(res, 200, await opVirtualDelete({ id: u.searchParams.get('id') || undefined, matchId: u.searchParams.get('matchId') || undefined }));
    }
    if (p === '/api/diary' && req.method === 'POST') {
      return json(res, 200, await opDiary(await readJsonBody(req)));
    }
    if (p === '/api/bet' && req.method === 'POST') {
      const r: any = await opBet(await readJsonBody(req));
      return json(res, r.ok ? 200 : 409, r);
    }

    // ── 触发器（POST，替代 shell 调用，不弹 CMD） ──
    if (p === '/api/trigger/refresh' && req.method === 'POST') {
      const date = u.searchParams.get('date') || undefined;
      const r = await refresh(date);
      return json(res, 200, { ok: true, ...r });
    }
    if (p === '/api/trigger/settle' && req.method === 'POST') {
      const r = await settleAll();
      return json(res, 200, { ok: true, ...r });
    }
    if (p === '/api/trigger/audit' && req.method === 'POST') {
      const r = await audit();
      return json(res, 200, { ok: true, ...r });
    }

    if (p === '/ws') { res.writeHead(400); res.end('use websocket upgrade'); return; }
    serveStatic(res, p);
    } catch (e) {
      console.error('[api]', p, e && (e as Error).message);
      if (!res.headersSent) json(res, 500, { error: String((e as Error).message || e) });
    }
  };
}
