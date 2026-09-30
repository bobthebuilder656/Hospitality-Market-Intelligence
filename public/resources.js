// Resources tab: a home view with four section cards and previews, plus one
// detail view per section (Tools, Glossary & reports, The Hotelier's Brief,
// Case study). Content comes from /api/resources (hand-maintained JSON in data/).

let resData = null;
let resLoading = false;
let resFailed = false; // the last load failed
// view: "home" | "tools" | "glossary" | "brief" | "case". term: a glossary term
// opened from search (otherwise the glossary view shows today's term).
const resState = { view: "home", calc: "occupancy", term: null };

const inr = (n) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const pct = (n) => `${(Math.round(n * 10) / 10).toLocaleString("en-IN")}%`;
const num = (id) => {
  const v = parseFloat(document.getElementById(id).value);
  return Number.isFinite(v) && v >= 0 ? v : null;
};
const resDate = (d, withYear = false) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
// A source without a url (e.g. a document not published online) is shown as plain text.
const sourceLink = (s) => (s.url ? `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.name)}</a>` : escapeHtml(s.name));

// Article text supports **bold**, *italic* and [link text](https://…), nothing else.
function richText(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\*([^*]+?)\*/g, "<i>$1</i>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (m, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
}

// ---- term of the day ------------------------------------------------------------

// Changes once a day (India time), cycling through the whole glossary.
function todaysTerm() {
  const terms = resData.glossary;
  if (!terms.length) return null;
  const istDay = Math.floor((Date.now() + 5.5 * 3600000) / 86400000);
  return terms[istDay % terms.length];
}

// ---- calculators ---------------------------------------------------------------

const CALCS = {
  occupancy: { label: "Occupancy & RevPAR", keywords: "adr average rate" },
  gst: { label: "GST on rooms", keywords: "tax slab" },
  group: { label: "Group quote", keywords: "gst tax meals commission mice wedding" },
};

function field(id, label, value, hint = "") {
  return `
    <label class="calc-field">
      <span class="calc-label">${label}</span>
      <input type="number" id="${id}" value="${value}" min="0" inputmode="decimal" />
      ${hint ? `<span class="calc-hint">${hint}</span>` : ""}
    </label>`;
}

function roomGstRate(rate) {
  const slab = resData.gst.roomSlabs.find((s) => s.upTo === null || rate <= s.upTo);
  return slab.rate;
}

function calcForm() {
  switch (resState.calc) {
    case "occupancy":
      return `
        <div class="calc-fields">
          ${field("c-avail", "Rooms available", 120, "Rooms in the hotel × nights in the period")}
          ${field("c-sold", "Rooms sold", 96)}
          ${field("c-rev", "Room revenue (₹)", 840000, "Rooms only, before tax")}
        </div>`;
    case "gst":
      return `
        <div class="calc-fields">
          ${field("c-rate", "Room rate per night (₹)", 6500, "The price of one room for one night")}
          ${field("c-rooms", "Rooms", 1)}
          ${field("c-nights", "Nights", 2)}
        </div>`;
    case "group":
      return `
        <div class="calc-fields">
          ${field("c-grooms", "Rooms per night", 20)}
          ${field("c-gnights", "Nights", 3)}
          ${field("c-grate", "Room rate per night (₹)", 7000)}
          ${field("c-pax", "Guests per room", 2)}
          ${field("c-meal", "Meals per guest per day (₹)", 1500, "Set to 0 for room only")}
          ${field("c-comm", "Agent commission (%)", 0, "Usually paid on room charges only")}
        </div>
        <fieldset class="calc-choice">
          <legend>GST on food and drink</legend>
          <label><input type="radio" name="c-food" value="standard" checked /> <span><b>5%</b>: no room in our hotel sold above ₹7,500 a night last financial year</span></label>
          <label><input type="radio" name="c-food" value="premium" id="c-premium" /> <span><b>18%</b>: at least one room sold above ₹7,500 a night last financial year</span></label>
          <span class="calc-hint">Food GST in a hotel depends on its room prices, not on the food.</span>
        </fieldset>`;
  }
  return "";
}

