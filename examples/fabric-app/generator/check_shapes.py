# SPDX-License-Identifier: Apache-2.0
"""
Print the evidence that the generated CSVs have the data shapes the model is built for.

    python check_shapes.py            # reads ../data
    python check_shapes.py data_dir

Each section names a chart type and prints the numbers that make it eligible (or not).
Requires numpy.
"""
from __future__ import annotations

import csv
import os
import sys
from collections import defaultdict

import numpy as np


def load(folder, name):
    with open(os.path.join(folder, name), encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh))


def terciles(values: dict[str, float]) -> dict[str, int]:
    keys = sorted(values, key=lambda k: (values[k], k))
    n = len(keys)
    return {k: min(2, (i * 3) // n) for i, k in enumerate(keys)}


def bivariate_grid(a: dict[str, float], b: dict[str, float]) -> np.ndarray:
    ta, tb = terciles(a), terciles(b)
    g = np.zeros((3, 3), dtype=int)
    for k in a:
        g[ta[k], tb[k]] += 1
    return g


def spearman(x, y) -> float:
    rx = np.argsort(np.argsort(x))
    ry = np.argsort(np.argsort(y))
    return float(np.corrcoef(rx, ry)[0, 1])


def main(folder: str) -> None:
    country = {r["CountryCode"]: r for r in load(folder, "DimCountry.csv")}
    city = {r["CityKey"]: r for r in load(folder, "DimCity.csv")}
    product = {r["ProductKey"]: r for r in load(folder, "DimProduct.csv")}
    dates = load(folder, "DimDate.csv")
    sales = load(folder, "FactSales.csv")
    ops = load(folder, "FactOperations.csv")
    target = load(folder, "FactRevenueTarget.csv")
    ships = load(folder, "FactShipments.csv")
    years = sorted({int(d["Year"]) for d in dates})
    last, prev = years[-1], years[-2]

    rev_cy = defaultdict(float); ord_cy = defaultdict(int); ret_cy = defaultdict(int); cust_cy = defaultdict(int)
    rev_m = defaultdict(float); rev_city = defaultdict(float)
    rev_rc = defaultdict(float); rev_ck = defaultdict(float)
    for r in sales:
        y = int(r["MonthStart"][:4]); c = r["CountryCode"]; v = float(r["RevenueUSD"])
        rev_cy[(c, y)] += v; ord_cy[(c, y)] += int(r["OrderCount"]); ret_cy[(c, y)] += int(r["ReturnCount"])
        cust_cy[(c, y)] += int(r["CustomerCount"]); rev_m[r["MonthStart"]] += v
        if y == last:
            rev_city[r["CityKey"]] += v
            rev_rc[(country[c]["Region"], r["Channel"])] += v
            rev_ck[(r["Channel"], product[r["ProductKey"]]["Category"])] += v
    print(f"FactSales {len(sales):,} rows | FactShipments {len(ships):,} | FactOperations {len(ops):,} | "
          f"FactRevenueTarget {len(target):,} | months {len(dates)} ({dates[0]['MonthStart']}..{dates[-1]['MonthStart']})")

    # ---------------------------------------------------------------- animated choropleth
    print("\n== Animated World Choropleth: Revenue by CountryCode (ISO-3) x Year")
    cells = [(c, y) for c in country for y in years if rev_cy.get((c, y), 0) > 0]
    print(f"   countries {len(country)}, ordered years {len(years)} ({years[0]}-{years[-1]}), "
          f"non-blank country-year cells {len(cells)} of {len(country) * len(years)}")
    growth = {c: (rev_cy[(c, last)] / rev_cy[(c, years[0])]) ** (1 / (len(years) - 1)) - 1 for c in country}
    top = sorted(growth, key=lambda c: -growth[c])
    print("   fastest CAGR: " + ", ".join(f"{c} {growth[c]:+.1%}" for c in top[:4])
          + " | slowest: " + ", ".join(f"{c} {growth[c]:+.1%}" for c in top[-3:]))

    # ---------------------------------------------------------------- bivariate
    print(f"\n== Bivariate World Choropleth ({last}, one row per country; terciles rows=first measure low..high)")
    rpc = {c: rev_cy[(c, last)] / int(country[c]["Population"]) for c in country}
    rr = {c: ret_cy[(c, last)] / ord_cy[(c, last)] for c in country}
    yoy = {c: rev_cy[(c, last)] / rev_cy[(c, prev)] - 1 for c in country}
    sat = defaultdict(lambda: [0, 0])
    for r in ops:
        if int(r["MonthStart"][:4]) == last:
            sat[r["CountryCode"]][0] += int(r["SatisfiedResponses"]); sat[r["CountryCode"]][1] += int(r["SurveyResponses"])
    csat = {c: sat[c][0] / sat[c][1] for c in country}
    pairs = [("Revenue per Capita", rpc, "Return Rate %", rr), ("Revenue YoY %", yoy, "Return Rate %", rr),
             ("Revenue per Capita", rpc, "CSAT %", csat)]
    for na, a, nb, b in pairs:
        g = bivariate_grid(a, b)
        ks = list(country)
        print(f"   {na} [{min(a.values()):.3g}..{max(a.values()):.3g}] vs {nb} [{min(b.values()):.3g}..{max(b.values()):.3g}]"
              f"  spearman {spearman([a[k] for k in ks], [b[k] for k in ks]):+.2f}  empty cells {int((g == 0).sum())}")
        for row in g:
            print("      " + " ".join(f"{v:3d}" for v in row))

    # ---------------------------------------------------------------- OD flow + chord
    print(f"\n== Origin-Destination Flow Map ({last} units by origin -> destination country)")
    od = defaultdict(int); rr_units = defaultdict(int); od_all = set()
    for r in ships:
        od_all.add((r["OriginCountryCode"], r["DestinationCountryCode"]))
        if int(r["MonthStart"][:4]) == last:
            od[(r["OriginCountryCode"], r["DestinationCountryCode"])] += int(r["UnitsShipped"])
            rr_units[(country[r["OriginCountryCode"]]["Region"], country[r["DestinationCountryCode"]]["Region"])] += int(r["UnitsShipped"])
    vals = sorted(od.values(), reverse=True)
    print(f"   OD lanes (all years) {len(od_all)}, active in {last}: {len(od)}, origins {len({o for o, _ in od})}, "
          f"destinations {len({d for _, d in od})}; median lane {int(np.median(vals)):,} units, top lane {vals[0]:,} "
          f"({vals[0] / np.median(vals):.0f}x median)")
    for (o, d), u in sorted(od.items(), key=lambda t: -t[1])[:8]:
        print(f"      {o} -> {d}  {u:>9,d}")

    print(f"\n== Chord diagram ({last} units, origin region -> destination region)")
    regs = sorted({country[c]["Region"] for c in country}, key=lambda r: int(next(x["RegionOrder"] for x in country.values() if x["Region"] == r)))
    print("      " + " ".join(f"{r[:10]:>11s}" for r in regs))
    for a in regs:
        print(f"   {a[:10]:>10s} " + " ".join(f"{rr_units.get((a, b), 0):>11,d}" for b in regs))
    bidir = sum(1 for i, a in enumerate(regs) for b in regs[i + 1:] if rr_units.get((a, b)) and rr_units.get((b, a)))
    print(f"   region pairs with flow in BOTH directions: {bidir} of {len(regs) * (len(regs) - 1) // 2}")

    # ---------------------------------------------------------------- sankey
    print(f"\n== Sankey: Region -> Channel -> Category ({last} revenue, USD M)")
    print(f"   edges Region->Channel {len(rev_rc)}, Channel->Category {len(rev_ck)} (limit 80)")
    for (a, b), v in sorted(rev_rc.items(), key=lambda t: -t[1])[:5]:
        print(f"      {a} -> {b}  {v / 1e6:,.1f}")
    for (a, b), v in sorted(rev_ck.items(), key=lambda t: -t[1]):
        print(f"      {a} -> {b}  {v / 1e6:,.1f}")

    # ---------------------------------------------------------------- what-if
    months = sorted(rev_m)
    tgt_m = defaultdict(float)
    for r in target:
        tgt_m[r["MonthStart"]] += float(r["TargetRevenueUSD"])
    print(f"\n== What-if projection / scenarios: monthly Revenue with Revenue Target")
    print(f"   periods {len(months)} ({months[0]}..{months[-1]}); first {rev_m[months[0]] / 1e6:,.1f}M, "
          f"last {rev_m[months[-1]] / 1e6:,.1f}M; months with a target {len(tgt_m)}")
    for y in years:
        a = sum(v for k, v in rev_m.items() if k.startswith(str(y))); t = sum(v for k, v in tgt_m.items() if k.startswith(str(y)))
        print(f"      {y}: revenue {a / 1e6:,.0f}M  target {t / 1e6:,.0f}M  attainment {a / t:.1%}")
    gr = [round(-0.10 + 0.025 * i, 4) for i in range(17)]
    print(f"   Growth Rate parameter GENERATESERIES(-0.10, 0.30, 0.025): {len(gr)} values {gr[0]:+.1%}..{gr[-1]:+.1%}")

    # ---------------------------------------------------------------- predictor
    print("\n== What-if predictor: one row per Country x Year")
    mk = defaultdict(float); hc = defaultdict(list)
    for r in ops:
        k = (r["CountryCode"], int(r["MonthStart"][:4]))
        mk[k] += float(r["MarketingSpendUSD"]); hc[k].append(float(r["HeadcountFTE"]))
    keys = sorted(rev_cy)
    names = ["Marketing Spend", "Customers", "Orders", "Revenue", "Avg Order Value", "Headcount"]
    X = np.array([[mk[k], cust_cy[k], ord_cy[k], rev_cy[k], rev_cy[k] / ord_cy[k], np.mean(hc[k])] for k in keys])
    print(f"   rows {len(keys)}")
    for label, M in (("Pearson", X), ("Pearson on log values", np.log(X))):
        cm = np.corrcoef(M.T)
        print(f"   {label}:")
        print("      " + " ".join(f"{n[:9]:>9s}" for n in names))
        for n, row in zip(names, cm):
            print(f"      {n[:9]:>9s} " + " ".join(f"{v:9.2f}" for v in row))
    # joint linear fit: revenue from the other drivers (not the Orders x AOV identity)
    for label, M in (("raw", X), ("log", np.log(X))):
        A = np.column_stack([M[:, [0, 1, 5]], np.ones(len(M))])
        y = M[:, 3]
        coef, *_ = np.linalg.lstsq(A, y, rcond=None)
        r2 = 1 - ((y - A @ coef) ** 2).sum() / ((y - y.mean()) ** 2).sum()
        print(f"   R^2 of Revenue ~ Marketing Spend + Customers + Headcount ({label}): {r2:.3f}")

    # ---------------------------------------------------------------- beeswarm / points
    print(f"\n== Beeswarm / point maps: cities ({last} revenue by CityTier)")
    tiers = defaultdict(list)
    for k, v in rev_city.items():
        tiers[city[k]["CityTier"]].append(v / 1e6)
    for t in sorted(tiers):
        v = np.array(tiers[t])
        print(f"   {t}: {len(v)} cities, revenue USD M min {v.min():.1f} / median {np.median(v):.1f} / max {v.max():.1f}")
    print(f"   cities with lat/lon: {sum(1 for c in city.values() if c['Latitude'] and c['Longitude'])} of {len(city)}, "
          f"in {len({c['CountryCode'] for c in city.values()})} countries")


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    main(os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "..", "data")))
