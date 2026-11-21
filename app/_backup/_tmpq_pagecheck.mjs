// 渲染 09-06 页面，检查赛果列 007/017/018 的显示
import { chromium } from 'playwright';
const exe = 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const b = await chromium.launch({ executablePath: exe, headless: true });
const p = await b.newPage();
await p.goto('http://127.0.0.1:9000/', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
// 切到 09-06（点 chip，onclick=goDay('2026-09-06', true)）
await p.evaluate(() => {
  const chips = [...document.querySelectorAll('#daychips .chip')];
  const target = chips.find(c => c.textContent.includes('09/06'));
  if (target) target.click();
});
await p.waitForTimeout(2500);
const rows = await p.$$eval('#daytable tr.mrow', trs => trs.map(tr => {
  const num = tr.dataset.num || tr.querySelector('td')?.textContent?.trim() || '';
  const tds = [...tr.querySelectorAll('td')].map(td => td.textContent.trim().replace(/\s+/g, ' '));
  const last = tds[tds.length - 1];
  return { num, last, cells: tds.slice(0, 5) };
}));
for (const r of rows) {
  const n = r.num.replace(/^周[六日一二三四五]/, '');
  if (+n === 7 || +n === 17 || +n === 18 || +n === 24) console.log(r.num, '| 赛果列:', r.last, '|', JSON.stringify(r.cells));
}
await b.close();
console.log('--- done ---');