function calcResult() {
  const out = (items) =>
    `<div class="calc-results">${items
      .map(([label, value, strong]) => `<div class="calc-result${strong ? " strong" : ""}"><span>${label}</span><b>${value}</b></div>`)
      .join("")}</div>`;
  const needInput = `<p class="calc-note">Fill in all the fields to see the result.</p>`;

  if (resState.calc === "occupancy") {
    const avail = num("c-avail");
    const sold = num("c-sold");
    const rev = num("c-rev");
    if (!avail || sold === null || rev === null) return needInput;
    if (sold > avail) return `<p class="calc-note warn">Rooms sold can't be more than rooms available.</p>`;
    return (
      out([
        ["Occupancy", pct((sold / avail) * 100), true],
        ["ADR (average rate)", sold ? inr(rev / sold) : "–", true],
        ["RevPAR", inr(rev / avail), true],
      ]) +
      `<div class="calc-formula">
        <b>How it's calculated</b>
        Occupancy = Rooms sold ÷ Rooms available · ADR = Room revenue ÷ Rooms sold · RevPAR = Room revenue ÷ Rooms available (or Occupancy × ADR)
      </div>`
    );
  }

  if (resState.calc === "gst") {
    const rate = num("c-rate");
    const rooms = num("c-rooms");
    const nights = num("c-nights");
    if (!rate || !rooms || !nights) return needInput;
    const gstRate = roomGstRate(rate);
    const base = rate * rooms * nights;
    const gst = (base * gstRate) / 100;
    const slabs = resData.gst.roomSlabs
      .map((s, i, all) => {
        const from = i === 0 ? "Up to" : `${inr(all[i - 1].upTo + 1)} to`;
        return s.upTo === null ? `above ${inr(all[i - 1].upTo)}: ${s.rate}%` : `${from} ${inr(s.upTo)}: ${s.rate}%`;
      })
      .join(" · ");
    return (
      out([
        ["GST rate", `${gstRate}%`, true],
        ["Room charges", inr(base)],
        ["GST", inr(gst)],
        ["Total to pay", inr(base + gst), true],
      ]) +
      `<div class="calc-formula">
        <b>How it's worked out</b>
        The slab depends on the rate of one room for one night. Room slabs since ${new Date(resData.gst.effectiveFrom).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}: ${slabs}.
      </div>`
    );
  }

  if (resState.calc === "group") {
    const rooms = num("c-grooms");
    const nights = num("c-gnights");
    const rate = num("c-grate");
    const pax = num("c-pax");
    const meal = num("c-meal");
    const comm = num("c-comm");
    if (!rooms || !nights || !rate || pax === null || meal === null || comm === null) return needInput;
    if (comm > 100) return `<p class="calc-note warn">Commission can't be more than 100%.</p>`;
    const roomNights = rooms * nights;
    const roomCharges = roomNights * rate;
    const roomGst = (roomCharges * roomGstRate(rate)) / 100;
    const foodRate = document.getElementById("c-premium").checked ? resData.gst.food.specifiedPremises : resData.gst.food.standard;
    const mealCharges = roomNights * pax * meal;
    const mealGst = (mealCharges * foodRate) / 100;
    const total = roomCharges + roomGst + mealCharges + mealGst;
    const commission = (roomCharges * comm) / 100;
    return (
      out([
        [`Rooms (${roomNights} room-nights)`, inr(roomCharges)],
        [`GST on rooms (${roomGstRate(rate)}%)`, inr(roomGst)],
        [`Meals (${roomNights * pax} guest-days)`, inr(mealCharges)],
        [`GST on meals (${foodRate}%)`, inr(mealGst)],
        ["Total quote to the client", inr(total), true],
        ["Per room-night, all in", inr(total / roomNights), true],
        ...(comm ? [[`Agent commission (${comm}% of rooms)`, inr(commission)], ["Net to hotel, before tax", inr(roomCharges + mealCharges - commission), true]] : []),
      ]) +
      `<div class="calc-formula">
        <b>How it's worked out</b>
        Rooms = rooms × nights × rate · Meals = room-nights × guests per room × meal cost · GST is added at the room slab and the food rate · Commission is taken from room charges before tax.
      </div>`
    );
  }
  return "";
}

