// Runs the quality checks ("evals") for Hospitality Market Intelligence and says
// whether the tool is fit to publish.
//
//   npm run evals            every suite except the slow external-link check
//   npm run evals:quick      only the checks that need no server, browser or internet
//   npm run evals:links      only the external-link check (a few minutes)
//   npm run evals:all        everything
//   npm run evals -- --only=news,app       chosen suites
//   npm run evals -- --url=https://…       check a deployed copy instead of this machine
//
// Results are printed and also written to evals/report.html and evals/report.json.
// The exit code is 1 if any blocker failed, so this can gate a deployment.

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { Recorder } = require("./lib/harness");
const { Browser, findBrowser, sleep } = require("./lib/browser");

const ROOT = path.join(__dirname, "..");
const SUITES_DIR = path.join(__dirname, "suites");
const PORT = 3199;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

function startServer(port, extraEnv = {}) {
  const proc = spawn(process.execPath, ["server.js"], { cwd: ROOT, env: { ...process.env, PORT: String(port), ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  proc.stdout.on("data", (d) => (log += d));
  proc.stderr.on("data", (d) => (log += d));
  return { proc, url: `http://localhost:${port}`, log: () => log };
}

async function waitForServer(url, timeoutMs = 60000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const res = await fetch(`${url}/api/resources`);
      if (res.ok) return;
    } catch {
      /* not listening yet */
    }
    await sleep(400);
  }
  throw new Error(`The server did not start at ${url}`);
}

// GET a path on the app and return status, headers, parsed JSON (if any) and time taken.
function makeApi(baseUrl) {
  return async (p, init) => {
    const started = Date.now();
    const res = await fetch(baseUrl + p, { redirect: "manual", ...init });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, headers: res.headers, text, json, ms: Date.now() - started };
  };
}

function loadSuites() {
  return fs
    .readdirSync(SUITES_DIR)
    .filter((f) => f.endsWith(".js"))
    .sort()
    .map((f) => require(path.join(SUITES_DIR, f)));
}

function chooseSuites(all) {
  const only = option("only");
  if (only) return all.filter((s) => only.split(",").includes(s.id));
  if (flag("links")) return all.filter((s) => s.id === "links");
  if (flag("quick")) return all.filter((s) => !(s.needs || []).length);
  if (flag("all")) return all;
  return all.filter((s) => !s.slow);
}

const LABEL = { pass: "PASS", fail: "FAIL", warn: "WARN", skip: "SKIP" };

function printSuite(suite, results) {
  console.log(`\n${suite.title}`);
  console.log(`${"-".repeat(suite.title.length)}`);
  for (const r of results) {
    const detail = r.detail ? `  ${r.status === "pass" ? "(" + r.detail + ")" : "→ " + r.detail}` : "";
    console.log(`  ${LABEL[r.status]}  ${r.name}${detail}`);
  }
}

