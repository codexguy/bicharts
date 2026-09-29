# SPDX-License-Identifier: Apache-2.0
"""
Write the Power BI project (PBIP) for the Global Revenue v2 demo model.

    python build_pbip.py            # writes ../pbip/GlobalRevenueV2.*
    python build_pbip.py out_dir

The model is described once, below, as Python data (tables, columns, measures,
relationships, descriptions) and rendered to TMDL, so names are quoted the same way
everywhere and every object carries a description. Lineage tags and other ids are
derived from object names, so re-running produces identical files.

The generated files are the source of truth for Power BI Desktop. If you edit the
model in Desktop, either carry the edit back into this script or stop regenerating.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import sys
import uuid

PROJECT = "GlobalRevenueV2"
NS = uuid.UUID("6f1c2d4e-8a3b-4c5d-9e7f-0a1b2c3d4e5f")
DEFAULT_DATA_PATH = "codexguy/bicharts/main/examples/fabric-app/data/"


def gid(*parts: str) -> str:
    return str(uuid.uuid5(NS, "/".join(parts)))


def hexid(*parts: str, n: int = 20) -> str:
    return uuid.uuid5(NS, "/".join(parts)).hex[:n]


def q(name: str) -> str:
    """TMDL / DAX object-name quoting: anything but a plain identifier goes in single quotes."""
    if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
        return name
    return "'" + name.replace("'", "''") + "'"


# --------------------------------------------------------------------------- model description
# column tuple: (name, tmdl dataType, M type, description, options)
# options: hidden, fmt, sum (summarizeBy sum), sortBy, category, key

DATE = "dateTime"
MTYPE = {"string": "type text", "int64": "Int64.Type", "double": "type number", DATE: "type date",
         "boolean": "type logical"}

TABLES = []


def table(name, description, source_file, columns, rename=None, data_category=None):
    TABLES.append(dict(name=name, description=description, file=source_file, columns=columns,
                       rename=rename or {}, category=data_category))


table("DimDate",
      "Calendar at MONTH grain: one row per month, January 2019 to December 2025 (84 rows). Every fact "
      "table joins to it on MonthStart, so one date filter moves sales, operations, targets and shipments "
      "together. Use MonthStart (a real date) or YearMonth as a monthly time axis and Year as the ordered "
      "frame for year-by-year animation. Marked as the model's date table.",
      "DimDate.csv", [
          ("MonthStart", DATE, None, "First day of the month (2019-01-01 ... 2025-12-01). Primary key of the calendar and the join key of every fact table.", dict(key=True, fmt="yyyy-mm-dd")),
          ("Year", "int64", None, "Calendar year, 2019-2025. The ordered time frame for year-by-year charts and animation.", dict(fmt="0")),
          ("Quarter", "int64", None, "Calendar quarter number, 1-4.", dict(fmt="0")),
          ("QuarterLabel", "string", None, "Quarter label Q1-Q4 (sorted by Quarter).", dict(sortBy="Quarter")),
          ("YearQuarter", "string", None, "Year and quarter as text, for example '2024 Q3'. Sorts chronologically as text.", {}),
          ("MonthNumber", "int64", None, "Month of the year, 1-12.", dict(fmt="0")),
          ("MonthName", "string", None, "Full month name, January-December (sorted by MonthNumber).", dict(sortBy="MonthNumber")),
          ("MonthShort", "string", None, "Three-letter month name, Jan-Dec (sorted by MonthNumber).", dict(sortBy="MonthNumber")),
          ("YearMonth", "string", None, "Year and month as 'YYYY-MM' text, for example '2025-03'. Sorts chronologically as text.", {}),
          ("MonthIndex", "int64", None, "Sequential month number: 0 = January 2019 ... 83 = December 2025. The year-over-year measures use it (a month and the same month a year earlier are 12 apart).", dict(fmt="0")),
      ], data_category="Time")

table("DimCountry",
      "One row per market country: 40 countries in 5 regions. CountryCode is the ISO 3166-1 alpha-3 code "
      "(USA, DEU, JPN) and is the key to use for world choropleth maps; Latitude/Longitude are the "
      "country's centroid for bubble maps. Filters FactSales, FactOperations and FactRevenueTarget. "
      "Shipments do NOT use this table - they have their own copies, DimOriginCountry and "
      "DimDestinationCountry.",
      "DimCountry.csv", [
          ("CountryCode", "string", None, "ISO 3166-1 alpha-3 country code, for example USA, GBR, IND. Primary key; stable across refreshes.", dict(category="Country")),
          ("CountryISO2", "string", None, "ISO 3166-1 alpha-2 country code, for example US, GB, IN.", {}),
          ("Country", "string", None, "Country name in English.", dict(category="Country")),
          ("Region", "string", None, "Sales region: North America, Latin America, Europe, Middle East & Africa, Asia Pacific (sorted by RegionOrder).", dict(sortBy="RegionOrder")),
          ("RegionOrder", "int64", None, "Display order of Region, 1-5.", dict(fmt="0", hidden=True)),
          ("Subregion", "string", None, "Geographic subregion (UN M49 style), for example Western Europe, South-eastern Asia.", {}),
          ("Latitude", "double", None, "Latitude of the country's centroid, in decimal degrees.", dict(category="Latitude", fmt="0.00")),
          ("Longitude", "double", None, "Longitude of the country's centroid, in decimal degrees.", dict(category="Longitude", fmt="0.00")),
          ("Population", "int64", None, "Approximate 2023 population. Denominator of Revenue per Capita (use the Total Population measure).", dict(fmt="#,0", sum=True)),
      ])

table("DimCity",
      "One row per city market: 71 cities in the 40 countries, with real coordinates, for point maps and "
      "per-city distributions (beeswarm by CityTier). CityKey is '<ISO-3>-<3-letter metro code>', for "
      "example 'USA-NYC', and is stable. Filters FactSales only. Its CountryCode column is descriptive: "
      "FactSales carries CountryCode itself, so a country filter reaches sales without going through "
      "this table.",
      "DimCity.csv", [
          ("CityKey", "string", None, "City key: ISO-3 country code, a hyphen and a 3-letter metro code, for example 'GBR-LON'. Primary key; stable.", {}),
          ("City", "string", None, "City name.", dict(category="City")),
          ("CountryCode", "string", None, "ISO-3 code of the city's country (descriptive; not a relationship).", {}),
          ("CityTier", "string", None, "Market tier: 'Tier 1' (global hubs), 'Tier 2' (major cities), 'Tier 3' (regional cities). Sorted by CityTierRank. Tier 3 cities have no Partner channel.", dict(sortBy="CityTierRank")),
          ("CityTierRank", "int64", None, "Tier as a number, 1-3 (1 = largest markets). An ordered rating usable as a numeric input.", dict(fmt="0")),
          ("Latitude", "double", None, "City latitude in decimal degrees.", dict(category="Latitude", fmt="0.00")),
          ("Longitude", "double", None, "City longitude in decimal degrees.", dict(category="Longitude", fmt="0.00")),
      ])

table("DimProduct",
      "One row per product: 10 products in 4 categories (Hardware, Accessories, Software, Services) with "
      "a ProductLine level between. Hierarchy: Category > ProductLine > Product. Filters FactSales and "
      "FactShipments (only the 5 shippable Hardware and Accessories products appear in shipments).",
      "DimProduct.csv", [
          ("ProductKey", "string", None, "Product key, for example 'HW-LAP' (the prefix is the category). Primary key; stable.", {}),
          ("Product", "string", None, "Product name.", {}),
          ("ProductLine", "string", None, "Product line, the level between Category and Product.", {}),
          ("Category", "string", None, "Product category: Hardware, Accessories, Software or Services.", {}),
          ("IsShippable", "boolean", None, "TRUE for physical products (Hardware, Accessories) that move through FactShipments.", {}),
          ("ListPriceUSD", "double", None, "List price of one unit in USD (a licence seat for software, an engagement or contract for services).", dict(fmt="\\$#,0.00")),
          ("StandardCostUSD", "double", None, "Standard cost of one physical unit in USD; 0 for software and services. Values FactShipments.", dict(fmt="\\$#,0.00")),
          ("UnitWeightKg", "double", None, "Shipping weight of one unit in kilograms; 0 for software and services.", dict(fmt="0.00")),
      ])

table("DimChannel",
      "One row per sales channel: Online, Retail, Partner. Filters FactSales. Not every product sells through "
      "every channel: Services sell only through Partner, Software through Online and Partner, Accessories "
      "through Online and Retail, Hardware through all three.",
      "DimChannel.csv", [
          ("Channel", "string", None, "Sales channel name: Online, Retail or Partner. Primary key.", dict(sortBy="ChannelOrder")),
          ("ChannelDescription", "string", None, "What the channel covers.", {}),
          ("ChannelOrder", "int64", None, "Display order of Channel, 1-3.", dict(fmt="0", hidden=True)),
      ])

table("FactSales",
      "Sales at month x city x product x channel grain (about 117,000 rows): what one city sold of one "
      "product through one channel in one month. All numeric columns are additive. Use the measures in "
      "_Measures (Revenue, Orders, Customers, Return Rate %, ...) rather than these columns. Related to "
      "DimDate, DimCity, DimCountry, DimProduct and DimChannel.",
      "FactSales.csv", [
          ("MonthStart", DATE, None, "Month of the sale (first day of the month). Joins DimDate.", dict(hidden=True, fmt="yyyy-mm-dd")),
          ("CityKey", "string", None, "City that made the sale. Joins DimCity.", dict(hidden=True)),
          ("CountryCode", "string", None, "ISO-3 code of the city's country. Joins DimCountry.", dict(hidden=True)),
          ("ProductKey", "string", None, "Product sold. Joins DimProduct.", dict(hidden=True)),
          ("Channel", "string", None, "Channel the sale came through. Joins DimChannel.", dict(hidden=True)),
          ("OrderCount", "int64", None, "Number of orders. Use the Orders measure.", dict(hidden=True, fmt="#,0", sum=True)),
          ("UnitsSold", "int64", None, "Units sold (devices, licence seats, service engagements). Use the Units Sold measure.", dict(hidden=True, fmt="#,0", sum=True)),
          ("RevenueUSD", "double", None, "Net revenue in USD. Use the Revenue measure.", dict(hidden=True, fmt="\\$#,0", sum=True)),
          ("CustomerCount", "int64", None, "Ordering customer accounts in this row's month, city, product and channel. Summing across rows counts an account once per product and channel it bought. Use the Customers measure.", dict(hidden=True, fmt="#,0", sum=True)),
          ("ReturnCount", "int64", None, "Orders returned. Use the Returns and Return Rate % measures.", dict(hidden=True, fmt="#,0", sum=True)),
      ])

table("FactOperations",
      "Country operations at month x country grain (3,360 rows): marketing spend, sales headcount and "
      "customer-satisfaction survey counts. Related to DimDate and DimCountry only (no city, product or "
      "channel detail). Use the measures Marketing Spend, Headcount and CSAT %.",
      "FactOperations.csv", [
          ("MonthStart", DATE, None, "Month (first day). Joins DimDate.", dict(hidden=True, fmt="yyyy-mm-dd")),
          ("CountryCode", "string", None, "ISO-3 country code. Joins DimCountry.", dict(hidden=True)),
          ("MarketingSpendUSD", "double", None, "Marketing spend in USD for the country and month. Use the Marketing Spend measure.", dict(hidden=True, fmt="\\$#,0", sum=True)),
          ("HeadcountFTE", "double", None, "Sales and support headcount in full-time equivalents at month end. NOT additive over time: use the Headcount measure, which averages months.", dict(hidden=True, fmt="#,0.0")),
          ("SurveyResponses", "int64", None, "Customer-satisfaction survey responses received.", dict(hidden=True, fmt="#,0", sum=True)),
          ("SatisfiedResponses", "int64", None, "Responses rating 4 or 5 out of 5. CSAT % = SatisfiedResponses / SurveyResponses.", dict(hidden=True, fmt="#,0", sum=True)),
      ])

table("FactRevenueTarget",
      "Revenue plan at month x country grain (3,360 rows). Each year's plan is phased evenly across its 12 "
      "months, so the monthly target is flat within a year and steps each January. Related to DimDate and "
      "DimCountry only: it has no city, product or channel detail, so compare it with Revenue at "
      "country, region or total level. Use the Revenue Target measure.",
      "FactRevenueTarget.csv", [
          ("MonthStart", DATE, None, "Month (first day). Joins DimDate.", dict(hidden=True, fmt="yyyy-mm-dd")),
          ("CountryCode", "string", None, "ISO-3 country code. Joins DimCountry.", dict(hidden=True)),
          ("TargetRevenueUSD", "double", None, "Planned revenue in USD for the country and month. Use the Revenue Target measure.", dict(hidden=True, fmt="\\$#,0", sum=True)),
      ])

table("FactShipments",
      "Physical shipments at month x origin country x destination country x product grain (about 37,000 "
      "rows, Hardware and Accessories only). Factories (China, Vietnam, Mexico, Germany, ...) ship to "
      "markets directly and through three re-export hubs (Netherlands, United Arab Emirates, Singapore), so "
      "a few lanes are far larger than the rest. Origin and destination are two different country "
      "tables: filter the origin with DimOriginCountry and the destination with DimDestinationCountry; "
      "both relationships are active. Small lanes consolidate, so a lane can skip months.",
      "FactShipments.csv", [
          ("MonthStart", DATE, None, "Month shipped (first day). Joins DimDate.", dict(hidden=True, fmt="yyyy-mm-dd")),
          ("OriginCountryCode", "string", None, "ISO-3 code of the shipping country. Joins DimOriginCountry.", dict(hidden=True)),
          ("DestinationCountryCode", "string", None, "ISO-3 code of the receiving country. Joins DimDestinationCountry.", dict(hidden=True)),
          ("ProductKey", "string", None, "Product shipped. Joins DimProduct.", dict(hidden=True)),
          ("UnitsShipped", "int64", None, "Units shipped. Use the Units Shipped measure.", dict(hidden=True, fmt="#,0", sum=True)),
          ("FreightCostUSD", "double", None, "Freight cost in USD. Use the Freight Cost and Freight per Unit measures.", dict(hidden=True, fmt="\\$#,0", sum=True)),
          ("ShipmentValueUSD", "double", None, "Value of the goods at standard cost, in USD. Use the Shipment Value measure.", dict(hidden=True, fmt="\\$#,0", sum=True)),
          ("DistanceKm", "int64", None, "Great-circle distance between the origin and destination centroids, in km (constant per lane). Use Avg Shipping Distance (km).", dict(hidden=True, fmt="#,0")),
      ])

ROLE_COLS = [("CountryCode", "string", "ISO 3166-1 alpha-3 code of the {role} country. Primary key.", dict(category="Country")),
             ("Country", "string", "Name of the {role} country.", dict(category="Country")),
             ("Region", "string", "Sales region of the {role} country (sorted by {prefix}RegionOrder).", dict(sortBy="RegionOrder")),
             ("RegionOrder", "int64", "Display order of {prefix}Region, 1-5.", dict(fmt="0", hidden=True)),
             ("Subregion", "string", "Geographic subregion of the {role} country.", {}),
             ("Latitude", "double", "Latitude of the {role} country's centroid.", dict(category="Latitude", fmt="0.00")),
             ("Longitude", "double", "Longitude of the {role} country's centroid.", dict(category="Longitude", fmt="0.00"))]
for prefix, role, other in (("Origin", "origin", "DimDestinationCountry"), ("Destination", "destination", "DimOriginCountry")):
    cols = []
    for base, dt, desc, opts in ROLE_COLS:
        o = dict(opts)
        if "sortBy" in o:
            o["sortBy"] = prefix + o["sortBy"]
        cols.append((prefix + base, dt, None, desc.format(role=role, prefix=prefix), o))
    table(f"Dim{prefix}Country",
          f"The {role} side of FactShipments: a copy of the country list (same 40 countries and codes as "
          f"DimCountry) that filters shipments by {role} only. Pair it with {other} for flow maps "
          f"(lat/lon at both ends) and chord diagrams ({prefix}Region against the other side's region). "
          f"It does not filter sales.",
          "DimCountry.csv", cols, rename={b: prefix + b for b, *_ in ROLE_COLS})

# measure tuple: (name, folder, format, expression, description)
MEASURES = [
    ("Revenue", "Sales", "\\$#,0", "SUM ( FactSales[RevenueUSD] )",
     "Net sales revenue in USD. Additive over every dimension that filters FactSales."),
    ("Orders", "Sales", "#,0", "SUM ( FactSales[OrderCount] )", "Number of orders."),
    ("Units Sold", "Sales", "#,0", "SUM ( FactSales[UnitsSold] )",
     "Units sold: devices for hardware and accessories, licence seats for software, engagements or contracts for services."),
    ("Customers", "Sales", "#,0", "SUM ( FactSales[CustomerCount] )",
     "Ordering customer accounts, summed over rows: an account buying two products, or in two months, counts twice. Moves with Orders and Marketing Spend."),
    ("Returns", "Sales", "#,0", "SUM ( FactSales[ReturnCount] )", "Orders returned."),
    ("Avg Order Value", "Sales", "\\$#,0.00", "DIVIDE ( [Revenue], [Orders] )",
     "Revenue per order in USD (Revenue / Orders)."),
    ("Return Rate %", "Sales", "0.0%", "DIVIDE ( [Returns], [Orders] )",
     "Share of orders returned (Returns / Orders). Differs strongly by country and category - hardware and online orders return most."),
    ("Revenue per Customer", "Sales", "\\$#,0.00", "DIVIDE ( [Revenue], [Customers] )", "Revenue / Customers, in USD."),
    ("Revenue PY", "Time Comparison", "\\$#,0",
     "VAR _months = VALUES ( DimDate[MonthIndex] )\n"
     "VAR _prior = SELECTCOLUMNS ( _months, \"MonthIndex\", DimDate[MonthIndex] - 12 )\n"
     "RETURN\n"
     "    CALCULATE ( [Revenue], REMOVEFILTERS ( DimDate ), TREATAS ( _prior, DimDate[MonthIndex] ) )",
     "Revenue for the same months one year earlier. Works at month, quarter or year grain; blank for 2019, which has no prior year."),
    ("Revenue YoY Change", "Time Comparison", "\\$#,0",
     "VAR _py = [Revenue PY]\nRETURN IF ( NOT ISBLANK ( _py ), [Revenue] - _py )",
     "Revenue minus Revenue PY, in USD. Blank when there is no prior year."),
    ("Revenue YoY %", "Time Comparison", "0.0%",
     "VAR _py = [Revenue PY]\nRETURN IF ( NOT ISBLANK ( _py ), DIVIDE ( [Revenue] - _py, _py ) )",
     "Revenue growth against the same months a year earlier. Filter to one Year for annual growth by country; blank for 2019."),
    ("Total Population", "Geography", "#,0", "SUM ( DimCountry[Population] )",
     "Population of the countries in the filter context (approximate 2023 values). Country-level only: a city filter does not narrow it."),
    ("Revenue per Capita", "Geography", "\\$#,0.00", "DIVIDE ( [Revenue], [Total Population] )",
     "Revenue in USD per inhabitant of the selected countries, for the selected period. Use at country, subregion or region level (not city)."),
    ("Marketing Spend", "Operations", "\\$#,0", "SUM ( FactOperations[MarketingSpendUSD] )",
     "Marketing spend in USD. Country and month only: product, channel and city filters do not narrow it."),
    ("Marketing ROI", "Operations", "0.00", "DIVIDE ( [Revenue], [Marketing Spend] )",
     "Revenue dollars per marketing dollar (Revenue / Marketing Spend). Use without product, channel or city filters."),
    ("Headcount", "Operations", "#,0.0",
     "AVERAGEX ( VALUES ( DimDate[MonthStart] ), CALCULATE ( SUM ( FactOperations[HeadcountFTE] ) ) )",
     "Sales and support headcount in FTE, averaged over the months in the filter context (headcount is a level, not a flow, so it is never summed over time)."),
    ("Revenue per Head", "Operations", "\\$#,0", "DIVIDE ( [Revenue], [Headcount] )",
     "Revenue per average FTE for the selected period (a full year gives annual revenue per head)."),
    ("Survey Responses", "Operations", "#,0", "SUM ( FactOperations[SurveyResponses] )",
     "Customer-satisfaction survey responses."),
    ("CSAT %", "Operations", "0.0%",
     "DIVIDE ( SUM ( FactOperations[SatisfiedResponses] ), SUM ( FactOperations[SurveyResponses] ) )",
     "Customer satisfaction: share of survey responses rating 4 or 5 out of 5. Country and month only."),
    ("Revenue Target", "Targets", "\\$#,0", "SUM ( FactRevenueTarget[TargetRevenueUSD] )",
     "Planned revenue in USD. Flat within each year on a monthly axis. Country and month only: under a product, channel or city filter it still shows the whole country's plan."),
    ("Revenue vs Target", "Targets", "\\$#,0", "[Revenue] - [Revenue Target]",
     "Revenue minus Revenue Target, in USD; negative means behind plan."),
    ("Target Attainment %", "Targets", "0.0%", "DIVIDE ( [Revenue], [Revenue Target] )",
     "Revenue as a share of Revenue Target; 100% means on plan."),
    ("Units Shipped", "Shipments", "#,0", "SUM ( FactShipments[UnitsShipped] )",
     "Units shipped from origin to destination country. The flow measure for flow maps and chord diagrams. "
     "Shipment measures follow DimOriginCountry and DimDestinationCountry (and DimDate, DimProduct), not DimCountry: "
     "grouped by DimCountry they repeat the same total on every row."),
    ("Freight Cost", "Shipments", "\\$#,0", "SUM ( FactShipments[FreightCostUSD] )", "Freight cost in USD."),
    ("Freight per Unit", "Shipments", "\\$#,0.00", "DIVIDE ( [Freight Cost], [Units Shipped] )",
     "Freight cost per unit shipped, in USD. Rises with distance and unit weight."),
    ("Shipment Value", "Shipments", "\\$#,0", "SUM ( FactShipments[ShipmentValueUSD] )",
     "Value of goods shipped at standard cost, in USD. An alternative flow measure that weights heavy, expensive products more than Units Shipped."),
    ("Avg Shipping Distance (km)", "Shipments", "#,0",
     "DIVIDE ( SUMX ( FactShipments, FactShipments[UnitsShipped] * FactShipments[DistanceKm] ), [Units Shipped] )",
     "Unit-weighted average great-circle distance of the shipments in context, in km."),
    ("Shipment Lanes", "Shipments", "#,0",
     "COUNTROWS ( SUMMARIZE ( FactShipments, FactShipments[OriginCountryCode], FactShipments[DestinationCountryCode] ) )",
     "Number of distinct origin-destination country pairs with shipments in context."),
    ("Projected Revenue", "What-if", "\\$#,0", "[Revenue] * ( 1 + [Growth Rate Value] )",
     "Revenue grown by the selected Growth Rate: what the same period would bring a year later at that rate. Put 'Growth Rate'[Growth Rate] on an axis or legend to see one line per scenario."),
]

GROWTH = dict(start=-0.10, end=0.30, step=0.025, default=0.05)

RELATIONSHIPS = [
    ("FactSales", "MonthStart", "DimDate", "MonthStart"),
    ("FactSales", "CityKey", "DimCity", "CityKey"),
    ("FactSales", "CountryCode", "DimCountry", "CountryCode"),
    ("FactSales", "ProductKey", "DimProduct", "ProductKey"),
    ("FactSales", "Channel", "DimChannel", "Channel"),
    ("FactOperations", "MonthStart", "DimDate", "MonthStart"),
    ("FactOperations", "CountryCode", "DimCountry", "CountryCode"),
    ("FactRevenueTarget", "MonthStart", "DimDate", "MonthStart"),
    ("FactRevenueTarget", "CountryCode", "DimCountry", "CountryCode"),
    ("FactShipments", "MonthStart", "DimDate", "MonthStart"),
    ("FactShipments", "OriginCountryCode", "DimOriginCountry", "OriginCountryCode"),
    ("FactShipments", "DestinationCountryCode", "DimDestinationCountry", "DestinationCountryCode"),
    ("FactShipments", "ProductKey", "DimProduct", "ProductKey"),
]


# --------------------------------------------------------------------------- TMDL rendering

def desc_lines(text: str, indent: str) -> list[str]:
    return [f"{indent}/// {line}" for line in text.split("\n")]


def expr_block(expr: str, indent: str) -> list[str]:
    return [f"{indent}{line}" if line else "" for line in expr.split("\n")]


def render_table(t) -> str:
    L = desc_lines(t["description"], "")
    L.append(f"table {q(t['name'])}")
    L.append(f"\tlineageTag: {gid('table', t['name'])}")
    if t["category"]:
        L.append(f"\tdataCategory: {t['category']}")
    L.append("")
    for name, dt, _, description, o in t["columns"]:
        L += desc_lines(description, "\t")
        L.append(f"\tcolumn {q(name)}")
        L.append(f"\t\tdataType: {dt}")
        if o.get("key"):
            L.append("\t\tisKey")
        if o.get("hidden"):
            L.append("\t\tisHidden")
        if "fmt" in o:
            L.append(f"\t\tformatString: {o['fmt']}")
        L.append(f"\t\tlineageTag: {gid('column', t['name'], name)}")
        if "category" in o:
            L.append(f"\t\tdataCategory: {o['category']}")
        L.append(f"\t\tsummarizeBy: {'sum' if o.get('sum') else 'none'}")
        L.append(f"\t\tsourceColumn: {name}")
        if "sortBy" in o:
            L.append(f"\t\tsortByColumn: {q(o['sortBy'])}")
        L.append("")
        L.append("\t\tannotation SummarizationSetBy = Automatic")
        if dt == DATE:
            L.append("")
            L.append("\t\tannotation UnderlyingDateTimeDataType = Date")
        L.append("")
    L.append(f"\tpartition {q(t['name'])} = m")
    L.append("\t\tmode: import")
    L.append("\t\tsource =")
    L += expr_block(m_query(t), "\t\t\t\t")
    L.append("")
    L.append("\tannotation PBI_ResultType = Table")
    L.append("")
    return "\n".join(L)


def m_query(t) -> str:
    types = ", ".join(f'{{"{name}", {MTYPE[dt]}}}' for name, dt, *_ in t["columns"])
    lines = ["let", f'    Source = fnLoadCsv("{t["file"]}"),']
    step = "Source"
    if t["rename"]:
        keep = ", ".join(f'"{src}"' for src in t["rename"])
        ren = ", ".join(f'{{"{src}", "{dst}"}}' for src, dst in t["rename"].items())
        lines.append(f"    Kept = Table.SelectColumns(Source, {{{keep}}}),")
        lines.append(f"    Renamed = Table.RenameColumns(Kept, {{{ren}}}),")
        step = "Renamed"
    lines.append(f'    Typed = Table.TransformColumnTypes({step}, {{{types}}}, "en-US")')
    lines += ["in", "    Typed"]
    return "\n".join(lines)


def render_measures_table() -> str:
    L = desc_lines("Home of every measure in the model, grouped in display folders (Sales, Time Comparison, "
                   "Geography, Operations, Targets, Shipments, What-if). It holds no data of its own; its one "
                   "column is a hidden placeholder.", "")
    L.append("table _Measures")
    L.append(f"\tlineageTag: {gid('table', '_Measures')}")
    L.append("")
    for name, folder, fmt, expr, description in MEASURES:
        L += desc_lines(description, "\t")
        if "\n" in expr:
            L.append(f"\tmeasure {q(name)} =")
            L += expr_block(expr, "\t\t\t")
        else:
            L.append(f"\tmeasure {q(name)} = {expr}")
        L.append(f"\t\tformatString: {fmt}")
        L.append(f"\t\tdisplayFolder: {folder}")
        L.append(f"\t\tlineageTag: {gid('measure', name)}")
        L.append("")
    L += desc_lines("Placeholder that makes this a table; never used.", "\t")
    L += ["\tcolumn Measures", "\t\tisHidden", "\t\tformatString: 0", f"\t\tlineageTag: {gid('column', '_Measures', 'Measures')}",
          "\t\tsummarizeBy: none", "\t\tisNameInferred", "\t\tsourceColumn: [Measures]", "",
          "\t\tannotation SummarizationSetBy = Automatic", "",
          "\tpartition _Measures = calculated", "\t\tmode: import", '\t\tsource = DATATABLE("Measures", INTEGER, {{}})', "",
          f"\tannotation PBI_Id = {hexid('pbiid', '_Measures', n=32)}", ""]
    return "\n".join(L)


def render_growth_table() -> str:
    g = GROWTH
    L = desc_lines(
        f"What-if parameter: an assumed annual revenue growth rate from {g['start']:.0%} to {g['end']:.0%} in "
        f"steps of {g['step']:.1%} ({int(round((g['end'] - g['start']) / g['step'])) + 1} values). Not related to "
        "any other table. Slice or pick one value to drive Projected Revenue through Growth Rate Value, or put "
        "the Growth Rate column on an axis or legend to lay out every scenario at once.", "")
    L.append("table 'Growth Rate'")
    L.append(f"\tlineageTag: {gid('table', 'Growth Rate')}")
    L.append("")
    L += desc_lines(f"The growth rate selected on 'Growth Rate'[Growth Rate]; {g['default']:.0%} when none or "
                    "several are selected. Drives Projected Revenue.", "\t")
    L.append(f"\tmeasure 'Growth Rate Value' = SELECTEDVALUE ( 'Growth Rate'[Growth Rate], {g['default']} )")
    L.append("\t\tformatString: 0.0%")
    L.append("\t\tdisplayFolder: What-if")
    L.append(f"\t\tlineageTag: {gid('measure', 'Growth Rate Value')}")
    L.append("")
    L += desc_lines("One assumed annual growth rate per row (a decimal fraction: 0.05 = 5%).", "\t")
    L += ["\tcolumn 'Growth Rate'", "\t\tformatString: 0.0%", f"\t\tlineageTag: {gid('column', 'Growth Rate', 'Growth Rate')}",
          "\t\tsummarizeBy: none", "\t\tsourceColumn: [Value]", "",
          "\t\textendedProperty ParameterMetadata =", "\t\t\t\t{", '\t\t\t\t  "version": 0', "\t\t\t\t}", "",
          "\t\tannotation SummarizationSetBy = User", "",
          "\tpartition 'Growth Rate' = calculated", "\t\tmode: import",
          f"\t\tsource = GENERATESERIES ( {g['start']}, {g['end']}, {g['step']} )", "",
          f"\tannotation PBI_Id = {hexid('pbiid', 'Growth Rate', n=32)}", ""]
    return "\n".join(L)


FN_LOAD_CSV = r'''(fileName as text) as table =>
let
    // The host is a literal on purpose: the Power BI service refuses to refresh a web source whose base URL is
    // computed (DynamicDataSourcesIsNotSupportedForRefresh). Only the path under it comes from the DataPath parameter.
    Bytes = Web.Contents("https://raw.githubusercontent.com", [RelativePath = DataPath & fileName]),
    Csv = Csv.Document(Bytes, [Delimiter = ",", Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Csv, [PromoteAllScalars = true])
in
    Promoted'''


def render_expressions() -> str:
    L = desc_lines("The folder the CSV files are read from, as a path under https://raw.githubusercontent.com ending in '/' "
                   "(owner/repository/branch/folder/). Every table reads https://raw.githubusercontent.com/<DataPath><file>.csv.", "")
    L.append(f'expression DataPath = "{DEFAULT_DATA_PATH}" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]')
    L.append(f"\tlineageTag: {gid('expression', 'DataPath')}")
    L.append("")
    L.append("\tannotation PBI_ResultType = Text")
    L.append("")
    L += desc_lines("Loads one CSV file from the DataPath folder on raw.githubusercontent.com and promotes its header row.", "")
    L.append("expression fnLoadCsv =")
    L += expr_block(FN_LOAD_CSV, "\t\t")
    L.append(f"\tlineageTag: {gid('expression', 'fnLoadCsv')}")
    L.append("")
    L.append("\tannotation PBI_ResultType = Function")
    L.append("")
    return "\n".join(L)


def render_relationships() -> str:
    L = []
    for ft, fc, tt, tc in RELATIONSHIPS:
        L.append(f"relationship {gid('relationship', ft, fc, tt, tc)}")
        if fc == "MonthStart":
            L.append("\tjoinOnDateBehavior: datePartOnly")
        L.append(f"\tfromColumn: {q(ft)}.{q(fc)}")
        L.append(f"\ttoColumn: {q(tt)}.{q(tc)}")
        L.append("")
    return "\n".join(L)


def render_model() -> str:
    names = [t["name"] for t in TABLES] + ["_Measures", "Growth Rate"]
    order = json.dumps([t["name"] for t in TABLES] + ["DataPath", "fnLoadCsv"])
    L = ["model Model", "\tculture: en-US", "\tdefaultPowerBIDataSourceVersion: powerBI_V3", "\tsourceQueryCulture: en-US",
         "\tdataAccessOptions", "\t\tlegacyRedirects", "\t\treturnErrorValuesAsNull", "",
         "annotation __PBI_TimeIntelligenceEnabled = 0", "", f"annotation PBI_QueryOrder = {order}", ""]
    L += [f"ref table {q(n)}" for n in names]
    L += ["", "ref cultureInfo en-US", ""]
    return "\n".join(L)


# --------------------------------------------------------------------------- files

def write(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text if text.endswith("\n") else text + "\n")


def write_json(path: str, obj) -> None:
    write(path, json.dumps(obj, indent=2, ensure_ascii=False))


def build(out: str) -> None:
    here = os.path.dirname(os.path.abspath(__file__))
    sm = os.path.join(out, f"{PROJECT}.SemanticModel")
    rp = os.path.join(out, f"{PROJECT}.Report")
    for d in (sm, rp):
        if os.path.isdir(os.path.join(d, "definition")):
            shutil.rmtree(os.path.join(d, "definition"))
    d = os.path.join(sm, "definition")

    write_json(os.path.join(out, f"{PROJECT}.pbip"), {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/pbip/pbipProperties/1.0.0/schema.json",
        "version": "1.0", "artifacts": [{"report": {"path": f"{PROJECT}.Report"}}],
        "settings": {"enableAutoRecovery": True}})
    write(os.path.join(out, ".gitignore"), "**/.pbi/localSettings.json\n**/.pbi/cache.abf\n")

    write_json(os.path.join(sm, ".platform"), {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json",
        "metadata": {"type": "SemanticModel", "displayName": PROJECT},
        "config": {"version": "2.0", "logicalId": gid("platform", "SemanticModel")}})
    write_json(os.path.join(sm, "definition.pbism"), {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/semanticModel/definitionProperties/1.0.0/schema.json",
        "version": "4.2", "settings": {}})
    write(os.path.join(d, "database.tmdl"), "database\n\tcompatibilityLevel: 1606\n")
    write(os.path.join(d, "model.tmdl"), render_model())
    write(os.path.join(d, "expressions.tmdl"), render_expressions())
    write(os.path.join(d, "relationships.tmdl"), render_relationships())
    write(os.path.join(d, "cultures", "en-US.tmdl"), "cultureInfo en-US\n")
    for t in TABLES:
        write(os.path.join(d, "tables", f"{t['name']}.tmdl"), render_table(t))
    write(os.path.join(d, "tables", "_Measures.tmdl"), render_measures_table())
    write(os.path.join(d, "tables", "Growth Rate.tmdl"), render_growth_table())

    # ---- report: one page holding a text box that says what the model is for
    write_json(os.path.join(rp, ".platform"), {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json",
        "metadata": {"type": "Report", "displayName": PROJECT},
        "config": {"version": "2.0", "logicalId": gid("platform", "Report")}})
    write_json(os.path.join(rp, "definition.pbir"), {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definitionProperties/2.0.0/schema.json",
        "version": "4.0", "datasetReference": {"byPath": {"path": f"../{PROJECT}.SemanticModel"}}})
    rd = os.path.join(rp, "definition")
    write_json(os.path.join(rd, "version.json"), {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/versionMetadata/1.0.0/schema.json",
        "version": "2.0.0"})
    write_json(os.path.join(rd, "report.json"), {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/report/3.3.0/schema.json",
        "themeCollection": {"baseTheme": {"name": "CY26SU07", "reportVersionAtImport": {"visual": "2.11.0", "report": "3.4.0", "page": "2.3.1"},
                                          "type": "SharedResources"}},
        "resourcePackages": [{"name": "SharedResources", "type": "SharedResources",
                              "items": [{"name": "CY26SU07", "path": "BaseThemes/CY26SU07.json", "type": "BaseTheme"}]}],
        "settings": {"useStylableVisualContainerHeader": True, "exportDataMode": "AllowSummarized",
                     "defaultDrillFilterOtherVisuals": True, "allowChangeFilterTypes": True,
                     "useEnhancedTooltips": True, "useDefaultAggregateDisplayName": True}})
    theme_src = os.path.join(here, "theme", "CY26SU07.json")
    theme_dst = os.path.join(rp, "StaticResources", "SharedResources", "BaseThemes", "CY26SU07.json")
    os.makedirs(os.path.dirname(theme_dst), exist_ok=True)
    shutil.copyfile(theme_src, theme_dst)

    page = hexid("page", "About")
    visual = hexid("visual", "About", "text")
    write_json(os.path.join(rd, "pages", "pages.json"), {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/pagesMetadata/1.1.0/schema.json",
        "pageOrder": [page], "activePageName": page})
    write_json(os.path.join(rd, "pages", page, "page.json"), {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/page/2.1.0/schema.json",
        "name": page, "displayName": "About this model", "displayOption": "FitToPage", "height": 720, "width": 1280})
    paragraphs = [
        [{"value": "Global Revenue v2", "textStyle": {"fontWeight": "bold", "fontSize": "20pt"}}],
        [{"value": ""}],
        [{"value": "A star-schema demo model (sales, operations, targets and shipments, 2019-2025, 40 countries, "
                   "71 cities) meant to be queried with DAX by an app. Every table, column and measure carries a "
                   "description; run EVALUATE INFO.VIEW.MEASURES() or INFO.VIEW.COLUMNS() to read them."}],
        [{"value": ""}],
        [{"value": "This page is intentionally empty of charts. The DataPath parameter (Transform data > Edit "
                   "parameters) chooses which public copy of the CSV files is read."}],
    ]
    write_json(os.path.join(rd, "pages", page, "visuals", visual, "visual.json"), {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.4.0/schema.json",
        "name": visual,
        "position": {"x": 80, "y": 80, "z": 0, "height": 320, "width": 900, "tabOrder": 0},
        "visual": {"visualType": "textbox",
                   "objects": {"general": [{"properties": {"paragraphs": [{"textRuns": p} for p in paragraphs]}}]},
                   "drillFilterOtherVisuals": True}})


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    target = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "..", "pbip"))
    build(target)
    print(f"wrote {target}")