function renderCalcResult() {
  const el = document.getElementById("calc-output");
  if (el) el.innerHTML = calcResult();
}

function calculatorsSection() {
  const tabs = Object.entries(CALCS)
    .map(([id, c]) => `<button class="sort-btn${resState.calc === id ? " active" : ""}" data-calc="${id}">${c.label}</button>`)
    .join("");
  const gstSources = resData.gst.sources
    .map((s) => `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.name)}</a>`)
    .join(" · ");
  return `
    <section class="res-section" id="res-calculators">
      <h3 class="res-section-title">Calculators</h3>
      <div class="sort-controls" id="calc-tabs">${tabs}</div>
      <div class="calc-card">
        <div id="calc-form">${calcForm()}</div>
        <div id="calc-output"></div>
        ${resState.calc !== "occupancy" ? `<p class="calc-source">GST rates change from time to time; this is a guide, not tax advice. Sources: ${gstSources}</p>` : ""}
      </div>
    </section>`;
}

// ---- views -------------------------------------------------------------------

const SECTIONS = {
  tools: { icon: "🧮", title: "Tools", line: "Calculators for occupancy, GST and group quotes." },
  glossary: { icon: "📚", title: "Glossary & reports", line: "A new hotel term explained every day, and the key industry reports." },
  brief: { icon: "📰", title: "The Hotelier's Brief", line: "A short, practical read, new every Wednesday and Sunday." },
  case: { icon: "🔍", title: "Case study", line: "A real hotel-market story and its lessons, new every Friday." },
};

function backButton() {
  return `<button class="res-back" data-view="home">← Back to Resources</button>`;
}

function viewHeader(id) {
  const s = SECTIONS[id];
  return `${backButton()}<h2 class="res-view-title">${s.icon} ${s.title}</h2>`;
}

function comingSoon(kind, date) {
  return `<p class="res-empty">${date ? `The first ${kind} arrives on ${resDate(date)}.` : `No ${kind} is scheduled yet.`}</p>`;
}

function homeView() {
  const cards = Object.entries(SECTIONS)
    .map(
      ([id, s]) => `
      <button class="res-card" data-view="${id}">
        <span class="res-card-icon">${s.icon}</span>
        <span class="res-card-title">${s.title}</span>
        <span class="res-card-line">${s.line}</span>
      </button>`
    )
    .join("");

  const term = todaysTerm();
  const termPreview = term
    ? `
      <button class="res-preview" data-view="glossary">
        <span class="res-preview-label">💡 Term of the day</span>
        <span class="res-preview-title">${escapeHtml(term.term)}</span>
        <span class="res-preview-text">${escapeHtml(term.short || term.definition)}</span>
        <span class="res-preview-more">Read more →</span>
      </button>`
    : "";

  const { brief, caseStudy } = resData;
  const briefPreview = `
    <button class="res-preview" data-view="brief">
      <span class="res-preview-label">📰 The Hotelier's Brief${brief ? ` · ${resDate(brief.publishDate)} · ${brief.minutes} min read` : ""}</span>
      ${
        brief
          ? `<span class="res-preview-title">${escapeHtml(brief.title)}</span><span class="res-preview-text">${escapeHtml(brief.dek)}</span><span class="res-preview-more">Read →</span>`
          : `<span class="res-preview-text">${resData.nextBriefDate ? `The first article arrives on ${resDate(resData.nextBriefDate)}.` : "No article is scheduled yet."}</span>`
      }
    </button>`;
  const casePreview = `
    <button class="res-preview" data-view="case">
      <span class="res-preview-label">🔍 Case study${caseStudy ? ` · ${resDate(caseStudy.publishDate)} · ${caseStudy.minutes} min read` : ""}</span>
      ${
        caseStudy
          ? `<span class="res-preview-title">${escapeHtml(caseStudy.title)}</span><span class="res-preview-text">${escapeHtml(caseStudy.dek)}</span><span class="res-preview-more">Read →</span>`
          : `<span class="res-preview-text">${resData.nextCaseDate ? `The first case study arrives on ${resDate(resData.nextCaseDate)}.` : "No case study is scheduled yet."}</span>`
      }
    </button>`;

  return `
    <div class="res-header">
      <h2 class="res-title">Resources</h2>
      <p class="res-subtitle">Tools, know-how and real stories for hotel teams</p>
      <input type="search" id="res-search" class="res-search" placeholder="Search tools, terms, reports, articles…" aria-label="Search resources" autocomplete="off" />
      <div id="res-search-results" class="res-search-results" hidden></div>
    </div>
    <div class="res-cards">${cards}</div>
    <div class="res-previews">${termPreview}${briefPreview}${casePreview}</div>`;
}

