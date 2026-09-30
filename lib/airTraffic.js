// Monthly air passengers for each City Events city, from the Airports Authority
// of India's "Traffic News" (free, official, published ~3-4 weeks after month end).
//
// Each month AAI posts an airport-wise passenger table as a PDF (Annexure 3) with
// three sections (international, domestic, total). We read the "total" rows,
// add up each city's airports (e.g. Mumbai + Navi Mumbai), and store the result
// in data/air-traffic.json.
//
// A month only goes live if it passes checks: every airport we need is found,
// total = international + domestic, and AAI's printed % change matches the
// numbers. A month that fails is kept in "held" for a person to review.

const fs = require("fs");
const path = require("path");
const pdf = require("pdf-parse");

const PAGE_URL = "https://www.aai.aero/en/business-opportunities/aai-traffic-news";
const DATA_PATH = path.join(__dirname, "..", "data", "air-traffic.json");
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const KEEP_MONTHS = 12;

// AAI airport names (as printed in the table) for each city.
const CITY_AIRPORTS = {
  delhi: ["DELHI (DIAL)", "NOIDA (NIAL)", "HINDON"],
  mumbai: ["MUMBAI (MIAL)", "NAVI MUMBAI (NMIAL)"],
  bengaluru: ["BENGALURU (BIAL)", "BENGALURU (HAL)"],
  hyderabad: ["HYDERABAD (GHIAL)", "HYDERABAD (BEGUMPET)"],
  chennai: ["CHENNAI"],
  kolkata: ["KOLKATA"],
  pune: ["PUNE"],
  goa: ["GOA (MOPA)", "GOA (DABOLIM)"],
  jaipur: ["JAIPUR"],
  udaipur: ["UDAIPUR"],
  ahmedabad: ["AHMEDABAD"],
  kochi: ["KOCHI"],
  lucknow: ["LUCKNOW"],
  indore: ["INDORE"],
  coimbatore: ["COIMBATORE"],
};

// Older tables use shorter names for some airports.
const AIRPORT_ALIASES = { "DELHI (DIAL)": ["DELHI"], "GOA (DABOLIM)": ["GOA"] };
// New airports only appear once they open; before that they count as zero.
const AIRPORT_SINCE = { "NOIDA (NIAL)": "2026-06" };

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.text();
}

async function fetchBuffer(url) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Finds the airport-wise passenger table (Annexure 3) for each month on AAI's page.
// File names vary ("Aug2k26Annex3.pdf", "April2k26Annex3.pdf", "Jan2k26Annex3_0.pdf").
async function listMonthlyTables() {
  const html = await fetchText(PAGE_URL);
  const found = new Map();
  const re = /href="([^"]*traffic-news\/([A-Za-z]{3})[a-z]*2k(\d\d)Annex3(?:_\d+)?\.pdf)"/gi;
  for (const m of html.matchAll(re)) {
    const month = MONTHS[m[2].toLowerCase()];
    if (!month) continue;
    const key = `20${m[3]}-${String(month).padStart(2, "0")}`;
    const url = m[1].startsWith("http") ? m[1] : `https://www.aai.aero${m[1]}`;
    if (!found.has(key)) found.set(key, url);
  }
  return [...found].map(([month, pdfUrl]) => ({ month, pdfUrl })).sort((a, b) => a.month.localeCompare(b.month));
}

// Rebuilds each table row from the PDF's text positions, so columns stay separate.
function renderRows(pageData) {
  return pageData.getTextContent().then((tc) => {
    const rows = new Map();
    for (const item of tc.items) {
      const y = Math.round(item.transform[5]);
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x: item.transform[4], s: item.str.trim() });
    }
    return [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, items]) => items.sort((a, b) => a.x - b.x).map((i) => i.s).filter(Boolean).join("\t"))
      .join("\n");
  });
}

const isNumber = (t) => /^\d+$/.test(t);
const isPct = (t) => /^-?\d+(\.\d+)?%$/.test(t) || t === "-";

// Returns { international, domestic, total } → { [airport]: { current, lastYear, pct } }.
async function parseTable(buffer) {
  const { text } = await pdf(buffer, { pagerender: renderRows });
  const sections = { international: {}, domestic: {}, total: {} };
  let section = null;
  for (const line of text.split("\n")) {
    if (/Total Passengers/i.test(line)) section = "total";
    else if (/Domestic Passengers/i.test(line)) section = "domestic";
    else if (/International Passengers/i.test(line)) section = "international";
    if (!section) continue;

    const tokens = line.split("\t");
    const tail = tokens.slice(-6);
    if (tail.length < 6 || !isNumber(tail[0]) || !isNumber(tail[1]) || !isPct(tail[2])) continue;
    // The English airport name: the ASCII tokens before the numbers, e.g. "DELHI", "(", "DIAL", ")".
    // Rows start with a serial number and the Hindi name (which can have its own
    // brackets), so the English name starts at the first capitalised English word.
    const head = tokens.slice(0, -6);
    const start = head.findIndex((t) => /^[A-Z]/.test(t));
    const name = (start < 0 ? [] : head.slice(start))
      .filter((t) => /^[\x20-\x7E]+$/.test(t))
      .join(" ")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")")
      .replace(/\s+/g, " ")
      .trim();
    if (!name) continue;
    sections[section][name] = {
      current: +tail[0],
      lastYear: +tail[1],
      pct: tail[2] === "-" ? null : parseFloat(tail[2]),
    };
  }
  return sections;
}

