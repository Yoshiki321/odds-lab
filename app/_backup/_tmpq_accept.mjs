// 验收快照：加载 /，抓 console 错误，检查四块是否渲染
import { chromium } from 'playwright';

const url = 'http://localhost:9000/';
const b = await chromium.launch({ executablePath: 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe' });
const pg = await b.newPage();
const errs = [];
pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
pg.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
pg.on('requestfailed', r => errs.push('REQFAIL: ' + r.url() + ' ' + (r.failure() || {}).errorText));
pg.on('response', r => { if (r.url().includes('/api/')) errs.push('RESP ' + r.status() + ': ' + r.url()); else if (r.status() >= 400) errs.push('HTTP' + r.status() + ': ' + r.url().slice(-60)); });
await pg.addInitScript(() => {
  window.__flog = [];
  const fl = (k, v) => { try { window.__flog.push(k + '=' + JSON.stringify(v)); } catch {} };
  const of = window.fetch;
  window.fetch = (...a) => {
    const u = String(a[0]);
    if (u.includes('/api/')) {
      fl('F', u.replace('/api/', ''));
      return of(...a).then(r => {
        if (u.includes('/api/days')) {
          const cl = r.clone();
          cl.text().then(t => {
            fl('B', t.slice(0, 200));
            setTimeout(() => { try { fl('SD', (typeof S !== 'undefined' ? S.days.map(d => d.date) : 'noS')); fl('SC', (typeof S !== 'undefined' ? S.cur : 'noS')); } catch {} }, 400);
          }).catch(() => {});
        }
        return r;
      });
    }
    return of(...a);
  };
});
await pg.goto(url, { waitUntil: 'networkidle' });
await pg.waitForTimeout(2500);

const probe = await pg.evaluate(async () => {
  const q = s => { const e = document.querySelector(s); return e ? e.innerHTML.slice(0, 300) : null; };
  const visible = s => { const e = document.querySelector(s); return e ? (e.children.length > 0 || e.textContent.trim().length > 0) : false; };
  return {
    daychips: q('#daychips'),
    daystat: q('#daystat'),
    daytableRows: document.querySelectorAll('#daytable .mrow').length,
    daytableEmpty: q('#daytable .empty'),
    filterbar: visible('#filterbar'),
    srcerr: q('#srcerr'),
    view: !!document.querySelector('#view-day'),
    footer: q('.footer'),
    logStr: JSON.stringify(window.__flog || [], null, 1),
    S_picked: (typeof S !== 'undefined' && S) ? S._picked : 'NO_S',
    S_daySig: (typeof S !== 'undefined' && S) ? String(S._daySig).slice(0, 60) : 'NO_S',
    Sdays: (typeof S !== 'undefined' && S && S.days) ? S.days.map(d => d.date).join(',') : 'NO_S',
    Scur: (typeof S !== 'undefined' && S) ? S.cur : 'NO_S',
    manualFetch: await (async () => {
      try {
        const r = await fetch('/api/days');
        return { status: r.status, body: (await r.text()).slice(0, 120) };
      } catch (e) { return { err: e.message }; }
    })(),
    tableFirstRow: (() => {
      const tr = document.querySelector('#daytable .mrow');
      return tr ? tr.textContent.replace(/\s+/g, ' ').slice(0, 220) : null;
    })(),
  };
});
console.log('consoleErrors:', JSON.stringify(errs, null, 1));
console.log('probe:', JSON.stringify(probe, null, 1));
await b.close();
process.exit(0);