function toolsView() {
  return `
    ${viewHeader("tools")}
    ${calculatorsSection()}`;
}

function glossaryView() {
  const today = todaysTerm();
  const term = resState.term || today;
  const isToday = term === today;
  const reportRow = (r) => `
      <a class="report-row" href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer">
        <span class="report-main">
          <span class="report-name">${escapeHtml(r.name)}${r.access ? ` <span class="report-paid">${escapeHtml(r.access)}</span>` : ""}</span>
          <span class="report-about">${escapeHtml(r.about)}</span>
        </span>
        <span class="report-meta">${escapeHtml(r.publisher)} · ${escapeHtml(r.frequency)}${r.published ? ` · ${/^updated/i.test(r.published) ? "" : "Published "}${escapeHtml(r.published)}` : ""}</span>
        <span class="report-open">Open ↗</span>
      </a>`;
  const reports = Object.entries(REPORT_GROUPS)
    .map(([group, label]) => {
      const rows = resData.reports.filter((r) => r.group === group);
      return rows.length ? `<h4 class="report-group">${label}</h4><div class="report-list">${rows.map(reportRow).join("")}</div>` : "";
    })
    .join("");
  return `
    ${viewHeader("glossary")}
    ${
      term
        ? `
      <div class="res-term">
        <div class="res-term-label">${isToday ? "💡 Term of the day" : "💡 From the glossary"}</div>
        <div class="res-term-name">${escapeHtml(term.term)}</div>
        <div class="res-term-def">${escapeHtml(term.definition)}</div>
        ${term.example ? `<div class="res-term-example"><b>Example:</b> ${escapeHtml(term.example)}</div>` : ""}
        <div class="res-term-foot">
          ${isToday ? "A new term tomorrow." : `<button class="res-link" data-term="today">Show today's term</button>`}
          <button class="res-link res-all-terms" data-view="glossary-all">See all ${resData.glossary.length} terms →</button>
        </div>
      </div>`
        : ""
    }
    <section class="res-section">
      <h3 class="res-section-title">📑 Additional reading</h3>
      <p class="res-section-sub">This year's key reports on India's hotel and travel market, linked to each report itself. New editions replace older ones.</p>
      ${reports}
    </section>`;
}

const REPORT_GROUPS = {
  market: "Hotel market performance",
  travel: "Travel and tourism",
};
const GLOSSARY_GROUPS = {
  performance: "Measuring performance",
  pricing: "Pricing",
  sales: "Sales and groups",
  revenue: "Revenue controls",
  distribution: "Distribution and systems",
};

