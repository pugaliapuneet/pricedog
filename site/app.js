/* Counter price lookup — vanilla JS, no build step. Data lives in products.js. */

const EMOJI = {
  "Air Conditioner": "❄️",
  "Refrigerator": "🧊",
  "Air Cooler": "🌀",
  "Television": "📺",
  "Washing Machine": "🧺",
  "Microwave": "🍽️",
  "Oven (OTG)": "🔥",
  "Ceiling Fan": "🌬️",
  "Pedestal Fan": "💨",
  "Exhaust Fan": "🔲",
  "Water Heater": "♨️",
  "Water Dispenser": "🚰",
  "Water Purifier": "💧",
  "Electric Kettle": "🫖",
  "Induction Cooktop": "🍳",
  "Gas Stove / Cooktop": "🔥",
  "Chimney": "🏭",
  "Sandwich Toaster": "🥪",
  "Toaster": "🍞",
  "Mixer Grinder": "🥤",
  "Cookware": "🍲",
  "Room Heater": "🔆",
  "Landline Phone": "☎️",
  "Speaker": "🔊",
  "Battery": "🔋",
  "Accessories": "🔧",
  "Other": "📦",
};

// ---- Pricing rule ----
// Selling price = cost incl. GST + 10% margin, rounded UP to the next ₹250.
const MARGIN = 0.10;
const ROUND_TO = 250;
const sellingPrice = (p) => Math.ceil((p.costIncl * (1 + MARGIN)) / ROUND_TO) * ROUND_TO;

const rupee = (n) => "₹" + Number(n).toLocaleString("en-IN");

// Searchable text: name + category + attribute values, plus supplier / availability
// so "rohit" or "on order" find on-order items.
const _hay = new WeakMap();
function haystack(p) {
  let s = _hay.get(p);
  if (!s) {
    const extra = p.onOrder ? ` on order ${p.supplier || ""} ${p.code || ""}` : "";
    s = (p.name + " " + p.category + " " + Object.values(p.attributes).join(" ") + extra).toLowerCase();
    _hay.set(p, s);
  }
  return s;
}

/* How an attribute value is shown in the UI (tags + filter chips).
   Star ratings render with a real star: "5 Star" -> "5★". The underlying data
   value is unchanged, so search and faceting still work on "5 Star". */
function displayValue(key, value) {
  if (key === "Star Rating") {
    const m = /^(\d+(?:\.\d+)?)\s*Star$/i.exec(value);
    if (m) return `${m[1]}★`;
  }
  return value;
}

/* Numeric-aware sort so "1.5 Ton" < "2 Ton", "32 inch" < "43 inch", "—" last. */
function valueSort(a, b) {
  if (a === "—") return 1;
  if (b === "—") return -1;
  const na = parseFloat(a), nb = parseFloat(b);
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
}

// ---- Build catalogue: in-stock products + on-order supplier items ----
const CATALOG = PRODUCTS.concat(typeof ONORDER !== "undefined" ? ONORDER : []);

// ---- Build category index ----
const byCategory = {};
for (const p of CATALOG) (byCategory[p.category] ||= []).push(p);
const categories = Object.keys(byCategory).sort(
  (a, b) => byCategory[b].length - byCategory[a].length || a.localeCompare(b)
);

// ---- DOM refs ----
const $ = (id) => document.getElementById(id);
const views = { category: $("categoryView"), results: $("resultsView"), search: $("searchView") };
function show(view) {
  for (const k in views) views[k].classList.toggle("hidden", k !== view);
}

let activeCat = null;
let activeFilters = {};   // { attrKey: Set(values) }
let sortDir = "asc";
let chipRegistry = [];    // { key, value, el, countEl } for live count badges

// "12 pcs of 5 models" — physical quantity (sum of stock) across the distinct models shown.
function countLabel(pcs, models) {
  return `${pcs} pcs of ${models} model${models === 1 ? "" : "s"}`;
}

// ---------- Category grid ----------
function renderCategories() {
  const grid = $("categoryGrid");
  grid.innerHTML = "";
  for (const cat of categories) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cat-card";
    btn.innerHTML = `
      <span class="cat-emoji">${EMOJI[cat] || "📦"}</span>
      <span class="cat-name">${cat}</span>
      <span class="cat-count">${byCategory[cat].length} item${byCategory[cat].length > 1 ? "s" : ""}</span>`;
    btn.addEventListener("click", () => openCategory(cat));
    grid.appendChild(btn);
  }
}

