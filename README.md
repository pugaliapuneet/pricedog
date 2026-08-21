# Counter Price Lookup

A tiny, static web app for looking up retail selling prices at the counter.
Pick a product type (AC, Fridge, TV, …), narrow down with filters (capacity,
star rating, brand, …), and see the selling price instantly.

- **No backend, no build step** — plain HTML/CSS/JS, deploys to GitHub Pages.
- **Cost prices are never published.** The catalogue (`site/products.js`)
  contains only the marked-up *selling* price. Raw purchase costs stay on your
  own machine and never reach this public repo.
- **Selling price = cost × (1 + margin)**, with a default **5%** margin,
  exclusive of GST.

## How it's laid out

```
site/                 # everything that gets deployed
  index.html
  styles.css
  app.js
  products.js         # generated catalogue (selling prices only)
tools/
  generate_catalog.py # rebuilds site/products.js from a stock export
.github/workflows/
  deploy.yml          # auto-deploys site/ to GitHub Pages on push to main
```

## One-time setup: turn on GitHub Pages

1. Push to the `main` branch (the deploy workflow runs automatically).
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **GitHub Actions**.

That's it. Every push to `main` thereafter rebuilds and republishes the site.
The live URL appears in **Settings → Pages** and on each successful
**Actions → Deploy to GitHub Pages** run.

## Updating the catalogue when stock changes

The catalogue is generated from a Tally **Stock Summary** export (an `.xlsx`
with columns: *Particulars*, *Quantity*, *Rate*). Free-form product names are
classified into categories and filterable attributes automatically.

```bash
pip install openpyxl
python tools/generate_catalog.py path/to/StockSummary.xlsx
git add site/products.js && git commit -m "Update catalogue" && git push
```

Useful options:

- `--margin 0.08` — use an 8% margin instead of the default 5%.
- `--out some/other/products.js` — write elsewhere.
- `--sheet "Sheet1"` — pick a specific worksheet.

Rows that are out of stock, priced at near-zero (data glitches), or non-retail
(e.g. software services) are dropped automatically and listed in the output.

## On-order supplier lists

Items the counter doesn't stock but can source from a supplier live in
`site/onorder.js` (generated — don't hand-edit). They ride in the same
catalogue with an **On order** flag and an availability filter, and are priced
from the dealer cost (NLC) with the same margin rule as stock.

Each supplier list is a CSV in `tools/`, in one of three formats:

- **residential** — a brand's home-split range (columns:
  `series,capacity_ton,star,model,mrp,nlc`). Example:
  `tools/rohit_daikin_june2026.csv`. Two optional columns, `type` and
  `compressor`, override the per-row defaults (`Split` / inferred from the
  series name) — used for window units and fixed-speed models. Example:
  `tools/satisfaction_hitachi_april2026.csv`.
- **commercial** — a brand's commercial range: cassettes, tower, ducted
  (columns: `type,capacity_tr,compressor,mode,model,cbu,mrp,nlc`). Capacity is
  in TR and each unit carries an orderable CBU code. Example:
  `tools/rohit_voltas_july2026.csv`.
- **threshold** — a room-AC list that quotes only a *Min Threshold Price* — the
  company's floor price, with no model code and no MRP/NLC (columns:
  `segment,capacity_tr,star,series,threshold`). The threshold stands in for the
  cost basis, so it's priced by the same margin rule; Type/Compressor/Mode are
  derived from the product segment. Example: `tools/voltas_direct_july2026.csv`
  (Voltas' "Direct" list, ordered straight from the company).

Regenerate `onorder.js` from all lists in one run (they're combined in order —
list **every** source each time, or the omitted ones drop out of the file):

```bash
python tools/generate_supplier.py \
  --source tools/rohit_daikin_june2026.csv Daikin Rohit "June 2026" residential \
  --source tools/rohit_voltas_july2026.csv Voltas Rohit "July 2026" commercial \
  --source tools/voltas_direct_july2026.csv Voltas Direct "July 2026" threshold \
  --source tools/satisfaction_hitachi_april2026.csv Hitachi Satisfaction "April 2026" residential \
  --source tools/satisfaction_mitsubishi_april2026.csv "Mitsubishi Electric" Satisfaction "April 2026" residential
git add site/onorder.js && git commit -m "Update on-order lists" && git push
```

Each `--source` takes: CSV path, brand, one-word supplier, validity label, and
format. Only the cost basis drives the selling price; MRP (when known), cost and
any order code stay in the staff-only tap-to-reveal detail.

> Don't have Python handy? Keep the export file private and regenerate the
> catalogue however is convenient — the only rule is that **cost prices must
> never be committed**, only the marked-up selling prices in `products.js`.
