import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe' });
const pg = await b.newPage();
await pg.goto('http://localhost:9000/', { waitUntil: 'networkidle' });
await pg.waitForTimeout(6000);
const r = await pg.evaluate(() => {
  const q = s => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim().slice(0, 300) : null; };
  return { stats: q('#stats'), betstop: q('#betstop'), goalpct: q('#goalpct') };
});
console.log(JSON.stringify(r, null, 1));
await b.close();
process.exit(0);
