// createChartHost — the host-side RUNTIME of the contract (Phase C, first cut).
//
// A minimal, host-agnostic implementation of everything a page must do to run a
// generated render(container, data, options) chart: compile the code the same way
// the visual/preview/exec-gate do, resolve options through the shared defaults,
// wire the cross-filter bridge (mark clicks + the llm-xfilter-refresh event), honor
// the container lifecycle slots, and re-render on setOptions/setData — which is how
// the live-restyle knobs (colorScaleLow/High, aggregation, animMaxIdealFrames) work.
//
// The Power BI visual does NOT use this runtime (its own bridge carries years of
// PBI-specific behavior: selectionManager, host tooltips, glyphs, geometry hit
// disambiguation); this is for OTHER hosts — the MCP preview, an SDK page, tests.
// Delegating the visual's generic half onto shared selection logic remains the
// harness-gated last step of Phase C.
//
// Animation scope (v1): the contract exposes only __llmAnimStop (stop) — playback
// and frame stepping are chart-owned (the play button + scrubber the chart draws).
// An imperative play()/goTo() would need NEW contract slots on the archetypes
// (contract v1.1 candidate, replay-gated) — deliberately not invented here.
import { type RenderOptions, ROW_IDX_ATTR, MARK_CLASS, LEGEND_MARK_CLASS, AXIS_FILTER_CLASS,
    XFILTER_REFRESH_EVENT, CONTAINER_SLOT_ANIM_STOP, CONTAINER_SLOT_XF_CLEAR,
    CONTAINER_SLOT_INITIAL_XF_MARK, HOST_CONTAINER_CLASS, SELECTION_ACTIVE_CLASS,
    MARK_SELECTED_CLASS, DIM_OPACITY_VAR, DIM_OPACITY_DEFAULT,
    HOST_CONTRACT_VERSION } from "./contract";
import { resolveOptions, type ResolveOptionsInput } from "./defaults";
// Deliberately NOT "./geo": that module statically imports ~1.3 MB of generated geometry,
// which every consumer then paid for even to draw a bar chart (GAP-11). geoLazy holds the
// cache and the dynamic loader but no asset, so the runtime entry stays lean.
import { geoFromCache } from "./geoLazy";
import { createMarkResolver } from "./selection";

export type RenderFn = (container: HTMLElement, data: any, options: RenderOptions) => void;

export interface ChartHostConfig {
    // The payload as buildRenderPayload / the MCP data.sample.json produce it. geoUnmatched
    // and geoPoint ride ALONGSIDE the table because they are facts ABOUT the binding, and
    // render() auto-promotes them into options — a host that just hands over the whole file
    // gets honest annotations without knowing they exist.
    data: {
        columns: any[];
        rows: any[][];
        geoUnmatched?: { count: number; examples: string[] };
        geoPoint?: RenderOptions["geoPoint"];
        /** Provenance the MCP stamps into data.sample.json. `hostContract` is checked
         *  against HOST_CONTRACT_VERSION so a major-version drift is LOUD, not silent. */
        meta?: { hostContract?: string; chart?: string };
    };
    /** Generated render() source — compiled exactly like the visual/preview/exec-gate. */
    code?: string;
    /** Pre-compiled alternative to `code`. */
    renderFn?: RenderFn;
    /** Partial raw options; resolveOptions applies the shared defaults/clamps. */
    options?: ResolveOptionsInput;
    /** D3 v7 instance handed to the compiled code. Default: (globalThis as any).d3. */
    d3?: any;
    /** Attach geometry for this geoKind as options.geo (choropleths / basemaps). Resolved
     *  from `geoProvider` or the geoLazy cache — see `loadGeo`. NOT eagerly bundled. */
    geoKind?: string;
    /** Supply geometry for a geoKind synchronously. The escape hatch for a host that
     *  already holds its assets (e.g. `geoForKind` from "@bicharts/chart-host/geo", or the
     *  data.geo.json the MCP wrote next to the chart). */
    geoProvider?: (geoKind: string) => any | undefined;
}

