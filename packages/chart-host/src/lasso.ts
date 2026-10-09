// THE HOST LASSO: draw around marks, and the marks inside become the selection.
//
// ONE gesture, owned by the host, so a chart type never writes (and never gets wrong) the parts that are
// invisible from generated code: pointer capture, the click that trails every drag, the cap on how many
// rows may be published, persistence at rest, an untrusted restore. A chart opts in through the
// capability the server sends with it (RenderOptions.lasso.capable) and may react to the gesture by
// listening for the DOM event `llm-lasso` on its container; it never draws the outline and never touches
// the selection.
//
//   surface   a transparent rect, class "lch-control lch-lasso-surface" and never "d3-mark", over the
//             chart's plot group (".lch-plot", else its svg) and BELOW the marks, so a press on a mark is
//             still a mark click. It gives the plot its crosshair and stops a touch drag scrolling the page.
//   gesture   a press that begins off a mark and travels 5px or more is a lasso; shorter is a click. Points
//             are sampled 3px or more apart. Freeform by default; the container attribute
//             data-lch-lasso-mode="rect" switches to a rectangle. Ctrl/Cmd/Shift adds to the current lasso.
//   members   a mark is inside when the CENTRE of its screen box falls inside the shape.
//   release   the configured action list runs (v1: "select", the host's own selection), then the DOM event
//             is dispatched. The list is config, so another action is added by registerLassoAction and a
//             name in the list, with no change to the gesture or to how a selection is published.
//   at rest   the shape is kept in the one knob bag (container.__lchKnobs.lasso), persisted through
//             options.setUiState the way every in-chart control writes it, on release and on clear and never
//             mid-drag. A chart that registers container.__lchLassoAxes = { toData, toScreen } gets it stored
//             in DATA coordinates, so it survives a resize; otherwise it is stored as fractions of the plot
//             box. A restore is UNTRUSTED, re-draws the shape, dispatches the event with source "restore",
//             and NEVER publishes a selection: only a reader's gesture does.
//   clear     Escape with the chart focused, clearLasso(), or an empty click on the plot.
//
// Pure DOM plus the host's own selection (passed in): no d3, no randomness, and nothing is logged.

import { MARK_CLASS, LEGEND_MARK_CLASS, AXIS_FILTER_CLASS, ROW_IDX_ATTR, SNAPSHOT_SVG_ATTR, CONTROL_CLASS, type RenderOptions } from "./contract";
import { DRAG_NOT_CLICK_PX, gestureWasDrag, isInsideControl, rowIdxsFromMark, type PressPoint } from "./selection";

// ---- constants -------------------------------------------------------------------------------

/**
 * THE MOST ROWS A CHART MAY HAVE IN VIEW AND STILL OFFER A LASSO.
 *
 * PROVISIONAL. Unmeasured: 5,000 is a stand-in until the time Power BI Desktop takes to apply a selection
 * of that many ids is measured on a release-test page (1,000, 5,000 and 13,000 ids), and that number
 * replaces this one. Do not read it as a finding. It is the worst case that is allowed for, not the
 * typical one: a reader can lasso everything.
 *
 * Above it the WHOLE lasso is off: no surface is installed, and a one-line caption says why. It is one
 * number for every host; a host may pass its own through RenderOptions.lasso.rowCap.
 */
export const LASSO_ROW_CAP = 5000;
/** Travel, in px on either axis, at which a press stops being a click and becomes a lasso. */
export const LASSO_DRAG_PX = DRAG_NOT_CLICK_PX;
/** A freeform point is kept only when it is this far from the last one kept. */
export const LASSO_SAMPLE_PX = 3;
/** A freeform shape longer than this is thinned before it is used, so what is published, stored and
 *  restored is one and the same shape. */
export const LASSO_MAX_VERTICES = 400;
/** What a restore will read, per shape and in all: a bag is untrusted, and a poisoned one must not be able
 *  to ask for unbounded work. */
export const LASSO_RESTORE_MAX_VERTICES = 2000;
export const LASSO_RESTORE_MAX_SHAPES = 32;

/** The DOM event a chart listens for on its container. detail is a LassoEventDetail. */
export const LASSO_EVENT = "llm-lasso";
export const LASSO_SURFACE_CLASS = "lch-lasso-surface";
export const LASSO_OUTLINE_CLASS = "lch-lasso-outline";
export const LASSO_COUNT_CLASS = "lch-lasso-count";
export const LASSO_NOTE_CLASS = "lch-lasso-note";
/** The group a chart draws its plot in; the surface goes over it. Without one the chart's svg is the plot. */
export const LASSO_PLOT_CLASS = "lch-plot";
/** Set on the container to switch to a rectangle ("rect"); anything else is freeform. */
export const LASSO_MODE_ATTR = "data-lch-lasso-mode";
/** The key in the shared knob bag. */
export const LASSO_KNOB_KEY = "lasso";
/** A chart registers { toData([x, y]), toScreen([dx, dy]) } here so the shape is stored in data coordinates.
 *  x and y are in the user space of the element the surface sits in (the plot group). */
