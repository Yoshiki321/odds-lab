import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe' });
const pg = await b.newPage();
await pg.goto('http://localhost:9000/', { waitUntil: 'networkidle' });
await pg.waitForTimeout(6500);
const r = await pg.evaluate(async () => {
  const q = s => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim().slice(0, 260) : null; };
  // 等一次 live 轮询
  const rows = document.querySelectorAll('#daytable .mrow');
  const row1 = rows[0] ? rows[0].textContent.replace(/\s+/g, ' ').trim() : null;
  return {
    headerCells: [...document.querySelectorAll('#daytable thead th')].map(t => t.textContent.trim()).join('|'),
    row1,
    liveRequests: window.__flog ? window.__flog.filter(x => x.includes('live')).slice(0, 3) : 'no log',
    summary: q('#summarybar') || q('.statbar') || 'no summarybar',
    betstop: q('#betstop') || 'no betstop',
  };
});
console.log(JSON.stringify(r, null, 1));
await b.close();
process.exit(0);
