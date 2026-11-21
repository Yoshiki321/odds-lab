/**
 * tools/okooo_jingcai.js — 从 okooo 竞彩页面获取当日比赛列表与 matchId 映射
 *
 * 用法:
 *   node tools/okooo_jingcai.js                    # 抓当日竞彩列表
 *   node tools/okooo_jingcai.js --force            # 强制刷新
 *
 * 输出示例:
 *   001 K联赛 18:30 大田市民 vs 蔚山现代 | 竞彩2.09/3.30/2.88 | 让球-1 4.40/3.80/1.57 | okooo匹配1320399
 */

import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE_DIR = join(ROOT, 'data', 'okooo_cache');

if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });

const CACHE_FILE = join(CACHE_DIR, 'jingcai_list.json');

function readCache() {
  if (existsSync(CACHE_FILE)) return JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
  return null;
}

function writeCache(data) {
  writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * 从 okooo 竞彩页面抓取比赛列表
 * @param {boolean} force - 强制刷新
 * @returns {Object} { fetchedAt, matches: [{ num, league, time, homeTeam, awayTeam, homeRank, awayRank, oddsH, oddsD, oddsA, rq, rqOddsH, rqOddsD, rqOddsA, matchId }] }
 */
export async function scrapeJingcaiList(force = false) {
  if (!force) {
    const cached = readCache();
    if (cached) return cached;
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  try {
    await page.goto('https://www.okooo.com/jingcai/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // 获取所有比赛容器
    const matches = await page.evaluate(() => {
      const containers = document.querySelectorAll('div.touzhu_1[data-mid]');
      const result = [];

      containers.forEach(div => {
        const mid = div.getAttribute('data-mid');
        const hname = div.getAttribute('data-hname') || '';
        const aname = div.getAttribute('data-aname') || '';
        const order = div.getAttribute('data-ordercn') || '';
        const rq = div.getAttribute('data-rq') || '0';
        const filterdata = div.getAttribute('filterdata') || '';

        // 联赛和时间
        const liansai = div.querySelector('.liansai');
        const homeDiv = div.querySelector('.touzhu_1homeinfo, .qhboxhDiv1, [class*="home"]');
        const league = liansai?.querySelector('.saiming')?.innerText?.trim() || '';
        const time = liansai?.querySelector('.touzhu_1time, span')?.innerText?.trim() || '';

        // 提取文本并解析赔率
        const inner = div.innerText;

        // 主队和客队区域
        // 竞彩胜平负赔率: 找 主赔率 平赔率 客赔率 的匹配
        // 结构: [主队] [主赔] [平赔] [客赔] [客队]
        // 用 data-hname / data-aname 定位更精确
        const homePos = inner.indexOf(hname);
        const awayPos = inner.indexOf(aname);

        // 从表格内联文本解析
        // 让球赔率单独标注（如 -1 4.40 3.80 1.57）
        const rqLine = inner.match(/([+-]?\d+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
        let rqGoal = rqLine?.[1] || '', rqH = rqLine?.[2], rqD = rqLine?.[3], rqA = rqLine?.[4];

        // 非让球的胜平负赔率（在让球赔率前后）
        // 主队和客队之间的数字
        let oddsH, oddsD, oddsA;
        if (homePos >= 0 && awayPos >= 0 && homePos < awayPos) {
          const middle = inner.substring(homePos + hname.length, awayPos);
          const nums = middle.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
          if (nums) {
            oddsH = parseFloat(nums[1]);
            oddsD = parseFloat(nums[2]);
            oddsA = parseFloat(nums[3]);
          }
        }

        // 生成盘口标签
        const rqLabel = rqGoal || rq || '';
        const rqNum = parseInt(rqLabel);
        let rqText = '';
        if (!isNaN(rqNum)) {
          if (rqNum > 0) {
            const names = ['平手/半球','半球','半球/一球','一球','一球/球半','球半','球半/两球','两球'];
            rqText = rqNum <= 8 ? '受' + names[rqNum-1] : '受' + rqNum + '球';
          } else if (rqNum < 0) {
            const n = -rqNum;
            const names = ['平手/半球','半球','半球/一球','一球','一球/球半','球半','球半/两球','两球'];
            rqText = n <= 8 ? names[n-1] : rqNum + '球';
          }
        }
        // 简化: 直接存数字
        const rqLabelSimple = rqLabel === '' ? '平手' : rqLabel;

        result.push({
          num: order.replace(/^[周周一二三四五六日]+\s*/, ''),
          order,
          league,
          time,
          homeTeam: hname,
          awayTeam: aname,
          homeRank: div.getAttribute('data-hrank') || '',
          awayRank: div.getAttribute('data-arank') || '',
          oddsH,
          oddsD,
          oddsA,
          rq: rqGoal || rq,
          rqLabel: rqLabelSimple,
          rqOddsH: rqH ? parseFloat(rqH) : null,
          rqOddsD: rqD ? parseFloat(rqD) : null,
          rqOddsA: rqA ? parseFloat(rqA) : null,
          matchId: mid,
          single: filterdata.includes('单关') ? 1 : 0
        });
      });

      return result;
    });

    const data = {
      fetchedAt: new Date().toISOString(),
      count: matches.length,
      matches
    };

    writeCache(data);
    await browser.close();
    return data;

  } catch (e) {
    await browser.close();
    throw new Error(`抓取竞彩列表失败: ${e.message}`);
  }
}

// ----- CLI -----
const cliPath = process.argv[1]?.replace(/\\/g, '/').split('/').pop();
if (process.argv[1] && import.meta.url.replace(/\\/g, '/').endsWith(cliPath)) {
  scrapeJingcaiList(process.argv.includes('--force'))
    .then(d => {
      console.log(`\n=== 竞彩列表 (${d.count}场) ===`);
      d.matches.forEach(m => {
        console.log(`${m.num} ${m.league} ${m.time} ${m.homeTeam} ${m.oddsH}/${m.oddsD}/${m.oddsA} vs ${m.awayTeam} | 让球${m.rq} ${m.rqOddsH}/${m.rqOddsD}/${m.rqOddsA} | okooo:${m.matchId}${m.single ? ' 单关' : ''}`);
      });
    })
    .catch(e => console.error(e.message));
}