export const LASSO_AXES_SLOT = "__lchLassoAxes";
const LASSO_SLOT = "__lchLasso";
/** The action list a host runs when none is configured. */
export const LASSO_DEFAULT_ACTIONS: readonly string[] = Object.freeze(["select"]);

const SVGNS = "http://www.w3.org/2000/svg";
// What a press must not begin on: a mark that names rows, a legend swatch, an axis label that filters.
const MARKISH = `.${MARK_CLASS}[${ROW_IDX_ATTR}]:not([${ROW_IDX_ATTR}=""]), .${LEGEND_MARK_CLASS}, .${AXIS_FILTER_CLASS}`;

// ---- the setting, and whether it applies ----------------------------------------------------

/** RenderOptions.lasso. `capable` is the capability the server sent with this chart (absent means not
 *  capable); `enabled` is the reader's setting (default on); both must hold. */
export type LassoSetting = NonNullable<RenderOptions["lasso"]>;

/** The lasso setting on a render's options. */
const settingOf = (o: RenderOptions | null | undefined): LassoSetting | undefined => o?.lasso;

/** "on" installs a surface. The others say why not; only "over-cap" shows a caption. */
export type LassoVerdict = "on" | "not-capable" | "disabled" | "over-cap";

/** The row cap in force: the setting's when it is a positive number, else LASSO_ROW_CAP. */
export function lassoRowCap(setting: LassoSetting | null | undefined): number {
    const n = Number(setting?.rowCap);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : LASSO_ROW_CAP;
}

/** The action names to run on release, in order. Anything that is not a list of names is the default. */
export function lassoActions(setting: LassoSetting | null | undefined): string[] {
    const a = setting?.actions;
    if (!Array.isArray(a)) return [...LASSO_DEFAULT_ACTIONS];
    const out: string[] = [];
    for (const n of a) if (typeof n === "string" && n.trim() && !out.includes(n.trim())) out.push(n.trim());
    return out;
}

/** Whether a chart with `rows` rows in view gets a lasso under `setting`. */
export function lassoVerdict(setting: LassoSetting | null | undefined, rows: number): LassoVerdict {
    if (!setting || setting.capable !== true) return "not-capable";
    if (setting.enabled === false) return "disabled";
    const n = Number(rows);
    if (Number.isFinite(n) && n > lassoRowCap(setting)) return "over-cap";
    return "on";
}

// ---- shapes ---------------------------------------------------------------------------------

type Pt = [number, number];
export type LassoMode = "free" | "rect";
export type LassoSpace = "data" | "unit";

/** One drawn shape as stored: a freeform polygon, or the four corners of a rectangle. */
export interface LassoShape { mode: LassoMode; pts: Pt[] }
/** What the knob bag holds under LASSO_KNOB_KEY. */
export interface LassoStored { v: 1; space: LassoSpace; shapes: LassoShape[] }

/** detail of the `llm-lasso` DOM event. `polygon` is the last shape drawn, `polygons` every shape in the
 *  lasso, both in `space` (data coordinates, or fractions of the plot box); `rows` is empty when the lasso
 *  was cleared. source: "user" a gesture or a clear, "restore" a lasso re-applied on draw, "host" a clear the
 *  host made because the selection was replaced from outside. */
export interface LassoEventDetail {
    rows: number[];
    polygon: Pt[];
    polygons: Pt[][];
    mode: LassoMode;
    space: LassoSpace;
    source: "user" | "restore" | "host";
}

export interface LassoAxes {
    toData(p: [number, number]): ArrayLike<unknown>;
    toScreen(p: [number, number]): ArrayLike<unknown>;
}

interface Shape { mode: LassoMode; pts: PressPoint[]; minX: number; minY: number; maxX: number; maxY: number }

function makeShape(mode: LassoMode, pts: PressPoint[]): Shape {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    return { mode, pts, minX, minY, maxX, maxY };
}

function rectCorners(a: PressPoint, b: PressPoint): PressPoint[] {
    return [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }];
}

/** Point in a shape: the bounding box rejects first; a rectangle is then done, and a freeform polygon is
 *  an even-odd ray cast. Implemented here so the host takes no dependency on a geometry library. */
export function pointInShape(shape: { mode: LassoMode; pts: ReadonlyArray<{ x: number; y: number }> }, x: number, y: number): boolean {
    const p = shape.pts;
    if (p.length < 3) return false;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const q of p) {
        if (q.x < minX) minX = q.x; if (q.x > maxX) maxX = q.x;
        if (q.y < minY) minY = q.y; if (q.y > maxY) maxY = q.y;
    }
    if (x < minX || x > maxX || y < minY || y > maxY) return false;
    if (shape.mode === "rect") return true;
    let inside = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const xi = p[i].x, yi = p[i].y, xj = p[j].x, yj = p[j].y;
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

