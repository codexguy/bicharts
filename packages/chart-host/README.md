# @bicharts/chart-host

> **Make Generative AI for Charts and Maps *Better*.**

**AI Data Components, running in your page:** a bivariate map with its two-way key, a what-if projection with its
controls inside the chart, a flow map, and about 90 everyday chart types, with selection, cross-filtering and the legend
already wired. This package is the open-source runtime that makes them behave the same way in Power BI, Excel, Fabric
Apps and any web page.

Describe the chart you want, or just hand over the data, and RegiaBI gives you back a working, interactive chart that fits your data on the first try — as source code you own. It goes into your repo and runs in the framework you already use: React, a plain web page, or whatever your coding agent is scaffolding. At run time there's no key, no call to us and nothing to pay per render: `@bicharts/chart-host`, the open-source runtime, makes the chart behave in your page — clicks, cross-filtering, selection — so that's code you don't have to write. You start from something that already works and spend your time on the last ten percent, in plain language or in the code itself; reading the code is an advantage, never the price of entry. And because the engine knows what each chart type can honestly say, it'll sometimes show you a view of your data you hadn't thought to ask for.

**[Live demo](https://codexguy.github.io/bicharts-react-demo/)** ·
[RegiaBI for developers](https://bizintelligencechampions.com/regiabi/developers?loc=npmhost)

This package is the runtime: it makes the chart you were handed behave in your page. A
generated chart is a plain `render(container, data, options)` function you commit to your repo,
and this is the host side — the ~80 lines every integrator would otherwise write, and the
handful they would get subtly wrong.

It is the same contract the BIC Power BI visual implements, minus Power BI — so a chart looks
and behaves the same wherever it runs.

## What it does for you

- **Compiles** the generated code and injects your `d3`.
- **Applies the shared option defaults/clamps** — the same `resolveOptions` the visual uses.
- **Resolves mark clicks** — including *through* a chart's own tooltip overlay, and by geometry
  when a row has no hittable shape.
- **Multi-select on Ctrl / Cmd / Shift** — the same gesture Power BI uses. Modifier-clicking
  *toggles* each row, so clicking a selected mark again removes it.
- **Owns the selection affordance** — dims unselected marks via the `lch-*` class grammar.
- **Translates row indices** between cross-filtered charts (see the hazard below).
- **Pins typography** at the container boundary so your page's CSS can't slice chart labels.
- **Tears down** cleanly — StrictMode-safe, stops animation timers.

## Install

```bash
npm install @bicharts/chart-host
npm install d3@7                      # peer requirement of the CHART, not of this package
npm install -D @types/d3              # TypeScript only — d3 ships no types
```

This package itself has **no runtime dependencies** — the shape profiler is bundled in, and the
map geometry loads on demand.

React is an **optional** peer — a vanilla host never resolves it.

## React

```tsx
import * as d3 from "d3";
import { BicChart, BicChartGroup } from "@bicharts/chart-host/react";
import code from "./charts/revenue/chart.js?raw";      // Vite; any raw-text import works
import payload from "./charts/revenue/data.sample.json";

// data.sample.json rows are POSITIONAL arrays; the group wants row OBJECTS.
const columns = payload.columns;
const rows = payload.rows.map(r =>
  Object.fromEntries(columns.map((c, i) => [c.name, r[i]])));

<BicChartGroup columns={columns} rows={rows}>
  <BicChart id="revenue" code={code} d3={d3} options={{ width, height }} />
  <BicChart id="detail"  code={detailCode} d3={d3} options={{ width, height }} />
</BicChartGroup>
```

Clicking a mark in one chart filters the other. The group owns the source table and the
payload→source row mapping — which is the part you must not hand-roll:

> **The row-index hazard.** `__rowIdx__` is a position *within the payload a chart received*,
> not an id in your table. Re-render a chart with filtered rows and its payload renumbers from
> zero, so the same integer now denotes a different record. Comparing indices across two charts
> does not throw — it quietly filters to the wrong thing.
>
> Rows built from `data.sample.json` already carry a `__rowIdx__` column (the sample's own
> positions). The payload builder owns that name: it drops an incoming `__rowIdx__` and writes
> each payload's positions itself, so the rows above need no cleaning. (Before 0.6.33 the
> incoming column was kept beside the new one and a filtered chart's clicks read it; on an older
> version, leave `__rowIdx__` out when you build `columns`.)

### The coordinated dashboard: one chart filters, the other highlights

The pairing almost every dashboard actually wants. A table *filters* down to the selection; a
map **keeps every bubble and dims the rest**, because filtering a map to one city throws the
geography away and leaves nothing to click to change the selection.

```tsx
<BicChartGroup columns={columns} rows={rows} point={{ city: "City", state: "StateOrProvince" }}>
  <BicChart id="map"   code={mapCode}   d3={d3} geoKind="north-america" respondsWith="highlight" />
  <BicChart id="table" code={tableCode} d3={d3} />
</BicChartGroup>
```

That is the whole recipe. `respondsWith="highlight"` keeps the full payload and paints the
sibling's selection onto the marks, so the map is **re-painted, never re-rendered** — it holds
its projection, zoom and basemap while the table filters beside it. The rest follows from rules
the group already enforces:

- **A chart never filters itself.** The origin keeps all its marks with the selected ones lit,
  so the gesture stays reversible.
- **Mutual by default.** Click a bubble → the table filters; click a row → the map highlights.
  Add `filteredBy="table"` only when you want one-way wiring.
- **Clearing** is `group.clear()`, or clicking the selected mark again.

Outside React it is `host.selection.highlight(rowIdxs)` on the chart that should dim, and
`setData()` with a filtered payload on the one that should filter. Both notify subscribers with
source `"host"` — that tag is what stops two linked charts republishing each other's selection
and fighting.

Do **not** reach for the `lch-*` classes to do this by hand. They are an implementation detail
of the affordance, they are re-applied on every render (so a manual `classList` poke is lost at
the next data change), and getting row indices right across a filtered payload is the hazard
above.

## Vanilla

```js
import { createChartHost } from "@bicharts/chart-host";

const host = createChartHost(el, { code, data, d3, options: { width: 800, height: 500 } });
host.render();
host.selection.onChange(rowIdxs => { /* cross-filter your other panels */ });
host.setOptions({ colorScaleLow: "#eee" });   // live restyle — never a regeneration
host.destroy();                               // call on unmount
```

### Several charts, one selection, without React

`createChartGroup` is the group `<BicChartGroup>` wraps: it owns the source table, derives each
member's payload, and translates every click to **source** row indices, so the row-index hazard
above is handled the same way in any framework (or none).

```js
import { createChartGroup, createChartHost, assembleD3 } from "@bicharts/chart-host";

const group = createChartGroup(columns, rows, { point: { city: "City" } });
const d3all = assembleD3(d3, d3Sankey);                     // one extensible d3 for every chart

function mount(id, el, code, opts = {}) {                   // opts: { filteredBy, respondsWith }
  const host = createChartHost(el, { code, d3: d3all, data: group.memberPayload(id, opts).payload,
                                     options: { width: 800, height: 500 } });
  host.render();
  return group.attach(id, host, opts);                      // .detach() on teardown
}
mount("map", mapEl, mapCode, { respondsWith: "highlight" });
mount("table", tableEl, tableCode);

group.onChange(sel => console.log(sel.sourceId, sel.rows));  // SOURCE row indices
group.clear();
```

## Reader options

Everything a reader can tune lives in `options` - the `options` prop on `<BicChart>`, the
`options` you hand `createChartHost`, or a later `setOptions`. The full set, with each option's
default, bounds and whether it repaints the chart on screen, is exported as `OPTIONS_VOCABULARY`;
`LIVE_OPTION_KEYS` lists the ones that apply without a new chart.

**Card decks and carousels.** A chart that pages through several faces (a flippable multi-card
deck, a rotating carousel) reads these on every draw, so they all restyle live:

| Option | Values | Unset means |
| --- | --- | --- |
| `cardBackgroundColor` | any CSS color | the chart's own fill: a deck uses the page, a carousel a light tint |
| `flipIntervalMs` | `0` (manual only), or 500-120000 ms | the chart's own: manual for a deck, 5 s for a carousel |
| `flipDirection` | `"horizontal"`, `"vertical"` | `"horizontal"` (side to side) |
| `flipMode` | `"both"`, `"all"`, `"single"` (the deck only; a carousel has its own arrows) | `"both"` |

```tsx
<BicChart id="kpis" code={code} d3={d3}
          options={{ width, height, cardBackgroundColor: "#f4c7b8", flipIntervalMs: 4000 }} />
```

The fill is the only thing you set: the chart still chooses its text colors, and they are its
job to keep readable on a dark card.

**Clearing an option.** `setOptions` merges into what the chart already has, and so does a
changed `options` prop - a key you simply drop keeps its last value. To hand an option back to
the chart's own default, pass it explicitly as `undefined`:

```js
host.setOptions({ cardBackgroundColor: undefined, flipIntervalMs: undefined });
```

## Sizing is yours

`width`/`height` have **no defaults**. A chart draws once at whatever it is handed and does not
re-measure, so a container measured at 0 draws a 0px chart forever. Measure synchronously, and
use a `ResizeObserver` only for *later* resizes — gating the first paint on one costs seconds in
a background or headless tab, where frames are barely produced.

```tsx
useLayoutEffect(() => setW(ref.current.getBoundingClientRect().width), []);
```

In React, `useMeasuredSize(ref)` from `@bicharts/chart-host/react` does exactly that and follows
later resizes: give the element its size in CSS and pass what it measures.

## Maps

Geometry is **not** bundled into the entry — the three assets are ~1.3 MB raw, and a bar chart
should not pay for a basemap. Choose one:

```js
import { loadGeo } from "@bicharts/chart-host";              // per-asset dynamic import (own chunk)
await loadGeo("us-state-code");
createChartHost(el, { code, data, d3, geoKind: "us-state-code" });

import { geoForKind } from "@bicharts/chart-host/geo";       // or bundle it yourself
createChartHost(el, { code, data, d3, geoKind, geoProvider: geoForKind });

createChartHost(el, { code, data, d3, options: { geo } });   // or pass data.geo.json directly
```

The React `<BicChart>` handles this itself: give it `geoKind` and it fetches the geometry when
the cache is cold, re-rendering with the basemap when it lands. `await loadGeo(kind)` before
mounting still works and skips the one-frame pop-in. Outside React, `render()` is synchronous
by contract, so setting `geoKind` with no geometry available warns and draws without a
basemap — load or provide geometry first.

## D3 plugins

Some charts call `d3.sankey()`, `d3.hexbin()` or the voronoi family. Those are separate packages
that **attach onto the d3 object** — install them and pass the host *one* d3 that carries them.
`import * as d3` is a module namespace, which is frozen, so assigning a plugin onto it throws;
`assembleD3` builds a plain copy instead:

```js
import * as d3base from "d3";
import { sankey, sankeyLinkHorizontal } from "d3-sankey";
import { assembleD3 } from "@bicharts/chart-host";

const d3 = assembleD3(d3base, { sankey, sankeyLinkHorizontal });
createChartHost(el, { code, data, d3 });
```

The integration contract returned by `generate_chart` names exactly which ones *your* chart
needs. If one is missing, the host throws a message naming the package instead of a bare
`d3.sankey is not a function`.

You can also ask the code itself, *before* rendering it — which is what you want when the chart
arrives at run time and a blank frame is not an acceptable answer:

```js
import { requiredD3Plugins } from "@bicharts/chart-host";

requiredD3Plugins(code);            // -> ["d3-sankey"]  (sorted, deduped, [] for core-only d3)
```

It is a static scan, not a trial render: synchronous, side-effect free, and safe to run on
generated code you have not executed yet. It errs toward naming a plugin the chart may not
reach — a needless install is cheaper than a blank chart.

## Selection styling

Generated code emits marks and `data-row-idx`; it never styles "selected", because only the host
knows what is selected. This package injects the rules, using the same grammar as the Power BI
visual — override them if you want a different look:

```css
.bic-chart-host { --lch-dim-opacity: 0.25; }
.bic-chart-host.lch-has-selection .d3-mark:not(.lch-mark-selected) { opacity: var(--lch-dim-opacity); }
.bic-chart-host.lch-has-selection .d3-lift-selected .d3-mark.lch-mark-selected { opacity: 1; stroke-opacity: 1; fill-opacity: 1; }
```

The second rule is opt-in. The affordance is dim-only — a selected mark is merely *exempt* from
the dim and keeps whatever paint the chart gave it — so a chart that rests its marks below full
opacity by design (a parallel-coordinates plot drawing every line at 0.38 so overplotting reads)
would show its selected lines at 38%, which the eye reads as dimmed. Such a chart stamps
`d3-lift-selected` on the group holding those marks, and inside that group a selected mark is
painted at full opacity. Undeclared charts are unchanged, so alpha used as an encoding (a depth
cue, a hierarchy level) is never flattened by a fix meant for another chart.

**How far the rest dims, per chart.** `options.dimOpacity` (a share of full opacity, `0.01`-`1`;
`DIM_OPACITY_MIN` is the floor) sets the level for one host without writing CSS, and it is live
through `setOptions`. It takes a number or a numeric string; a value above 1 is clamped to 1 (no
dim), never read as a percentage, and anything else is ignored. The host writes it as
`--lch-dim-opacity` on its own container and, when the option goes away or the host is destroyed,
puts back the value your page had set inline there, so with the option absent nothing is written
and the CSS above decides: the stylesheet's `0.25`, or whatever your page sets on the variable.

```js
createChartHost(el, { code, data, options: { dimOpacity: 0.15 } });
```

**A glyph on each selected mark.** `options.selectionGlyph` (`"dot"` or `"check"`; absent or
`"none"` draws nothing, the default) puts a small glyph on every selected mark, in a layer the host
owns inside the container (`.bic-selection-glyphs`, each glyph `.lch-sel-glyph`, never hit-tested).
It is painted after every selection change and, on a redraw, after the layout pass and the fit, so
nothing measures it as part of the chart. Only a mark the reader can see gets one: a mark hidden by
`visibility` or `opacity` (a legend toggle) and a mark outside its svg's frame or its plot's
`clip-path` (a point panned into the axis margin) get none. While a selection is lit, a mark that
moves or hides without a redraw (a pan or zoom, a transition, an animation frame, a legend toggle)
takes its glyph with it on the next frame; a write that holds no mark (a hover dot, a tooltip)
repaints nothing, and that repaint is not reported again. Where the browser has a `ResizeObserver`,
a container resized without a redraw (a responsive chart, a hidden tab shown) is repainted too, and
reported when it drew a different count. The layer clips at the container's scroll area, so a
glyph never widens what the container scrolls, and it sits under the note badges, under a chart's
own tooltip or control that sets a `z-index` above 1, and under a pinned axis, so a glyph on a row
scrolled beneath the axis is covered with its row. When the page left the container
`position: static`, the host makes it `relative` so the layer scrolls and clips with the marks, and
`destroy()` puts back what the page had. A period picked on a chart's own timeline dims nothing and
marks nothing.

Some charts never take a glyph: on a flow or relationship chart a selected series would get one on
every point. The generate answer says so (`suppressSelectionGlyph`, read by shape-core's
`parseGenerateResponse`); pass it as `options.suppressSelectionGlyph`, or leave it in the payload's
`meta` (`data.meta.suppressSelectionGlyph`) and the host promotes it, the way it promotes
`geoPoint`. Keep it with the chart's code, so a redraw from a cache honors it too.
`onSelectionGlyphs` reports what each paint did (`{ mode, drawn, total, suppressed }`), and is
called only when a glyph mode is set:

```js
createChartHost(el, {
  code, data,
  options: { selectionGlyph: "dot", suppressSelectionGlyph: answer.suppressSelectionGlyph },
  onSelectionGlyphs: r => console.debug("glyphs", r),
});
```

**Which marks count as selected.** By default a mark is selected when *any* of the rows in its
`data-row-idx` list is selected, which is what lights a legend swatch together with its series. A
chart whose marks share rows declares the other rule by stamping
`data-lch-sel-rule="clicked-marks"` on an element it draws (its own `<svg>`): then exactly the
marks the reader clicked are selected and every other mark is dimmed, Ctrl/Cmd/Shift-click adds or
removes a mark, and a selection set from outside lights the marks whose rows equal it. A mark is
named by `data-mark-key` when it carries one, else by its row list. A word cloud is the case it was
made for: every word shares a comment with many others, so the default lit most of the cloud on one
click. The cross-filter sent out is the same under both rules. `onSelectionPaint` reports how each
paint of a declaring chart decided, including when no mark matched and the default was used.

## Remembering what the reader did

A chart keeps its resting state (a sort, an expanded row, a 3D camera angle) in a small bag. It
reads the bag from `options.uiState` and writes it through `options.setUiState`, and generated code
never learns where the bag goes. Where it goes is your host's choice, and so is which keys may
outlive what: a redraw, a close and reopen, or a new version of the chart.

`createChartHost` still takes one `viewState` provider, as before. When your host needs more than
one store, describe it with a `ViewStateService`:

```ts
import { sessionViewStateProvider, type ViewStateService } from "@bicharts/chart-host";

const viewState: ViewStateService = {
    viewing: sessionViewStateProvider(el),   // survives a redraw; a page switch starts clean
    durable: workbookStore,                  // optional: survives close and reopen
    policy: {                                // the keys your host scopes, by name
        camera: { lifetime: "durable", dropOnNewVersion: true, dropOnFreshViewing: false, durableWhen: "rememberView" },
        userStopped: { lifetime: "durable", dropOnNewVersion: false, dropOnFreshViewing: true },
    },
    versionKey: "cameraVersion",             // optional: how a version change is noticed
};
```

**What you provide.** `viewing` and `policy` are required (`policy: {}` is fine). Everything else is
optional, and leaving it out says something about your host:

- no `durable` store: the host can't remember across a close (a static preview, a server-side
  render). `viewStateIsDurable(service)` is the one definition of "remembers the view", so it can't
  be claimed without a store to back it. `noopViewStateService()` says "nothing is stored" out loud.