function glossaryAllView() {
  const groups = Object.entries(GLOSSARY_GROUPS)
    .map(([group, label]) => {
      const terms = resData.glossary.filter((t) => t.group === group).sort((a, b) => a.term.localeCompare(b.term));
      if (!terms.length) return "";
      const items = terms
        .map(
          (t) => `
          <details class="gloss-item">
            <summary>
              <span class="gloss-term">${escapeHtml(t.term)}</span>
              <span class="gloss-short">${escapeHtml(t.short || "")}</span>
            </summary>
            <p>${escapeHtml(t.definition)}</p>
            ${t.example ? `<p class="gloss-example"><b>Example:</b> ${escapeHtml(t.example)}</p>` : ""}
          </details>`
        )
        .join("");
      return `<h3 class="gloss-group-title">${label}</h3><div class="gloss-list">${items}</div>`;
    })
    .join("");
  return `
    <button class="res-back" data-view="glossary">← Back to Glossary & reports</button>
    <h2 class="res-view-title">📚 All glossary terms</h2>
    <p class="res-section-sub">${resData.glossary.length} terms, grouped by topic. Tap a term for the full explanation and an example.</p>
    ${groups}`;
}

// A small data table inside an article section: { caption, head: [...], rows: [[...]], note }.
// Columns after the first are numbers and align right, unless the table sets text: true.
function readTable(t) {
  if (!t) return "";
  const cell = (tag, v, i) => `<${tag}${i > 0 && !t.text ? ' class="num"' : ""}>${richText(String(v))}</${tag}>`;
  return `<div class="read-table-wrap"><table class="read-table">
    ${t.caption ? `<caption>${escapeHtml(t.caption)}</caption>` : ""}
    <thead><tr>${t.head.map((h, i) => cell("th", h, i)).join("")}</tr></thead>
    <tbody>${t.rows.map((r) => `<tr>${r.map((v, i) => cell("td", v, i)).join("")}</tr>`).join("")}</tbody>
  </table>${t.note ? `<p class="read-table-note">${richText(t.note)}</p>` : ""}</div>`;
}

// Articles and case studies share one layout: a dek, sections, takeaways, sources.
function longRead(item, kind, nextDate) {
  const sections = item.sections
    .map((s) => `${s.heading ? `<h3>${escapeHtml(s.heading)}</h3>` : ""}${s.body.map((p) => `<p>${richText(p)}</p>`).join("")}${readTable(s.table)}${(s.after || []).map((p) => `<p>${richText(p)}</p>`).join("")}`)
    .join("");
  const takeaways = item.takeaways && item.takeaways.length
    ? `<div class="read-takeaways"><h3>${kind === "case" ? "What hotels can learn" : "Key takeaways"}</h3><ul>${item.takeaways.map((t) => `<li>${richText(t)}</li>`).join("")}</ul></div>`
    : "";
  // Case studies: a short, honest note on what the evidence can and can't tell us.
  const limitations = item.limitations && item.limitations.length
    ? `<div class="read-limits"><h3>Limitations of this case</h3>${item.limitations.map((p) => `<p>${richText(p)}</p>`).join("")}</div>`
    : "";
  // Links to another tab (link.tab) or to another section of Resources (link.view).
  const internal = item.link
    ? item.link.view
      ? `<button class="res-link read-internal" data-view="${item.link.view}">→ ${escapeHtml(item.link.label)}</button>`
      : `<button class="res-link read-internal" data-open-tab="${item.link.tab}">→ ${escapeHtml(item.link.label)}</button>`
    : "";
  const meta = [resDate(item.publishDate, true), item.place, item.period, `${item.minutes} min read`].filter(Boolean).map(escapeHtml).join(" · ");
  // A freely licensed photo, always shown with its credit and licence.
  const image = item.image
    ? `<figure class="read-image">
        <img src="${escapeHtml(item.image.src)}" alt="${escapeHtml(item.image.alt)}" loading="lazy" />
        <figcaption>${escapeHtml(item.image.caption || "")}
          <span class="read-credit"><a href="${escapeHtml(item.image.creditUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.image.credit)}</a> · ${escapeHtml(item.image.license)}</span>
        </figcaption>
      </figure>`
    : "";
  // Two or three key numbers from the piece, shown under the headline.
  const stats = item.stats && item.stats.length
    ? `<div class="read-stats">${item.stats
        .map((s) => `<div class="read-stat"><b>${escapeHtml(s.value)}</b><span>${escapeHtml(s.label)}</span></div>`)
        .join("")}</div>`
    : "";
  return `
    <article class="read">
      <div class="read-meta">${meta}</div>
      <h2 class="read-title">${escapeHtml(item.title)}</h2>
      <p class="read-dek">${escapeHtml(item.dek)}</p>
      ${item.theme ? `<p class="read-theme"><b>The main message</b>${richText(item.theme)}</p>` : ""}
      ${image}
      ${stats}
      <div class="read-body">${sections}</div>
      ${takeaways}
      ${limitations}
      ${internal}
      <div class="read-sources"><b>Sources</b><ol>${item.sources.map((s) => `<li>${sourceLink(s)}</li>`).join("")}</ol></div>
    </article>
    ${nextDate ? `<p class="read-next">Next ${kind === "case" ? "case study" : "article"}: <b>${resDate(nextDate)}</b></p>` : ""}`;
}