/** Thin a freeform path to at most `max` vertices, keeping the first and the last. */
function thin(pts: PressPoint[], max: number): PressPoint[] {
    if (pts.length <= max) return pts;
    const step = pts.length / max;
    const out: PressPoint[] = [];
    for (let i = 0; i < max; i++) out.push(pts[Math.floor(i * step)]);
    out.push(pts[pts.length - 1]);
    return out;
}

// ---- where the surface sits: client px <-> the surface's own units -----------------------------
//
// The mapping is linear between the surface's client box and its own x/y/width/height, which holds for any
// scaling or translation of the group and any viewBox. It is read from the surface itself, so there is no
// matrix to ask a layout engine for, and it is the same in a browser and a test.

interface Frame {
    left: number; top: number; width: number; height: number;   // the surface in client px
    sx: number; sy: number; sw: number; sh: number;             // the surface in its own units
}

function frameOf(surface: Element): Frame {
    const r = surface.getBoundingClientRect();
    const num = (n: string) => { const v = parseFloat(surface.getAttribute(n) || "0"); return Number.isFinite(v) ? v : 0; };
    return { left: r.left, top: r.top, width: r.width, height: r.height, sx: num("x"), sy: num("y"), sw: num("width"), sh: num("height") };
}
const frameUsable = (f: Frame) => f.width > 0 && f.height > 0;
const insideFrame = (f: Frame, x: number, y: number) =>
    frameUsable(f) && x >= f.left && x <= f.left + f.width && y >= f.top && y <= f.top + f.height;
const toLocal = (f: Frame, p: PressPoint): Pt => [
    f.sx + (f.width > 0 ? ((p.x - f.left) * f.sw) / f.width : p.x - f.left),
    f.sy + (f.height > 0 ? ((p.y - f.top) * f.sh) / f.height : p.y - f.top),
];
const fromLocal = (f: Frame, p: Pt): PressPoint => ({
    x: f.left + (f.sw > 0 ? ((p[0] - f.sx) * f.width) / f.sw : p[0] - f.sx),
    y: f.top + (f.sh > 0 ? ((p[1] - f.sy) * f.height) / f.sh : p[1] - f.sy),
});

const finiteNumber = (v: unknown): number => {
    const n = v instanceof Date ? +v : typeof v === "number" ? v : NaN;
    return Number.isFinite(n) ? n : NaN;
};
const finitePair = (v: unknown): Pt | null => {
    if (!v || typeof v !== "object") return null;
    const a = finiteNumber((v as any)[0]), b = finiteNumber((v as any)[1]);
    return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null;
};

function axesOf(container: Element): LassoAxes | null {
    const a = (container as any)[LASSO_AXES_SLOT];
    return a && typeof a.toData === "function" && typeof a.toScreen === "function" ? a as LassoAxes : null;
}

/** Shapes in client px -> the stored form. Data coordinates when the chart registered its axes and they
 *  answer for every vertex; otherwise fractions of the plot box. */
function toStored(shapes: Shape[], f: Frame, axes: LassoAxes | null): LassoStored {
    if (axes) {
        try {
            const out: LassoShape[] = [];
            for (const s of shapes) {
                const pts: Pt[] = [];
                for (const p of s.pts) {
                    const d = finitePair(axes.toData(toLocal(f, p)));
                    if (!d) throw new Error("no data coordinate");
                    pts.push(d);
                }
                out.push({ mode: s.mode, pts });
            }
            return { v: 1, space: "data", shapes: out };
        } catch { /* the axes could not answer: fractions of the box are always possible */ }
    }
    const w = f.width > 0 ? f.width : 1, h = f.height > 0 ? f.height : 1;
    return {
        v: 1, space: "unit",
        shapes: shapes.map(s => ({ mode: s.mode, pts: s.pts.map((p): Pt => [(p.x - f.left) / w, (p.y - f.top) / h]) })),
    };
}

/**
 * The stored form, read back as shapes in client px. UNTRUSTED: a bag is written by whatever generation of
 * the chart wrote it, or by a person editing a file. Anything that is not a well-formed lasso is an empty
 * one, and nothing here throws. A shape wholly outside the plot box is dropped.
 */
