---
name: regiabi-charts
description: Use when adding or fixing a chart from the RegiaBI chart server (@bicharts/chart-host, BicChartPanel, a generated chart.component.tsx) in this Fabric App, laying out the cards and pages that hold charts, saving notes on chart marks, or deploying with rayfin up. Heads off the layout, Rayfin version and deploy traps measured on real builds. Also use it when the app needs a table, grid or list of rows a reader sorts, resizes, filters or browses - ask the chart server for it (list_eligible_charts, the Interactive table) before hand-building one or using the template's grid.
---

# RegiaBI charts in this Fabric App

## A table a reader works with comes from the chart server

- A page that shows rows a reader sorts, resizes, hides columns of, copies from or filters is a chart-server request, not a hand-built
  table and not the template's grid: call `list_eligible_charts` on the rows and, when the Interactive table fits, `generate_chart` it
  (`chart_type: "Interactive table"`). It is a preview type: when it isn't listed, say so and ask how to go on.
- Keep the reader's sort, widths and hidden columns through a reload: pass `rememberAs` (or `viewState` for a per-person store).

Added by the RegiaBI chart server's setup_fabric_app; it's never rewritten. The full guide is the chart server's `get_guide` tool
(topic `fabric-app`). The Rayfin facts here were checked against Rayfin's own docs on Rayfin 1.36.1, a preview:
where your installed version differs (setup_fabric_app's reply names it), its own docs
(`node_modules/@microsoft/rayfin-guide/assets/docs`) win.

## Layout: a chart is never clipped or squashed

- Render every chart inside `BicChartPanel` (`src/components/bic-chart-panel.tsx`). It sizes the chart from its cell, never from the chart.
- Give each chart its minimum with `minChartWidth` and `minChartHeight` (a world map wants about 2:1; a time series wants height).
- A phone needs no sideways scroll: set no `minChartWidth` unless the chart needs more, and never one above 294 (a 360px
  phone leaves a chart's box 294 after the padding). Make the chart fit it - `check_chart` at `width: 294`, and if it doesn't
  fit, `generate_chart` again at `width: 294` - never a wider minimum, which scrolls the chart sideways inside its card.
  `check_app` warns on one above 294, except at or below the chart type's own minimum (next).
  Below that the panel scrolls; it never squashes or clips the chart. That scroll is a safety net: inside a page that
  already scrolls it's a second scrollbar, which reads as broken - size every chart's cell at or above its minimum.
- The exception is a chart type's own minimum, which can be wider than a phone: `generate_chart` reports it ("Minimum size").
  The component written beside the chart keeps it for you: given less, it draws the chart at its minimum in a box that scrolls,
  so on a phone that chart scrolls sideways and never squashes. Set nothing for it, and never regenerate a chart type below its
  own minimum to fit a phone.
- From a laptop up, no chart scrolls sideways: at every width from 1024px, give each chart a card at least its minimum.
  A two-column grid leaves a card about 436px at a 1024px page, a three-column one about 358px at 1280px (after the page's
  padding, a `gap-5` and a `p-4` card with a border). A chart whose minimum is wider gets a row of its own at those widths
  (move its card out of the grid, or `lg:col-span-2`), or a grid track at least its minimum plus the card's padding and
  border (`minmax(544px, ...)` for a 510px chart in that card). `check_app` warns on a card narrower than its chart's
  minimum at any width from 1024 to 1920px.
- Take the actual size from the layout - percent, flex or grid `fr` - and never a fixed height smaller than the chart's minimum.
- Put `min-h-0` on every flex child between a card and its chart (`min-w-0` in a row). A flex item's default `min-height: auto`
  lets it grow past its card, and the card's `overflow-hidden` slices off the rest.
- A chart with controls drawn inside it (sliders, steppers, a reset) gets its card's full width. Put a side panel that goes
  with it - saved scenarios, a form - below the chart, not beside it: beside it, the chart's cell drops under its minimum.
- When you stack a panel below a chart, don't keep a fixed card height that can't hold both. Prefer letting the card grow (a
  `min-h-*` in place of its `h-*`); only where it must stay fixed, give the panel below `min-h-0 flex-1 overflow-auto`. Give the
  chart's cell at least the chart's `minChartHeight` (`h-72` is 288px, under a 300 minimum).
- A card's title and subtitle are static: never describe what the reader can change there (a sort order such as "highest
  first", a pick, a flipped face) - one click and it's false. Say what the chart shows.
- Open anything secondary - notes, details, a form - in a dialog, drawer or popover that overlays the page through a portal
  (`createPortal(..., document.body)`), never inside a chart's card: a card has a fixed height and clips it.

## Light and dark, on every page, unasked

- setup_fabric_app writes `src/lib/bic-theme.ts` (follows Fabric's `data-appearance`, else the OS, until the reader picks;
  the pick holds for the session) and points `src/main.tsx` at it. Put `<BicThemeToggle />`
  (`src/components/bic-theme-toggle.tsx`) in the app's header on every page, whether or not the person asked.
- Colors come from the template's tokens (`bg-card`, `text-foreground`, `border-border`...), never a literal (`#fff`,
  `bg-white`, `text-gray-700`). Charts take the theme from `useBicChartOptions()` and follow the toggle on their own.
- A dialog's scrim is `bg-black/40` (it dims in both themes), never `bg-foreground/40` (white in dark mode).
- `check_app` flags a page with no toggle, the template's own theme hook, a literal color and a scrim that flips.

## Selection, filters and a chart's own controls: the library's, never hand-written

- Filter the page with `useBicFilter("<key column>")` from `@bicharts/chart-host/react` and pass it to the chart that
  sets it as `selects`. A click sets it; the same click or empty canvas clears it; `filter.clear()` clears the marks too;
  new rows keep a pick whose key is still drawn. Never write a select handler, a toggle or a Clear-by-remount.
- Key a click filter at the grain of the chart's marks: one mark per product in each region sets
  `useBicFilter(["Product", "Region"])`, never the product alone (one pick would pick it in every region).
- An axis label picks its own field: on a filter keyed by region and stage, a region's label holds the region in any
  stage (`["EMEA", ANY_VALUE]`), and `treatAs` filters by the region alone. Never build tuple keys by hand.
- Call `useBicFilter` once in the page and pass it down. Read `filter.keys`: a pick can be a group (a legend entry, a
  subtotal row, a lasso, a Ctrl-click) and `filter.value` is only its first key, so name one pick with `filter.text` and
  say how many ("3 countries") when there are more (`filter.textOf(key, rows)` names any other key). When several
  filters share a key (one per clicked chart), read every one: in one group their keys are the page's one pick, never the
  union of filters. Filter another chart with `filterBy={{ filter, columns }}` on its
  component, and a query with `filterQuery(dax, treatAs(filter, "Table[Column]"))` from `@bicharts/chart-host/dax` -
  the query stays in its `.dax` file. `<BicFilterChips />` shows what's filtered with a clear for each.
- "A click filters everything else" means every OTHER panel follows it: its query goes through `filterQuery`/`treatAs`
  (KPIs and tables too - a table that follows shows only the matching rows), and the clicked chart highlights its pick. A
  chart never filters itself, so when the person names two charts to click ("the map or the table"), give each its own
  `useBicFilter` on the same key and filter every panel's query by each of them but its own. Give those filters one
  group, `useBicFilter("Country", { label, group: "country" })` (`{ group }`): the most recent pick is the page's one pick,
  and a click on it in whichever panel shows it clears it. A side list beside them follows that one pick. `check_app`
  flags filters on one key without a group, and lists each
  chart's wiring (filtered query, highlight only, none): say that list in your reply.
- A pick narrows only the measures it can mean: a filter in a query narrows every measure there, so keep the ones it
  can't mean out of its reach (a stage pick narrows open value, not won value or a goal), and pass it only to panels the
  model's relationships let it reach. `check_app` reads them from `.schema/models/<model>/model.sqlite`. And a pick
  reaches a measure through the tables its expression reads: a goal computed from an owners table a region pick
  can't reach stays whole beside revenue that narrows; carry the pick to it (`TREATAS`) or say on the card it ignores it.
- A panel whose query takes a page filter passes that filter as `scopedBy` (`scopedBy={country}`, or
  `scopedBy={[fromMap, fromTable]}`), so the chart says it's filtered: its rows arrive narrowed and it can't see the
  filter, so without it a KPI keeps its region's title over one country and ranks what the filter left. With it, titles
  and comparisons name the pick ("United States only", "rank 2 of 3 (United States only)"). `filterBy` needs nothing
  more. `check_app` warns on a filtered-query panel with no `scopedBy`. Leave out of `scopedBy` a pick its query removes
  on every figure it plots (`REMOVEFILTERS` / `ALL` on that column in each measure), or apply it: its marks never move for it.
  A query that takes only part of a pick's key names that part: `scopedBy={{ filter: cell, takes: ["Region"] }}`.
- Give each `BicChartPanel` the query string its hook gets (`query={q}`): it dims the last chart under "Updating..."
  until the new rows arrive, and shows a failed query over it, so old figures never pass for the new selection's.
- A chart that takes the lasso sends a circled group through the same `selects` a click uses, as many keys
  (`filter.values`). On a page, give it `selects` and the other charts `filterBy` or `filterQuery`, as for a click, so
  the circled group filters the page without being asked; with no `selects` the lasso only highlights inside the chart.
- A template `VegaVisual` or `DataGrid` joins the same filter: `onInteraction={e => fromVegaInteraction(filter, e)}`.
- A link that opens the page as it was: `useBicUrlState()`; linked hover: `useBicFilter(..., { hover: true })`; a query
  filtered to nothing: `onClearFilters={filter.clear}` on its `BicChartPanel`; while building: `<BicDevtools />`.
- A chart that draws its own sliders (a What-if chart): `const scenario = useBicControls()` and `controls={scenario}`.
  `scenario.values` is every slider's value from the first draw, `scenario.summary` the chart's own words for them;
  `scenario.set(saved)` applies a saved one. Build no slider beside the chart and never read its `uiState`.
- Notes on marks and saved scenarios: once the data service and Rayfin's functions are on (`npx rayfin functions init`),
  run setup_fabric_app with `features: ["notes", "scenarios"]`. It writes the entities, hooks, a notes dialog, a
  scenarios panel and the Rayfin functions each save runs through, finished; badges come from
  `noteBadges(notes, { chart, columns })`. Pass the signed-in user, `useAuth().session?.user`.
- Anything else the app writes (action items, flags) does what those files do: store the signed-in user's `id` beside
  the name and check both with a create policy (`claims.sub.eq(item.createdById).and(claims.email.eq(item.createdBy))`,
  the name being the signed-in email), so neither comes only from the browser; with no one signed in, refuse the save
  and say why, never "unknown"; a change that happens once (done) is its own row with a unique key per item, never an
  update anyone can repeat; a save resolves only once its reload has landed (`await reload()`, a reload that awaits
  the load itself, never a counter an effect reloads on), so its button stays off until the new rows show; and a
  dialog uses `useDialogFocus(ref, onClose)` from `src/lib/bic-dialog.ts`.
- The rest of the write-back pattern: apply only the latest reload's rows; show Loading until the first load lands; adopt
  a form default when its data arrives, and say when a lookup failed; a due date takes `min={today}` in the reader's own
  date (`getFullYear()`, `getMonth()`, `getDate()`), and the server refuses only a day already past everywhere, one before
  the date at UTC-12 (`new Date(Date.now() - 12 * 3600_000).toISOString().slice(0, 10)`), never UTC's today or its own:
  it can't know the reader's time zone, and UTC's today refuses the reader's own every evening west of UTC; read what the page
  shows (`.where(...)`), not every row; pass the query hook's whole result to `BicChartPanel` so a failed panel offers Retry.
  Every OPEN item is read whatever its due date; only done ones are bounded, by when they were done, never by due date.
  A disabled Save says why beside it; a done time shows in the reader's time zone; a refused done says who closed it, in
  the list; and one key held by two filters is one pick. And a list for a picked owner filters by the owner field the
  form saves (never the owner the model gives the item's account), and a sign-in check asks what the save asks (the email too).
  And a lookup whose rows reach the page shows its loading and its failure on the page, not only in the form.
  Other people's writes: reload when the page comes back into view (`visibilitychange`, window `focus`), never on a
  timer, and reload after a refused done as well as a saved one; a dialog's list is filtered from the hook's rows
  where it's shown, never copied into state when it opens.
- A chart that carries write markers draws every row a marker can belong to: a badge lands only on a drawn mark, so
  its query keeps every row the form can target (no `FILTER ( ..., NOT ISBLANK ( [Open Pipeline] ) )`; a blank size
  draws as a hollow ring). `check_app` flags a marker-hosting chart whose query drops rows the form can target.
- A write aimed at one mark (a flag on an account) also chooses its target by name: `<BicTargetPicker>`
  (`src/components/bic-target-picker.tsx`) in the form, started at the chart's pick; never a button only a chart pick enables.
- A time is the server's: a write that records one (created, marked done) goes through a Rayfin function that stamps it
  (`createdAt: new Date()` inside `udf.func`, saving with `ctx.getDataClient()`), and the browser never sends a time.
  Rayfin has no server-time default or function-only permission yet, so a hand-made request can still set its own -
  say so if the person asks for an audit trail. get_guide `fabric-app` (notes recipe, step e) has the pattern.

- These layer on the template's own AGENTS.md and skills. A request for RegiaBI charts is the consent its visuals
  skill asks for before another chart library. Its `validate:visual` checks VegaVisual factories, not these charts -
  `check_chart` does - and its app-validation in the portal embed still applies.

## Choices that are the person's

- `chart_style` (the familiar chart forms or the other types), `level_of_detail` and `culture` (language and region) are the person's.
  When they haven't said, put ONE question that lists the options before the first `generate_chart`; the chart server's
  `get_guide` with topic `settings` has them.
- When a chart will judge a measure good or bad (a variance against target, a rank, ahead or behind), that same question
  asks which direction is good for each such measure not already given one; pass it as `direction_of_good`
  (`{ "Bookings": "higher", "Cost": "lower" }`, by column name), or, on a server without that argument, in the
  chart's `prompt` as `higher <measure> is better`. Can't ask, or told to use defaults: pass nothing (the engine
  infers it where it can) and say which measures were left to it.
- Every other `generate_chart` argument (a title, labels, a legend, a grain, an industry, a limit...) is passed only when the person's own words name it:
  the engine's own defaults apply and an unset argument adds nothing to the request, so leaving one out costs nothing.
- When you can't ask (a sub-agent, an unattended run), use the defaults and say in your final message which choices were left to the engine.
- In that message, list the engine's choices and each chart's limits (a width it won't draw below, a row cap) under what the
  engine chose; keep "falls short" for an ask the app doesn't meet, each with why.
- When the person names a chart type or a specific ask (a grain, a limit, an overlay, a column that must show), pass the same
  arguments to `check_request` first. It says which asks this data can't honor and why, with chart types that fit when the
  type itself is denied: tell the person what it denies and why rather than generating around it.

## Before you deploy: check every chart locally

- Check every chart with the chart server's `check_chart` tool, at the size the panel will give it: by default it reads the
  chart's `minChartWidth` and `minChartHeight` off its `BicChartPanel`. A `WARNING` line in its reply is a label cut off at
  that size. You don't need to deploy to check a chart. For a table, its `Table` lines say how each column draws and
  what stays in place as the rows scroll, read from the drawn table: quote them in your reply.
- Then run the chart server's `check_app` on the whole app before every deploy: it reads how the page uses the library
  (selection, a chart's own controls, notes on marks, panel sizes), draws every chart together and compares the stack with
  npm; each finding names the file, the line and the call to use instead.
- A "vs" measure in a query is blank where there's nothing to compare against: `DIVIDE([a] - [b], [b])` or
  `IF(NOT ISBLANK([x]), [x] - 1)`, never `[x] - 1` (BLANK() - 1 is -1: a -100% mark that sets a diverging scale's span).
  `query_semantic_model` flags it in the query it runs, `check_app` in the app's `.dax` files; `check_chart` warns when
  one value stretches a color scale.
- A shown total is the sum of the parts shown: when another panel lists the parts, the card's total is
  `SUMX(VALUES('Owner'[Owner]), [Goal])`, never the measure once at the total (a rounding measure's total isn't its parts' sum).
- A card that names a window ("2019 to 2025", "to December 2025") gets a query bounded to it: a filter on the date column
  inside SUMMARIZECOLUMNS (`DATESBETWEEN(...)` or `TREATAS({ 2025 }, 'Date'[Year])`), so a later month in the model never
  shows under words that rule it out. `check_app` warns on a card that names a window over a query with no bound.
- A series over time returns every period in its range: a count or sum reads 0 for an empty period
  (`COALESCE([Case Count], 0)`, or the period table driving the query: `ADDMISSINGITEMS`), and a rate or ratio stays blank.
  SUMMARIZECOLUMNS drops a period whose measures are all blank, so under a sparse pick a line joins the periods either side
  and a quiet week looks busy. `check_app` warns on a query a line over time reads that can drop a quiet period.
- A query's range comes from the data or the person's words, never a date copied from a profile: the first and last day a
  profile showed are where the data ran when you looked, and a query bounded to them drops every later week once the model
  holds one. Leave the dates out, or bound them with the data's own first and last day (`DATESBETWEEN('Calendar'[Date],
  CALCULATE(MIN('Cases'[Opened Date]), REMOVEFILTERS()), CALCULATE(MAX('Cases'[Opened Date]), REMOVEFILTERS()))`), and print
  the range on the card from the rows the query returns. `check_app` flags a query bounded by a date written into it.
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
  non-interactive shell. It rewrites `rayfin/rayfin.yml` and `.gitignore`, so diff both and put back anything of yours -
  on a template whose models are Rayfin connectors that includes the `connectors:` list (or run `npx rayfin connector add`
  again with the same ids) and the static hosting `buildCommand`.
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
