// The small test harness behind `npm run evals`.
//
// A suite is a file in evals/suites that exports { id, title, about, needs, run }.
// Inside run(t, ctx) it calls:
//   t.check(name, fn)  - a blocker: if fn throws, the tool is not fit to publish
//   t.warn(name, fn)   - needs a look, but does not block publishing
//   t.skip(name, why)  - could not be run this time (e.g. no browser installed)
// fn may return a short string, shown next to a passing check.

class Recorder {
  constructor() {
    this.results = [];
  }

  async check(name, fn, level = "fail") {
    const started = Date.now();
    try {
      const detail = await fn();
      this.results.push({ name, status: "pass", detail: typeof detail === "string" ? detail : "", ms: Date.now() - started });
    } catch (err) {
      this.results.push({ name, status: level, detail: String((err && err.message) || err), ms: Date.now() - started });
    }
  }

  warn(name, fn) {
    return this.check(name, fn, "warn");
  }

  skip(name, why) {
    this.results.push({ name, status: "skip", detail: why, ms: 0 });
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function expectEqual(actual, expected, what) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`);
}

// For checks that run over many items: pass the list of problems found.
// An empty list passes; otherwise the first few are shown.
function expectNone(problems, max = 6) {
  if (!problems.length) return;
  const shown = problems.slice(0, max).join(" | ");
  throw new Error(`${problems.length} problem${problems.length === 1 ? "" : "s"}: ${shown}${problems.length > max ? " | …" : ""}`);
}

module.exports = { Recorder, expect, expectEqual, expectNone };
