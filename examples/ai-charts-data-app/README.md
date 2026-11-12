# AI Charts Data App

A [Microsoft Fabric App](https://learn.microsoft.com/fabric/apps/overview) starter: Microsoft's Rayfin **data app
template** with a finished page of RegiaBI charts and mini-apps already wired in, beside the template's own Vega-Lite
visual. You point it at **your own semantic model** by editing one file, `src/fieldMap.ts`. The widget code never
changes.

Out of the box it draws the bundled sample rows from the public Global Revenue v2 model, so it runs with no tenant
and no sign-in.

**Charts** (first tab)

| Widget | What it shows | Roles it reads |
| --- | --- | --- |
| Ranking | Each category's growth, colored by its group | Category, CountryCode, Group, Value, Growth, Attainment, ReturnRate, Satisfaction |
| Country map | The value by country | the same |
| Top ten | The template's own Vega-Lite bar chart | Category, Value |
| Trend | The value and its target by month | Date, Period, Value, Target |
| Actual against target | Each month's gap to its target | Date, Value, Target |

**Mini-apps** (second tab)

| Widget | What a reader does with it | Roles it reads |
| --- | --- | --- |
| Selection explainer | Circles a group of points and reads what sets it apart (known defect: its y axis repeats tick labels; see `knownDefects` in `widgets.json`) | Category, CountryCode, Group, Value, Growth, Attainment, ReturnRate, Satisfaction |
| Budget allocator | Sets a total budget and sees the split that earns the most | Group, CountryCode, Category, Year, Spend, Response |
| What-if projection | Steers a growth rate and sees where the line lands against the goal | Date, Baseline, Goal |
| What-if scenarios | Compares growth scenarios side by side | Date, Baseline, Goal |

Every widget sets or follows the same page filters: click a country in the ranking, the map or the Vega-Lite bars and
the trends narrow to it; click a month on a trend and the rankings narrow to it. A chip names each filter and clears
it.

## Getting started

You need Node.js 22 or later.

```bash
npm install
npx playwright install chromium   # once, for the widget tests and the render check
npm run dev:sample                # the page on its bundled sample rows: no tenant, no sign-in
```

### 1. Rebind the page to your model

Every role is a column a widget reads. In `src/fieldMap.ts`, bind each one to a column, a measure or a DAX
expression of your model. Each widget's query is built from the map and names every result column after its role,
so nothing else changes. A worked example, for a retail model:

```ts
export const fieldMap: FieldMap = {
    connection: "retail",                                        // the connector you add in step 2
    roles: {
        Category: { table: "Store", column: "Store Name" },     // one row per store in the rankings
        CountryCode: { table: "Store", column: "Country ISO3" }, // ISO 3166 alpha-3, for the map
        Group: { table: "Store", column: "Region" },
        Value: { measure: "Net Sales" },
        Growth: { measure: "Net Sales YoY %" },
        Attainment: { measure: "Sales vs Plan %" },
        ReturnRate: { measure: "Return Rate" },
        Satisfaction: { expression: "DIVIDE ( [Happy Surveys], [Surveys] )" },
        Date: { table: "Calendar", column: "Month Start" },
        Period: { table: "Calendar", column: "Year Month" },
        Target: { measure: "Sales Plan" },
        Baseline: { measure: "Net Sales" },
        Goal: { measure: "Sales Plan" },
        Year: { table: "Calendar", column: "Year" },
        Spend: { measure: "Ad Spend" },
        Response: { measure: "Net Sales" },
    },
};
```

A role bound to a column groups the rows; a role bound to a measure or an expression is computed per row. Leave a role
out (or set it to `null`) and each panel that needs it says **Map a field to &lt;Role&gt; in src/fieldMap.ts** instead
of drawing.

### 2. Connect your model and run it in Fabric

```bash
npx rayfin login
npx rayfin connector search "<model name>" --all-workspaces --type fabric-semanticmodel --json
npx rayfin connector add --type fabric-semanticmodel --name retail --workspace-id <workspaceId> --item-id <itemId>
npm run dev
```

Once `connection` in the map names a connector in `rayfin/rayfin.yml`, the page queries the model instead of the
sample. Open the app's item in the Fabric portal and add `&devUri=http://localhost:5173` to its URL to preview it, then
publish with `npx rayfin up --workspace-uri "<workspace-uri>"`.

To try it on the Global Revenue v2 model the map ships bound to, publish that model from
[`examples/fabric-app`](https://github.com/codexguy/bicharts/tree/main/examples/fabric-app) and add it as a connector
named `globalrevenue`.

### 3. A chart the page doesn't have: ask your agent

For a chart of a shape the page doesn't have, ask your AI coding agent for it. The RegiaBI chart server (registered in
`.mcp.json` as `bic-chart`, run locally with `npx -y @bicharts/chart-mcp`) generates it into `src/widgets/<id>/`,
wired the same way: add its entry to `src/widgets/widgets.json` and its component to `src/widgets/registry.ts`, and it
reads the map like the others. You can also use the hosted server at `https://bizintelligencechampions.com/mcp`.

Generating a new chart needs a RegiaBI account, and the free tier is enough: the first chart request opens your browser
once to sign in. The prebuilt widgets need no account and make no network call; they're ordinary source files.
More for developers: [RegiaBI for developers](https://bizintelligencechampions.com/regiabi/developers?loc=aitmpl).

## Project structure

| Path | What it is |
| --- | --- |
| `src/fieldMap.ts` | **The one file you edit to rebind the page**: the connector and a field for each role. |
| `src/widgets/<id>/` | One prebuilt widget each: `chart.js` (the generated chart) and `chart.component.tsx` (its React host). Generated code: regenerate it rather than edit it. |
| `src/widgets/widgets.json` | Each widget's roles (the column its code reads and the role that fills it), the filter it sets, and its provenance: chart type, where the code came from, its sha256 and the `@bicharts/chart-host` version it was checked on. |
| `src/widgets/registry.ts` | Ties each entry in `widgets.json` to its component. |
| `src/widgets/query.ts` | Builds a widget's DAX query from the map, aliasing each field to its role. |
| `src/widgets/use-widget-data.ts` | A widget's rows: the live query once a connector is set, the bundled sample before. |
| `src/sample/` | The bundled sample (country-by-month totals from the Global Revenue v2 sample data) and the code that answers each widget from it. |
| `src/components/widget-card.tsx` | A widget in a card, with its loading, empty and unmapped states. |
| `src/components/vega-ranking-card.tsx` | The template's own Vega-Lite visual, on the same rows and filters. |
| `src/components/bic-*.tsx`, `src/lib/bic-*.ts` | Added by the RegiaBI chart server's `setup_fabric_app`: the chart panel, the theme bridge, the light and dark toggle. |
| `src/widgets/tests/` | The widget suite (`npm run test:widgets`). |
| `scripts/check-render.mjs` | The headless render check (`npm run check:render`). |
| `scripts/widgets-refresh.mjs` | Takes newer code for the widgets (`npm run widgets:refresh`). |
| `.agents/skills/`, `.claude/skills/`, `AGENTS.md` | Instructions for your AI coding agent, including `regiabi-charts`. |
| `.mcp.json` | The Rayfin and RegiaBI chart servers for your agent. |
| `rayfin/` | Rayfin's configuration (`rayfin.yml`) and data schema. |
| `manifest.json`, `rayfin-template.yml` | Gallery metadata. |

## Scripts

| Script | What it does, and what passing proves |
| --- | --- |
| `npm run dev:sample` | Serves the page on its bundled sample rows, with no tenant and no sign-in. |
| `npm run dev` | Serves the page for the Fabric portal (signs in, queries the connector the map names). |
| `npm run build` | Typechecks and builds for deployment. Passing proves the app and every widget compile. |
| `npm test` | The template's unit tests in jsdom, plus the field map, the query builder and the sample. Passing proves every role is bound, each query names its columns after their roles and is narrowed by the other widgets' filters, and the page lays out both tabs. |
| `npm run test:widgets` | Every widget on its own, in headless Chromium, with no network. Passing proves each one (a) draws on the shipped map, (b) still draws after a rebind (renamed fields, new values, three times the rows, labels over 60 characters), (c) names the role to map when one is missing, (d) for a mini-app, changes what it draws when each control moves, before and after the rebind, and (e) sets the page filter when a mark is clicked. |
| `npm run check:render` | Draws the whole page headless at 1440x900 and saves a screenshot per widget in `check-render-output/`. Passing proves every widget draws, nothing spills past its card or scrolls inside it, no axis repeats a numeric tick label, no label in a row of series labels is empty or has lost its series name, and a click on one widget redraws another (a trend month narrows the Vega-Lite bars; a ranked category narrows the trend). A defect in generated code that only regenerating fixes is listed under `knownDefects` in `widgets.json`: it's reported rather than failed, and the check fails once it's gone until the entry is removed. |
| `npm run widgets:refresh` | Compares each widget's code with the newest code for its chart type and columns, and says what changed. With `-- --apply` it takes the new code, re-runs `test:widgets` and `check:render`, and puts everything back if either fails. With `-- --stamp` it records the `@bicharts/chart-host` version both checks passed on. It never generates a chart. |
| `npm run lint` | ESLint. |
| `npm run validate:visual` | The template's check of a Vega-Lite visual's query factory. |

## License

The files that come from Microsoft's data app template keep Microsoft's MIT license (`LICENSE` in this folder, and the
header at the top of each of those files). Everything added here is Apache-2.0, like the rest of this repository.
