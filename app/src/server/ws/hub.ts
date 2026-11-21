// WebSocket Hub：多房间推送
// 客户端连接后 sub 当日/全局，服务器每收到 change_log 哨兵就重算并推增量。
// 心跳保活 30s；消息格式见 shared/types.ts ServerMessage
import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'node:http';
import { buildDayView, buildSummary } from '../db/store.js';
import type { ServerMessage } from '../../shared/types.js';

type Room = `day:${string}` | 'summary' | 'status';

interface Client {
  ws: WebSocket;
  subs: Set<Room>;
  alive: boolean;
}

export class Hub {
  private wss: WebSocketServer;
  private clients = new Map<WebSocket, Client>();
  private dayCache = new Map<string, Promise<unknown>>();

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws) => this.onConn(ws));
    const iv = setInterval(() => {
      this.wss.clients.forEach(ws => {
        const c = this.clients.get(ws);
        if (!c || !c.alive) { ws.terminate(); return; }
        c.alive = false;
        ws.ping();
      });
    }, 30000);
    this.wss.on('close', () => clearInterval(iv));
  }

  private onConn(ws: WebSocket) {
    const c: Client = { ws, subs: new Set(), alive: true };
    this.clients.set(ws, c);
    ws.on('pong', () => { c.alive = true; });
    ws.on('message', (raw) => this.onMsg(c, raw));
    ws.on('close', () => this.clients.delete(ws));
    const ok: ServerMessage = { type: 'hello', now: new Date().toISOString() };
    ws.send(JSON.stringify(ok));
  }

  private onMsg(c: Client, raw: WebSocket.RawData) {
    let m: any;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.action === 'sub') {
      const rooms = Array.isArray(m.rooms) ? m.rooms : [m.room].filter(Boolean);
      for (const r of rooms) {
        const name = String(r) as Room;
        c.subs.add(name);
        void this.pushRoom(c, name);
      }
    } else if (m.action === 'unsub') {
      c.subs.delete(String(m.room) as Room);
    } else if (m.action === 'ping') {
      const pong: ServerMessage = { type: 'pong', t: Date.now() };
      c.ws.send(JSON.stringify(pong));
    }
  }

  private async pushRoom(c: Client, room: Room) {
    if (room.startsWith('day:')) {
      const date = room.slice(4);
      let view = Promise.resolve(this.dayCache.get(date));
      if (!view) {
        view = buildDayView(date);
        this.dayCache.set(date, view);
        view.finally(() => this.dayCache.delete(date));
      }
      const msg: ServerMessage = { type: 'day', date, view: await view, at: new Date().toISOString() };
      c.ws.send(JSON.stringify(msg));
    }
  }

  /** 向 room 的全订阅者推新数据。change 哨兵到点时调用。 */
  async broadcast(scope: 'day' | 'summary' | 'status', ref: string) {
    const existing: Client[] = [];
    for (const c of this.clients.values()) {
      if (scope === 'day' && c.subs.has(`day:${ref}`)) existing.push(c);
      if (scope !== 'day' && c.subs.has(scope)) existing.push(c);
    }
    if (!existing.length) return;
    if (scope === 'day') {
      const view = await buildDayView(ref);
      const msg: ServerMessage = { type: 'day', date: ref, view, at: new Date().toISOString() };
      for (const c of existing) c.ws.send(JSON.stringify(msg));
    } else if (scope === 'summary') {
      const summary = await buildSummary();
      const msg: ServerMessage = { type: 'summary', summary, at: new Date().toISOString() };
      for (const c of existing) c.ws.send(JSON.stringify(msg));
    } else {
      // status 推送值从 store 读
      const { getSourceStatus } = await import('../db/store.js');
      const st = await getSourceStatus();
      const msg: ServerMessage = { type: 'status', status: st, at: new Date().toISOString() };
      for (const c of existing) c.ws.send(JSON.stringify(msg));
    }
  }

  broadcastSync(scope: 'day' | 'summary' | 'status', ref: string) {
    void this.broadcast(scope, ref);
  }
}