export interface ChartHost {
    render(): void;
    /** Merge raw option changes and re-render — the live-restyle path (colour scale,
     *  aggregation, animMaxIdealFrames, timeline style…). Never a regeneration. */
    setOptions(partial: ResolveOptionsInput): void;
    setData(data: ChartHostConfig["data"]): void;
    readonly options: RenderOptions;
    selection: {
        /** Subscribe to cross-filter changes (mark clicks + the chart's own
         *  llm-xfilter-refresh dispatches). rowIdxs = [] means cleared. */
        onChange(cb: (rowIdxs: number[], source: string) => void): () => void;
        /** Clear the chart's own selection (calls __llmXfClear when the chart set it). */
        clear(): void;
        readonly current: number[] | null;
    };
    animation: {
        /** Stop playback (calls __llmAnimStop when set). Call before unmount. */
        stop(): void;
    };
    /** The mark the chart nominated as its initial filter (__llmInitialXfMark), if any. */
    initialMark(): Element | null;
    destroy(): void;
}

const parseRowIdxs = (s: string | null | undefined): number[] =>
    (s || "").split(",").map(x => parseInt(x, 10)).filter(n => Number.isFinite(n));

// d3 plugins are separate packages that ATTACH onto the d3 object. When one is missing the
// generated code fails as `d3.sankey is not a function` several frames deep inside compiled
// chart source — a message that tells a host nothing about what to install. Name the cause
// and the way forward instead; the package list matches what the Power BI visual loads, so
// a chart behaves the same in both hosts.
const D3_PLUGIN_PACKAGES: Record<string, string> = {
    sankey: "d3-sankey", sankeyLinkHorizontal: "d3-sankey", sankeyJustify: "d3-sankey",
    sankeyCenter: "d3-sankey", sankeyLeft: "d3-sankey", sankeyRight: "d3-sankey",
    hexbin: "d3-hexbin",
    voronoiTreemap: "d3-voronoi-treemap", voronoiMap: "d3-voronoi-map",
    weightedVoronoi: "d3-weighted-voronoi",
};

// FAIL FAST, not fail deep (GAP-6, 2026-07-31). explainRenderFailure below turns a plugin
// crash into an actionable message, but only AFTER the chart has thrown and drawn nothing.
// A host that knows what a chart needs BEFORE running it can install the plugin, warn, or
// choose a different chart. The Power BI visual has always sniffed the code this way to pick
// which CDN bundles to load; this is that sniff, exported, so an SDK/MCP host stops being the
// only consumer flying blind.
//
// Deliberately a STATIC SCAN of `d3.<name>(` rather than a trial render: synchronous, side
// effect free, and safe on untrusted generated code — which executing is not. Over-reporting
// is the safe direction: naming a plugin the chart turns out not to reach costs a needless
// install, while missing one costs a blank chart failing several frames deep.
export function requiredD3Plugins(code: string): string[] {
    const out = new Set<string>();
    for (const m of String(code || "").matchAll(/\bd3\s*\.\s*(\w+)\s*\(/g)) {
        const pkg = D3_PLUGIN_PACKAGES[m[1]];
        if (pkg) out.add(pkg);
    }
    return [...out].sort();
}

export function explainRenderFailure(err: unknown, d3: any): unknown {
    const msg = String((err as any)?.message ?? err ?? "");
    if (!d3) {
        return new Error(
            "[@bicharts/chart-host] no d3 was provided, so the generated chart could not run. " +
            "Pass it explicitly — createChartHost(el, { d3 }) / <BicChart d3={d3} /> — or set " +
            "window.d3. The chart needs D3 v7 (npm install d3@7). Original error: " + msg);
    }
    const m = /d3\.(\w+) is not a function|(\w+) is not a function/.exec(msg);
    const name = m?.[1] ?? m?.[2] ?? "";
    const pkg = D3_PLUGIN_PACKAGES[name];
    if (pkg) {
        return new Error(
            `[@bicharts/chart-host] this chart calls d3.${name}(), which comes from the separate ` +
            `"${pkg}" package and is not attached to the d3 you passed. Install it and augment ` +
            `the SAME d3 instance:  npm install ${pkg}  then  import { ${name} } from "${pkg}"; ` +
            `Object.assign(d3, { ${name} });  Original error: ` + msg);
    }
    return err;
}

// A generated chart is delivered in one of two forms — the bare render() function, or the
// SAME code plus an ES-module export clause so it can be `import`ed from a file. Both are
// legitimate artifacts of the same generator, and nothing in either form tells the caller
// which one a given host accepts. Feeding the module form to the code-string path below
// threw a SyntaxError inside `new Function` before a single line ran: a blank chart, no
// mark, no annotation, and an error whose text says nothing about the artifact form.
//
// So accept both. The export clause is pure module bookkeeping and carries no behaviour —
// `render` is already a top-level binding, which is exactly what the compile below picks
// up — so removing it changes nothing about what the chart does.
//
// Deliberately narrow: only STATEMENT-POSITION export forms at the start of a line, so an
// `export` inside a string, a comment, or a property name is untouched. `export function` /
// `export const` keep their declaration and lose only the keyword, because the binding they
// introduce is the one being returned.
const ESM_EXPORT_CLAUSE = /^[ \t]*export[ \t]+(?:\{[^}]*\}|default[ \t]+[A-Za-z_$][\w$]*)[ \t]*;?[ \t]*$/gm;
const ESM_EXPORT_DECL = /^([ \t]*)export[ \t]+(?=(?:async[ \t]+)?function\b|const\b|let\b|var\b|class\b)/gm;

