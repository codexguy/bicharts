# Global Revenue v2: a demo semantic model

A synthetic, multi-table Power BI semantic model for building data apps, including
[Microsoft Fabric Apps](https://learn.microsoft.com/fabric/apps/overview). Its data has
the shapes that richer chart types need: two measures per country for a bivariate map,
trade lanes between countries, several years for animation, several measures that move
together, and a what-if parameter.

Every number is generated. None of it describes a real company.

## What's here

| Path | What it is |
| --- | --- |
| `data/*.csv` | The nine tables the model reads. UTF-8, LF line endings, with a header row. |
| `pbip/GlobalRevenueV2.pbip` | A Power BI project: the semantic model (TMDL) plus a one-page report. |
| `generator/generate_data.py` | Rebuilds `data/` from a fixed seed. Every run is byte-identical. |
| `generator/build_pbip.py` | Rebuilds the project folder. |
| `generator/check_shapes.py` | Prints the evidence that the data has each shape described below. |

## The model

A star schema. Every relationship is many-to-one, single-direction and active.

- **DimDate**: one row per month, 2019-01 to 2025-12. It's marked as the date table and has
  a `MonthIndex` column for period arithmetic.
- **DimCountry**: 40 countries in 5 regions, keyed by ISO 3166-1 alpha-3 `CountryCode`. Each
  has a subregion, a centroid latitude/longitude and a population.
- **DimCity**: 71 real cities with real coordinates and a tier (1-3), keyed like `USA-NYC`.
- **DimProduct**: 10 products, Category > Line > Product, keyed like `HW-LAP`.
- **DimChannel**: Online, Retail and Partner.
- **FactSales**: month x city x product x channel (orders, units, revenue, customers and returns).
- **FactOperations**: month x country (marketing spend, headcount and survey results).
- **FactRevenueTarget**: month x country.
- **FactShipments**: month x origin country x destination country x product (units, freight
  cost and value). Origin and destination each join their own copy of the country table
  (**DimOriginCountry**, **DimDestinationCountry**), so a flow query needs no inactive
  relationship.
- **Growth Rate**: a what-if parameter, `GENERATESERIES(-0.1, 0.3, 0.025)`, defaulting to 5%.

Measures live in `_Measures`, grouped in display folders: Sales, Time Comparison, Geography,
Operations, Targets, Shipments and What-if. Every table, column and measure has a
description, so a tool that reads the model's metadata (DAX `INFO` functions, for example)
learns what each one means. Fact columns are hidden; query the measures.

## Shapes it's built to have

- **A country measure over time.** 40 countries x 7 years, every cell filled, with growth
  rates that differ widely by country.
- **Two measures per country.** Revenue per Capita against Return Rate % fills every cell
  of a 3x3 grid.
- **Flows between places.** 291 origin-destination lanes, the largest about 100 times the
  median, with region-to-region flows in both directions.
- **Multi-level flows.** Region > Channel > Product category.
- **A dated measure with a target.** 84 months of revenue against a monthly target, plus
  the Growth Rate parameter for projections and scenarios.
- **Measures that move together.** 280 country-years of marketing spend, customers,
  headcount, orders and revenue, related but not perfectly.
- **Many points.** 71 cities across three tiers.

## Using it

**Power BI Desktop.** Open `pbip/GlobalRevenueV2.pbip` and refresh. Every table reads its CSV
from `https://raw.githubusercontent.com/<DataPath><file>.csv`, and the `DataPath` parameter
(Transform data > Edit parameters) says which copy: by default the `data/` folder on this
repository's `main` branch,

```
codexguy/bicharts/main/examples/fabric-app/data/
```

A fork can point `DataPath` at its own copy.

**The Power BI service.** After publishing, open the semantic model's settings > Data source
credentials. For `https://raw.githubusercontent.com/`, choose **Anonymous** authentication and
privacy level **Public**, then refresh. No gateway is needed. GitHub caches the files for a few
minutes after any change.

**Why the host isn't a parameter.** The Power BI service refuses to refresh a web source whose
base address is computed (`DynamicDataSourcesIsNotSupportedForRefresh`). So the host is a
literal in the `fnLoadCsv` function, and only the path under it comes from the parameter.

**Shipment measures** follow `DimOriginCountry` and `DimDestinationCountry`, not `DimCountry`.
Grouped by `DimCountry`, they repeat the same total on every row.

**Regenerating.** `python generator/generate_data.py` rewrites `data/`, and
`python generator/build_pbip.py` rewrites the project. Run `python generator/check_shapes.py`
to confirm the shapes.

## Licence

Apache-2.0, like the rest of this repository.
