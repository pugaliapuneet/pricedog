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

> Don't have Python handy? Keep the export file private and regenerate the
> catalogue however is convenient — the only rule is that **cost prices must
> never be committed**, only the marked-up selling prices in `products.js`.
