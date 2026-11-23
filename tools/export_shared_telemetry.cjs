/**
 * export_shared_telemetry.cjs — 每日脱敏采集数据导出 + 推送到 data/daily-sync
 *
 * 安全红线（提交前逐条核验，命中即中止）：
 *  - 禁止 app/config/db.json、*credentials*、ledger*、decisions/、runtime/、snapshots/_log.jsonl
 *  - 禁止 token/cookie/password/checkid/x-api-/真实订单号/余额字段
 *
 * 用法: node tools/export_shared_telemetry.cjs
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");

process.on("uncaughtException", (e) => {
  console.error("ERR " + String(e.stderr || e.message || e).slice(0, 400));
  process.exit(1);
});

const ROOT = path.resolve(__dirname, "..");
const EXP = path.join(ROOT, "data", "experiment_survival_100");
const SNAP = path.join(EXP, "snapshots");
const SHARED = path.join(ROOT, "data", "shared_telemetry");
const WORKTREE = path.resolve(ROOT, "..", "odds-lab-data-sync");
const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

function run(cmd, opts = {}) {
  return cp.execSync(cmd, { cwd: opts.cwd || ROOT, encoding: "utf8", stdio: opts.stdio || "pipe", timeout: opts.timeout || 120000 });
}
function log(msg) { console.log(msg); }
function copy(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

// ---------- 1. 生成脱敏摘要 ----------
fs.mkdirSync(SHARED, { recursive: true });
const st = JSON.parse(fs.readFileSync(path.join(SNAP, "_state.json"), "utf8"));
const sanitizeOdds = (o) => {
  if (!o || typeof o !== "object") return null;
  const out = { h: o.h, d: o.d, a: o.a };
  if (o.ah && typeof o.ah === "object") out.ah = { line: o.ah.line, h: o.ah.h, a: o.ah.a };
  if (o.ou && typeof o.ou === "object") out.ou = { line: o.ou.line, over: o.ou.over, under: o.ou.under };
  return out;
};
const sanitizeMap = (m) => Object.fromEntries(Object.entries(m || {}).map(([mid, v]) => {
  const x = v && typeof v === "object" ? v : {};
  return [mid, { at: x.at, endBJ: x.endBJ, endMs: x.endMs, window: x.window, odds: sanitizeOdds(x.odds) }];
}));
const summary = {
  generatedAt: new Date().toISOString(),
  dateBJ: today,
  source: "snapshots/_state.json",
  heartbeat: st.heartbeat || null,
  authError: st.authError ? { at: st.authError.at, code: st.authError.code, msg: st.authError.msg } : null,
  counts: {
    mainOk: Object.keys(st.mainOk || {}).length,
    auxOk: Object.keys(st.auxOk || {}).length,
    closingOk: Object.keys(st.closingOk || {}).length,
    missing: Object.keys(st.missing || {}).length,
  },
  mainOk: sanitizeMap(st.mainOk),
  auxOk: sanitizeMap(st.auxOk),
  closingOk: sanitizeMap(st.closingOk),
  missing: st.missing || {},
  note: "脱敏摘要：仅含赛事、时间、赔率、缺失与健康状态；不含会话凭据、本地路径、账本、余额或真实订单号",
};
fs.writeFileSync(path.join(SHARED, "latest_state_summary.json"), JSON.stringify(summary, null, 2), "utf8");
for (const f of ["HEALTH.md", "SIGNAL.md"]) {
  const p = path.join(SNAP, f);
  if (fs.existsSync(p)) copy(p, path.join(SHARED, f));
}

// ---------- 2. weekly audit ----------
let pairs = "0";
try {
  const out = run(`"${process.execPath}" tools/weekly_audit.cjs`);
  const m = /pairs=(\d+)/.exec(out);
  if (m) pairs = m[1];
  const rep = path.join(EXP, "reports", `weekly_audit_${today}.md`);
  if (fs.existsSync(rep)) copy(rep, path.join(SHARED, `weekly_audit_${today}.md`));
  log(`weekly_audit pairs=${pairs}`);
} catch (e) {
  log("weekly_audit_failed " + String(e.stdout || e.message).slice(0, 120));
}

// ---------- 3. 复制当日 inplay / sweep / simulation ----------
const inplaySrc = path.join(EXP, "inplay");
const sweepSrc = path.join(EXP, "sweep");
const inplayDst = path.join(SHARED, "inplay");
const sweepDst = path.join(SHARED, "sweep");
if (fs.existsSync(inplaySrc)) {
  for (const f of fs.readdirSync(inplaySrc)) if (f.startsWith(today) && f.endsWith(".json")) copy(path.join(inplaySrc, f), path.join(inplayDst, f));
}
if (fs.existsSync(sweepSrc)) {
  for (const f of fs.readdirSync(sweepSrc)) if (f.startsWith(`planApi_${today}`) && f.endsWith(".json")) copy(path.join(sweepSrc, f), path.join(sweepDst, f));
}
const simSrc = path.join(EXP, "simulation.json");
if (fs.existsSync(simSrc)) copy(simSrc, path.join(SHARED, "simulation.json"));
fs.writeFileSync(path.join(SHARED, "manifest.json"), JSON.stringify({ generatedAt: new Date().toISOString(), dateBJ: today, pairs: Number(pairs), counts: summary.counts, note: "脱敏共享数据清单" }, null, 2), "utf8");
log("step: shared built");

// ---------- 4. 准备 data/daily-sync worktree ----------
run("git fetch origin --prune");
log("step: worktree setup");
let wtExists = fs.existsSync(WORKTREE);
if (!wtExists) {
  const remote = run("git ls-remote --heads origin data/daily-sync").trim();
  if (remote) {
    run(`git worktree add "${WORKTREE}" data/daily-sync`);
    wtExists = true;
  } else {
    run(`git worktree add -b data/daily-sync "${WORKTREE}" origin/main`);
    wtExists = true;
  }
}
if (wtExists) {
  run("git fetch origin --prune", { cwd: WORKTREE });
  run("git checkout data/daily-sync", { cwd: WORKTREE });
  // 先对齐远端数据分支，避免 non-fast-forward；没有远端分支时回退到 origin/main
  try {
    run("git reset --hard origin/data/daily-sync", { cwd: WORKTREE });
  } catch {
    run("git reset --hard origin/main", { cwd: WORKTREE });
  }
  run("git clean -fd", { cwd: WORKTREE });
}

// ---------- 5. 复制到 worktree ----------
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}
const dstShared = path.join(WORKTREE, "data", "shared_telemetry");
fs.mkdirSync(dstShared, { recursive: true });
copyDir(SHARED, dstShared);
log("step: worktree files copied");

const dstExp = path.join(WORKTREE, "data", "experiment_survival_100");
fs.mkdirSync(path.join(dstExp, "inplay"), { recursive: true });
fs.mkdirSync(path.join(dstExp, "sweep"), { recursive: true });
if (fs.existsSync(inplayDst)) for (const f of fs.readdirSync(inplayDst)) copy(path.join(inplayDst, f), path.join(dstExp, "inplay", f));
if (fs.existsSync(sweepDst)) for (const f of fs.readdirSync(sweepDst)) copy(path.join(sweepDst, f), path.join(dstExp, "sweep", f));
if (fs.existsSync(simSrc)) copy(simSrc, path.join(dstExp, "simulation.json"));

// ---------- 6. 安全核验 ----------
log("step: staging");
run("git add -A", { cwd: WORKTREE });
const files = run("git diff --cached --name-only", { cwd: WORKTREE }).split(/\r?\n/).filter(Boolean);
const badPaths = files.filter((f) => /(^|\/)(app\/config\/db\.json|.*credentials.*|ledger.*\.json|decisions\/|runtime\/|snapshots\/_log\.jsonl)/i.test(f) || /\.edge-auto|node_modules/.test(f));
if (badPaths.length) { run("git reset", { cwd: WORKTREE }); console.error("ABORT bad paths: " + badPaths.join(", ")); process.exit(2); }
const badContent = [];
for (const f of files) {
  let txt = "";
  try { txt = fs.readFileSync(path.join(WORKTREE, f), "utf8"); } catch { continue; }
  if (/(api_credentials|checkid|x-api-|cookie|password|sportWallet|ledger_user_orders|app\/config\/db\.json)/i.test(txt) ||
      /"platformOrderId"\s*:\s*"?[1-9]/.test(txt) || /"orderNo"\s*:\s*"\d/.test(txt) || /"betNo"\s*:\s*"\d/.test(txt)) {
    badContent.push(f);
  }
}
if (badContent.length) { run("git reset", { cwd: WORKTREE }); console.error("ABORT sensitive content: " + badContent.join(", ")); process.exit(2); }

// ---------- 7. 提交并推送 ----------
log("step: scan ok");
const changed = run("git status --porcelain", { cwd: WORKTREE }).trim();
if (!changed) { log("no changes to commit"); process.exit(0); }
run('git commit -m "data: 每日脱敏采集快照与 CLV 汇总 (' + today + ')"', { cwd: WORKTREE });
run("git push origin data/daily-sync", { cwd: WORKTREE });
const sha = run("git rev-parse --short HEAD", { cwd: WORKTREE }).trim();
log(JSON.stringify({ ok: true, branch: "data/daily-sync", commit: sha, date: today, pairs: Number(pairs), counts: summary.counts }, null, 1));
