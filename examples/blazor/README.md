# Blazor WebAssembly: the exact steps

The three files this recipe wires in are beside it: `Scripts/bic.entry.js`, `Components/BicChartGroup.razor` and `Components/BicChart.razor`. So is `check.mjs`, a browser check for the finished page: run `npm install -D playwright` in your project, then `node check.mjs <url>`.
[RegiaBI for developers](https://bizintelligencechampions.com/regiabi/developers?loc=ghlib)

Current as of **2026-09-26**, against `@bicharts/chart-host@0.6.45`, `@bicharts/chart-mcp` and its
`bic-charts` agent skill. Everything below runs from npm and NuGet, with nothing to clone or build.

The point of the exercise: *a BIC chart is generated source you own, not a service you call.* Steps 2
and 3 happen **once, at design time**. The running page makes no call to us, needs no API key, costs
nothing per render, and works offline. It's a standalone Blazor WebAssembly app, so any static host can
serve it.

The [reference app](https://github.com/codexguy/bicharts-blazor-demo) ([live](https://codexguy.github.io/bicharts-blazor-demo/)) was built from an empty folder by a coding agent that had only the MCP
server, its skill, the published packages, a CSV and a one-page brief. It took two generations, one per
chart, and no regeneration.

---

## 0. Prerequisites

| | |
| --- | --- |
| .NET | the .NET 10 SDK |
| Node | 20 or later, for the one bundling step (esbuild) |
| An MCP-capable client | Claude Code, Claude Desktop, Cursor, and so on |
| A BIC **trial or paid** account | `generate_chart` and `list_eligible_charts` both need one. `assess_data_shape` needs no account: it runs locally and never calls the backend |
| Credits | `generate_chart` costs about 3 credits a chart. `list_eligible_charts` is free within a generous hourly allowance |

---

## 1. Register the MCP server, and give your agent the skill

```powershell
claude mcp add --scope user bic-chart -- npx -y @bicharts/chart-mcp
```

Put your credentials in `~/.bic/credentials.json` (`licenseKey`, `licensee`), then run `claude mcp list`:
you should see `bic-chart` with three tools.

The package ships an agent skill, `bic-charts`, that carries the Blazor scaffold and wiring below as
copy-paste blocks. Put it where your agent looks for skills, in the folder you'll work in:

```powershell
$tgz = npm pack @bicharts/chart-mcp
tar -xzf $tgz
mkdir -Force .claude\skills
Copy-Item -Recurse package\skills\bic-charts .claude\skills\
Remove-Item -Recurse package, $tgz
```

```bash
tgz=$(npm pack @bicharts/chart-mcp 2>/dev/null)
tar -xzf "$tgz"
mkdir -p .claude/skills && cp -r package/skills/bic-charts .claude/skills/
rm -rf package "$tgz"
```

`npm pack` prints the tarball's name, and the first line keeps it: PowerShell passes a `*` to `tar`
unexpanded, so a wildcard in the name fails there.

---

## 2. Scaffold

```powershell
dotnet new blazorwasm -o MyCharts -f net10.0
cd MyCharts
dotnet new globaljson --sdk-version 10.0.100 --roll-forward latestFeature
npm init -y
npm install d3@7 @bicharts/chart-host
npm install -D esbuild
```

Run `npm init -y` **before** the first install. With no `package.json` in the folder, npm walks up and
installs into the nearest parent folder that has one. `global.json` pins the build to your newest .NET 10
SDK, so a newer or preview SDK on the same machine isn't picked instead.

Add this to `MyCharts.csproj`, inside `<Project>`:

```xml
<PropertyGroup>
  <DefaultItemExcludes>$(DefaultItemExcludes);node_modules/**</DefaultItemExcludes>
</PropertyGroup>
<Target Name="BundleBicCharts" BeforeTargets="BeforeBuild">
  <Exec Command="npm ci" Condition="!Exists('node_modules')" />
  <RemoveDir Directories="wwwroot/js/bic" />
  <Exec Command="npx esbuild Scripts/bic.entry.js --bundle --format=esm --splitting --minify --outdir=wwwroot/js/bic" />
  <ItemGroup>
    <Content Include="wwwroot/js/bic/**" Exclude="@(Content)" />
  </ItemGroup>
</Target>
```

Why each line is there:

- **`node_modules/**` is excluded**, or MSBuild globs thousands of package files into the project.
- **The source lives in `Scripts/` and the bundle in `wwwroot/js/bic/`.** `wwwroot` is published as-is,
  and the unbundled entry (a bare `import "d3"`) can't load in a browser.
- **`--splitting`** keeps the map geometry (about 1.3 MB across three assets) in chunks the page fetches
  only when a map asks for one.
- **The `Content` item inside the target.** The bundle is written *during* the build, after the project
  already listed `wwwroot`. Without this line a clean build (a fresh clone, CI, `dotnet publish`) ships
  no bundle, while your own incremental builds keep working.
- **`RemoveDir`**: chunk names are content hashes, so stale chunks would pile up.

Add `bin/`, `obj/`, `node_modules/` and `wwwroot/js/bic/` to `.gitignore`, and commit `package.json` and
`package-lock.json` (the target's `npm ci` needs the lock).

---

## 3. Prompts: design time

Point your agent at the folder and paste these in order.

### 3a. Discover and assess

> Use the `bic-chart` MCP server. Assess the data shape of `./data.csv`, then list the eligible D3 chart
> types. Pick two that work together on one page for cross-filtering.

### 3b. Generate

> Generate both charts with `generate_chart` in parallel: `renderer: "D3"`, `out_dir` set to the absolute
> path of `wwwroot/charts/<name>`, `include_code: false`, `preview_html: true`. Use the contract parameters
> (`rows_policy`, `required_columns`) for anything the page depends on, not prose.

Each call writes `chart.js` (the `render(container, data, options)` function you own),
`data.sample.json` (your rows, plus anything the tool resolved, such as the geography join) and, for a
map, `data.geo.json`. `out_dir` resolves against the MCP server's working directory, not your project,
which is why it's absolute. `include_code: false` keeps the code out of the reply, because it's on disk
already. Open `preview.html` before you wire anything: if a chart is wrong, regenerating it now costs one
file.

### 3c. Wire it up

> Wire both charts in with the skill's Blazor blocks (`Scripts/bic.entry.js`, `BicChartGroup.razor`,
> `BicChart.razor`), exactly as written. Pass the map's `geo.kind` from the generate result as `GeoKind`.

### 3d. Verify

> Run `dotnet publish -c Release`, serve the output, and click a mark in each chart. Confirm the other
> chart filters or highlights, the clicked chart dims its other marks, Ctrl-click grows the selection, and
> Clear restores both.

---

## 4. The shape of the result

```text
MyCharts/
  MyCharts.csproj            # + the bundling target above
  global.json, package.json, package-lock.json
  Scripts/bic.entry.js       # the only JavaScript you own: the charts and their one cross-filter group
  Components/BicChartGroup.razor
  Components/BicChart.razor
  Pages/Home.razor           # the dashboard
  wwwroot/charts/map/        # generated: chart.js, data.sample.json, data.geo.json
  wwwroot/charts/<other>/    # generated: chart.js, data.sample.json
```

The page itself is ordinary Razor:

```razor
<BicChartGroup Source="charts/map/data.sample.json" OnSelection="OnSelection" @ref="group">
    <button data-bic-clear disabled="@(selected == 0)" @onclick="() => group!.ClearAsync()">Clear</button>
    <BicChart Id="map"    Dir="charts/map"    Height="440" RespondsWith="highlight" GeoKind="us-state-name" @ref="map" />
    <BicChart Id="bubble" Dir="charts/bubble" Height="440" />
</BicChartGroup>
```

`BicChartGroup` owns the single source table and the payload-row to source-row mapping, in JavaScript.
The map **highlights** (keeps every state and dims the rest); the other chart **filters**. A chart never
filters itself, cross-filtering is mutual, and .NET only ever sees the selection as source row indices.
A live restyle is one call, `await map.SetOptionsAsync(new { colorScaleLow = "#eaf3fb", colorScaleHigh =
"#08519c" })`: a repaint, never a regeneration. The generate result's integration contract lists the
options each chart reads.

---

## 5. Why it's built this way

- **The chart code is loaded as text, not imported.** `createChartHost` compiles it and injects your d3,
  the same way every BIC host runs a chart. Imported as an ES module, the code would run in strict mode
  against a global `d3`.
- **All interop happens in `OnAfterRenderAsync(firstRender)`.** An `ElementReference` is empty until the
  element is rendered, and under prerendering there's no JavaScript yet. So the same components run
  unchanged under Blazor Server or Auto.
- **The payload stays on the JavaScript side.** No chart data crosses the interop boundary, so there's no
  message-size ceiling to raise, and no second copy of your data to keep in step.
- **`IAsyncDisposable` on both components.** `destroy` stops a chart's timers and detaches it from the
  group, so navigating away and back leaves no running timer and no duplicate chart.
- **The map's geometry loads before its first render.** `render()` is synchronous, so a cold cache would
  draw marks over no land. `loadGeo` fetches only the asset that kind needs, from your own origin.
- **The chart draws for the canvas it sits on.** `theme(el)` reads the background behind the chart, so a
  page that switches its colours for a dark-mode reader gets light chart text, and a light-only page keeps
  dark text.
- **Measure, then mount.** The chart takes the element's width once it's laid out, and a
  `ResizeObserver` follows later resizes. A `display:none` container measures 0 and draws nothing.
- **`<base href>`**: every fetch resolves against `document.baseURI`, so the app works under a sub-path
  (GitHub Pages, a virtual directory) once `index.html`'s `<base href>` says so.

---

## 6. Regenerating a chart

Call `generate_chart` again with the same `out_dir`. The files are overwritten and the diff is reviewable.
Regeneration re-rolls content as well as style, so pin the chart type and read the diff before you commit.

---

## 7. Verifying it

Publish, serve the output as static files, and check it by hand or with your own headless browser:
- both charts draw, and their marks carry the shared `data-row-idx` attribute
- a click in each chart filters or highlights the other, and Clear restores both
- Ctrl-click grows and shrinks the selection, and a click inside a *filtered* chart selects the record clicked
- the live restyle repaints without reloading any chart code
- navigating away and back leaves no running timer and no duplicate chart
- a dark-mode reader gets a dark canvas with light chart text
- every request stays on the page's own origin
