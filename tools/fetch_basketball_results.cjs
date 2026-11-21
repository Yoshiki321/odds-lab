/**
 * fetch_basketball_results.cjs — 补抓竞彩篮球历史赛果（只读，不碰账本/订单）
 * 用法: node tools/fetch_basketball_results.cjs 2026-08-30 2026-11-20
 * 写 data/history/basketball/<date>.json，格式与旧文件一致 {date,count,matches}
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DIR = path.join(ROOT, "data", "history", "basketball");
const H = {
  referer: "https://www.sporttery.cn/jc/zqsgkj/",
  accept: "application/json, text/javascript, */*; q=0.01",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0",
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchDay(day) {
  const all = [];
  for (let page = 1; page <= 5; page++) {
    const url = `https://webapi.sporttery.cn/gateway/uniform/basketball/getUniformMatchResultV1.qry?matchBeginDate=${day}&matchEndDate=${day}&pageSize=50&pageNo=${page}&isFix=0&matchPage=1&pcOrWap=1`;
    const j = await (await fetch(url, { headers: H })).json();
    if (j.errorCode !== "0") throw new Error(`errorCode=${j.errorCode} ${j.errorMessage || ""}`);
    const arr = (j.value && j.value.matchResult) || [];
    all.push(...arr);
    if (arr.length < 50) break;
    await sleep(400);
  }
  return all;
}

(async () => {
  const from = process.argv[2] || "2026-08-30";
  const to = process.argv[3] || "2026-11-20";
  const d0 = new Date(from + "T00:00:00Z");
  const d1 = new Date(to + "T00:00:00Z");
  fs.mkdirSync(DIR, { recursive: true });
  let wrote = 0, total = 0, skipped = 0;
  for (let d = new Date(d0); d <= d1; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    const file = path.join(DIR, day + ".json");
    if (fs.existsSync(file)) { skipped++; continue; }
    try {
      const rows = await fetchDay(day);
      fs.writeFileSync(file, JSON.stringify({ date: day, count: rows.length, matches: rows }, null, 2), "utf8");
      wrote++; total += rows.length;
      process.stdout.write(`${day} ${rows.length}\n`);
    } catch (e) {
      process.stderr.write(`${day} ERR ${e.message}\n`);
    }
    await sleep(450);
  }
  process.stdout.write(`done wrote=${wrote} matches=${total} skipped=${skipped}\n`);
})().catch((e) => { console.error("FATAL " + e.message); process.exit(1); });