// Adds up each city's airports and runs the checks that decide whether the month can go live.
function buildMonth(sections, month) {
  const problems = [];
  const cities = {};
  for (const [city, airports] of Object.entries(CITY_AIRPORTS)) {
    let current = 0;
    let lastYear = 0;
    for (const a of airports) {
      const key = [a, ...(AIRPORT_ALIASES[a] || [])].find((n) => sections.total[n]);
      const t = key && sections.total[key];
      if (!t) {
        if (AIRPORT_SINCE[a] && month < AIRPORT_SINCE[a]) continue; // not open yet
        problems.push(`${a}: not found in the total passengers table`);
        continue;
      }
      const i = sections.international[key] || { current: 0, lastYear: 0 };
      const d = sections.domestic[key] || { current: 0, lastYear: 0 };
      if (i.current + d.current !== t.current) problems.push(`${a}: total ${t.current} ≠ international ${i.current} + domestic ${d.current}`);
      if (t.lastYear > 0 && t.pct !== null) {
        const calc = (t.current / t.lastYear - 1) * 100;
        if (Math.abs(calc - t.pct) > 0.15) problems.push(`${a}: printed change ${t.pct}% but figures give ${calc.toFixed(1)}%`);
      }
      current += t.current;
      lastYear += t.lastYear;
    }
    cities[city] = {
      passengers: current,
      lastYear,
      change: lastYear > 0 ? Math.round((current / lastYear - 1) * 1000) / 10 : null,
      airports,
    };
  }
  return { cities, problems };
}

function readData() {
  if (!fs.existsSync(DATA_PATH)) return { source: PAGE_URL, months: [], held: [] };
  return JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
}

// Downloads any month on AAI's page that we don't have yet.
async function refreshAirTraffic() {
  const data = readData();
  const have = new Set([...data.months, ...(data.held || [])].map((m) => m.month));
  const tables = await listMonthlyTables();
  let added = 0;
  for (const { month, pdfUrl } of tables) {
    if (have.has(month)) continue;
    try {
      const { cities, problems } = buildMonth(await parseTable(await fetchBuffer(pdfUrl)), month);
      const entry = { month, pdfUrl, cities, checkedAt: new Date().toISOString() };
      if (problems.length) {
        data.held = [...(data.held || []), { ...entry, problems }];
        console.warn(`[air] ${month} held for review: ${problems.length} problem(s)`);
      } else {
        data.months.push(entry);
        added++;
      }
    } catch (err) {
      console.warn(`[air] could not read ${month}: ${err.message}`);
    }
  }
  data.months.sort((a, b) => a.month.localeCompare(b.month));
  data.months = data.months.slice(-KEEP_MONTHS);
  data.updatedAt = new Date().toISOString();
  data.source = PAGE_URL;
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + "\n");
  if (added) console.log(`[air] added ${added} month(s); latest ${data.months[data.months.length - 1].month}`);
  return data;
}

// Hand-maintained, sourced reasons for the latest month's changes (data/air-reasons.json).
const REASONS_PATH = path.join(__dirname, "..", "data", "air-reasons.json");

function readReasons() {
  try {
    return JSON.parse(fs.readFileSync(REASONS_PATH, "utf-8"));
  } catch {
    return null;
  }
}

function getAirTraffic() {
  const { months, source, updatedAt } = readData();
  return { source, updatedAt, months, reasons: readReasons() };
}

module.exports = { getAirTraffic, refreshAirTraffic, buildMonth, CITY_AIRPORTS };

if (require.main === module) {
  refreshAirTraffic().then((d) => {
    const latest = d.months[d.months.length - 1];
    console.log("months:", d.months.map((m) => m.month).join(", "), "| held:", (d.held || []).map((m) => m.month).join(", ") || "none");
    if (latest) for (const [c, v] of Object.entries(latest.cities)) console.log(latest.month, c.padEnd(11), String(v.passengers).padStart(9), String(v.lastYear).padStart(9), v.change);
    for (const h of d.held || []) console.log("HELD", h.month, h.problems.slice(0, 5));
  });
}
