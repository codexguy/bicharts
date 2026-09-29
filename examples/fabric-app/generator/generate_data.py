# SPDX-License-Identifier: Apache-2.0
"""
Deterministic synthetic data for the Global Revenue v2 demo semantic model.

Writes every CSV the model reads into ../data (or the folder given as the first
argument). Re-running produces byte-identical files: all randomness comes from
named, fixed-seed streams, numbers are written with fixed precision, and rows are
written in a fixed order with LF line endings.

    python generate_data.py            # writes ../data/*.csv
    python generate_data.py out_dir    # writes out_dir/*.csv

The data is fictional. Country centroids, city coordinates and populations are
real (approximate) reference values; every revenue, order, shipment and target
figure is simulated.
"""
from __future__ import annotations

import csv
import hashlib
import math
import os
import random
import sys
from collections import defaultdict

SEED = "global-revenue-v2"
FIRST_YEAR, LAST_YEAR = 2019, 2025
MONTHS = [(y, m) for y in range(FIRST_YEAR, LAST_YEAR + 1) for m in range(1, 13)]


def rng(stream: str) -> random.Random:
    """One independent, fixed-seed random stream per logical purpose, so changing
    one table's generation never shifts the numbers of another."""
    h = hashlib.sha256(f"{SEED}|{stream}".encode("utf-8")).hexdigest()
    return random.Random(int(h[:16], 16))


# --------------------------------------------------------------------------- reference data

REGIONS = ["North America", "Latin America", "Europe", "Middle East & Africa", "Asia Pacific"]
NA, LA, EU, MEA, AP = REGIONS

