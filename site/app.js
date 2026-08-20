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

// Searchable text for a product: its name plus category and every attribute value.
const _hay = new WeakMap();
function haystack(p) {
  let s = _hay.get(p);
  if (!s) {
    s = (p.name + " " + p.category + " " + Object.values(p.attributes).join(" ")).toLowerCase();
    _hay.set(p, s);
  }
  return s;
}

/* Numeric-aware sort so "1.5 Ton" < "2 Ton", "32 inch" < "43 inch", "—" last. */
function valueSort(a, b) {
  if (a === "—") return 1;
  if (b === "—") return -1;
  const na = parseFloat(a), nb = parseFloat(b);
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
}

// ---- Build category index ----
const byCategory = {};
for (const p of PRODUCTS) (byCategory[p.category] ||= []).push(p);
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

function buildFilters(cat) {
  const items = byCategory[cat];
  const box = $("filters");
  box.innerHTML = "";
  for (const key of attrKeys(items)) {
    const values = [...new Set(items.map((p) => p.attributes[key]).filter(Boolean))].sort(valueSort);
    if (values.length < 2) continue;           // nothing to choose between
    const group = document.createElement("div");
    group.className = "filter-group";
    group.innerHTML = `<span class="filter-label">${key}</span>`;
    for (const val of values) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = val;
      chip.addEventListener("click", () => {
        (activeFilters[key] ||= new Set());
        const set = activeFilters[key];
        set.has(val) ? set.delete(val) : set.add(val);
        if (set.size === 0) delete activeFilters[key];
        chip.classList.toggle("active");
        renderResults();
      });
      group.appendChild(chip);
    }
    box.appendChild(group);
  }
}

function matches(p) {
  for (const key in activeFilters)
    if (!activeFilters[key].has(p.attributes[key])) return false;
  return true;
}

function renderResults() {
  const items = byCategory[activeCat].filter(matches);
  items.sort((a, b) => (sortDir === "asc" ? sellingPrice(a) - sellingPrice(b) : sellingPrice(b) - sellingPrice(a)));
  const box = $("results");
  box.innerHTML = "";
  items.forEach((p) => box.appendChild(card(p)));
  $("resultCount").textContent = `${items.length} shown`;
  $("emptyMsg").classList.toggle("hidden", items.length > 0);
}

function card(p) {
  const el = document.createElement("div");
  el.className = "card";
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");
  el.setAttribute("aria-expanded", "false");
  const tags = Object.entries(p.attributes)
    .filter(([, v]) => v && v !== "—")
    .map(([, v]) => `<span class="tag">${v}</span>`)
    .join("");
  const low = p.stock <= 1 ? "low" : "";
  el.innerHTML = `
    <div class="card-row">
      <div class="card-main">
        <div class="card-name">${p.name}</div>
        <div class="card-tags">${tags}</div>
      </div>
      <div class="card-right">
        <div class="price">${rupee(sellingPrice(p))}</div>
        <div class="stock ${low}">${p.stock} in stock</div>
      </div>
      <span class="chev" aria-hidden="true">⌄</span>
    </div>
    <div class="card-detail" hidden>
      <div class="detail-row"><span>Cost (incl. GST)</span><b>${rupee(p.costIncl)}</b></div>
      <div class="detail-row"><span>GST rate</span><b>${p.gst}%</b></div>
      <div class="detail-row"><span>Selling price</span><b>${rupee(sellingPrice(p))}</b></div>
    </div>`;
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
  const hits = PRODUCTS.filter((p) => haystack(p).includes(q))
    .sort((a, b) => sellingPrice(a) - sellingPrice(b));
  const box = $("searchResults");
  box.innerHTML = "";
  hits.forEach((p) => box.appendChild(card(p)));
  $("searchCount").textContent = `${hits.length} result${hits.length === 1 ? "" : "s"}`;
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
