/**
 * selftest_shot2.mjs — 新版看板自测：截图主视图/展开行/日记弹窗/自我升级
 * 用法: node tools/selftest_shot2.mjs [url]
 */
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:9000/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });

const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
console.log('== HTTP:', resp && resp.status());

// 略等入场动效结束
await page.waitForTimeout(900);

// 1. 主视图（含账态条 + 目标轨 + 表格）
const stats = await page.locator('#stats').innerText().catch(() => 'N/A');
console.log('== 账态条:\n' + stats.replace(/\n/g, ' | '));
await page.screenshot({ path: 'tools/shot-main.png', fullPage: true });

// 2. 展开第一行看详情
const firstRow = page.locator('tbody tr.mrow').first();
const rowCount = await page.locator('tbody tr.mrow').count();
console.log('== 行数:', rowCount);
if (rowCount) {
  await firstRow.click().catch(() => console.log('row click failed'));
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tools/shot-detail.png', fullPage: false });
}

// 3. 展开实单面板（点账态条）
await page.locator('#stats').click().catch(() => {});
await page.waitForTimeout(400);
await page.screenshot({ path: 'tools/shot-bets.png', fullPage: false });

// 4. 日记弹窗
await page.evaluate(() => openModal('diary'));
await page.waitForTimeout(500);
await page.screenshot({ path: 'tools/shot-diary.png', fullPage: false });

// 5. 自我升级
await page.evaluate(() => closeModal());
await page.waitForTimeout(200);
await page.evaluate(() => openModal('up'));
await page.waitForTimeout(800);
await page.screenshot({ path: 'tools/shot-upgrade.png', fullPage: false });
await page.evaluate(() => closeModal());

// 6. 移动端视图
const mpage = await browser.newPage({ viewport: { width: 390, height: 844 } });
mpage.on('pageerror', e => errors.push('MOBILE PAGEERROR: ' + e.message));
await mpage.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
await mpage.waitForTimeout(900);
await mpage.screenshot({ path: 'tools/shot-mobile.png', fullPage: false });

console.log('== Console errors:', errors.length ? errors : '无');
await browser.close();
console.log('done');