# code, iso2, name, region, subregion, lat, lon, population (approx. 2023),
# base 2019 revenue (USD M), base annual growth, hardware return rate, CSAT base,
# price index, marketing-to-revenue ratio, revenue per FTE (USD K / year)
COUNTRIES = [
    ("USA", "US", "United States", NA, "Northern America", 37.09, -95.71, 334914895, 420, 0.060, 0.075, 0.84, 1.00, 0.10, 620),
    ("CAN", "CA", "Canada", NA, "Northern America", 56.13, -106.35, 40097761, 55, 0.050, 0.070, 0.86, 0.98, 0.09, 520),
    ("MEX", "MX", "Mexico", LA, "Central America", 23.63, -102.55, 128455567, 38, 0.080, 0.060, 0.80, 0.85, 0.12, 380),
    ("BRA", "BR", "Brazil", LA, "South America", -14.24, -51.93, 216422446, 60, 0.070, 0.085, 0.78, 0.90, 0.13, 360),
    ("ARG", "AR", "Argentina", LA, "South America", -38.42, -63.62, 46654581, 14, 0.050, 0.090, 0.74, 0.88, 0.11, 300),
    ("CHL", "CL", "Chile", LA, "South America", -35.68, -71.54, 19629590, 12, 0.070, 0.050, 0.85, 0.92, 0.08, 420),
    ("COL", "CO", "Colombia", LA, "South America", 4.57, -74.30, 52085168, 11, 0.100, 0.070, 0.81, 0.82, 0.12, 330),
    ("PER", "PE", "Peru", LA, "South America", -9.19, -75.02, 34352719, 7, 0.090, 0.055, 0.83, 0.80, 0.10, 310),
    ("GBR", "GB", "United Kingdom", EU, "Northern Europe", 55.38, -3.44, 68350000, 120, 0.030, 0.095, 0.82, 1.02, 0.09, 560),
    ("FRA", "FR", "France", EU, "Western Europe", 46.23, 2.21, 68170228, 85, 0.025, 0.080, 0.79, 1.00, 0.08, 540),
    ("DEU", "DE", "Germany", EU, "Western Europe", 51.17, 10.45, 84482267, 140, 0.030, 0.130, 0.80, 1.01, 0.07, 600),
    ("ITA", "IT", "Italy", EU, "Southern Europe", 41.87, 12.57, 58993475, 50, 0.005, 0.060, 0.77, 0.95, 0.08, 470),
    ("ESP", "ES", "Spain", EU, "Southern Europe", 40.46, -3.75, 48373336, 45, 0.040, 0.070, 0.83, 0.93, 0.09, 460),
    ("NLD", "NL", "Netherlands", EU, "Western Europe", 52.13, 5.29, 17879488, 42, 0.045, 0.110, 0.85, 1.03, 0.08, 640),
    ("SWE", "SE", "Sweden", EU, "Northern Europe", 60.13, 18.64, 10536632, 28, 0.035, 0.090, 0.88, 1.05, 0.07, 610),
    ("NOR", "NO", "Norway", EU, "Northern Europe", 60.47, 8.47, 5519594, 22, 0.030, 0.085, 0.90, 1.12, 0.06, 650),
    ("POL", "PL", "Poland", EU, "Eastern Europe", 51.92, 19.15, 36685849, 18, 0.120, 0.065, 0.82, 0.84, 0.11, 400),
    ("CHE", "CH", "Switzerland", EU, "Western Europe", 46.82, 8.23, 8849852, 38, 0.025, 0.050, 0.91, 1.15, 0.06, 700),
    ("IRL", "IE", "Ireland", EU, "Northern Europe", 53.41, -8.24, 5262382, 26, 0.070, 0.080, 0.87, 1.04, 0.08, 680),
    ("TUR", "TR", "Türkiye", MEA, "Western Asia", 38.96, 35.24, 85326000, 20, 0.090, 0.100, 0.76, 0.80, 0.12, 330),
    ("ARE", "AE", "United Arab Emirates", MEA, "Western Asia", 23.42, 53.85, 9516871, 30, 0.170, 0.045, 0.89, 1.08, 0.10, 650),
    ("SAU", "SA", "Saudi Arabia", MEA, "Western Asia", 23.89, 45.08, 36947025, 26, 0.140, 0.060, 0.84, 1.05, 0.11, 560),
    ("ISR", "IL", "Israel", MEA, "Western Asia", 31.05, 34.85, 9756700, 22, 0.060, 0.070, 0.83, 1.03, 0.08, 600),
    ("EGY", "EG", "Egypt", MEA, "Northern Africa", 26.82, 30.80, 112716598, 6, 0.100, 0.090, 0.72, 0.70, 0.14, 250),
    ("MAR", "MA", "Morocco", MEA, "Northern Africa", 31.79, -7.09, 37840044, 4, 0.090, 0.075, 0.78, 0.75, 0.12, 260),
    ("ZAF", "ZA", "South Africa", MEA, "Sub-Saharan Africa", -30.56, 22.94, 60414495, 14, 0.050, 0.100, 0.75, 0.82, 0.10, 320),
    ("NGA", "NG", "Nigeria", MEA, "Sub-Saharan Africa", 9.08, 8.68, 223804632, 5, 0.180, 0.120, 0.70, 0.72, 0.15, 240),
    ("KEN", "KE", "Kenya", MEA, "Sub-Saharan Africa", -0.02, 37.91, 55100586, 3, 0.130, 0.080, 0.79, 0.74, 0.13, 250),
    ("CHN", "CN", "China", AP, "Eastern Asia", 35.86, 104.20, 1410710000, 150, 0.110, 0.040, 0.81, 0.88, 0.09, 420),
    ("JPN", "JP", "Japan", AP, "Eastern Asia", 36.20, 138.25, 124516650, 110, -0.010, 0.030, 0.88, 1.02, 0.06, 540),
    ("KOR", "KR", "South Korea", AP, "Eastern Asia", 35.91, 127.77, 51712619, 48, 0.050, 0.050, 0.86, 0.97, 0.08, 560),
    ("IND", "IN", "India", AP, "Southern Asia", 20.59, 78.96, 1428627663, 40, 0.300, 0.110, 0.80, 0.72, 0.12, 280),
    ("SGP", "SG", "Singapore", AP, "South-eastern Asia", 1.35, 103.82, 5917600, 36, 0.080, 0.040, 0.90, 1.08, 0.07, 720),
    ("IDN", "ID", "Indonesia", AP, "South-eastern Asia", -0.79, 113.92, 277534122, 12, 0.120, 0.085, 0.79, 0.78, 0.13, 300),
    ("THA", "TH", "Thailand", AP, "South-eastern Asia", 15.87, 100.99, 71801279, 10, 0.070, 0.060, 0.84, 0.82, 0.10, 340),
    ("VNM", "VN", "Vietnam", AP, "South-eastern Asia", 14.06, 108.28, 98858950, 6, 0.260, 0.070, 0.83, 0.75, 0.12, 290),
    ("PHL", "PH", "Philippines", AP, "South-eastern Asia", 12.88, 121.77, 117337368, 7, 0.110, 0.095, 0.80, 0.76, 0.13, 280),
    ("MYS", "MY", "Malaysia", AP, "South-eastern Asia", 4.21, 101.98, 34308525, 11, 0.080, 0.055, 0.85, 0.85, 0.09, 380),
    ("AUS", "AU", "Australia", AP, "Australia and New Zealand", -25.27, 133.78, 26638544, 60, 0.045, 0.075, 0.85, 1.06, 0.08, 610),
    ("NZL", "NZ", "New Zealand", AP, "Australia and New Zealand", -40.90, 174.89, 5223100, 10, 0.040, 0.065, 0.87, 1.04, 0.08, 580),
]
C = {row[0]: dict(code=row[0], iso2=row[1], name=row[2], region=row[3], subregion=row[4], lat=row[5],
                  lon=row[6], pop=row[7], base=row[8] * 1e6, g=row[9], rr=row[10], csat=row[11],
                  price=row[12], mkt=row[13], prod=row[14] * 1e3) for row in COUNTRIES}
CODES = [row[0] for row in COUNTRIES]