// ---------- Open a category ----------
function openCategory(cat) {
  activeCat = cat;
  activeFilters = {};
  $("search").value = "";
  $("catTitle").textContent = cat;
  buildFilters(cat);
  renderResults();
  show("results");
  window.scrollTo(0, 0);
}

// Attribute keys in the order they appear in the data (Brand, Type, Capacity, …)
function attrKeys(items) {
  const keys = [];
  for (const p of items)
    for (const k of Object.keys(p.attributes))
      if (!keys.includes(k)) keys.push(k);
  return keys;
}

// The value a product presents for a filter key ("__avail" is derived, not an attribute).
const chipValue = (p, key) =>
  key === "__avail" ? (p.onOrder ? "On order" : "In stock") : p.attributes[key];

// One multi-select chip (OR within its group). Carries a live count badge.
function makeChip(key, value) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "chip";
  chip.innerHTML = `<span class="chip-val"></span><span class="chip-count"></span>`;
  chip.querySelector(".chip-val").textContent = displayValue(key, value);
  const countEl = chip.querySelector(".chip-count");
  chip.addEventListener("click", () => {
    const set = (activeFilters[key] ||= new Set());
    set.has(value) ? set.delete(value) : set.add(value);
    if (set.size === 0) delete activeFilters[key];
    chip.classList.toggle("active");
    renderResults();
  });
  chipRegistry.push({ key, value, el: chip, countEl });
  return chip;
}

// Collapsible groups start collapsed: the label becomes a toggle button so the
// chips are there if you want them but out of the way if you don't.
function filterGroup(label, key, values, collapsible = false) {
  const group = document.createElement("div");
  group.className = "filter-group";
  if (collapsible) {
    group.classList.add("collapsible", "collapsed");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filter-label filter-toggle";
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = `<span class="filter-caret" aria-hidden="true"></span>${label}`;
    btn.addEventListener("click", () => {
      const collapsed = group.classList.toggle("collapsed");
      btn.setAttribute("aria-expanded", String(!collapsed));
    });
    group.appendChild(btn);
  } else {
    group.innerHTML = `<span class="filter-label">${label}</span>`;
  }
  for (const val of values) group.appendChild(makeChip(key, val));
  return group;
}

function buildFilters(cat) {
  const items = byCategory[cat];
  const box = $("filters");
  box.innerHTML = "";
  chipRegistry = [];

  // Availability first, only when the category actually mixes stocked and on-order items.
  const hasStock = items.some((p) => !p.onOrder);
  const hasOrder = items.some((p) => p.onOrder);
  if (hasStock && hasOrder) {
    box.appendChild(filterGroup("Availability", "__avail", ["In stock", "On order"]));
  }

  // "Series" is a long, rarely-needed list — hold it back and render it last as
  // a collapsed, toggleable group so it stays accessible without taking up room.
  let seriesGroup = null;
  for (const key of attrKeys(items)) {
    const values = [...new Set(items.map((p) => p.attributes[key]).filter(Boolean))].sort(valueSort);
    if (values.length < 2) continue;           // nothing to choose between
    if (key === "Series") {
      seriesGroup = filterGroup(key, key, values, true);
      continue;
    }
    box.appendChild(filterGroup(key, key, values));
  }
  if (seriesGroup) box.appendChild(seriesGroup);
}

function matches(p) {
  for (const key in activeFilters) {
    if (!activeFilters[key].has(chipValue(p, key))) return false;
  }
  return true;
}

// Does p pass every active filter except the one group we're counting within?
function matchesExcept(p, exceptKey) {
  for (const key in activeFilters) {
    if (key === exceptKey) continue;
    if (!activeFilters[key].has(chipValue(p, key))) return false;
  }
  return true;
}

// Faceted counts: how many items each chip would still yield given the other active filters.
function updateChipCounts() {
  const items = byCategory[activeCat];
  for (const { key, value, el, countEl } of chipRegistry) {
    let n = 0;
    for (const p of items)
      if (chipValue(p, key) === value && matchesExcept(p, key)) n++;
    countEl.textContent = n;
    el.classList.toggle("zero", n === 0 && !el.classList.contains("active"));
  }
}

function renderResults() {
  const items = byCategory[activeCat].filter(matches);
  items.sort((a, b) => (sortDir === "asc" ? sellingPrice(a) - sellingPrice(b) : sellingPrice(b) - sellingPrice(a)));
  const box = $("results");
  box.innerHTML = "";
  items.forEach((p) => box.appendChild(card(p)));
  const pcs = items.reduce((n, p) => n + (p.stock || 0), 0);
  $("resultCount").textContent = countLabel(pcs, items.length);
  $("emptyMsg").classList.toggle("hidden", items.length > 0);
  updateChipCounts();
}