function fromStored(raw: unknown, f: Frame, axes: LassoAxes | null): Shape[] {
    try {
        if (!raw || typeof raw !== "object") return [];
        const o = raw as any;
        const space: LassoSpace | null = o.space === "data" ? "data" : o.space === "unit" ? "unit" : null;
        if (!space || !Array.isArray(o.shapes) || o.shapes.length === 0 || o.shapes.length > LASSO_RESTORE_MAX_SHAPES) return [];
        if (space === "data" && !axes) return [];
        if (!frameUsable(f)) return [];
        const out: Shape[] = [];
        for (const s of o.shapes) {
            if (!s || typeof s !== "object" || !Array.isArray(s.pts)) return [];
            const mode: LassoMode = s.mode === "rect" ? "rect" : "free";
            if (s.pts.length < 3 || s.pts.length > LASSO_RESTORE_MAX_VERTICES) return [];
            if (mode === "rect" && s.pts.length !== 4) return [];
            const pts: PressPoint[] = [];
            for (const v of s.pts) {
                const p = finitePair(v);
                if (!p) return [];
                if (space === "unit") {
                    pts.push({ x: f.left + p[0] * f.width, y: f.top + p[1] * f.height });
                } else {
                    const scr = finitePair(axes!.toScreen(p));
                    if (!scr) return [];
                    pts.push(fromLocal(f, scr));
                }
            }
            const shape = makeShape(mode, pts);
            const outside = shape.maxX < f.left || shape.minX > f.left + f.width || shape.maxY < f.top || shape.minY > f.top + f.height;
            if (!outside) out.push(shape);
        }
        return out;
    } catch { return []; }
}

// ---- what is inside ---------------------------------------------------------------------------

interface Centre { x: number; y: number; el: Element; rows: number[] }

/** Every mark that names rows and has a box, with the centre of that box. One layout read per mark. */
function gatherCentres(container: Element): Centre[] {
    const out: Centre[] = [];
    for (const el of Array.from(container.querySelectorAll(`.${MARK_CLASS}[${ROW_IDX_ATTR}]`))) {
        const rows = rowIdxsFromMark(el);
        if (!rows.length) continue;
        const r = el.getBoundingClientRect();
        if (!(r.width > 0 || r.height > 0)) continue;
        out.push({ x: r.left + r.width / 2, y: r.top + r.height / 2, el, rows });
    }
    return out;
}

/** A mark the chart has hidden is not part of what the reader drew around. */
function markHidden(el: Element, win: any): boolean {
    try {
        const cs = win?.getComputedStyle?.(el);
        return !!cs && (cs.visibility === "hidden" || cs.display === "none");
    } catch { return false; }
}

/** The rows whose marks have their centre inside any of `shapes`. `skipHidden` reads the style of each mark that is
 *  inside, which a live count while dragging does not need to pay for on every move: the release does it once. */
function rowsInside(centres: Centre[], shapes: Shape[], win: any, skipHidden = true): number[] {
    const set = new Set<number>();
    for (const c of centres) {
        if (!shapes.some(s => pointInShape(s, c.x, c.y))) continue;
        if (skipHidden && markHidden(c.el, win)) continue;
        for (const r of c.rows) set.add(r);
    }
    return Array.from(set).sort((a, b) => a - b);
}

const sameRows = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((r, i) => r === b[i]);

// ---- the action list ----------------------------------------------------------------------------

/** What an action is given on release. */
export interface LassoActionContext {
    /** The rows inside the lasso (every shape of it), ascending. */
    rows: number[];
    mode: LassoMode;
    source: "user";
    env: LassoEnv;
}
export type LassoAction = (ctx: LassoActionContext) => void;

const ACTIONS = new Map<string, LassoAction>([
    // The host's own selection: the same publish a mark click makes, so the dim and the subscribers follow.
    ["select", ctx => ctx.env.select(ctx.rows)],
]);

/**
 * Make `name` available to the action list (RenderOptions.lasso.actions). A name in the list that nothing
 * registered is skipped, so a host can carry a list ahead of the build that understands it.
 */
export function registerLassoAction(name: string, action: LassoAction): void {
    if (typeof name === "string" && name && typeof action === "function") ACTIONS.set(name, action);
}

// ---- the knob bag ---------------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** The stored lasso: the persisted view-state first, else the bag on the container. undefined when none. */
function readStored(options: RenderOptions, container: Element): unknown {
    const ui = options?.uiState;
    const knobs = isObject(ui) ? (ui as any).knobs : undefined;
    if (isObject(knobs) && knobs[LASSO_KNOB_KEY] !== undefined) return knobs[LASSO_KNOB_KEY];
    const bag = (container as any).__lchKnobs;
    return isObject(bag) ? bag[LASSO_KNOB_KEY] : undefined;
}

/**
 * Write the lasso (or remove it) into the shared bag and persist the WHOLE bag, exactly as an in-chart
 * slider does: the persisting host REPLACES its state rather than merging, so every other knob and every
 * other key travels with it. The base is the last full state any helper wrote during this render, else the
 * render-time view-state (container.__lchUiLive and its two guards, the record the helpers share).
 */