function briefView() {
  return `
    ${viewHeader("brief")}
    ${resData.brief ? longRead(resData.brief, "brief", resData.nextBriefDate) : comingSoon("article", resData.nextBriefDate)}`;
}

function caseView() {
  return `
    ${viewHeader("case")}
    ${resData.caseStudy ? longRead(resData.caseStudy, "case", resData.nextCaseDate) : comingSoon("case study", resData.nextCaseDate)}`;
}

const VIEWS = { home: homeView, tools: toolsView, glossary: glossaryView, "glossary-all": glossaryAllView, brief: briefView, case: caseView };

// ---- search ---------------------------------------------------------------------

function searchIndex() {
  const items = [
    ...Object.entries(CALCS).map(([id, c]) => ({ kind: "Tool", title: c.label, text: `calculator ${c.keywords || ""}`, go: { view: "tools", calc: id } })),
    ...resData.glossary.map((t) => ({ kind: "Glossary", title: t.term, text: `${t.definition} ${t.example || ""}`, go: { view: "glossary", term: t.term } })),
    ...resData.reports.map((r) => ({ kind: "Report", title: r.name, text: `${r.publisher} ${r.about}`, go: { url: r.url } })),
  ];
  const longText = (x) => [x.title, x.dek, ...x.sections.flatMap((s) => [s.heading || "", ...s.body])].join(" ");
  if (resData.brief) items.push({ kind: "Article", title: resData.brief.title, text: longText(resData.brief), go: { view: "brief" } });
  if (resData.caseStudy) items.push({ kind: "Case study", title: resData.caseStudy.title, text: longText(resData.caseStudy), go: { view: "case" } });
  return items;
}