export function stripEsmExports(code: string): string {
    return String(code || "")
        .replace(ESM_EXPORT_CLAUSE, "")
        .replace(ESM_EXPORT_DECL, "$1");
}

export function compileRenderFn(code: string, win: any, doc: any, d3: any): RenderFn {
    // Same compile the preview/exec-gate use: the code must define a top-level render().
    const body = stripEsmExports(code) + "\n;return (typeof render === 'function') ? render : null;";
    let factory: Function;
    try {
        factory = new Function("container", "data", "options", "window", "document", "d3", body);
    } catch (e) {
        // A SyntaxError here happens BEFORE any chart code runs, so there is no mark, no
        // annotation and nothing on screen — and the raw message ("Unexpected token") names
        // a token, not a cause. Say what was handed in and what it needs to be.
        const msg = String((e as any)?.message ?? e ?? "");
        const modular = /\bimport\b|\bexport\b/.test(String(code || ""));
        throw new Error(
            "[@bicharts/chart-host] the generated code could not be COMPILED, so nothing was " +
            "drawn. This path evaluates the chart as a code string, which cannot contain " +
            "ES-module syntax" +
            (modular
                ? " — and this code still has `import`/`export` in it after the export clause was " +
                  "stripped. Either request the plain form from the generator, or `import` the " +
                  "module yourself and pass the render function directly."
                : ".") +
            " Original error: " + msg);
    }
    const fn = factory.call(null, null, null, null, win, doc, d3);
    if (typeof fn !== "function") throw new Error("generated code did not define render(container, data, options)");
    return fn as RenderFn;
}

