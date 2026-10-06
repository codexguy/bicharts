---
name: regiabi-charts
description: Use when adding or fixing a chart from the RegiaBI chart server (@bicharts/chart-host, BicChartPanel, a generated chart.component.tsx) in this Fabric App, laying out the cards and pages that hold charts, saving notes on chart marks, or deploying with rayfin up. Heads off the layout, Rayfin version and deploy traps measured on real builds.
---

# RegiaBI charts in this Fabric App

Added by the RegiaBI chart server's setup_fabric_app; it's never rewritten. The full guide is the chart server's `get_guide` tool
(topic `fabric-app`). The Rayfin facts here were checked against Rayfin's own docs on Rayfin 1.36.1, a preview:
where your installed version differs (setup_fabric_app's reply names it), its own docs
(`node_modules/@microsoft/rayfin-guide/assets/docs`) win.

## Layout: a chart is never clipped or squashed

- Render every chart inside `BicChartPanel` (`src/components/bic-chart-panel.tsx`). It sizes the chart from its cell, never from the chart.
- Give each chart its minimum with `minChartWidth` and `minChartHeight` (a world map about 560 x 300; a time series wants height).
  Below that the panel scrolls; it never squashes or clips the chart. That scroll is a safety net: inside a page that
  already scrolls it's a second scrollbar, which reads as broken - size every chart's cell at or above its minimum.
- Take the actual size from the layout - percent, flex or grid `fr` - and never a fixed height smaller than the chart's minimum.
- Put `min-h-0` on every flex child between a card and its chart (`min-w-0` in a row). A flex item's default `min-height: auto`
  lets it grow past its card, and the card's `overflow-hidden` slices off the rest.
- A chart with controls drawn inside it (sliders, steppers, a reset) gets its card's full width. Put a side panel that goes
  with it - saved scenarios, a form - below the chart, not beside it: beside it, the chart's cell drops under its minimum.
- When you stack a panel below a chart, don't keep a fixed card height that can't hold both. Prefer letting the card grow (a
  `min-h-*` in place of its `h-*`); only where it must stay fixed, give the panel below `min-h-0 flex-1 overflow-auto`. Give the
  chart's cell at least the chart's `minChartHeight` (`h-72` is 288px, under a 300 minimum).
- Open anything secondary - notes, details, a form - in a dialog, drawer or popover that overlays the page through a portal
  (`createPortal(..., document.body)`), never inside a chart's card: a card has a fixed height and clips it.

## Selection, filters and a chart's own controls: the library's, never hand-written

- Filter the page with `useBicFilter("<key column>")` from `@bicharts/chart-host/react` and pass it to the chart that
  sets it as `selects`. A click sets it; the same click or empty canvas clears it; `filter.clear()` clears the marks too;
  new rows keep a pick whose key is still drawn. Never write a select handler, a toggle or a Clear-by-remount.
- Call `useBicFilter` once in the page and pass it down. Read `filter.value` / `filter.row` / `filter.text`
  (`filter.textOf(key, rows)` names any other key). Filter another chart with `filterBy={{ filter, columns }}` on its
  component, and a query with `filterQuery(dax, treatAs(filter, "Table[Column]"))` from `@bicharts/chart-host/dax` -
  the query stays in its `.dax` file. `<BicFilterChips />` shows what's filtered with a clear for each.
- A template `VegaVisual` or `DataGrid` joins the same filter: `onInteraction={e => fromVegaInteraction(filter, e)}`.
- A link that opens the page as it was: `useBicUrlState()`; linked hover: `useBicFilter(..., { hover: true })`; a query
  filtered to nothing: `onClearFilters={filter.clear}` on its `BicChartPanel`; while building: `<BicDevtools />`.
- A chart that draws its own sliders (a What-if chart): `const scenario = useBicControls()` and `controls={scenario}`.
  `scenario.values` is every slider's value from the first draw, `scenario.summary` the chart's own words for them;
  `scenario.set(saved)` applies a saved one. Build no slider beside the chart and never read its `uiState`.
- Notes on marks and saved scenarios: once the data service is on, run setup_fabric_app with
  `features: ["notes", "scenarios"]`. It writes the entities, hooks, a notes dialog and a scenarios panel, finished;
  badges come from `noteBadges(notes, { chart, columns })`.

- These layer on the template's own AGENTS.md and skills. A request for RegiaBI charts is the consent its visuals
  skill asks for before another chart library. Its `validate:visual` checks VegaVisual factories, not these charts -
  `check_chart` does - and its app-validation in the portal embed still applies.

## Before you deploy: check every chart locally

- Check every chart with the chart server's `check_chart` tool, at the size the panel will give it: by default it reads the
  chart's `minChartWidth` and `minChartHeight` off its `BicChartPanel`. A `WARNING` line in its reply is a label cut off at
  that size. You don't need to deploy to check a chart.
- Type-check with `npx tsc -b`: build mode builds the `rayfin/` project first, and a bare `tsc --noEmit` reports TS6305.

## Rayfin packages: one version

- Every `@microsoft/rayfin-*` package must be on the same version, and deploying needs 1.35 or later.
  setup_fabric_app puts them all on npm's latest, the release `rayfin init` installs, so run it before `rayfin init`.
  Run it again after anything else installs Rayfin packages: an install of only some of them leaves two copies of
  `rayfin-auth` and a TS2345 between them.

## Turning on the data service (notes, saved settings)

- The template ships with it off. One command turns it on:
  `npx rayfin init --services auth,data --auth-methods fabric --dialect mssql --overwrite --project-name <id from rayfin/rayfin.yml> .`
  Without `--overwrite` it prints 'Initialization cancelled' and exits 0; without `--project-name` it stops in a
  non-interactive shell. It rewrites `rayfin/rayfin.yml` and `.gitignore`, so diff both and put back anything of yours.
- It doesn't write the entities, the root tsconfig's reference to `./rayfin`, or the typed client. setup_fabric_app with
  `features` writes the notes and scenario entities; the notes recipe in get_guide `fabric-app` has the tsconfig and client
  edits, checked on Rayfin 1.36.1. It was checked against Rayfin's own docs for that version, so on it the recipe
  is the version-matched source: read Rayfin's docs only for what it doesn't cover.
- Don't stand up a backend to test notes; the deploy creates the tables. Finish with `npx tsc -b` and the tests, and say the
  notes go live on deploy.

## Deploying (`npx rayfin up`)

- Signed in? `npx rayfin login status` (a subcommand, not a `--status` flag); `npx rayfin login` if not.
- Name the workspace: `npx rayfin up -w "<workspace>"`. Left out, Rayfin 1.36.1 deploys to My Workspace.
- The Fabric item is named by `id:` in `rayfin/rayfin.yml`, not `name:`. Two projects with the same `id:` in one workspace
  deploy into one item: give each its own `id:`, or deploy with `--item-name <unique-name>`.
- Pass `--yes` to reuse an existing item only when you know it's yours: it deploys into whatever item has the name.
- Deleted the app outside Rayfin? `rayfin/.deployments.json` still names the deleted item, so the next `rayfin up` fails with
  404 Not Found. Move that file aside and deploy again.