# CityKey = ISO-3 country + "-" + the metro's 3-letter code. Real coordinates.
CITIES = [
    ("USA", "NYC", "New York", 1, 40.71, -74.01), ("USA", "LAX", "Los Angeles", 1, 34.05, -118.24),
    ("USA", "CHI", "Chicago", 1, 41.88, -87.63), ("USA", "DFW", "Dallas", 2, 32.78, -96.80),
    ("USA", "SEA", "Seattle", 2, 47.61, -122.33), ("USA", "ATL", "Atlanta", 2, 33.75, -84.39),
    ("CAN", "YTO", "Toronto", 1, 43.65, -79.38), ("CAN", "YVR", "Vancouver", 2, 49.28, -123.12),
    ("CAN", "YMQ", "Montréal", 2, 45.50, -73.57),
    ("MEX", "MEX", "Mexico City", 1, 19.43, -99.13), ("MEX", "MTY", "Monterrey", 2, 25.69, -100.32),
    ("MEX", "GDL", "Guadalajara", 3, 20.66, -103.35),
    ("BRA", "SAO", "São Paulo", 1, -23.55, -46.63), ("BRA", "RIO", "Rio de Janeiro", 2, -22.91, -43.17),
    ("BRA", "BHZ", "Belo Horizonte", 3, -19.92, -43.94),
    ("ARG", "BUE", "Buenos Aires", 1, -34.60, -58.38), ("CHL", "SCL", "Santiago", 2, -33.45, -70.67),
    ("COL", "BOG", "Bogotá", 2, 4.71, -74.07), ("PER", "LIM", "Lima", 2, -12.05, -77.04),
    ("GBR", "LON", "London", 1, 51.51, -0.13), ("GBR", "MAN", "Manchester", 2, 53.48, -2.24),
    ("GBR", "EDI", "Edinburgh", 3, 55.95, -3.19),
    ("FRA", "PAR", "Paris", 1, 48.86, 2.35), ("FRA", "LYS", "Lyon", 2, 45.76, 4.84),
    ("FRA", "MRS", "Marseille", 3, 43.30, 5.37),
    ("DEU", "BER", "Berlin", 1, 52.52, 13.40), ("DEU", "MUC", "Munich", 1, 48.14, 11.58),
    ("DEU", "HAM", "Hamburg", 2, 53.55, 9.99),
    ("ITA", "MIL", "Milan", 1, 45.46, 9.19), ("ITA", "ROM", "Rome", 2, 41.90, 12.50),
    ("ESP", "MAD", "Madrid", 1, 40.42, -3.70), ("ESP", "BCN", "Barcelona", 2, 41.39, 2.17),
    ("NLD", "AMS", "Amsterdam", 1, 52.37, 4.90), ("SWE", "STO", "Stockholm", 2, 59.33, 18.07),
    ("NOR", "OSL", "Oslo", 2, 59.91, 10.75),
    ("POL", "WAW", "Warsaw", 2, 52.23, 21.01), ("POL", "KRK", "Kraków", 3, 50.06, 19.94),
    ("CHE", "ZRH", "Zürich", 2, 47.38, 8.54), ("IRL", "DUB", "Dublin", 2, 53.35, -6.26),
    ("TUR", "IST", "Istanbul", 1, 41.01, 28.98),
    ("ARE", "DXB", "Dubai", 1, 25.20, 55.27), ("ARE", "AUH", "Abu Dhabi", 2, 24.45, 54.38),
    ("SAU", "RUH", "Riyadh", 2, 24.71, 46.68), ("ISR", "TLV", "Tel Aviv", 2, 32.09, 34.78),
    ("EGY", "CAI", "Cairo", 2, 30.04, 31.24), ("MAR", "CAS", "Casablanca", 3, 33.57, -7.59),
    ("ZAF", "JNB", "Johannesburg", 2, -26.20, 28.05), ("ZAF", "CPT", "Cape Town", 3, -33.92, 18.42),
    ("NGA", "LOS", "Lagos", 2, 6.52, 3.38), ("KEN", "NBO", "Nairobi", 3, -1.29, 36.82),
    ("CHN", "SHA", "Shanghai", 1, 31.23, 121.47), ("CHN", "BJS", "Beijing", 1, 39.90, 116.41),
    ("CHN", "SZX", "Shenzhen", 1, 22.54, 114.06),
    ("JPN", "TYO", "Tokyo", 1, 35.68, 139.69), ("JPN", "OSA", "Osaka", 2, 34.69, 135.50),
    ("KOR", "SEL", "Seoul", 1, 37.57, 126.98),
    ("IND", "BOM", "Mumbai", 1, 19.08, 72.88), ("IND", "BLR", "Bengaluru", 1, 12.97, 77.59),
    ("IND", "DEL", "Delhi", 1, 28.61, 77.21), ("IND", "MAA", "Chennai", 2, 13.08, 80.27),
    ("SGP", "SIN", "Singapore", 1, 1.35, 103.82), ("IDN", "JKT", "Jakarta", 2, -6.21, 106.85),
    ("THA", "BKK", "Bangkok", 2, 13.76, 100.50),
    ("VNM", "SGN", "Ho Chi Minh City", 2, 10.82, 106.63), ("VNM", "HAN", "Hanoi", 3, 21.03, 105.85),
    ("PHL", "MNL", "Manila", 2, 14.60, 120.98), ("MYS", "KUL", "Kuala Lumpur", 2, 3.14, 101.69),
    ("AUS", "SYD", "Sydney", 1, -33.87, 151.21), ("AUS", "MEL", "Melbourne", 2, -37.81, 144.96),
    ("AUS", "BNE", "Brisbane", 3, -27.47, 153.03), ("NZL", "AKL", "Auckland", 3, -36.85, 174.76),
]
TIER_WEIGHT = {1: 1.0, 2: 0.45, 3: 0.2}

