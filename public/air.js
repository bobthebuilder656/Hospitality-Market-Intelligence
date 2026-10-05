// Helpers for monthly air passengers per city (AAI data, data/air-traffic.json),
// used by the City Events tab.

const AIR_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const AIR_MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const AIR_BAR = "#2563a8"; // one series, one hue (checked for contrast)

let airData = null;
let airLoading = null;

function loadAirTraffic() {
  if (!airLoading) {
    airLoading = getData("air-traffic.json")
      .then((d) => (airData = d && d.months && d.months.length ? d : null))
      .catch(() => null);
  }
  return airLoading;
}

const airMonthName = (key, long = false) => `${(long ? AIR_MONTHS_LONG : AIR_MONTHS)[+key.slice(5, 7) - 1]} ${key.slice(0, 4)}`;
const airLatest = () => airData.months[airData.months.length - 1];

// 7,29,079 → "7.3 lakh"; 61,68,022 → "61.7 lakh"
function airLakh(n) {
  return `${(n / 100000).toLocaleString("en-IN", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} lakh`;
}

function airChange(change) {
  if (change === null || change === undefined) return `<span class="air-change">new</span>`;
  const dir = change > 0 ? "up" : change < 0 ? "down" : "flat";
  const arrow = change > 0 ? "▲" : change < 0 ? "▼" : "▬";
  return `<span class="air-change ${dir}">${arrow} ${Math.abs(change).toLocaleString("en-IN")}%</span>`;
}

// Tiny column chart of the months we have, for one city. Hover a column for its value.
function airSparkline(cityId) {
  const months = airData.months;
  const values = months.map((m) => m.cities[cityId].passengers);
  const max = Math.max(...values);
  const W = 8 * months.length + 2 * (months.length - 1);
  const H = 22;
  const bars = months
    .map((m, i) => {
      const h = Math.max(2, Math.round((H * values[i]) / max));
      const x = i * 10;
      return `<rect x="${x}" y="${H - h}" width="8" height="${h}" rx="1.5" fill="${AIR_BAR}"><title>${airMonthName(m.month)}: ${airLakh(values[i])}</title></rect>`;
    })
    .join("");
  const first = airMonthName(months[0].month);
  const last = airMonthName(months[months.length - 1].month);
  return `<svg class="air-spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Monthly air passengers, ${first} to ${last}">${bars}</svg>`;
}

// 2-3 plain sentences comparing the latest month with the same month last year.
function airSummary(cityName) {
  const latest = airLatest();
  const rows = Object.entries(latest.cities).filter(([, v]) => v.change !== null);
  const up = rows.filter(([, v]) => v.change > 0).sort((a, b) => b[1].change - a[1].change);
  const down = rows.filter(([, v]) => v.change < 0).sort((a, b) => a[1].change - b[1].change);
  const list = (items) => items.slice(0, 3).map(([id, v]) => `${cityName(id)} (${v.change > 0 ? "+" : "−"}${Math.abs(v.change)}%)`).join(", ");
  const total = rows.reduce((s, [, v]) => s + v.passengers, 0);
  const totalLast = rows.reduce((s, [, v]) => s + v.lastYear, 0);
  const totalChange = Math.round((total / totalLast - 1) * 1000) / 10;
  const month = airMonthName(latest.month, true);
  const sentences = [
    `In ${month}, airports in ${up.length} of our ${rows.length} cities handled more passengers than a year earlier, and ${down.length} handled fewer.`,
    `${up.length ? `Biggest rises: ${list(up)}.` : ""} ${down.length ? `Biggest falls: ${list(down)}.` : ""}`.trim(),
    `Together these cities' airports handled ${(total / 10000000).toLocaleString("en-IN", { maximumFractionDigits: 2 })} crore passengers, ${totalChange >= 0 ? "up" : "down"} ${Math.abs(totalChange)}% on ${month.replace(/\d{4}$/, (y) => y - 1)}.`,
  ];
  return sentences;
}

// All our cities together for one month: % change on the same month last year.
function airTotalChange(month) {
  const rows = Object.values(month.cities).filter((v) => v.change !== null);
  const total = rows.reduce((s, v) => s + v.passengers, 0);
  const totalLast = rows.reduce((s, v) => s + v.lastYear, 0);
  return Math.round((total / totalLast - 1) * 1000) / 10;
}