function writeStored(container: Element, options: RenderOptions, value: LassoStored | null): void {
    const holder = container as any;
    if (!isObject(holder.__lchKnobs)) holder.__lchKnobs = {};
    const bag = holder.__lchKnobs as Record<string, unknown>;
    const had = bag[LASSO_KNOB_KEY] !== undefined || readStored(options, container) !== undefined;
    if (value === null && !had) return;                     // nothing was stored, so nothing to remove
    if (value === null) delete bag[LASSO_KNOB_KEY]; else bag[LASSO_KNOB_KEY] = value;
    if (typeof options.setUiState !== "function") return;
    const ui = isObject(options.uiState) ? options.uiState : {};
    const live = holder.__lchUiLiveOpts === options && holder.__lchUiLiveSeed === options.uiState ? holder.__lchUiLive : null;
    const base: Record<string, unknown> = isObject(live) ? live : ui;
    const next: Record<string, unknown> = { ...base };
    const knobs: Record<string, unknown> = { ...(isObject(base.knobs) ? base.knobs : {}), ...bag };
    if (value === null) delete knobs[LASSO_KNOB_KEY];
    next.knobs = knobs;
    holder.__lchUiLive = next;
    holder.__lchUiLiveOpts = options;
    holder.__lchUiLiveSeed = options.uiState;
    try { options.setUiState(next); } catch { /* persistence is advisory: a refused write never takes the chart down */ }
}

// ---- the plot --------------------------------------------------------------------------------------

