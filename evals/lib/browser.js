// Drives headless Chrome (or Edge) over the DevTools protocol, so the evals can
// open the real app, click through it and read what is on screen. No extra
// packages: Node 22's built-in WebSocket and fetch are enough.

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const findBrowser = () => CANDIDATES.find((p) => fs.existsSync(p)) || null;

class Browser {
  constructor() {
    this.id = 0;
    this.pending = new Map();
    this.errors = []; // uncaught exceptions and console errors since the last clearErrors()
    this.failedRequests = [];
  }

  async launch(port = 9444) {
    const exe = findBrowser();
    if (!exe) throw new Error("No Chrome or Edge found (set CHROME_PATH to its location)");
    this.profile = fs.mkdtempSync(path.join(os.tmpdir(), "hi-evals-"));
    this.proc = spawn(exe, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${port}`, `--user-data-dir=${this.profile}`, "about:blank"], { stdio: "ignore" });

    let target;
    for (let i = 0; i < 60 && !target; i++) {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
        target = targets.find((t) => t.type === "page");
      } catch {
        /* not up yet */
      }
      if (!target) await sleep(250);
    }
    if (!target) throw new Error("The browser did not start");

    this.ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = () => reject(new Error("Could not connect to the browser"));
    });
    this.ws.onmessage = (e) => this.onMessage(JSON.parse(e.data));
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("Network.enable");
    await this.send("Log.enable");
    return this;
  }

  onMessage(msg) {
    if (msg.id && this.pending.has(msg.id)) {
      this.pending.get(msg.id)(msg);
      this.pending.delete(msg.id);
      return;
    }
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      this.errors.push(`${(d.exception && d.exception.description) || d.text}`.split("\n")[0]);
    } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      this.errors.push(`console.error: ${msg.params.args.map((a) => a.value || a.description || "").join(" ")}`.slice(0, 300));
    } else if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error" && /security|Content Security Policy/i.test(`${msg.params.entry.source} ${msg.params.entry.text}`)) {
      // Something the page tried to do was blocked by its own security policy.
      this.errors.push(`blocked by security policy: ${msg.params.entry.text}`.slice(0, 300));
    } else if (msg.method === "Network.responseReceived") {
      const { url, status } = msg.params.response;
      if (status >= 400) this.failedRequests.push(`${status} ${url}`);
    } else if (msg.method === "Network.loadingFailed" && !msg.params.canceled && msg.params.blockedReason !== "inspector") {
      this.failedRequests.push(`failed ${msg.params.errorText}`);
    }
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  clearErrors() {
    this.errors = [];
    this.failedRequests = [];
  }

  async setViewport(width, height) {
    await this.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 700 });
  }

  async open(url, settleMs = 2500) {
    await this.send("Page.navigate", { url });
    await sleep(settleMs);
  }

  // Runs JavaScript in the page and returns its (JSON-serialisable) result.
  // `body` is the body of an async function, so it can use await and return.
  async run(body) {
    const res = await this.send("Runtime.evaluate", { expression: `(async () => { ${body} })()`, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) {
      const d = res.exceptionDetails;
      throw new Error(`Page script failed: ${((d.exception && d.exception.description) || d.text).split("\n")[0]}`);
    }
    return res.result.value;
  }

  // Waits until `condition` (a JS expression) is true in the page.
  async waitFor(condition, timeoutMs = 15000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (await this.run(`return Boolean(${condition});`).catch(() => false)) return true;
      await sleep(200);
    }
    throw new Error(`Timed out waiting for: ${condition}`);
  }

  async clickTab(tab, settleMs = 600) {
    await this.run(`document.querySelector('.tab[data-tab="${tab}"]').click();`);
    await sleep(settleMs);
  }

  blockUrls(patterns) {
    return this.send("Network.setBlockedURLs", { urls: patterns });
  }

  async close() {
    try {
      if (this.ws) this.ws.close();
    } catch {
      /* already closed */
    }
    if (this.proc) this.proc.kill();
    await sleep(300);
    try {
      fs.rmSync(this.profile, { recursive: true, force: true });
    } catch {
      /* the browser may still hold the folder for a moment; it is only a temp folder */
    }
  }
}

module.exports = { Browser, findBrowser, sleep };