const airPct = (n) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}%`;

// Briefing points for one city, as [label, text] pairs: size of the year-on-year
// change, whether it is part of a trend, how it compares with the other cities,
// and what it implies commercially.
function airCityMeaning(cityId) {
  const latest = airLatest();
  const v = latest.cities[cityId];
  if (v.change === null) return [];
  const c = v.change;
  const month = airMonthName(latest.month, true);
  const level = c >= 5 ? "Strong growth" : c > 0 ? "Modest growth" : c === 0 ? "Flat" : c > -5 ? "Modest decline" : "Sharp decline";

  const trend = airTrend(airData.months.map((m) => m.cities[cityId]).filter((x) => x && x.change !== null).map((x) => x.change));

  const avg = airTotalChange(latest);
  const cities = Object.values(latest.cities).filter((x) => x.change !== null).length;
  const peers = Math.abs(c - avg) < 2
    ? `In line with the ${cities} cities combined (${airPct(avg)}).`
    : `${c > avg ? "Outperforming" : "Underperforming"} the ${cities} cities combined (${airPct(avg)}).`;

  const implication =
    c >= 5 ? "Rising fly-in demand supports firmer rates; limit discounting on peak dates."
    : c > -5 ? "Fly-in demand is stable; last year's pace and pricing remain a reliable benchmark."
    : "Softer fly-in demand; expect rate pressure. Prioritise corporate, MICE, wedding and drive-in segments.";

  const why = airReason(cityId, c);
  return [
    ["Performance", `${level}: ${airPct(c)} year on year in ${month}.`],
    ["Trend", trend],
    ["Vs. peers", peers],
    why && ["Why", why.text, why.sources],
    ["Implication", implication],
  ].filter(Boolean);
}

// The trend sentence for a run of monthly year-on-year changes (oldest first).
// It states two things the figures support: how long the latest direction has
// lasted, and how many months of the period were up. It used to call a fall "an
// exception" or "sustained" from the month count alone, which contradicted the
// figures when the most recent months had turned.
function airTrend(changes) {
  const n = changes.length;
  const span = airSpan();
  const up = changes.filter((c) => c > 0).length;
  const down = changes.filter((c) => c < 0).length;
  if (up === n) return `Higher than a year earlier in every month, ${span}: sustained growth.`;
  if (down === n) return `Lower than a year earlier in every month, ${span}: sustained decline.`;

  const sign = Math.sign(changes[n - 1]);
  let streak = 0;
  for (let i = n - 1; i >= 0 && Math.sign(changes[i]) === sign; i--) streak++;
  const recent =
    sign === 0 ? "Level with a year earlier in the latest month"
    : `${sign > 0 ? "Higher" : "Lower"} than a year earlier for the last ${streak === 1 ? "month" : `${streak} months`}`;
  return `${recent}; higher in ${up} of ${n} months, ${span}.`;
}

// "Jan–Aug 2026": the months the trend is counted over.
function airSpan() {
  const first = airData.months[0].month;
  const last = airLatest().month;
  const short = (key) => AIR_MONTHS[+key.slice(5, 7) - 1];
  return first.slice(0, 4) === last.slice(0, 4) ? `${short(first)}–${short(last)} ${last.slice(0, 4)}` : `${airMonthName(first)} – ${airMonthName(last)}`;
}

// The sourced reason for a city's latest change (data/air-reasons.json), or null.
// Reasons are only used for the month they were researched for; a city with no
// city-specific source gets the national driver, labelled as such. Near-flat
// changes (under 2%) need no explanation.
function airReason(cityId, change) {
  const r = airData.reasons;
  if (!r || r.month !== airLatest().month || Math.abs(change) < 2) return null;
  const city = r.cities[cityId];
  if (!city) return { text: "No specific cause reported in published sources yet.", sources: [] };
  if (city.basis === "national") return { text: `National factor: ${r.national.text}`, sources: r.national.sources };
  return city;
}

// Briefing points for all cities together, as [label, text] pairs.
function airOverallMeaning(cityName) {
  const latest = airLatest();
  const avg = airTotalChange(latest);
  const n = airData.months.length;
  const monthsDown = airData.months.filter((m) => airTotalChange(m) < 0).length;
  const rows = Object.entries(latest.cities).filter(([, v]) => v.change !== null);
  const names = (list) => list.map(([id]) => cityName(id)).join(", ");
  const growing = rows.filter(([, v]) => v.change >= 5).sort((a, b) => b[1].change - a[1].change);
  const falling = rows.filter(([, v]) => v.change <= -5).sort((a, b) => a[1].change - b[1].change);
  const span = airSpan();
  const trend =
    monthsDown === 0 ? `Higher than a year earlier in every month, ${span}: sustained growth.`
    : monthsDown === n ? `Lower than a year earlier in every month, ${span}: sustained decline.`
    : monthsDown * 2 > n ? `Lower than a year earlier in ${monthsDown} of ${n} months, ${span}: a sustained slowdown.`
    : monthsDown * 2 === n ? `Higher than a year earlier in ${n - monthsDown} of ${n} months, ${span}: no clear direction.`
    : `Higher than a year earlier in ${n - monthsDown} of ${n} months, ${span}: growth is holding.`;
  const r = airData.reasons;
  const why = r && r.month === latest.month && r.all ? ["Why", r.all.text, r.all.sources] : null;
  const implication =
    avg >= 3 ? "Fly-in demand is expanding; conditions support firmer pricing."
    : avg > -3 ? "Fly-in demand is broadly stable year on year."
    : "Fly-in demand is contracting; expect sharper rate competition, particularly in underperforming markets.";
  return [
    ["Market", `Passenger traffic across our ${rows.length} cities was ${avg === 0 ? "flat" : `${avg > 0 ? "up" : "down"} ${Math.abs(avg).toFixed(1)}%`} year on year in ${airMonthName(latest.month, true)}.`],
    ["Trend", trend],
    growing.length ? ["Outperforming (+5% or more)", `${names(growing)}.`] : null,
    falling.length ? ["Underperforming (−5% or worse)", `${names(falling)}.`] : null,
    why,
    ["Implication", implication],
  ].filter(Boolean);
}

// Renders [label, text, sources?] points from the two functions above as a short list.
function airPoints(points) {
  const links = (sources = []) =>
    sources.length
      ? ` <span class="air-cite">(${sources.map((s) => `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.name)}</a>`).join("; ")})</span>`
      : "";
  return `<ul class="air-points">${points.map(([label, text, sources]) => `<li><b>${escapeHtml(label)}:</b> ${escapeHtml(text)}${links(sources)}</li>`).join("")}</ul>`;
}

function airSourceLink(label = "AAI airport data") {
  const latest = airLatest();
  return `<a href="${latest.pdfUrl}" target="_blank" rel="noopener noreferrer">${label}, ${airMonthName(latest.month)} (PDF) ↗</a>`;
}
