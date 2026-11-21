import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe' });
const pg = await b.newPage();
const errs = [];
pg.on('pageerror', e => errs.push(e.message));
await pg.goto('http://localhost:9000/', { waitUntil: 'networkidle' });
await pg.waitForTimeout(2500);
// 切到 09/06（周日）看已完场比分
await pg.evaluate(() => goDay('2026-09-06'));
await pg.waitForTimeout(2500);
const r = await pg.evaluate(() => {
  const rows = [...document.querySelectorAll('#daytable .mrow')].map(tr => {
    const tds = tr.children;
    const cells = [...tds].map(t => t.textContent.replace(/\s+/g, ' ').trim());
    return cells.join(' | ');
  });
  return rows.slice(0, 8);
});
console.log('pageErrors:', JSON.stringify(errs));
console.log(JSON.stringify(r, null, 1));
await b.close(); process.exit(0);
