# A Fabric Apps data app with RegiaBI charts

A runnable [Microsoft Fabric App](https://learn.microsoft.com/fabric/apps/overview): Microsoft's Rayfin
**data app template**, with three RegiaBI charts wired in **beside** the template's own Vega-Lite visual. It reads
the public [Global Revenue v2](../fabric-app) semantic model, and it's the page built in
[Building Fabric Apps with an AI agent](https://bizintelligencechampions.com/articles/fabric-app-two-mcp-servers?loc=fabtmpl).

What's on the page:

- **A bivariate world map.** Every country colored by revenue per capita *and* return rate through a 3×3 key, with
  zoom and pan.
- **A flow map of the shipping lanes.** Great-circle arcs over land, wider for more units, fading from origin to
  destination.
- **A what-if projection.** Monthly revenue against the target, compounding forward from the last actual month. The
  growth and horizon controls are drawn inside the chart.
- **The template's own `VegaVisual`**, a bar chart ranking the countries, on the same page filter as the others.

Click a country on the map or a bar in the ranking, and the lanes and the projection follow. A chip names the filter
and clears it. Readers can leave a note on a country or a lane (it shows as a badge on that mark) and save the
projection's settings as named scenarios. Both are kept in the app's own Fabric SQL database, under the signed-in
reader's name.

## What you need

- **Node.js** 22 or later.
- **A Fabric workspace where Fabric Apps is turned on.** Fabric Apps is a preview. Deploying needs a Fabric capacity
  (a trial works), the tenant setting "Enable Fabric App Items (preview)" applied, and a region where Fabric Apps is
  available. Microsoft's [overview](https://learn.microsoft.com/fabric/apps/overview) has the current list.
- **The Global Revenue v2 model** published to that workspace. Its project and data are in
  [`../fabric-app`](../fabric-app), and its README covers publishing and refreshing it with no gateway.
- **The Azure CLI**, signed in (`az login`), so the template's `fabric-app-data` command can query the model.

You don't need a RegiaBI account to build, run or deploy this app. The charts are ordinary source files in
`src/charts/`, and they make no call to us. You only need an account (a trial works) to generate new charts.

## Run it

```bash
# 1. Get this folder (sparse, so you don't download the whole repository)
git clone --filter=blob:none --sparse https://github.com/codexguy/bicharts.git
cd bicharts
git sparse-checkout set examples/fabric-app-template examples/fabric-app
cd examples/fabric-app-template
npm install

# 2. Point the app at your copy of the model (the alias the code uses is globalRevenue)
npx fabric-app-data add semanticModel globalRevenue --from-url "<the semantic model's URL in the Fabric portal>"

# 3. Check it builds (the build writes src/fabric.generated.ts from fabric.yaml, so it goes first)
npm run build && npx tsc -b && npm test

# 4. Sign in to Fabric and deploy. The first deploy also creates the notes and scenarios tables.
npx rayfin login
npx rayfin up -w "<your workspace name>"
```

Give the app its own name before you deploy if you'll keep more than one copy: the Fabric item is named after `id:`
in `rayfin/rayfin.yml`.

To work on it locally after the first deploy, run `npm run dev` and open the app in the Fabric portal with
`&devUri=http://localhost:5173` added to its URL. The app runs inside the portal even in development, because that's
where its sign-in and its queries come from. Opening `localhost` on its own won't load any data.

## What's in here

Most of this folder is Microsoft's template, scaffolded with `npx -y @microsoft/create-rayfin --template dataapp`
(create-rayfin 1.36.2, Rayfin 1.36.2). This is what was added:

| Path | What it is |
| --- | --- |
| `src/charts/*/chart.js` | The three charts, exactly as the RegiaBI chart server generated them. |
| `src/charts/*/chart.component.tsx` | The React component the server writes beside each chart. It maps a DAX result's `Table[Column]` headers onto the chart's columns and hosts the chart with [`@bicharts/chart-host`](../../packages/chart-host). |
| `src/charts/*/data.sample.json` | The rows each chart was generated from: the whole query result, profiled. |
| `src/queries/overview/*.dax` | The DAX each chart was generated on, so the live rows match what the chart expects. |
| `src/queries/overview/country-ranking.*` | The template's own pattern for a `VegaVisual`: a `.dax` query, a Vega-Lite spec and a factory. |
| `src/App.tsx` | The page. |
| `src/components/bic-*.tsx`, `src/lib/bic-*.ts`, `rayfin/data/*` | The chart panel, theme bridge, notes and saved scenarios, written by the chart server's `setup_fabric_app`. |

The template's own files are unchanged, apart from these:

- `package.json` gains `@bicharts/chart-host` and `d3`, and every `@microsoft/rayfin-*` package is on one version;
- `src/main.tsx` reads the theme through `src/lib/bic-css-theme.ts`, and `scripts/validate-visual.spec.mjs` gains one
  `vi.mock` so it passes under ESM;
- the notes and scenarios turned Rayfin's data service on (`npx rayfin init --services auth,data`), so
  `rayfin/rayfin.yml`, `rayfin/tsconfig.json`, `tsconfig.json` and `.gitignore` changed, and the Rayfin client
  (`src/lib/rayfin-client.ts`, `src/services/rayfin-auth.service.ts`) is typed with the app's schema;
- `src/App.tsx` is the page, in place of the template's empty-state preview (removed);
- `src/App.spec.tsx` stands in for the Fabric host, so the tests need no tenant;
- the template's repository files (its README, code of conduct, security policy and CodeQL workflow) are left out.

### The whole interaction layer

There's no select handler, toggle or clear button in this app. A page filter is a key in the model's own terms, and a
chart that `selects` it handles the click, the dimming, Ctrl-click, its legend and the clear:

```tsx
const country = useBicFilter("CountryCode", { label: "Country", display: "Country" });
const lane = useBicFilter(["OriginCountryCode", "DestinationCountryCode"], { label: "Lane" });
const scenario = useBicControls();

<BivariateWorldChoroplethChart table={table} selects={country} annotations={noteBadges(notes, COUNTRY_NOTES)} />
<OriginDestinationFlowMapChart table={table} selects={lane}
  filterBy={{ filter: country, columns: ["OriginCountryCode", "DestinationCountryCode"] }} />
<WhatIfProjectionChart table={table} controls={scenario} />
<VegaVisual spec={spec} data={data} theme={theme} onInteraction={e => fromVegaInteraction(country, e)} />
```

The projection's query takes the same filter with `filterQuery(dax, treatAs(country, "DimCountry[CountryCode]"))`, so
it narrows in DAX, as the signed-in reader.

## How the charts were made

With the RegiaBI chart server, an MCP server your coding agent calls. It's listed in the official MCP Registry as
`com.regiabi/chart-mcp`. For Claude Code:

```bash
claude mcp add --scope project bic-chart -- npx -y @bicharts/chart-mcp
```

Then, in a freshly scaffolded data app:

1. `setup_fabric_app`, once. It installs `@bicharts/chart-host` and `d3` and adds the chart panel and theme bridge.
   With `features: ["notes", "scenarios"]` (after Rayfin's data service is on) it also adds the notes and scenarios.
2. Per chart: `query_semantic_model` runs the chart's DAX, saves every row and profiles it. Then
   `list_eligible_charts` says which chart types that result can honestly support, and `generate_chart` with
   `out_dir: "src/charts/<name>"` writes `chart.js` and `chart.component.tsx`.
3. Render the component inside `BicChartPanel` with the live query result, as `src/App.tsx` does.

**To add a chart of your own,** ask your agent for it in plain words ("a chart of …, using the RegiaBI charts
server"). It'll follow the same three steps and write a new folder under `src/charts/`. Put its `.dax` file under
`src/queries/`, and render it the way the three here are rendered. If you want a generated chart changed,
regenerate it with a prompt that describes the change rather than editing `chart.js` by hand.

`get_guide` (topic `fabric-app`) is the server's full guide to this template, and it's free and local.

## Checked

`npm run build`, `npx tsc -b` and `npm test` (vitest) pass on a clean `npm ci` of this folder. `npm run lint` reports one error, in the
template's own `src/hooks/use-semantic-model-query.ts`, which is unchanged here. The template's `validate:visual`
check runs each `VegaVisual` query against a live model, so it needs a deployed connection.

Running the app itself needs a Fabric tenant (see above). The charts and the page wiring were also checked headless in
Chromium, with the charts' sample rows standing in for the model. All four charts drew, and a click on the map or on a
bar set the same filter.

## More

- [RegiaBI for developers](https://bizintelligencechampions.com/regiabi/developers?loc=fabtmpl): the chart server,
  the open-source host, and how to get an account.
- [The article](https://bizintelligencechampions.com/articles/fabric-app-two-mcp-servers?loc=fabtmpl): the same app
  built twice from the same prompts, with and without the chart server, and every step on the record.
- [The same page as a public web page](https://codexguy.github.io/bicharts-fabric-app-demo/), no Fabric needed.

## License

The files that come from Microsoft's data app template keep Microsoft's MIT license (`LICENSE` in this folder, and the
header at the top of each of those files). Everything added here is Apache-2.0, like the rest of this repository.