function card(p) {
  const el = document.createElement("div");
  el.className = "card" + (p.onOrder ? " onorder" : "");
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");
  el.setAttribute("aria-expanded", "false");
  const tags = Object.entries(p.attributes)
    .filter(([, v]) => v && v !== "—")
    .map(([k, v]) => `<span class="tag">${displayValue(k, v)}</span>`)
    .join("");

  let avail, detail;
  if (p.onOrder) {
    // On-order: sourced from a named supplier, not stocked. Price = margin rule on the cost
    // basis (dealer NLC, or a company floor price); cost + margin stay in the staff-only detail.
    avail = `<div class="pill order">On order</div>
             <div class="via">via ${p.supplier}</div>`;
    // MRP + margin-vs-MRP only when a list price is known (some lists quote a floor price only).
    let mrpRows = "";
    if (p.mrp) {
      const margin = p.mrp - p.costIncl;
      const pct = Math.round((margin / p.mrp) * 100);
      mrpRows =
        `<div class="detail-row"><span>MRP (list price)</span><b>${rupee(p.mrp)}</b></div>` +
        `__COST__` +
        `<div class="detail-row"><span>Margin vs MRP</span><b>${rupee(margin)} · ${pct}%</b></div>`;
    }
    const costRow = `<div class="detail-row"><span>${p.costLabel || "Your cost (NLC)"}</span><b>${rupee(p.costIncl)}</b></div>`;
    mrpRows = mrpRows ? mrpRows.replace("__COST__", costRow) : costRow;
    const codeRow = p.code ? `<div class="detail-row"><span>Order code</span><b>${p.code}</b></div>` : "";
    detail = `
      ${mrpRows}
      <div class="detail-row"><span>Supplier</span><b>${p.supplier}</b></div>
      ${codeRow}
      <div class="detail-row"><span>Price list</span><b>${p.priceList}</b></div>
      <div class="detail-row"><span>Selling price</span><b>${rupee(sellingPrice(p))}</b></div>`;
  } else {
    const low = p.stock <= 1 ? "low" : "";
    avail = `<div class="stock ${low}">${p.stock} in stock</div>`;
    detail = `
      <div class="detail-row"><span>Cost (incl. GST)</span><b>${rupee(p.costIncl)}</b></div>
      <div class="detail-row"><span>GST rate</span><b>${p.gst}%</b></div>
      <div class="detail-row"><span>Selling price</span><b>${rupee(sellingPrice(p))}</b></div>`;
  }

  el.innerHTML = `
    <div class="card-row">
      <div class="card-main">
        <div class="card-name">${p.name}</div>
        <div class="card-tags">${tags}</div>
      </div>
      <div class="card-right">
        <div class="price">${rupee(sellingPrice(p))}</div>
        ${avail}
      </div>
      <span class="chev" aria-hidden="true">⌄</span>
    </div>
    <div class="card-detail" hidden>${detail}</div>`;
  const toggle = () => {
    const open = el.classList.toggle("open");
    el.setAttribute("aria-expanded", open ? "true" : "false");
    el.querySelector(".card-detail").hidden = !open;
  };
  el.addEventListener("click", toggle);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
  });
  return el;
}

// ---------- Global search ----------
function runSearch(q) {
  q = q.trim().toLowerCase();
  if (!q) {
    show(activeCat ? "results" : "category");
    return;
  }
  const hits = CATALOG.filter((p) => haystack(p).includes(q))
    .sort((a, b) => sellingPrice(a) - sellingPrice(b));
  const box = $("searchResults");
  box.innerHTML = "";
  hits.forEach((p) => box.appendChild(card(p)));
  const pcs = hits.reduce((n, p) => n + (p.stock || 0), 0);
  $("searchCount").textContent = countLabel(pcs, hits.length);
  $("searchEmpty").classList.toggle("hidden", hits.length > 0);
  show("search");
}

// ---------- Wire up ----------
$("backBtn").addEventListener("click", () => { activeCat = null; show("category"); });
$("homeBtn").addEventListener("click", () => {
  activeCat = null; $("search").value = ""; show("category"); window.scrollTo(0, 0);
});
$("sortBtn").addEventListener("click", (e) => {
  sortDir = sortDir === "asc" ? "desc" : "asc";
  e.target.textContent = sortDir === "asc" ? "Price ↑" : "Price ↓";
  e.target.dataset.dir = sortDir;
  if (activeCat) renderResults();
});
$("search").addEventListener("input", (e) => runSearch(e.target.value));

renderCategories();
show("category");