# key, product, line, category, list price, units/order, standard cost, weight kg, base share, share trend / yr
PRODUCTS = [
    ("HW-LAP", "Laptop Pro 14", "Computing", "Hardware", 1350, 1.3, 900, 2.0, 0.20, -0.02),
    ("HW-WKS", "Workstation X", "Computing", "Hardware", 2600, 1.2, 1800, 9.0, 0.09, 0.00),
    ("HW-TAB", "Tablet 11", "Mobile Devices", "Hardware", 620, 1.3, 380, 0.7, 0.09, -0.04),
    ("AC-DCK", "USB-C Dock", "Peripherals", "Accessories", 240, 1.8, 120, 0.6, 0.05, 0.01),
    ("AC-HDS", "Noise-Cancelling Headset", "Peripherals", "Accessories", 110, 2.2, 45, 0.3, 0.05, 0.02),
    ("SW-OFF", "Office Suite", "Productivity Software", "Software", 240, 6.0, 0, 0.0, 0.17, 0.03),
    ("SW-SEC", "Endpoint Security", "Security Software", "Software", 90, 10.0, 0, 0.0, 0.09, 0.06),
    ("SW-ANL", "Analytics Cloud", "Data & Analytics", "Software", 1800, 1.0, 0, 0.0, 0.07, 0.12),
    ("SV-IMP", "Implementation Services", "Professional Services", "Services", 16000, 1.0, 0, 0.0, 0.10, 0.00),
    ("SV-SUP", "Premium Support Plan", "Support", "Services", 2200, 1.0, 0, 0.0, 0.09, 0.04),
]
P = {r[0]: dict(key=r[0], name=r[1], line=r[2], cat=r[3], price=r[4], upo=r[5], cost=r[6], kg=r[7],
                share=r[8], trend=r[9]) for r in PRODUCTS}
PKEYS = [r[0] for r in PRODUCTS]
PHYSICAL = [k for k in PKEYS if P[k]["cat"] in ("Hardware", "Accessories")]
CATEGORIES = ["Hardware", "Accessories", "Software", "Services"]
FIXED_UNIT = {"SW-ANL", "SV-IMP", "SV-SUP"}   # one unit per order, whatever the channel

CHANNELS = [("Online", "Web store and marketplace orders placed directly by customers", 1),
            ("Retail", "Orders through physical stores and consumer-electronics retailers", 2),
            ("Partner", "Orders through resellers, system integrators and managed-service partners", 3)]

# channel base shares by category and region (only channels that sell the category appear)
CHANNEL_MIX = {
    "Hardware": {NA: {"Online": .45, "Retail": .30, "Partner": .25}, LA: {"Online": .25, "Retail": .50, "Partner": .25},
                 EU: {"Online": .40, "Retail": .30, "Partner": .30}, MEA: {"Online": .25, "Retail": .40, "Partner": .35},
                 AP: {"Online": .50, "Retail": .30, "Partner": .20}},
    "Accessories": {NA: {"Online": .60, "Retail": .40}, LA: {"Online": .35, "Retail": .65}, EU: {"Online": .55, "Retail": .45},
                    MEA: {"Online": .35, "Retail": .65}, AP: {"Online": .65, "Retail": .35}},
    "Software": {NA: {"Online": .55, "Partner": .45}, LA: {"Online": .35, "Partner": .65}, EU: {"Online": .40, "Partner": .60},
                 MEA: {"Online": .30, "Partner": .70}, AP: {"Online": .50, "Partner": .50}},
    "Services": {r: {"Partner": 1.0} for r in REGIONS},
}
CHANNEL_UPO = {"Online": 1.0, "Retail": 0.9, "Partner": 5.0}
CHANNEL_PRICE = {"Online": 1.0, "Retail": 1.04, "Partner": 0.86}
CHANNEL_RETURNS = {"Online": 1.35, "Retail": 0.85, "Partner": 0.55}
CATEGORY_RETURNS = {"Hardware": 1.0, "Accessories": 1.25, "Software": 0.12, "Services": 0.02}
ORDERS_PER_CUSTOMER = {"Online": 1.12, "Retail": 1.04, "Partner": 2.2}