const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function writeReports(report) {
  fs.writeFileSync(path.join(__dirname, "report.json"), JSON.stringify(report, null, 2));
  const rows = (s) =>
    s.results
      .map((r) => `<tr class="${r.status}"><td class="st">${LABEL[r.status]}</td><td>${escapeHtml(r.name)}${r.detail ? `<div class="detail">${escapeHtml(r.detail)}</div>` : ""}</td></tr>`)
      .join("");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Evals report</title>
<style>
  body { margin: 0; font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; background: #fff6ea; color: #1c1c1c; }
  header { background: #ffc72c; padding: 18px 24px; }
  h1 { margin: 0; font-size: 22px; }
  header p { margin: 4px 0 0; font-size: 14px; }
  main { max-width: 980px; margin: 0 auto; padding: 20px 16px 48px; }
  .verdict { font-size: 20px; font-weight: 700; padding: 14px 18px; border-radius: 14px; margin-bottom: 8px; }
  .verdict.ok { background: #e6f4ea; color: #14683a; } .verdict.no { background: #fdecea; color: #a52a22; }
  .totals { font-size: 14px; color: #6b6359; font-weight: 600; margin-bottom: 20px; }
  section { background: #fff; border: 1px solid #f1e2cf; border-radius: 16px; padding: 16px 18px; margin-bottom: 16px; }
  h2 { margin: 0; font-size: 18px; } .about { margin: 2px 0 10px; font-size: 13px; color: #6b6359; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  td { padding: 7px 8px; border-top: 1px solid #f1e2cf; vertical-align: top; }
  .st { width: 52px; font-weight: 700; font-size: 12px; }
  .pass .st { color: #1b8a4a; } .fail .st { color: #d1403a; } .warn .st { color: #b8450a; } .skip .st { color: #6b6359; }
  .fail td { background: #fff5f4; } .warn td { background: #fff8ef; }
  .detail { font-size: 12px; color: #6b6359; margin-top: 2px; word-break: break-word; }
</style></head><body>
<header><h1>Hospitality Market Intelligence: evals report</h1><p>Run on ${escapeHtml(report.ranAt)} against ${escapeHtml(report.target)}</p></header>
<main>
  <div class="verdict ${report.totals.fail ? "no" : "ok"}">${report.totals.fail ? `Not ready to publish: ${report.totals.fail} blocker${report.totals.fail === 1 ? "" : "s"} failed` : "Ready to publish: no blockers failed"}</div>
  <div class="totals">${report.totals.pass} passed · ${report.totals.fail} failed · ${report.totals.warn} warnings · ${report.totals.skip} skipped · ${Math.round(report.seconds)} seconds</div>
  ${report.suites.map((s) => `<section><h2>${escapeHtml(s.title)}</h2><p class="about">${escapeHtml(s.about)}</p><table>${rows(s)}</table></section>`).join("")}
</main></body></html>`;
  fs.writeFileSync(path.join(__dirname, "report.html"), html);
}

async function main() {
  const started = Date.now();
  const suites = chooseSuites(loadSuites());
  if (!suites.length) {
    console.error("No suites match. Available: " + loadSuites().map((s) => s.id).join(", "));
    process.exit(2);
  }
  const needs = (what) => suites.some((s) => (s.needs || []).includes(what));
  const remoteUrl = option("url");

  let server = null;
  let browser = null;
  const ctx = { root: ROOT, remote: Boolean(remoteUrl), baseUrl: null, api: null, startServer, waitForServer, makeApi, sleep };

  try {
    if (needs("server")) {
      if (remoteUrl) {
        ctx.baseUrl = remoteUrl.replace(/\/$/, "");
      } else {
        console.log("Starting a private copy of the server for the checks…");
        server = startServer(PORT);
        ctx.baseUrl = server.url;
        await waitForServer(server.url);
      }
      ctx.api = makeApi(ctx.baseUrl);
    }
    ctx.getBrowser = async () => {
      if (browser) return browser;
      if (!findBrowser()) return null;
      browser = await new Browser().launch();
      return browser;
    };

    const report = { ranAt: new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }), target: remoteUrl || "this machine", suites: [], totals: { pass: 0, fail: 0, warn: 0, skip: 0 } };
    for (const suite of suites) {
      const t = new Recorder();
      try {
        await suite.run(t, ctx);
      } catch (err) {
        t.results.push({ name: "The suite itself crashed", status: "fail", detail: String(err.stack || err).split("\n").slice(0, 3).join(" "), ms: 0 });
      }
      for (const r of t.results) report.totals[r.status]++;
      report.suites.push({ id: suite.id, title: suite.title, about: suite.about, results: t.results });
      printSuite(suite, t.results);
    }

    report.seconds = (Date.now() - started) / 1000;
    writeReports(report);
    const { pass, fail, warn, skip } = report.totals;
    console.log(`\n${"=".repeat(64)}`);
    console.log(`${pass} passed, ${fail} failed, ${warn} warnings, ${skip} skipped in ${Math.round(report.seconds)}s`);
    console.log(fail ? `NOT READY TO PUBLISH: ${fail} blocker${fail === 1 ? "" : "s"} failed.` : "READY TO PUBLISH: no blockers failed.");
    console.log(`Full report: ${path.join("evals", "report.html")}`);
    process.exitCode = fail ? 1 : 0;
  } finally {
    if (browser) await browser.close();
    if (server) server.proc.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
