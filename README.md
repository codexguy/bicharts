# @bicharts — RegiaBI for developers

> **Make Generative AI for Charts *Better*.**

Describe the chart you want, or just hand over the data, and RegiaBI gives you back a working, interactive chart that fits your data on the first try — as source code you own. It goes into your repo and runs in the framework you already use: React, a plain web page, or whatever your coding agent is scaffolding. At run time there's no key, no call to us and nothing to pay per render: `@bicharts/chart-host`, the open-source runtime, makes the chart behave in your page — clicks, cross-filtering, selection — so that's code you don't have to write. You start from something that already works and spend your time on the last ten percent, in plain language or in the code itself; reading the code is an advantage, never the price of entry. And because the engine knows what each chart type can honestly say, it'll sometimes show you a view of your data you hadn't thought to ask for.

**[Live demo](https://codexguy.github.io/bicharts-react-demo/)** — two generated charts
cross-filtering in a plain React app; the page makes zero calls to us. There's also a
**[Blazor demo](https://codexguy.github.io/bicharts-blazor-demo/)** — the same claim, in .NET,
[built from an empty folder through the MCP](https://github.com/codexguy/bicharts-blazor-demo)
with a [step-by-step recipe](examples/blazor).
· [RegiaBI for developers](https://bizintelligencechampions.com/regiabi/developers?loc=ghlib)

The chart is a plain `render(container, data, options)` function you commit to your
repository; these packages are the host side, the code that runs it correctly. The same
contract is implemented by the LLM AI Charts visual in Power BI, so a chart looks and behaves
the same wherever it runs.

| Package | What it is |
| --- | --- |
| [`@bicharts/chart-host`](packages/chart-host) | Runs a generated chart in a web host: compiles it, applies the shared option defaults, resolves mark clicks, owns the selection affordance, translates row indices between cross-filtered charts, and tears down cleanly. React bindings included. |
| [`@bicharts/shape-core`](packages/shape-core) | Measures the *shape* of a dataset — types, cardinality, temporal/ordinal detection, geographic region and point resolution, cross-column signals. Measurement only; the policy that decides what a shape means lives server-side. |

## Quick start

```bash
npm install @bicharts/chart-host d3@7
```

```tsx
import * as d3 from "d3";
import { BicChart, BicChartGroup } from "@bicharts/chart-host/react";
import code from "./charts/revenue/chart.js?raw";

<BicChartGroup columns={columns} rows={rows}>
  <BicChart id="revenue" code={code} d3={d3} options={{ width, height }} />
  <BicChart id="detail"  code={detail} d3={d3} options={{ width, height }} />
</BicChartGroup>
```

Clicking a mark in one chart filters the other. See
[the package README](packages/chart-host#readme) for the vanilla API, sizing rules, maps,
d3 plugins, and the row-index hazard you must not hand-roll.

## Where the chart comes from

`chart.js` above is *generated*. The easiest way to produce one is the
**`@bicharts/chart-mcp`** server, which any MCP-capable agent — Claude Code, Claude Desktop,
Cursor — can drive:

```bash
claude mcp add --scope user bic-chart -- npx -y @bicharts/chart-mcp
```

It exposes three tools. `assess_data_shape` profiles a dataset **entirely locally** with the
`@bicharts/shape-core` package in this repo — no account, no network call, nothing leaves the
machine. `list_eligible_charts` asks the backend which chart types actually suit that shape,
which is the authoritative answer rather than a local guess; it is free within a generous
allowance, and its credential requirements are documented in that package's own README.
`generate_chart` writes the `render(container, data, options)` function and a sample payload
into a directory you name.

## What needs a licence, and what doesn't

Authoring a chart — through the MCP server or the API — needs a RegiaBI trial or paid account; there's no freemium tier on the programmatic side. Asking which chart types fit your data is free within an allowance and metered beyond it, and generating a chart uses your account's credits; bring-your-own-key billing is available here too. If your organisation already licenses one of our visuals, that's the licence — there's nothing further to buy. Running a generated chart is free, forever, anywhere: no key, no licence check, no call to us. The generated source is yours. A consultancy can author under its own licence and hand the finished charts to its client, who needs no licence to run them.

## Why the first try can be trusted

Before anything is written, RegiaBI measures your data's shape — types, grain, time, geography, and which measures are rates that must never be summed — and takes every chart type your columns can't honestly support off the table instead of ranking it low. The model then writes real code against the chosen chart type's contract, and that code is run before you see it: the legend is checked against what was actually painted, the layout is re-measured at small sizes, and every interactive mark is checked for a binding to a real row of your data. A chart that fails is repaired or reported, never assumed to have worked because it returned.

> `@bicharts/chart-mcp` is **not covered by this repository's licence.** It is a
> closed-source, separately-licensed artifact distributed on npm; see the `LICENSE.txt` inside
> that package. The two packages in *this* repo are Apache-2.0, and the chart code the
> generator produces is yours outright.

## Why these exist as open source

The interesting part of BIC is the *generation* — choosing a chart type for a dataset and
writing code that renders it correctly. That stays a paid service. The part that runs the
result is plumbing, and plumbing is worth more to everyone as a shared, inspectable thing than
as a private one. Making it Apache-2.0 also means a chart you generated is yours in a way a
proprietary runtime could never promise.

## Development

```bash
npm install          # workspaces: both packages, linked
npm run build        # esbuild bundles + .d.ts for each package
npm test             # vitest across both
```

`packages/chart-host` bundles `shape-core` into its published artifact, so consumers get one
self-contained package; `shape-core` also publishes independently for callers that only want
the profiler.

**Do not consume these by path alias.** A package consumed by alias is not a package — it will
appear to work while shipping a tarball nobody can install. The published artifact is verified
by installing it into a freshly scaffolded app outside this repository.

## Licence

Apache-2.0 — see [LICENSE](LICENSE).

The packages embed geographic reference data. One source carries a **condition**, not a
courtesy: city and administrative coordinates come from [GeoNames](https://www.geonames.org/)
under **CC BY 4.0**, and that attribution must travel with any redistribution — including an
application that bundles these packages. It is in [NOTICE](NOTICE) and in a banner comment at
the top of every built file, so keeping either satisfies it. Country polygons (Natural Earth)
and US state/ZIP boundaries (US Census/TIGER) are public domain.