SEASON = [0.88, 0.90, 1.02, 0.95, 0.97, 1.03, 0.92, 0.90, 1.02, 1.03, 1.12, 1.26]
SEASON = [s * 12 / sum(SEASON) for s in SEASON]

REGION_SHOCK = {
    2020: {NA: -0.07, LA: -0.10, EU: -0.06, MEA: -0.04, AP: 0.00},
    2021: {NA: 0.06, LA: 0.08, EU: 0.05, MEA: 0.03, AP: 0.04},
    2023: {EU: -0.02},
    2025: {AP: 0.01},
}
COUNTRY_SHOCK = {
    "ARG": {2019: -0.06, 2023: -0.14, 2024: 0.10},
    "NGA": {2023: -0.20, 2024: -0.05},
    "EGY": {2023: -0.12},
    "TUR": {2021: -0.08, 2022: -0.10},
    "GBR": {2020: -0.03},
}
PLAN_GROWTH = {NA: 0.07, LA: 0.10, EU: 0.05, MEA: 0.12, AP: 0.11}
PLAN_OVERRIDE = {"CHN": 0.12, "IND": 0.25, "JPN": 0.02}   # CHN plans for growth it no longer gets


def annual_growth(code: str, year: int) -> float:
    c = C[code]
    if code == "CHN" and year >= 2023:
        return 0.015
    return c["g"] + REGION_SHOCK.get(year, {}).get(c["region"], 0.0) + COUNTRY_SHOCK.get(code, {}).get(year, 0.0)


# --------------------------------------------------------------------------- helpers

def poisson(r: random.Random, lam: float) -> int:
    if lam <= 0:
        return 0
    if lam > 30:
        return max(0, int(round(lam + math.sqrt(lam) * r.gauss(0, 1))))
    limit, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= r.random()
        if p <= limit:
            return k
        k += 1


def binomial(r: random.Random, n: int, p: float) -> int:
    if n <= 0 or p <= 0:
        return 0
    if n < 60:
        return sum(1 for _ in range(n) if r.random() < p)
    mu, sd = n * p, math.sqrt(n * p * (1 - p))
    return min(n, max(0, int(round(mu + sd * r.gauss(0, 1)))))


def haversine_km(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(a))


def month_start(y: int, m: int) -> str:
    return f"{y:04d}-{m:02d}-01"


def f2(x: float) -> str:
    return f"{x:.2f}"