function svgBox(svg: Element): { x: number; y: number; w: number; h: number } | null {
    const vb = (svg.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
    if (vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) return { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
    const r = svg.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return { x: 0, y: 0, w: r.width, h: r.height };
    const w = parseFloat(svg.getAttribute("width") || ""), h = parseFloat(svg.getAttribute("height") || "");
    return w > 0 && h > 0 ? { x: 0, y: 0, w, h } : null;
}

/** The element the surface goes into and the box it covers there, in that element's own units. */
function findPlot(container: Element): { host: Element; box: { x: number; y: number; w: number; h: number } } | null {
    const grouped = container.querySelector(`.${LASSO_PLOT_CLASS}`);
    const tag = grouped?.tagName?.toLowerCase();
    if (grouped && grouped.namespaceURI === SVGNS && (tag === "g" || tag === "svg")) {
        if (tag === "svg") {
            const b = svgBox(grouped);
            return b ? { host: grouped, box: b } : null;
        }
        try {
            const b = (grouped as any).getBBox?.();
            if (b && b.width > 0 && b.height > 0) return { host: grouped, box: { x: b.x, y: b.y, w: b.width, h: b.height } };
        } catch { /* not laid out */ }
        const svg = (grouped as any).ownerSVGElement ?? grouped.closest("svg");
        const b = svg ? svgBox(svg) : null;
        return b ? { host: grouped, box: b } : null;
    }
    const svg = container.querySelector(`svg[${SNAPSHOT_SVG_ATTR}]`) ?? container.querySelector("svg");
    const b = svg ? svgBox(svg) : null;
    return svg && b ? { host: svg, box: b } : null;
}

// ---- installing ------------------------------------------------------------------------------------

/** What the host gives the lasso. The lasso never reaches into the host's selection itself. */
export interface LassoEnv {
    container: HTMLElement;
    /** The options of the render now on screen (a function, because setOptions replaces them). */
    options: () => RenderOptions;
    /** How many rows the chart was handed: the number the cap is measured against. */
    rows: number;
    /** Publish this row set as the selection (what the "select" action does). */
    select(rows: number[]): void;
    /** Clear the host's selection the way an empty click does: the chart's own clear slot first when the
     *  chart owns the selection, then a published clear. A no-op when nothing is selected. */
    clearSelection(): void;
}

export interface LassoHandle {
    /** The surface the gesture is read on; null when the lasso is off at this row count. */
    readonly surface: Element | null;
    /** The rows inside the lasso now drawn, ascending; empty when none. */
    rows(): number[];
    /** Erase the lasso. By default it also clears the host's selection and says so with `llm-lasso`. */
    clear(opts?: { publish?: boolean; source?: "user" | "host" }): void;
    /** Remove the listeners and everything the lasso drew. Nothing is persisted. */
    destroy(): void;
}

interface Gesture {
    id: number | undefined;
    start: PressPoint;
    pts: PressPoint[];
    end: PressPoint;
    additive: boolean;
    mode: LassoMode;
    dragging: boolean;
}

function fmtCount(n: number, culture?: string): string {
    try { return new Intl.NumberFormat(culture || undefined).format(n); } catch { return String(n); }
}

/** The one-line caption over the cap. Absolutely positioned, so it adds nothing to the chart's layout. */
function showNote(env: LassoEnv, rows: number, cap: number): LassoHandle {
    const { container } = env;
    const doc = container.ownerDocument;
    const win: any = doc.defaultView;
    const opts = env.options();
    const note = doc.createElement("div");
    note.className = LASSO_NOTE_CLASS;
    note.setAttribute("role", "note");
    note.textContent = `Lasso selection is off at ${fmtCount(rows, opts?.cultureCode)} rows (limit ${fmtCount(cap, opts?.cultureCode)})`;
    Object.assign(note.style, {
        position: "absolute", right: "6px", bottom: "2px", font: "11px/1.2 system-ui, sans-serif", opacity: "0.75",
        pointerEvents: "none", whiteSpace: "nowrap", zIndex: "2", color: opts?.themeFg || "inherit",
    });
    try { if (win?.getComputedStyle(container).position === "static") container.style.position = "relative"; } catch { /* no layout */ }
    container.appendChild(note);
    const handle: LassoHandle = {
        surface: null, rows: () => [], clear: () => { /* nothing is drawn */ },
        destroy: () => { note.remove(); if ((container as any)[LASSO_SLOT] === handle) (container as any)[LASSO_SLOT] = null; },
    };
    (container as any)[LASSO_SLOT] = handle;
    return handle;
}

/**
 * Put the lasso on the chart in `env.container`, which has just drawn. Returns null when the chart gets none
 * (not capable, switched off, nothing to draw on); a handle for the caption when the rows exceed the cap;
 * otherwise the live handle. A lasso already installed on the container is destroyed first.
 */
export function installLasso(env: LassoEnv): LassoHandle | null {
    const { container } = env;
    const doc = container.ownerDocument;
    const win: any = doc.defaultView ?? globalThis;
    const holder = container as any;
    try { holder[LASSO_SLOT]?.destroy(); } catch { /* an old handle that cannot clean up is not a reason to stop */ }
    holder[LASSO_SLOT] = null;

    const setting = settingOf(env.options());
    const verdict = lassoVerdict(setting, env.rows);
    if (verdict === "not-capable" || verdict === "disabled") return null;
    if (verdict === "over-cap") return showNote(env, env.rows, lassoRowCap(setting));
    const plot = findPlot(container);
    if (!plot) return null;

    // ---- the elements ----
    const surface = doc.createElementNS(SVGNS, "rect");
    surface.setAttribute("class", `${CONTROL_CLASS} ${LASSO_SURFACE_CLASS}`);
    surface.setAttribute("x", String(plot.box.x));
    surface.setAttribute("y", String(plot.box.y));
    surface.setAttribute("width", String(plot.box.w));
    surface.setAttribute("height", String(plot.box.h));
    surface.setAttribute("fill", "transparent");
    surface.setAttribute("pointer-events", "all");
    surface.setAttribute("tabindex", "0");
    surface.setAttribute("aria-label", "Selection area: drag to draw around marks, Escape to clear");
    // The crosshair is a system cursor, so the bitmap-cursor trap does not apply; never a grab cursor, which
    // an embedded WebView does not draw. touch-action: none makes a touch drag draw rather than scroll.
    Object.assign(surface.style, { cursor: "crosshair", touchAction: "none", userSelect: "none" });
    plot.host.insertBefore(surface, plot.host.firstChild);   // BELOW the marks: a press on a mark is a mark click

    const outline = doc.createElementNS(SVGNS, "path");
    outline.setAttribute("class", LASSO_OUTLINE_CLASS);
    outline.setAttribute("pointer-events", "none");
    outline.setAttribute("fill-opacity", "0.12");
    outline.setAttribute("stroke-width", "1.5");
    outline.setAttribute("stroke-dasharray", "5 3");
    outline.setAttribute("d", "");
    const count = doc.createElementNS(SVGNS, "text");
    count.setAttribute("class", LASSO_COUNT_CLASS);
    count.setAttribute("pointer-events", "none");
    count.setAttribute("font-size", "12");
    count.setAttribute("x", String(plot.box.x + 6));
    count.setAttribute("y", String(plot.box.y + 16));
    Object.assign(count.style, { userSelect: "none" });
    plot.host.appendChild(outline);
    plot.host.appendChild(count);
    const paintInk = () => {
        const o = env.options();
        const fg = o?.themeFg || "currentColor";
        outline.setAttribute("stroke", fg);
        outline.setAttribute("fill", o?.themeAccent || fg);
        count.setAttribute("fill", fg);
    };
    paintInk();

    // ---- state ----
    let shapes: Shape[] = [];         // the lasso at rest, in client px
    let rowsNow: number[] = [];
    let gesture: Gesture | null = null;
    let press: PressPoint | null = null;   // where the last press began, anywhere in the chart
    let tail = false;                       // a drag just ended, so the click that follows is its tail
    let centres: Centre[] = [];             // mark centres, read once when a drag begins

    const frame = () => frameOf(surface);
    const modeNow = (): LassoMode => container.getAttribute(LASSO_MODE_ATTR) === "rect" ? "rect" : "free";

    const dFor = (list: Shape[], f: Frame): string => list.map(s => {
        const loc = s.pts.map(p => toLocal(f, p));
        return "M" + loc.map(p => `${round(p[0])} ${round(p[1])}`).join("L") + "Z";
    }).join("");
    const round = (n: number) => Math.round(n * 100) / 100;
    const drawRest = () => { outline.setAttribute("d", shapes.length ? dFor(shapes, frame()) : ""); };
    const setCount = (n: number | null) => {
        count.textContent = n === null ? "" : `${fmtCount(n, env.options()?.cultureCode)} selected`;
    };

    const detail = (rows: number[], list: Shape[], source: LassoEventDetail["source"]): LassoEventDetail => {
        const stored = toStored(list, frame(), axesOf(container));
        const last = stored.shapes[stored.shapes.length - 1];
        return {
            rows, polygon: last ? last.pts : [], polygons: stored.shapes.map(s => s.pts),
            mode: last ? last.mode : modeNow(), space: stored.space, source,
        };
    };
    const emit = (d: LassoEventDetail) => {
        const Ev = win.CustomEvent ?? (globalThis as any).CustomEvent;
        try { container.dispatchEvent(new Ev(LASSO_EVENT, { detail: d, bubbles: true })); } catch { /* a listener's error is its own */ }
    };
    const persist = (list: Shape[] | null) => {
        try {
            writeStored(container, env.options(), list ? toStored(list, frame(), axesOf(container)) : null);
        } catch { /* advisory */ }
    };

    // ---- a finished lasso: show it, store it, run the actions, tell the chart ----
    const commit = (list: Shape[], rows: number[]) => {
        shapes = list; rowsNow = rows;
        drawRest(); setCount(null);
        persist(list);
        const ctx: LassoActionContext = { rows: rows.slice(), mode: list[list.length - 1].mode, source: "user", env };
        for (const name of lassoActions(settingOf(env.options()))) {
            const run = ACTIONS.get(name);
            if (!run) continue;                       // a name this build does not know: skipped, not an error
            try { run(ctx); } catch { /* one action failing must not stop the next, nor the event */ }
        }
        emit(detail(rows, list, "user"));
    };

    const clear = (opts: { publish?: boolean; source?: "user" | "host" } = {}) => {
        const had = shapes.length > 0;
        if (gesture) endGesture();
        shapes = []; rowsNow = [];
        drawRest(); setCount(null);
        // The chart's own clear slot is called first and the clear published after, as the host's click
        // does when the chart owns the selection (see clearSelection).
        if (opts.publish !== false) { try { env.clearSelection(); } catch { /* the host's concern */ } }
        if (had) {
            persist(null);
            emit(detail([], [], opts.source ?? "user"));
        }
    };

    // ---- the gesture ----
    const beginsOffMark = (target: unknown, x: number, y: number): boolean => {
        const t = target as Element | null;
        if (!t || t.nodeType !== 1) return false;
        if (t !== surface) {
            // Something of the chart's own drawing in the plot (a gridline, a plot background), not an
            // overlay of HTML laid over it.
            if (!plot.host.contains(t)) return false;
            if (t.closest?.(MARKISH)) return false;
            if (isInsideControl(t, container)) return false;
        }
        // A transparent overlay over the marks is the event's target; the mark under it is what was pressed.
        try {
            const stack = (doc as any).elementsFromPoint?.(x, y) as Element[] | undefined;
            if (stack) for (const el of stack) if (el !== surface && container.contains(el) && el.closest?.(MARKISH)) return false;
        } catch { /* no hit-test */ }
        return true;
    };

    const stopSelect = (e: Event) => e.preventDefault();
    const listen = (on: boolean) => {
        const m = on ? "addEventListener" : "removeEventListener";
        (doc as any)[m]("pointermove", onMove);
        (doc as any)[m]("pointerup", onUp);
        (doc as any)[m]("pointercancel", onCancel);
        (doc as any)[m]("selectstart", stopSelect);
    };
    const endGesture = () => {
        if (!gesture) return;
        const wasDragging = gesture.dragging;
        gesture = null;
        listen(false);
        centres = [];
        setCount(null);
        if (wasDragging) { tail = true; drawRest(); }
    };

    const liveShape = (g: Gesture): Shape =>
        g.mode === "rect" ? makeShape("rect", rectCorners(g.start, g.end)) : makeShape("free", [...g.pts, g.end]);

    const paintLive = (g: Gesture) => {
        const f = frame();
        const live = liveShape(g);
        const parts = g.additive ? [...shapes, live] : [live];
        outline.setAttribute("d", dFor(parts, f));
        setCount(rowsInside(centres, parts, win, false).length);
    };

    function onDown(e: any) {
        tail = false;
        const x = Number(e.clientX), y = Number(e.clientY);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        press = { x, y };
        if (gesture || (e.button != null && e.button !== 0) || e.isPrimary === false) return;
        const f = frame();
        if (!insideFrame(f, x, y) || !beginsOffMark(e.target, x, y)) return;
        gesture = {
            id: e.pointerId, start: { x, y }, pts: [{ x, y }], end: { x, y },
            additive: !!(e.ctrlKey || e.metaKey || e.shiftKey), mode: modeNow(), dragging: false,
        };
        try {
            if (e.pointerId != null && typeof (surface as any).setPointerCapture === "function") (surface as any).setPointerCapture(e.pointerId);
        } catch { /* the pointer is not active, or the platform has no capture: the document listeners still follow it */ }
        listen(true);
    }

    function onMove(e: any) {
        const g = gesture;
        if (!g || (g.id != null && e.pointerId != null && e.pointerId !== g.id)) return;
        const p = { x: Number(e.clientX), y: Number(e.clientY) };
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
        if (!g.dragging) {
            if (!gestureWasDrag(g.start, p, LASSO_DRAG_PX)) return;       // still a click
            g.dragging = true;
            centres = gatherCentres(container);
            paintInk();
        }
        g.end = p;
        if (g.mode === "free") {
            const last = g.pts[g.pts.length - 1];
            if (Math.hypot(p.x - last.x, p.y - last.y) >= LASSO_SAMPLE_PX) g.pts.push(p);
        }
        paintLive(g);
    }

    function onUp(e: any) {
        const g = gesture;
        if (!g || (g.id != null && e.pointerId != null && e.pointerId !== g.id)) return;
        if (!g.dragging) { endGesture(); return; }                         // a click: the click handler decides
        const x = Number(e.clientX), y = Number(e.clientY);
        if (Number.isFinite(x) && Number.isFinite(y)) g.end = { x, y };
        const additive = g.additive;
        const mode = g.mode;
        let pts = mode === "rect" ? rectCorners(g.start, g.end) : [...g.pts, g.end];
        endGesture();                                                       // restores the outline at rest
        if (mode === "free") {
            if (pts.length < 3) return;
            pts = thin(pts, LASSO_MAX_VERTICES);
        }
        const shape = makeShape(mode, pts);
        const fresh = gatherCentres(container);
        // A shape that takes in nothing changes nothing: the drag is discarded.
        const added = rowsInside(fresh, [shape], win);
        if (!added.length) return;
        const list = additive ? [...shapes, shape] : [shape];
        const rows = additive ? rowsInside(fresh, list, win) : added;
        if (additive && sameRows(rows, rowsNow)) return;                    // brought nothing new
        commit(list, rows);
        try { (surface as any).focus?.({ preventScroll: true }); } catch { /* not focusable here */ }
    }

    function onCancel(e: any) {
        const g = gesture;
        if (!g || (g.id != null && e.pointerId != null && e.pointerId !== g.id)) return;
        endGesture();
    }

    // The click that trails a drag is its tail and no click on the plot. A click that lands on the surface
    // itself is an empty click on the plot, and clears. Capture phase, and the press is read from the
    // lasso's own record, so the host's click handler (which spends its record) cannot hide it.
    function onClick(e: any) {
        const wasDrag = tail || (Number(e.detail) > 0 && !!press && gestureWasDrag(press, { x: Number(e.clientX), y: Number(e.clientY) }, LASSO_DRAG_PX));
        tail = false;
        press = null;                                  // spent: the click it led to has been read
        if (e.target !== surface || wasDrag) return;
        if (e.ctrlKey || e.metaKey || e.shiftKey) return;
        clear({ publish: true, source: "user" });
    }

    function onKey(e: any) {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        if (gesture) { endGesture(); e.preventDefault?.(); return; }
        if (shapes.length) { clear({ publish: true, source: "user" }); e.preventDefault?.(); }
    }

    container.addEventListener("pointerdown", onDown, true);
    container.addEventListener("click", onClick, true);
    container.addEventListener("keydown", onKey);

    const handle: LassoHandle = {
        surface,
        rows: () => rowsNow.slice(),
        clear,
        destroy() {
            if (gesture) { gesture = null; listen(false); }
            container.removeEventListener("pointerdown", onDown, true);
            container.removeEventListener("click", onClick, true);
            container.removeEventListener("keydown", onKey);
            surface.remove(); outline.remove(); count.remove();
            if (holder[LASSO_SLOT] === handle) holder[LASSO_SLOT] = null;
        },
    };
    holder[LASSO_SLOT] = handle;

    // ---- a lasso kept from before: re-applied, announced, and never published ----
    const restored = fromStored(readStored(env.options(), container), frame(), axesOf(container));
    if (restored.length) {
        const rows = rowsInside(gatherCentres(container), restored, win);
        if (rows.length) {
            shapes = restored; rowsNow = rows;
            drawRest();
            emit(detail(rows, restored, "restore"));
        }
    }
    return handle;
}

/** Erase the lasso on `container`, if it has one, and clear the selection with it. */
export function clearLasso(container: Element | null | undefined, opts?: { publish?: boolean; source?: "user" | "host" }): void {
    try { ((container as any)?.[LASSO_SLOT] as LassoHandle | null | undefined)?.clear(opts); } catch { /* nothing to clear */ }
}