function renderSearch(query) {
  const box = document.getElementById("res-search-results");
  const q = query.trim().toLowerCase();
  if (q.length < 2) {
    box.hidden = true;
    return;
  }
  const words = q.split(/\s+/);
  const hits = searchIndex()
    .map((item) => {
      const title = item.title.toLowerCase();
      const all = `${title} ${item.text.toLowerCase()}`;
      if (!words.every((w) => all.includes(w))) return null;
      return { item, score: words.every((w) => title.includes(w)) ? 2 : 1 };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((h) => h.item);

  box.hidden = false;
  box._hits = hits;
  box.innerHTML = hits.length
    ? hits
        .map(
          (item, i) => `
          <button class="search-hit" data-hit="${i}">
            <span class="search-kind">${item.kind}</span>
            <span class="search-title">${escapeHtml(item.title)}${item.go.url ? " ↗" : ""}</span>
          </button>`
        )
        .join("")
    : `<p class="search-empty">No matches for "${escapeHtml(query.trim())}".</p>`;
}

// ---- navigation -------------------------------------------------------------------

function renderResources() {
  const view = VIEWS[resState.view] ? resState.view : "home";
  document.getElementById("res-content").innerHTML = `
    ${VIEWS[view]()}
    <p class="disclaimer">For reference only. Articles and case studies are general guidance; adapt them to your hotel.</p>`;
  if (view === "tools") renderCalcResult();
  updateDashboard();
}

// Opens a detail view. It's also added to the browser history, so the phone or
// browser Back button returns to the Resources home instead of leaving the app.
function openView(view, extra = {}) {
  Object.assign(resState, { view, term: null }, extra);
  // The address carries the view ("#resources/brief"), so it can be reloaded, linked to
  // and stepped through with the browser's Back and Forward buttons.
  history.pushState({ resView: view, term: resState.term, calc: resState.calc }, "", view === "home" ? "#resources" : `#resources/${view}`);
  renderResources();
  document.getElementById("resources").scrollIntoView({ block: "start" });
  window.scrollTo({ top: 0 });
}

// The Resources view named in the address, e.g. "brief" for "#resources/brief".
function resViewFromAddress() {
  const [tab, view] = location.hash.slice(1).split("/");
  return tab === "resources" && VIEWS[view] ? view : "home";
}

// Browser Back / Forward.
window.addEventListener("popstate", (e) => {
  if (!resData) return;
  const s = e.state || {};
  resState.view = s.resView || resViewFromAddress();
  resState.term = s.term || null;
  if (s.calc) resState.calc = s.calc;
  renderResources();
});

async function loadResources() {
  if (resLoading) return;
  resLoading = true;
  try {
    // Open the app with ?preview=1 (next piece) or ?preview=YYYY-MM-DD (as on that date)
    // to read articles and case studies before they publish. On the live site
    // this also needs &key=… (the PREVIEW_KEY setting).
    const params = new URLSearchParams(location.search);
    const query = new URLSearchParams();
    for (const name of ["preview", "key"]) if (params.get(name)) query.set(name, params.get(name));
    const res = await fetch(`/api/resources${query.size ? `?${query}` : ""}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    resData = await res.json();
    resFailed = false;
    resState.view = resViewFromAddress(); // a reload or a shared link reopens the same view
    renderResources();
  } catch {
    document.getElementById("res-content").innerHTML = `<p class="error">Couldn't load resources. Try again in a moment.</p>`;
    resFailed = true;
    updateDashboard();
  } finally {
    resLoading = false;
  }
}

// ---- wiring -------------------------------------------------------------------

const resPanel = document.getElementById("resources");

resPanel.addEventListener("click", (e) => {
  const viewBtn = e.target.closest("[data-view]");
  if (viewBtn) {
    openView(viewBtn.dataset.view);
    return;
  }
  const calc = e.target.closest("[data-calc]");
  if (calc) {
    resState.calc = calc.dataset.calc;
    document.getElementById("res-calculators").outerHTML = calculatorsSection();
    renderCalcResult();
    return;
  }
  const termBtn = e.target.closest("[data-term]");
  if (termBtn) {
    resState.term = null;
    renderResources();
    return;
  }
  const hit = e.target.closest("[data-hit]");
  if (hit) {
    const { go } = document.getElementById("res-search-results")._hits[+hit.dataset.hit];
    if (go.url) window.open(go.url, "_blank", "noopener");
    else {
      const term = go.term ? resData.glossary.find((t) => t.term === go.term) : null;
      openView(go.view, { ...(go.calc ? { calc: go.calc } : {}), ...(term ? { term } : {}) });
    }
    return;
  }
  const openTab = e.target.closest("[data-open-tab]");
  if (openTab) {
    document.querySelector(`.tab[data-tab="${openTab.dataset.openTab}"]`).click();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
});

// Recalculate as the user types.
resPanel.addEventListener("input", (e) => {
  if (e.target.id === "res-search") renderSearch(e.target.value);
  else if (e.target.closest("#calc-form")) renderCalcResult();
});
resPanel.addEventListener("change", (e) => {
  if (e.target.closest("#calc-form")) renderCalcResult();
});

// Opening the tab always starts on the Resources home.
document.querySelector('.tab[data-tab="resources"]').addEventListener("click", () => {
  if (!resData) loadResources();
  else if (resState.view !== "home") {
    resState.view = "home";
    renderResources();
  }
});