def write_csv(folder: str, name: str, header: list[str], rows) -> int:
    path = os.path.join(folder, name)
    n = 0
    with open(path, "w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh, lineterminator="\n", quoting=csv.QUOTE_MINIMAL)
        w.writerow(header)
        for row in rows:
            w.writerow(row)
            n += 1
    return n


# --------------------------------------------------------------------------- generation

def build(out: str) -> dict[str, int]:
    os.makedirs(out, exist_ok=True)
    counts: dict[str, int] = {}

    # ---- dimensions
    region_order = {r: i + 1 for i, r in enumerate(REGIONS)}
    counts["DimCountry.csv"] = write_csv(out, "DimCountry.csv",
        ["CountryCode", "CountryISO2", "Country", "Region", "RegionOrder", "Subregion", "Latitude", "Longitude", "Population"],
        [[k, C[k]["iso2"], C[k]["name"], C[k]["region"], region_order[C[k]["region"]], C[k]["subregion"],
          f2(C[k]["lat"]), f2(C[k]["lon"]), C[k]["pop"]] for k in CODES])

    city_rows = []
    for cc, code, name, tier, lat, lon in CITIES:
        city_rows.append([f"{cc}-{code}", name, cc, f"Tier {tier}", tier, f2(lat), f2(lon)])
    counts["DimCity.csv"] = write_csv(out, "DimCity.csv",
        ["CityKey", "City", "CountryCode", "CityTier", "CityTierRank", "Latitude", "Longitude"], city_rows)

    counts["DimProduct.csv"] = write_csv(out, "DimProduct.csv",
        ["ProductKey", "Product", "ProductLine", "Category", "IsShippable", "ListPriceUSD", "StandardCostUSD", "UnitWeightKg"],
        [[k, P[k]["name"], P[k]["line"], P[k]["cat"], "true" if k in PHYSICAL else "false",
          f2(P[k]["price"]), f2(P[k]["cost"]), f2(P[k]["kg"])] for k in PKEYS])

    counts["DimChannel.csv"] = write_csv(out, "DimChannel.csv", ["Channel", "ChannelDescription", "ChannelOrder"],
                                         [list(c) for c in CHANNELS])

    month_names = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
                   "October", "November", "December"]
    date_rows = []
    for i, (y, m) in enumerate(MONTHS):
        q = (m - 1) // 3 + 1
        date_rows.append([month_start(y, m), y, q, f"Q{q}", f"{y} Q{q}", m, month_names[m - 1],
                          month_names[m - 1][:3], f"{y}-{m:02d}", i])
    counts["DimDate.csv"] = write_csv(out, "DimDate.csv",
        ["MonthStart", "Year", "Quarter", "QuarterLabel", "YearQuarter", "MonthNumber", "MonthName", "MonthShort",
         "YearMonth", "MonthIndex"], date_rows)

    # ---- country operating styles: how hard each country markets, how lean it is staffed and how
    # loyal its customers are differ well beyond what size explains, and budgets move year to year
    r_style = rng("country-style")
    mkt_ratio = {code: C[code]["mkt"] * r_style.lognormvariate(0, 0.40) for code in CODES}
    productivity = {code: C[code]["prod"] * r_style.lognormvariate(0, 0.35) for code in CODES}
    loyalty = {code: r_style.lognormvariate(0, 0.20) for code in CODES}
    budget = {(code, y): r_style.lognormvariate(0, 0.25) for code in CODES for y in range(FIRST_YEAR, LAST_YEAR + 1)}
    hiring = {(code, y): r_style.lognormvariate(0, 0.10) for code in CODES for y in range(FIRST_YEAR, LAST_YEAR + 1)}

    # ---- latent country-month demand
    r_level = rng("country-month-demand")
    r_mkt = rng("marketing")
    level = {}        # (code, i) -> underlying monthly revenue run-rate before season/noise
    demand = {}       # (code, i) -> realised monthly demand incl. season, marketing uplift, noise
    mkt_spend = {}
    for code in CODES:
        lv = C[code]["base"] / 12.0
        for i, (y, m) in enumerate(MONTHS):
            if i > 0:
                lv *= math.exp(math.log(1 + annual_growth(code, y)) / 12.0)
            level[(code, i)] = lv
            mnoise = budget[(code, y)] * r_mkt.lognormvariate(0, 0.15)
            spend = lv * SEASON[m - 1] * mkt_ratio[code] * mnoise
            uplift = mnoise ** 0.3
            demand[(code, i)] = lv * SEASON[m - 1] * uplift * r_level.lognormvariate(0, 0.04)
            mkt_spend[(code, i)] = spend

    # ---- fixed structural tilts
    r_tilt = rng("tilts")
    city_share = {}
    by_country = defaultdict(list)
    for cc, code, name, tier, lat, lon in CITIES:
        by_country[cc].append((f"{cc}-{code}", tier))
    for cc, lst in by_country.items():
        ws = [TIER_WEIGHT[t] * r_tilt.uniform(0.75, 1.25) for _, t in lst]
        tot = sum(ws)
        for (key, _), w in zip(lst, ws):
            city_share[key] = w / tot
    product_tilt = {(cc, k): r_tilt.lognormvariate(0, 0.20) for cc in CODES for k in PKEYS}

    # ---- FactSales
    r_sales = rng("sales")
    sales_rows = []
    units_physical = defaultdict(float)     # (dest code, i, product) -> units sold
    cust_cm = defaultdict(int)
    rev_cm = defaultdict(float)
    for i, (y, m) in enumerate(MONTHS):
        yrs = (y - FIRST_YEAR) + (m - 1) / 12.0
        covid = (y == 2020 and 4 <= m <= 6)
        for cc, code, cname, tier, lat, lon in CITIES:
            ckey = f"{cc}-{code}"
            region = C[cc]["region"]
            # product shares with trend, normalised within the country-month
            pw = {k: P[k]["share"] * product_tilt[(cc, k)] * (1 + P[k]["trend"]) ** yrs for k in PKEYS}
            ptot = sum(pw.values())
            for k in PKEYS:
                cat = P[k]["cat"]
                mix = dict(CHANNEL_MIX[cat][region])
                if tier == 3:
                    mix.pop("Partner", None)
                if not mix:
                    continue
                if "Online" in mix:
                    mix["Online"] *= (1 + 0.05 * yrs)
                mtot = sum(mix.values())
                for ch in ("Online", "Retail", "Partner"):
                    if ch not in mix:
                        continue
                    share = mix[ch] / mtot
                    if covid:
                        share *= {"Online": 1.25, "Retail": 0.45, "Partner": 0.85}[ch]
                    if ch == "Partner" and m in (3, 6, 9, 12):
                        share *= 1.15
                    expected = demand[(cc, i)] * city_share[ckey] * (pw[k] / ptot) * share
                    expected *= r_sales.lognormvariate(0, 0.08)
                    upo = 1.0 if k in FIXED_UNIT else P[k]["upo"] * CHANNEL_UPO[ch]
                    aov = P[k]["price"] * C[cc]["price"] * CHANNEL_PRICE[ch] * upo
                    orders = poisson(r_sales, expected / aov)
                    if orders <= 0:
                        continue
                    revenue = orders * aov * r_sales.lognormvariate(0, 0.04)
                    units = orders if k in FIXED_UNIT else max(orders, int(round(orders * upo * r_sales.lognormvariate(0, 0.05))))
                    opc = ORDERS_PER_CUSTOMER[ch] * loyalty[cc] * r_sales.lognormvariate(0, 0.05)
                    customers = max(1, min(orders, int(round(orders / opc))))
                    p_ret = min(0.5, C[cc]["rr"] * CATEGORY_RETURNS[cat] * CHANNEL_RETURNS[ch])
                    returns = binomial(r_sales, orders, p_ret)
                    sales_rows.append([month_start(y, m), ckey, cc, k, ch, orders, units, f2(revenue), customers, returns])
                    if k in PHYSICAL:
                        units_physical[(cc, i, k)] += units
                    cust_cm[(cc, i)] += customers
                    rev_cm[(cc, i)] += revenue
    counts["FactSales.csv"] = write_csv(out, "FactSales.csv",
        ["MonthStart", "CityKey", "CountryCode", "ProductKey", "Channel", "OrderCount", "UnitsSold", "RevenueUSD",
         "CustomerCount", "ReturnCount"], sales_rows)

    # ---- FactOperations (country x month)
    r_ops = rng("operations")
    ops_rows = []
    for code in CODES:
        hc = None
        for i, (y, m) in enumerate(MONTHS):
            if hc is None or m in (1, 4, 7, 10):     # headcount is re-planned quarterly
                target_hc = level[(code, i)] * 12 / productivity[code] * hiring[(code, y)]
                hc = max(3.0, target_hc * r_ops.lognormvariate(0, 0.04))
            csat = C[code]["csat"] + 0.004 * (y - FIRST_YEAR) + r_ops.gauss(0, 0.012)
            csat = min(0.97, max(0.55, csat))
            responses = max(25, int(round(cust_cm[(code, i)] * 0.04)))
            satisfied = binomial(r_ops, responses, csat)
            ops_rows.append([month_start(y, m), code, f2(mkt_spend[(code, i)]), f"{hc:.1f}", responses, satisfied])
    counts["FactOperations.csv"] = write_csv(out, "FactOperations.csv",
        ["MonthStart", "CountryCode", "MarketingSpendUSD", "HeadcountFTE", "SurveyResponses", "SatisfiedResponses"],
        ops_rows)

    # ---- FactRevenueTarget (country x month; annual plan phased evenly)
    r_plan = rng("plan")
    ambition = {code: r_plan.uniform(-0.04, 0.04) for code in CODES}
    tgt_rows = []
    for code in CODES:
        for y in range(FIRST_YEAR, LAST_YEAR + 1):
            idx = [i for i, (yy, _) in enumerate(MONTHS) if yy == y]
            if y == FIRST_YEAR:
                annual = sum(level[(code, i)] for i in idx) * 1.03
            else:
                prev = sum(rev_cm[(code, i - 12)] for i in idx)
                g = PLAN_OVERRIDE.get(code, PLAN_GROWTH[C[code]["region"]]) + ambition[code]
                annual = prev * (1 + g)
            monthly = round(annual / 12 / 100) * 100
            for i in idx:
                yy, mm = MONTHS[i]
                tgt_rows.append([month_start(yy, mm), code, f2(monthly)])
    counts["FactRevenueTarget.csv"] = write_csv(out, "FactRevenueTarget.csv",
        ["MonthStart", "CountryCode", "TargetRevenueUSD"], tgt_rows)

    # ---- FactShipments (origin country -> destination country, physical products)
    shipments = build_shipments(units_physical)
    counts["FactShipments.csv"] = write_csv(out, "FactShipments.csv",
        ["MonthStart", "OriginCountryCode", "DestinationCountryCode", "ProductKey", "UnitsShipped", "FreightCostUSD",
         "ShipmentValueUSD", "DistanceKm"], shipments)
    return counts