- no `chartKeys`: keys your policy doesn't name belong to the chart. They're kept, durably, through a
  new version and a fresh viewing, and the chart validates what it reads. Set `chartKeys` to give
  them another rule. A host that forgets everything when its chart changes sets `dropOnNewVersion`.
- no `versionKey`: you apply the version rule yourself, where you learn the chart changed.
- no `durableMaxChars`: the durable store accepts any size.

**What a key can be.** `lifetime: "viewing"` keeps a key out of the durable store; `"durable"` puts it
in both. `dropOnNewVersion` drops it when the chart on screen is another version (a camera is aimed
at one chart's axes). `dropOnFreshViewing` drops it when the bag is read at the start of a viewing
instead of in the one that wrote it. `durableWhen` names a preference that must be on for the key to
reach the durable store; the viewing store keeps it either way.

**The rules are plain functions** in `@bicharts/chart-host/view-state`, with no DOM, timers or
storage of their own:

```ts
import { resolveViewState, commitViewState } from "@bicharts/chart-host/view-state";

const { bag, dropped } = resolveViewState(viewState, { codeVersion, freshViewing });   // before a render
commitViewState(next, viewState, prefs);                                               // when the chart writes
```

`resolveViewState` builds the bag the chart is handed: the viewing store, else the durable one, with
the policy applied. `commitViewState` decides what a write reaches: the viewing store gets all of
it, the durable store gets what the policy allows. Both report what they did and neither throws.
`viewStateAfterSwap(service, bag)` applies the version rule for a host that sees the swap itself.

**Check your stores** with the conformance suite in the testing subpath. It confirms `load` never
throws and reads `{}` when empty, that `save` replaces, that nested values round-trip, that the
viewing store survives your host being re-created on the same element, and that the durable store
holds what it's given across a reopen:

```ts
import { assertViewStateConformance } from "@bicharts/chart-host/testing";

const report = await assertViewStateConformance(service, {
    recreate: () => buildService(sameElement),   // the host drawing again
    reopen: () => buildService(newElement),      // a new viewing over the same saved file
    settle: () => flushPendingWrites(),          // only if your durable save is debounced
});
expect(report.skipped).toEqual([]);              // nothing went unchecked
```

**A zoomed or panned view** is not in the bag: d3-zoom keeps it on the DOM node, and every redraw
(a resize, a cross-filter, a restyle) opens the chart at full extent again. `@bicharts/chart-host/zoom-memory`
remembers it. You supply where the view lives; the hook does the rest on every render:

```ts
import { createZoomMemoryHook, type ZoomMemoryHost } from "@bicharts/chart-host/zoom-memory";

const zoomHost: ZoomMemoryHost = {
    liveZoomState: null, zoomWatchKey: "", zoomWatchAttached: false, zoomSettleTimer: 0, zoomContainer: el,
    rememberAcrossSessions: () => prefs.rememberZoom,             // the persisted tier is on now?
    readPersistedZoom: () => localStorage.getItem("chart-zoom"),
    persistZoom: json => localStorage.setItem("chart-zoom", json), // "" forgets
    log: () => {},
};
const zoomMemory = createZoomMemoryHook(zoomHost);   // once per chart, reused by every host built for it
const host = createChartHost(el, { code, data, d3, zoomMemory });
```

The view survives every redraw in the session whatever the preference says, and a close and reopen
only while `rememberAcrossSessions()` is true. It is keyed by the chart's code and the viewport size
(to the nearest 32 px), so a regenerated chart or a real resize opens at full extent instead of
somewhere arbitrary. A chart with several zoomable panels is left alone. The `ZoomMemoryHost` is the
memory: keep one per chart for as long as the chart is on the page, and hand its hook to every host
built for that chart, on the same element or, after a remount, a new one (a destroyed host releases
the hook's watcher, so the next one can take it). In React, pass the hook as the `zoomMemory` prop of
`<BicChart>`, built once (`zoomHost` as above, kept outside the render):

```tsx
const [zoomMemory] = useState(() => createZoomMemoryHook(zoomHost));   // once, however often this renders
return <BicChart code={code} data={data} d3={d3} zoomMemory={zoomMemory} />;
```

A hook that arrives after mount, or goes away, rebuilds the chart's host; swapping one hook for another
on a mounted `<BicChart>` rebuilds nothing, and applies at the next rebuild (a new `code`, say) or at
once if you remount it with a `key`, so a hook built inline in the props costs no rebuild.

**A scrolled chart** keeps its place with no setup. A chart taller than its frame scrolls, and every
redraw empties the container, which used to send the reader back to the top. The host now parks the
scroll offset on the container before it clears it, and the fit puts it back once the new layout has
decided whether it still scrolls. The offset is clamped to what the new layout can scroll, and only
restored on an axis that still scrolls. That covers a resize, a filter, a restyle, and a new host
created on the same element. The memory is keyed by the chart (its `code`, or the `renderFn`'s
source text), so a different chart opens at the top, while a `renderFn` closure rebuilt on every draw
is still the same chart. It lives on the element for the session
only, and nothing is persisted. A page that manages the container's scrolling itself passes
`restoreScroll: false` (the `restoreScroll` prop of `<BicChart>`), and then nothing is remembered or
restored. A host that clears and fits its container on its own can use the same pieces:
`rememberScroll` before the clear, `takeScroll` after the render, and `fitRenderedChart`'s
`restoreScroll` option (or the pure `planScrollRestore`).

## Keeping a drawn chart readable inside its frame

A generated chart cannot know how wide its own legend text will come out, where its tick labels will
collide, or how far a label will hang past the frame, because none of that exists until the browser
has laid the SVG out. `@bicharts/chart-host/legend-fit` measures the rendered chart and repairs what
it finds. It is opt-in, and a separate entry so a host that never calls it never loads it.

```ts
import { chartSvgOf } from "@bicharts/chart-host";
import { reconcileLegendInSvg, fitTextToFrame } from "@bicharts/chart-host/legend-fit";

// After a render, once the SVG is in the document (layout must exist):
const svg = chartSvgOf(container);
const result = svg && reconcileLegendInSvg(svg);   // { applied, reason, dx, ext, fit, ... }
fitTextToFrame(container);                         // grows the viewBox for text at the edge, fits the rest
```

What `reconcileLegendInSvg` does, in this order, each phase on its own and each leaving the chart as
it was drawn when it has no evidence:

1. **Legend slide.** A legend that overlaps the plot or runs off the right edge is slid clear and the
   viewBox widened just enough to hold it. The legend is found by `.d3-legend-mark`, or by its measured
   shape (a mark-free group of same-size swatches, each with a label) when the chart omitted the class.
2. **Colorbar.** A gradient bar drawn over the marks, or over the x-axis, is pushed into the margin it
   belongs in.
3. **Axis and label thinning.** A horizontal axis whose tick labels collide loses every k-th label
   (the tick lines stay). A nominal axis, where each label is the only record of its bar, is never
   thinned: each label is shrunk, then shortened with the full name in a `<title>`.
4. **Bottom text.** An axis title or caption sitting on top of the tick labels is pushed below them.
5. **Content fit.** The viewBox is extended so nothing the chart painted is cut off, unless that
   would shrink the smallest text past a legibility floor.

`fitTextToFrame` is the sibling for text parked against the raw edge of the frame: a few units past
it grow the viewBox, and a label too far out for that is shrunk and then cut to the widest prefix
that fits, never inside a number.

Both are idempotent per render (the SVG is stamped) and take no policy: pass
`{ minOverlap, maxGutterFraction }` to `reconcileLegendInSvg` to make it act less often, and decide
yourself when to call it. They are best-effort, so call them in a `try`/`catch` and log what you like:
a throw must never fail a chart that already drew. The geometry behind each phase (`planLegendReconcile`, `planContentFit`,
`planAxisTickThin`, `planFrameFit`, ...) is exported as plain functions over boxes, for a host that
measures on its own terms.

**Running them after every render.** `createLegendFitPass()` is both passes in the order that works
(the legend first, then the frame fit, which measures what the legend pass left), with nothing to log
and no policy. Hand it to the host as `layoutPass`, and the host runs it after every render, re-render
and async settle, after the label colors are fixed and before anything measures the marks or the
frame:

```ts
import { createChartHost } from "@bicharts/chart-host";
import { createLegendFitPass } from "@bicharts/chart-host/legend-fit";

const layoutPass = createLegendFitPass({
    legend: true,            // or "narrow" to act only on large overlaps, or false
    frameFit: true,
    onReport: r => console.debug(r.legend, r.frame),   // what each run did; log what you like
});
const host = createChartHost(el, { code, data, d3, layoutPass });
```

In React it is the `layoutPass` prop of `<BicChart>`. Build the pass once, at module scope or in a
`useMemo`: a new function on every render is a new host config, and the chart is rebuilt.

## Architecture — three layers, and why it matters if you contribute

Read this before adding code. The package has **three** concerns, and they are independent.
Most well-meaning changes that damage it do so by collapsing two of them.

| layer | knows about | must **not** know about |
| --- | --- | --- |
| **1 · Core** | rows, marks as a *concept*, selection state, the cross-filter protocol, option resolution | any charting library, any host |
| **2 · Renderer adapter** | how *one* library expresses a binding, and where its marks live | the host it is running in |
| **3 · Host glue** | one host's lifecycle, identity model and settings | a library's internals |

Layer 3 is **not in this package** — it is the integrator's. `createChartHost` is the glue for a
plain web page; the BIC Power BI visual has its own, because a report host's lifecycle is
genuinely different. That separation is deliberate: merging them would drag host concepts into a
package whose entire value is not having them.

**Layer 2 is the one that is easy to get wrong**, because today only one adapter exists (D3) and
its assumptions are easy to mistake for universal truths. They are not. Two examples from charts
BIC already generates:

- **Marks are not always DOM elements.** D3 tags them in the DOM (`.d3-mark` + `data-row-idx`).
  Other libraries carry the row binding in their *data model* instead, on the trace or point.
  An abstraction phrased as `querySelectorAll(markClass)` is D3's implementation wearing the
  costume of an interface.
- **A renderer may support no interaction at all.** Some chart types render to a raster image —
  no DOM, no marks, nothing to hit-test. A null adapter has to be legal.

So: if you are adding support for another charting library, you should be implementing layer 2
and touching nothing else. If your change needs edits in the core to make one library work, the
seam is in the wrong place — please open an issue rather than widening the core.

**Known wart, and it is ours, not yours.** `contract.ts` currently mixes layers 1 and 2:
`MARK_CLASS` (`"d3-mark"`) and `ROW_IDX_ATTR` are D3's binding mechanism, while
`XFILTER_REFRESH_EVENT`, the `lch-*` selection classes and `DIM_OPACITY_VAR` are genuinely
renderer-neutral. The names are historical. Do not take the file's current shape as licence to
add more renderer-specific constants to it.

## Versioning

`HOST_CONTRACT_VERSION` is the grammar version (mark classes, container slots, the cross-filter
event). `generate_chart` stamps it into every artifact it writes; this package warns if it runs
a chart from a different **major**. Package SemVer tracks the JS API; the contract version tracks
the DOM/interaction grammar, and they move independently.

## Licence and attribution

Apache-2.0 (see `LICENSE`).

The package embeds geographic reference data, and one source carries a **condition**, not a
courtesy: city and administrative-region coordinates come from
[GeoNames](https://www.geonames.org/) under **CC BY 4.0**, which requires attribution to travel
with any redistribution — including an application that bundles this package. The credit is in
`NOTICE` and in a banner comment at the top of every built file, so keeping either satisfies it.
Country polygons (Natural Earth) and US state/ZIP boundaries (US Census/TIGER) are public domain.

If your build strips comments and you do not ship `NOTICE`, reproduce this line somewhere a
recipient can find it:

> This work includes data from GeoNames (https://www.geonames.org/), licensed under CC BY 4.0.

## Building from source

```bash
npm install && npm run build     # esbuild bundle (+ .d.ts) into dist/
npm test
```

The build **inlines** `@bicharts/shape-core`, which lives outside this package root — that is
deliberate, so the repo keeps one copy of the geo detection logic and the published artifact
still stands alone. `npm pack` rebuilds first (`prepack`); do not publish a stale `dist/`.

