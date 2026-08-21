#!/usr/bin/env python3
"""Turn one or more supplier price lists (CSV) into site/onorder.js.

These are ON-ORDER items — things the counter doesn't stock, but can source for a
customer from a named supplier (one-word name, e.g. "Rohit"). They ride in the same
catalogue as in-stock products (same category, filters and search), flagged so the UI
can mark them clearly and price them from the dealer cost.

Pricing mirrors the in-stock rule: the supplier's dealer cost (NLC) is treated as the
GST-inclusive cost, written as `costIncl`, and the web app (site/app.js) applies the
same margin + rounding to produce the selling price. The list price (MRP) is carried
alongside for the staff-only tap-to-reveal detail.

Three CSV formats are supported, one per source, chosen by the source's FORMAT field:

  residential — brand's home-split range (e.g. Daikin, Hitachi). Columns:
      series,capacity_ton,star,model,mrp,nlc
      Optional columns type,compressor override the defaults ("Split" / inferred
      from the series name) per row — e.g. window units or fixed-speed models.

  commercial  — brand's commercial range (e.g. Voltas: cassettes, tower, ducted).
      Capacity is in TR, there is no star rating, and each unit carries an orderable
      CBU code. Columns:
      type,capacity_tr,compressor,mode,model,cbu,mrp,nlc

  threshold   — a room-AC list quoting only a Min Threshold Price (e.g. Voltas "Direct").
      No model code and no MRP/NLC: the threshold is the company's floor price and stands
      in for the cost basis, so the margin rule prices it like any other item. Type /
      Compressor / Mode are derived from the product segment. Columns:
      segment,capacity_tr,star,series,threshold

Every source is emitted into the SAME site/onorder.js, in the order given, so listing
several suppliers/brands in one run keeps them all. Do not hand-edit onorder.js —
re-run this generator instead.

Usage (both of Rohit's lists into one file):
    python tools/generate_supplier.py \
        --source tools/rohit_daikin_june2026.csv Daikin Rohit "June 2026" residential \
        --source tools/rohit_voltas_july2026.csv Voltas Rohit "July 2026" commercial

Stdlib only — no third-party dependencies.
"""
import argparse
import csv
import json
import os
import sys

# Long price-list series names -> short label used as a filter chip / tag (residential).
SERIES_LABELS = {
    "highest efficiency": "Highest Efficiency",
    "waizu": "Waizu",
    "wifi": "Wifi",
    "premium": "Premium",
    "standard": "Standard",
    "standard non inverter": "Standard",
    "hot & cold": "Hot & Cold",
    "hot and cold": "Hot & Cold",
}


def series_label(raw):
    return SERIES_LABELS.get(raw.strip().lower(), raw.strip())


def compressor_of(raw_series):
    return "Fixed Speed" if "non inverter" in raw_series.strip().lower() else "Inverter"


def ton_label(v):
    # Ton / TR / Tn all mean the same thing for ACs (tons of refrigeration).
    # Emit a single canonical "Ton" label so capacity filters and tags don't fragment.
    return f"{float(v):g} Ton"


def base_item(brand, supplier, valid, category, gst, name, attributes, nlc, mrp,
              code=None, cost_label=None):
    """Shared on-order item shape (see site/app.js for how it's rendered)."""
    item = {
        "name": name,
        "category": category,
        "attributes": attributes,
        "stock": 0,
        "onOrder": True,
        "supplier": supplier,
        "priceList": valid,
        "gst": gst,
        "costIncl": nlc,   # cost basis drives the selling price (see app.js)
    }
    if mrp is not None:
        item["mrp"] = mrp  # list price, shown in staff-only detail (omitted when unknown)
    if code:
        item["code"] = code  # orderable code, shown in staff-only detail + searchable
    if cost_label:
        item["costLabel"] = cost_label  # overrides the "Your cost (NLC)" detail-row label
    return item


def parse_residential(row, brand, supplier, valid, category, gst):
    raw_series = row["series"]
    ton = row["capacity_ton"].strip()
    star = row["star"].strip()
    model = row["model"].strip().upper()
    label = series_label(raw_series)
    # Type/compressor default to a split inverter, but a source may override per row
    # (e.g. window units, or fixed-speed models a series name can't reveal).
    unit_type = (row.get("type") or "").strip() or "Split"
    compressor = (row.get("compressor") or "").strip() or compressor_of(raw_series)
    name = f"{brand.upper()} {label.upper()} {float(ton):g}TON {star}* {model}"
    attributes = {
        "Brand": brand,
        "Type": unit_type,
        "Capacity": ton_label(ton),
        "Star Rating": f"{star} Star",
        "Compressor": compressor,
        "Series": label,
    }
    return base_item(brand, supplier, valid, category, gst, name, attributes,
                     int(round(float(row["nlc"]))), int(round(float(row["mrp"]))))