# --------------------------------------------------------------------------- supply network

HUBS = {"NLD": EU, "ARE": MEA, "SGP": AP}
HUB_SHARE = {"NLD": 0.65, "ARE": 0.55, "SGP": 0.50}
SEA_OCEANIA = {"IDN", "THA", "PHL", "MYS", "AUS", "NZL", "VNM"}

DIRECT_MIX = {
    NA: {"HW-LAP": {"CHN": .55, "MEX": .45}, "HW-WKS": {"USA": 1.0}, "HW-TAB": {"CHN": .60, "VNM": .25, "KOR": .15},
         "AC-DCK": {"CHN": .45, "VNM": .30, "DEU": .15, "TUR": .10}, "AC-HDS": {"VNM": .60, "IND": .40}},
    LA: {"HW-LAP": {"BRA": .40, "MEX": .35, "CHN": .25}, "HW-WKS": {"USA": 1.0}, "HW-TAB": {"CHN": .80, "KOR": .20},
         "AC-DCK": {"CHN": .80, "DEU": .20}, "AC-HDS": {"VNM": .50, "IND": .50}},
    EU: {"HW-LAP": {"CHN": .75, "MEX": .25}, "HW-WKS": {"DEU": .70, "USA": .30}, "HW-TAB": {"CHN": .60, "VNM": .40},
         "AC-DCK": {"CHN": .50, "TUR": .30, "DEU": .20}, "AC-HDS": {"VNM": .60, "IND": .40}},
    MEA: {"HW-LAP": {"CHN": 1.0}, "HW-WKS": {"DEU": .60, "USA": .40}, "HW-TAB": {"CHN": .70, "KOR": .30},
          "AC-DCK": {"CHN": .60, "TUR": .40}, "AC-HDS": {"IND": .70, "VNM": .30}},
    AP: {"HW-LAP": {"CHN": 1.0}, "HW-WKS": {"CHN": .50, "USA": .30, "DEU": .20}, "HW-TAB": {"CHN": .50, "VNM": .30, "KOR": .20},
         "AC-DCK": {"CHN": .70, "VNM": .30}, "AC-HDS": {"VNM": .60, "IND": .40}},
}
LOCAL_LAPTOP = {"BRA": .70, "MEX": .80}   # local assembly share of laptop demand


