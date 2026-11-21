/**
 * selftest_playwright.mjs — 用 playwright 自测账单/日记页面
 * 用法: node tools/selftest_playwright.mjs [url]
 */
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://139.196.51.10:9000/';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

// 收集 console 错误
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
console.log('== HTTP 状态:', resp && resp.status());

// 页面标题
console.log('== 标题:', await page.title());

// 左侧账单
const bill = await page.locator('#bill').innerText().catch(() => 'N/A');
console.log('== 账单卡片:\n' + bill);

// 日历
const ym = await page.locator('#cal-ym').innerText().catch(() => 'N/A');
console.log('== 日历:', ym);

// 日记区
const diary = await page.locator('#diary').innerText().catch(() => 'N/A');
console.log('== 日记区:\n' + diary.slice(0, 800));

// 截图
await page.screenshot({ path: 'tools/selftest_shot.png', fullPage: false });
console.log('== 截图已保存 tools/selftest_shot.png');

console.log('== Console errors:', errors.length ? errors : '无');

await browser.close();
