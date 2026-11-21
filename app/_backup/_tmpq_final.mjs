import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe' });
const pg = await b.newPage();
const errs = [];
pg.on('pageerror', e => errs.push(e.message));
await pg.goto('http://localhost:9000/', { waitUntil: 'networkidle' });
await pg.waitForTimeout(3000);
const r = await pg.evaluate(() => {
  const chips = [...document.querySelectorAll('#daychips .chip')].map(c => c.textContent.replace(/\s+/g, ' ').trim());
  const rows = document.querySelectorAll('#daytable .mrow');
  return {
    chips,
    rows: rows.length,
    firstRow: rows[0] ? rows[0].textContent.replace(/\s+/g, ' ').trim() : null,
    daystat: (document.querySelector('#daystat')?.textContent || '').replace(/\s+/g, ' ').trim(),
  };
});
console.log('pageErrors:', JSON.stringify(errs));
console.log(JSON.stringify(r, null, 1));
await b.close(); process.exit(0);