def parse_commercial(row, brand, supplier, valid, category, gst):
    tr = row["capacity_tr"].strip()
    model = row["model"].strip()
    cbu = row["cbu"].strip().upper()
    name = f"{brand.upper()} {model.upper()}"
    attributes = {
        "Brand": brand,
        "Type": row["type"].strip(),
        "Capacity": ton_label(tr),  # TR == Ton; unify the label with the rest of the catalogue
        "Compressor": row["compressor"].strip(),
        "Mode": row["mode"].strip(),
    }
    return base_item(brand, supplier, valid, category, gst, name, attributes,
                     int(round(float(row["nlc"]))), int(round(float(row["mrp"]))), code=cbu)


def parse_threshold(row, brand, supplier, valid, category, gst):
    """A room-AC list quoting only a Min Threshold Price (no model code, no MRP/NLC).

    The threshold is the company's floor price for the counter; it stands in for the
    cost basis, so the usual margin rule in app.js prices it exactly like every other
    on-order item. Type / Compressor / Mode are derived from the product segment.
    """
    segment = row["segment"].strip()
    seg = segment.lower()
    cap = float(row["capacity_tr"].strip())
    star = row["star"].strip()
    series = row["series"].strip()

    ac_type = "Window" if "window" in seg else "Split"
    compressor = "Fixed Speed" if "fixed speed" in seg else "Inverter"
    mode = "Hot & Cold" if ("hot & cold" in seg or "hot and cold" in seg) else "Cooling Only"

    hc = " HOT & COLD" if mode == "Hot & Cold" else ""
    name = (f"{brand.upper()} {series.upper()} {cap:g} TON {star} STAR "
            f"{ac_type.upper()} {compressor.upper()}{hc}")
    attributes = {
        "Brand": brand,
        "Type": ac_type,
        "Capacity": ton_label(cap),
        "Star Rating": f"{star} Star",
        "Compressor": compressor,
        "Mode": mode,
        "Series": series,
    }
    return base_item(brand, supplier, valid, category, gst, name, attributes,
                     int(round(float(row["threshold"]))), None,
                     cost_label="Min threshold price")


PARSERS = {
    "residential": parse_residential,
    "commercial": parse_commercial,
    "threshold": parse_threshold,
}


def read_source(path, brand, supplier, valid, fmt, category, gst):
    parse = PARSERS[fmt]
    items = []
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if not any((v or "").strip() for v in row.values()):
                continue  # skip fully-blank rows
            items.append(parse(row, brand, supplier, valid, category, gst))
    if not items:
        sys.exit(f"No rows read from {path}")
    return items


def main():
    ap = argparse.ArgumentParser(description="Generate site/onorder.js from supplier price-list CSVs.")
    ap.add_argument(
        "--source", nargs=5, action="append", required=True,
        metavar=("CSV", "BRAND", "SUPPLIER", "VALID", "FORMAT"),
        help='A supplier list: path, brand, one-word supplier, validity label, and format '
             '("residential" or "commercial"). Repeat --source to combine several lists.',
    )
    ap.add_argument("--category", default="Air Conditioner", help="Catalogue category (default: Air Conditioner)")
    ap.add_argument("--gst", type=int, default=18, help="GST rate, whole percent (default: 18)")
    ap.add_argument("--out", default=None, help="Output path (default: <repo>/site/onorder.js)")
    args = ap.parse_args()

    out = args.out or os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "site", "onorder.js"
    )

    items = []
    lines = []
    for csv_path, brand, supplier, valid, fmt in args.source:
        if fmt not in PARSERS:
            sys.exit(f"Unknown format {fmt!r} for {csv_path} (expected: {', '.join(PARSERS)})")
        src_items = read_source(csv_path, brand, supplier, valid, fmt, args.category, args.gst)
        items.extend(src_items)
        lines.append(f'//   {len(src_items):>3} · supplier "{supplier}" · {brand} · {valid} · {fmt}.')

    header = (
        "// Auto-generated by tools/generate_supplier.py — do not edit by hand.\n"
        "// On-order items sourced from a supplier, priced from dealer NLC:\n"
        + "\n".join(lines) + "\n"
        "// costIncl = dealer NLC (treated as GST-inclusive); selling price is computed in app.js.\n"
    )
    with open(out, "w", encoding="utf-8") as f:
        f.write(header + "const ONORDER = " + json.dumps(items, ensure_ascii=False, indent=2) + ";\n")

    print(f"Wrote {len(items)} on-order items to {out}")
    for csv_path, brand, supplier, valid, fmt in args.source:
        print(f"  {brand} · supplier {supplier} · valid {valid} · {fmt} ({csv_path})")


if __name__ == "__main__":
    main()