def supply_plan(dest: str, product: str) -> dict[str, float]:
    """Where a destination's units of one product come from: {origin: share}. An origin equal
    to the destination is local production and never becomes a shipment row; an origin that is
    a hub is a re-export, and the hub is itself replenished from factories."""
    region = C[dest]["region"]
    direct = dict(DIRECT_MIX[region][product])
    if product == "HW-LAP" and dest in LOCAL_LAPTOP:
        local = LOCAL_LAPTOP[dest]
        direct = {dest: local, "CHN": 1 - local}
    plan: dict[str, float] = defaultdict(float)
    hub = None
    if dest == "TUR":
        hub, hub_share = "NLD", 0.40
    elif region in (EU, MEA) and dest not in HUBS:
        hub = "NLD" if region == EU else "ARE"
        hub_share = HUB_SHARE[hub]
    elif region == AP and dest in SEA_OCEANIA:
        hub, hub_share = "SGP", HUB_SHARE["SGP"]
    elif dest == "IND" and product == "HW-LAP":
        hub, hub_share = "ARE", 0.15
    if hub:
        plan[hub] += hub_share
        for o, s in direct.items():
            plan[o] += s * (1 - hub_share)
    else:
        for o, s in direct.items():
            plan[o] += s
    return dict(plan)


def hub_replenishment(hub: str, product: str) -> dict[str, float]:
    return dict(DIRECT_MIX[HUBS[hub]][product])


def build_shipments(units_physical) -> list[list]:
    r = rng("shipments")
    lanes = defaultdict(float)         # (i, origin, dest, product) -> units
    for (dest, i, k), units in sorted(units_physical.items()):
        plan = supply_plan(dest, k)
        noisy = {o: s * r.lognormvariate(0, 0.10) for o, s in sorted(plan.items())}
        tot = sum(noisy.values())
        for o, s in sorted(noisy.items()):
            if o == dest:
                continue
            lanes[(i, o, dest, k)] += units * s / tot * r.lognormvariate(0, 0.05)
    # hubs re-order what they re-exported from the factories
    reexport = defaultdict(float)
    for (i, o, d, k), u in lanes.items():
        if o in HUBS:
            reexport[(i, o, k)] += u
    for (i, hub, k), u in sorted(reexport.items()):
        mix = hub_replenishment(hub, k)
        for o, s in sorted(mix.items()):
            if o == hub:
                continue
            lanes[(i, o, hub, k)] += u * s * r.lognormvariate(0, 0.05)
    # Small lanes consolidate: units wait until at least MIN_SHIPMENT have accumulated, and
    # whatever is still waiting ships in December so every year's total is preserved.
    MIN_SHIPMENT = 40
    shipped = {}
    for lane in sorted({(o, d, k) for (_, o, d, k) in lanes}):
        o, d, k = lane
        waiting = 0.0
        for i, (y, m) in enumerate(MONTHS):
            waiting += lanes.get((i, o, d, k), 0.0)
            if waiting >= MIN_SHIPMENT or (m == 12 and waiting >= 0.5):
                shipped[(i, o, d, k)] = waiting
                waiting = 0.0
    rows = []
    for (i, o, d, k) in sorted(shipped, key=lambda t: (t[0], t[1], t[2], PKEYS.index(t[3]))):
        units = int(round(shipped[(i, o, d, k)]))
        if units <= 0:
            continue
        y, m = MONTHS[i]
        km = haversine_km(C[o]["lat"], C[o]["lon"], C[d]["lat"], C[d]["lon"])
        per_kg = 0.35 + 0.00022 * km if km > 1500 else 0.55 + 0.0006 * km
        freight = units * P[k]["kg"] * per_kg * r.lognormvariate(0, 0.08) + 150.0
        value = units * P[k]["cost"]
        rows.append([month_start(y, m), o, d, k, units, f2(freight), f2(value), int(round(km))])
    return rows


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    target = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "..", "data")
    result = build(os.path.abspath(target))
    for name, n in result.items():
        print(f"{name:26s} {n:>8,d} rows")
    print(f"{'total':26s} {sum(result.values()):>8,d} rows")
