// Side-by-side performance of 2-3 stocks. Share prices aren't comparable
// (₹8 vs ₹8,000), so every series is rebased to 100 at a common start date and
// the chart shows relative performance.

const { fetchHistory } = require("./fetchStockDetail");

const COMPARE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHED = 300;
const cache = new Map(); // `${ids}:${range}` -> { data, ts }

// series: [{ entry, points: [{ date: "YYYY-MM-DD", close }] }] (points ascending by date)
function alignAndRebase(series) {
  // Start where every stock has data: the latest of the first dates.
  const startDate = series.map((s) => s.points[0].date).reduce((a, b) => (a > b ? a : b));

  const dateSet = new Set();
  for (const s of series) for (const p of s.points) if (p.date >= startDate) dateSet.add(p.date);
  const dates = [...dateSet].sort();

  return {
    dates,
    series: series.map(({ entry, points }) => {
      const closeByDate = new Map(points.map((p) => [p.date, p.close]));
      // Base = the stock's last close on or before the start date; later dates a
      // stock didn't trade on carry its previous close forward.
      let last = [...points].reverse().find((p) => p.date <= startDate).close;
      const base = last;
      const values = dates.map((d) => {
        if (closeByDate.has(d)) last = closeByDate.get(d);
        return Math.round((last / base) * 10000) / 100;
      });
      return {
        id: entry.id,
        name: entry.name,
        symbol: entry.symbol,
        values,
        changePercent: Math.round((values[values.length - 1] - 100) * 100) / 100,
      };
    }),
  };
}

async function getComparison(entries, range) {
  const key = `${entries.map((e) => e.id).join(",")}:${range}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < COMPARE_TTL_MS) return cached.data;

  const series = await Promise.all(
    entries.map(async (entry) => {
      const points = await fetchHistory(entry.symbol, range);
      if (!points.length) throw new Error(`no price history for ${entry.name}`);
      return { entry, points };
    })
  );

  const data = { range, ...alignAndRebase(series) };
  // Keeps the saved comparisons from growing without limit: the oldest goes first.
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value);
  cache.set(key, { data, ts: Date.now() });
  return data;
}

module.exports = { getComparison, alignAndRebase };