export function createChartHost(container: HTMLElement, config: ChartHostConfig): ChartHost {
    const doc: any = container.ownerDocument;
    const win: any = doc?.defaultView ?? (globalThis as any);
    const d3 = config.d3 ?? (globalThis as any).d3 ?? win?.d3;
    let data = config.data;
    // A generated chart is COMMITTED SOURCE that outlives the tool that wrote it, so a host
    // on a different major version of the grammar is a real possibility. Warn once, loudly
    // and specifically — a renamed mark class fails as "nothing is clickable", which is
    // exactly the kind of silent breakage nobody traces back to a version.
    {
        const stamped = config.data?.meta?.hostContract;
        const major = (v?: string) => (v || "").split(".")[0];
        if (stamped && major(stamped) !== major(HOST_CONTRACT_VERSION)) {
            try {
                (win?.console ?? console)?.warn(
                    `[@bicharts/chart-host] contract MAJOR mismatch: this chart was generated against ` +
                    `v${stamped}, the host implements v${HOST_CONTRACT_VERSION}. Marks, container ` +
                    `slots or the cross-filter event may not line up — regenerate the chart.`);
            } catch { /* no console — the check is advisory, never fatal */ }
        }
    }
    let raw: ResolveOptionsInput = { ...(config.options ?? {}) };
    let resolved = resolveOptions(raw);
    let renderFn: RenderFn | null = config.renderFn ?? null;
    let destroyed = false;
    let warnedGeo = false;
    let current: number[] | null = null;
    const subs = new Set<(rowIdxs: number[], source: string) => void>();

    // ---- Selection affordance ------------------------------------------------
    // Inject the dim/hover rules ONCE per document, scoped to hosted containers, using
    // the same class grammar the Power BI visual uses. Without this a click cross-filters
    // other charts but the clicked chart itself gives no feedback — the "I clicked a
    // legend swatch and nothing happened" report from the React demo.
    const ensureAffordanceStyles = () => {
        try {
            if (!doc || doc.getElementById("bic-chart-host-affordances")) return;
            const st = doc.createElement("style");
            st.id = "bic-chart-host-affordances";
            st.textContent = `
/* TYPOGRAPHY FIREWALL. Generated charts set font-size but almost never line-height or
   letter-spacing, so they INHERIT whatever the host page cascades in. A page with
   \`:root { font: 18px/145% }\` (the stock Vite template does exactly this) hands every
   chart an inherited 26.1px line box; an 11px label in a 14px band is then sliced through
   the middle. The chart is not wrong and the host is not wrong — the boundary between
   them is, so the boundary fixes it. Both properties are overridable: a chart that sets
   its own line-height still wins. Deliberately NOT resetting font-family or color, which
   a host SHOULD be able to theme. Found 2026-07-26 in the React demo, on a chart that
   renders perfectly inside Power BI. */
.${HOST_CONTAINER_CLASS} { line-height: normal; letter-spacing: normal; }
.${HOST_CONTAINER_CLASS} .${MARK_CLASS} { cursor: pointer; transition: opacity 120ms ease-in-out, filter 100ms ease-in-out; }
.${HOST_CONTAINER_CLASS} .${MARK_CLASS}:hover { filter: brightness(1.1) drop-shadow(0 0 1.5px rgba(0,0,0,0.5)) !important; }
.${HOST_CONTAINER_CLASS}:has(.${MARK_CLASS}:hover) .${MARK_CLASS}:not(:hover) { opacity: 0.55; }
.${HOST_CONTAINER_CLASS}.${SELECTION_ACTIVE_CLASS} .${MARK_CLASS}:not(.${MARK_SELECTED_CLASS}) {
    opacity: var(${DIM_OPACITY_VAR}, ${DIM_OPACITY_DEFAULT}) !important;
}
.${HOST_CONTAINER_CLASS} .${LEGEND_MARK_CLASS} { cursor: pointer; }`;
            (doc.head || doc.documentElement)?.appendChild(st);
        } catch { /* no document (jsdom edge) — affordance is cosmetic, never fatal */ }
    };

    // Paint the current selection onto the marks. Re-run after EVERY render, because
    // the chart rebuilds its DOM and the classes would otherwise be lost on repaint.
    const paintSelection = () => {
        try {
            const sel = current;
            const active = !!sel && sel.length > 0;
            container.classList?.[active ? "add" : "remove"](SELECTION_ACTIVE_CLASS);
            const wanted = new Set(sel ?? []);
            const marks = container.querySelectorAll(`.${MARK_CLASS}[${ROW_IDX_ATTR}], .${LEGEND_MARK_CLASS}[${ROW_IDX_ATTR}]`);
            for (const m of Array.from(marks)) {
                // A mark represents SEVERAL rows (a legend swatch, an aggregated slice);
                // it counts as selected when ANY of its rows is in the selection, which is
                // what makes a legend click light up its own swatch and its marks together.
                const rows = parseRowIdxs(m.getAttribute(ROW_IDX_ATTR));
                const on = active && rows.some(r => wanted.has(r));
                m.classList?.[on ? "add" : "remove"](MARK_SELECTED_CLASS);
            }
        } catch { /* cosmetic */ }
    };

    const notify = (rowIdxs: number[], source: string) => {
        current = rowIdxs;
        paintSelection();
        for (const cb of subs) { try { cb(rowIdxs, source); } catch { /* subscriber error is not ours */ } }
    };

    // The chart's own dispatch (scrubber ticks, period changes) — the primary
    // mechanism for animated charts. detail = {clear,source} | {mark,source}.
    // xfAt timestamps it so the click handler can tell "the chart already handled this
    // gesture" from "a static chart marked an axis label and dispatched nothing".
    let xfAt = 0;
    const XF_ECHO_MS = 150;
    const onXf = (e: any) => {
        const d = e?.detail || {};
        xfAt = Date.now();
        if (d.clear) notify([], d.source || "chart");
        else if (d.mark) notify(parseRowIdxs(d.mark.getAttribute?.(ROW_IDX_ATTR)), d.source || "chart");
    };
    // Plain mark clicks (static charts + choropleth regions): the chart does NOT
    // dispatch the event for these — the host reads data-row-idx itself.
    //
    // The selector MATCHES THE VISUAL's (`.d3-mark, .d3-legend-mark, .d3-axis-filter`).
    // .d3-axis-filter used to be excluded here on the assumption that a chart owning an
    // axis-tick click always dispatches llm-xfilter-refresh — true for ANIMATED scrubber
    // ticks, false for the static charts that label a category axis `.d3-axis-filter` and
    // dispatch nothing (measured 2026-07-26 on a cold-generated grouped bar: the class and
    // data-row-idx are emitted, no dispatch anywhere in the file). Clicking a category
    // label therefore did nothing in an SDK host while working in Power BI. `xfJustFired`
    // below keeps the animated case from double-firing.
    const resolver = createMarkResolver({
        root: container, doc,
        log: () => { /* diagnostics are the visual's concern; the resolution logic is shared */ },
    });
    const clickSel = `.${MARK_CLASS}[${ROW_IDX_ATTR}], .${LEGEND_MARK_CLASS}[${ROW_IDX_ATTR}], .${AXIS_FILTER_CLASS}[${ROW_IDX_ATTR}]`;
    const onClick = (e: any) => {
        // A chart that dispatched for THIS gesture has already been handled by onXf, which
        // runs first (the chart's own handler sits on the tick; this one on the container).
        if (Date.now() - xfAt < XF_ECHO_MS) return;
        let el: any = resolver.findMark(e?.target, clickSel, e as MouseEvent);
        // OVERLAY PENETRATION then GEOMETRY — the two hardenings the visual has carried
        // since two production charts exposed it, already ported into selection.ts but never wired up here.
        // Without them a tooltip/crosshair overlay painted OVER the marks (fill:'transparent'
        // is a painted fill, so it hit-tests) makes every mark click read as "empty canvas"
        // and the chart silently cannot cross-filter — which is exactly what a cold consumer
        // hit on 2026-07-26, then worked around with their own elementsFromPoint hack.
        // Both run ONLY on the branch that already resolved nothing, so neither can alter a
        // click that resolved normally.
        if (!el) el = resolver.penetrateOverlayAt(e?.clientX, e?.clientY, clickSel);
        if (!el) el = resolver.resolveByGeometry(e?.clientX, e?.clientY, clickSel);
        if (!el) {
            // Click on empty canvas CLEARS, the way every BI tool behaves. Without this
            // a selection is a one-way door: the React demo could filter to one city and
            // had no gesture to get back ("how can I go back to nothing selected?").
            if (current && current.length) notify([], "user");
            return;
        }
        const rows = parseRowIdxs(el.getAttribute(ROW_IDX_ATTR));
        if (!rows.length) return;

        // MULTI-SELECT (Ctrl / Cmd / Shift), matching the Power BI visual.
        // Without this a chart that grows a selection fine inside Power BI silently cannot
        // outside it — a parity gap in the one thing this package exists to guarantee.
        //
        // The semantics are TOGGLE-PER-ROW, not union. That distinction is the whole bug the
        // visual's own comment warns about: "a naive union would leave previously-selected
        // marks lit up after the user Ctrl-clicked them off." Ctrl-clicking a selected mark
        // must REMOVE it, and a mark spanning several rows (a legend swatch) toggles each of
        // its rows independently — which is what makes Ctrl-clicking a legend swatch off
        // leave the other series still selected.
        if (e?.ctrlKey || e?.metaKey || e?.shiftKey) {
            const next = new Set(current ?? []);
            for (const r of rows) {
                if (next.has(r)) next.delete(r);
                else next.add(r);
            }
            // Toggling the last row off is a legitimate way to reach empty; notify([]) is
            // the clear, so a modifier-click can undo a selection without hunting for canvas.
            notify(Array.from(next), "user");
            return;
        }

        // Re-clicking the SAME mark toggles it off — the other half of that gesture. Only
        // on the non-modifier path: with a modifier, per-row toggling already covers it, and
        // running both is the dual-owner drift the visual hit (it clears lastMarkClickSig
        // when isMulti for exactly this reason).
        const same = !!current && current.length === rows.length && rows.every(r => current!.includes(r));
        notify(same ? [] : rows, "user");
    };
    container.addEventListener(XFILTER_REFRESH_EVENT, onXf);
    container.addEventListener("click", onClick);
    container.classList?.add(HOST_CONTAINER_CLASS);
    ensureAffordanceStyles();

    const stopAnim = () => { const s = (container as any)[CONTAINER_SLOT_ANIM_STOP]; if (typeof s === "function") { try { s(); } catch { /* chart timer already dead */ } } };

    const host: ChartHost = {
        render() {
            if (destroyed) return;
            stopAnim();                          // contract: stop the old timer before repaint
            container.innerHTML = "";            // the host owns clearing between renders
            if (!renderFn) {
                if (!config.code) throw new Error("createChartHost: provide code or renderFn");
                renderFn = compileRenderFn(config.code, win, doc, d3);
            }
            // Attach geometry + unmatched when configured and not explicitly supplied.
            // render() is SYNCHRONOUS by contract, so geoKind resolves against whatever the
            // caller has already made available — an explicit geoProvider, or the cache that
            // `await loadGeo(kind)` / registerGeo() fills. A caller who sets geoKind without
            // doing either gets no geometry, which is why that case warns rather than drawing
            // a mysteriously empty map.
            if (resolved.geo === undefined && config.geoKind) {
                const g = config.geoProvider?.(config.geoKind) ?? geoFromCache(config.geoKind);
                if (g) resolved = { ...resolved, geo: g };
                else if (!warnedGeo) {
                    warnedGeo = true;
                    try {
                        (win?.console ?? console)?.warn(
                            `[@bicharts/chart-host] geoKind "${config.geoKind}" was set but no geometry is ` +
                            `available, so this chart will draw without a basemap. Either ` +
                            `\`await loadGeo("${config.geoKind}")\` before rendering, pass a geoProvider, ` +
                            `or import { geoForKind } from "@bicharts/chart-host/geo" and set options.geo.`);
                    } catch { /* advisory only */ }
                }
            }
            if (resolved.geoUnmatched === undefined && data.geoUnmatched) resolved = { ...resolved, geoUnmatched: data.geoUnmatched };
            // Same promotion for point maps: without it the chart cannot say which rows it
            // could not place, or that a "city" dot is really a state centroid.
            if (resolved.geoPoint === undefined && data.geoPoint) resolved = { ...resolved, geoPoint: data.geoPoint };
            try {
                renderFn(container, { columns: data.columns, rows: data.rows }, resolved);
            } catch (err) {
                throw explainRenderFailure(err, d3);
            }
            // The chart just rebuilt its DOM, so the selection classes are gone. Repaint
            // them or a cross-filtered chart loses its own highlight on every restyle.
            paintSelection();
        },
        setOptions(partial) {
            raw = { ...raw, ...partial };
            resolved = resolveOptions(raw);
            host.render();
        },
        setData(next) {
            data = next;
            host.render();
        },
        get options() { return resolved; },
        selection: {
            onChange(cb) { subs.add(cb); return () => subs.delete(cb); },
            clear() {
                const s = (container as any)[CONTAINER_SLOT_XF_CLEAR];
                if (typeof s === "function") { try { s(); } catch { /* chart already clear */ } }
                // Always settle the host's own state, even when the chart owns the clear:
                // a chart that clears WITHOUT dispatching would otherwise leave the host
                // (and every subscriber) believing the old selection is still live.
                notify([], "host");
            },
            get current() { return current; },
        },
        animation: { stop: stopAnim },
        initialMark() { return ((container as any)[CONTAINER_SLOT_INITIAL_XF_MARK] as Element) ?? null; },
        destroy() {
            if (destroyed) return;
            destroyed = true;
            stopAnim();
            container.removeEventListener(XFILTER_REFRESH_EVENT, onXf);
            container.removeEventListener("click", onClick);
            subs.clear();
            container.innerHTML = "";
        },
    };
    return host;
}

