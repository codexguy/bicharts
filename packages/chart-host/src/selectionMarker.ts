// WHAT MARKS A SELECTION BEYOND THE DIM, AND THE OUTLINE.
//
// A selection dims every mark outside it; a selected mark keeps its paint. That is enough until the selected mark's
// own colour is close to the canvas. A diverging colour ramp puts a neutral just off the canvas at its centre, and the
// dim pulls every other mark toward the canvas too, so a selected region near the centre and a dimmed region at
// either end come out as nearly the same pale colour. On a map every region is coloured that way and the regions
// touch, so the selection can disappear.
//
// THE CHOICE. A host carries two settings, the same in every host:
//   - the selection marker for every chart ("auto", the default, or "none", "dot", "check", "outline");
//   - the selection marker for region maps ("outline", the default, or "none", "dot", "check").
// "auto" is an outline on a chart that declares a ramp with a neutral centre, and nothing otherwise, so every other
// chart draws exactly as it did before the setting had an "auto". A region map is outlined by default whatever its
// ramp: its regions share borders and its colours are its data.
//
// TRAITS, NEVER NAMES. Both facts are read from what the chart carries, not from its chart type:
//   - a REGION MAP is a chart whose rows carry the host's region join column (REGION_JOIN_COLUMN). Every choropleth,
//     bivariate choropleth, cartogram and province map joins its rows to regions through it; a point map places its
//     rows by coordinates instead and has none.
//   - a NEUTRAL-CENTRE RAMP is the legend the shared value ramp draws for a diverging scale, which declares its kind
//     on the element (NEUTRAL_CENTRE_RAMP_SELECTOR).
//
// THE OUTLINE is drawn by the host in its own layer over the chart, never on the chart's marks: a stroke the width of
// the reader's eye at the dim, in the chart's text colour over a halo of its canvas, around each selected AREA mark (a
// filled path, rect or polygon). A line or a point keeps its geometry and gets none. Drawn over the chart, it sits
// above the neighbouring regions, so a shared border is never painted over; and since the marks themselves are
// neither restyled nor moved, the keyboard's order, a chart's own transitions and what a click hits are all untouched.
// Over the chart means over its controls too, so the chart's own controls (CONTROL_CLASS: a map's zoom pad) are holes
// in the outline: a region that runs under the pad is outlined up to it, never across the buttons.

import { MARK_CLASS, MARK_SELECTED_CLASS, CONTROL_CLASS } from "./contract";
import { clipWindowOf } from "./fitDom";

/** The reader's choice for every chart. */
export type SelectionMarkerChoice = "auto" | "none" | "dot" | "check" | "outline";
/** The reader's choice for region maps. */
export type MapSelectionMarkerChoice = "none" | "dot" | "check" | "outline";
/** What a chart is given, once the choice meets the chart. */
export type SelectionMarker = "none" | "dot" | "check" | "outline";

/** The default for every chart: an outline where the chart's ramp has a neutral centre, nothing elsewhere. */
export const SELECTION_MARKER_DEFAULT: SelectionMarkerChoice = "auto";
/** The default for region maps: an outline. */
export const MAP_SELECTION_MARKER_DEFAULT: MapSelectionMarkerChoice = "outline";

/** The choice for every chart from an untrusted value: one of the five words in any case, else the default. */
export function readSelectionMarker(raw: unknown): SelectionMarkerChoice {
    const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    return v === "none" || v === "dot" || v === "check" || v === "outline" || v === "auto" ? v : SELECTION_MARKER_DEFAULT;
}

/** The choice for region maps from an untrusted value: one of the four words in any case, else the default. */
export function readMapSelectionMarker(raw: unknown): MapSelectionMarkerChoice {
    const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    return v === "none" || v === "dot" || v === "check" || v === "outline" ? v : MAP_SELECTION_MARKER_DEFAULT;
}

/** The column the host adds to a region map's rows: each row's region code, joined to the geometry. */
export const REGION_JOIN_COLUMN = "__geoIso__";

/** Whether the chart's data joins its rows to regions (a choropleth, a cartogram, a province map). */
export function isRegionMapData(data: { columns?: readonly ({ name?: unknown } | null | undefined)[] | null } | null | undefined): boolean {
    const cols = data?.columns;
    if (!Array.isArray(cols)) return false;
    return cols.some(c => !!c && c.name === REGION_JOIN_COLUMN);
}

/** The legend the shared value ramp draws for a diverging scale: its centre colour is a neutral just off the canvas. */
export const NEUTRAL_CENTRE_RAMP_SELECTOR = '.llm-value-ramp[data-kind="diverging"]';

/** Whether the drawn chart declares a colour ramp with a neutral centre. */
export function hasNeutralCentreRamp(container: Element | null | undefined): boolean {
    try {
        return !!container?.querySelector?.(NEUTRAL_CENTRE_RAMP_SELECTOR);
    } catch {
        return false;
    }
}

/** What marks this chart's selection: the map choice on a region map, else the general choice with "auto" decided. */
export function selectionMarkerFor(facts: {
    choice?: unknown;
    mapChoice?: unknown;
    regionMap: boolean;
    neutralCentreRamp: boolean;
}): SelectionMarker {
    if (facts.regionMap) return readMapSelectionMarker(facts.mapChoice);
    const c = readSelectionMarker(facts.choice);
    if (c !== "auto") return c;
    return facts.neutralCentreRamp ? "outline" : "none";
}

/** The class on the host's outline layer (one svg in the overlay). */
export const SELECTION_OUTLINE_CLASS = "lch-sel-outline";

const SVG_NS = "http://www.w3.org/2000/svg";
const AREA_TAGS = new Set(["path", "rect", "polygon"]);
const UNFILLED = /^(none|transparent|rgba\([^)]*,\s*0(\.0+)?\s*\))$/i;

/** Whether `el` is an AREA mark: a path, rect or polygon whose interior is painted. A line (fill none), a point
 *  (a circle or an ellipse) and a group are not. Reads the computed fill where the platform resolves it, else the
 *  element's own attribute and inline style; an element with no fill at all is filled, as SVG paints it. */
export function isAreaMark(el: Element): boolean {
    const tag = (el.localName || el.tagName || "").toLowerCase();
    if (!AREA_TAGS.has(tag)) return false;
    let fill = "", fillOpacity = "";
    try {
        const cs = el.ownerDocument?.defaultView?.getComputedStyle?.(el);
        fill = (cs?.fill || "").trim();
        fillOpacity = (cs?.fillOpacity || "").trim();
    } catch { /* no styles: the attributes below decide */ }
    const style = (el as HTMLElement).style;
    if (!fill) fill = (style?.fill || el.getAttribute("fill") || "").trim();
    if (!fillOpacity) fillOpacity = (style?.fillOpacity || el.getAttribute("fill-opacity") || "").trim();
    if (fill && UNFILLED.test(fill)) return false;
    if (fillOpacity !== "" && parseFloat(fillOpacity) === 0) return false;
    return true;
}

/** Which selected marks get an outline, for a host that draws its own layer: `shown` drops a mark the reader can't see. */
export interface OutlineMarkFilter {
    shown?(mark: Element): boolean;
}

/**
 * The selected area marks in `container`, in document order. A selected mark that is a group stands for the filled
 * shapes inside it. A selected mark whose box strictly encloses another selected mark is a hierarchy's backdrop (a
 * treemap's parent tile), whose children carry the outlines, and is left out - checked up to 300 marks, as the glyphs
 * check it.
 */
export function collectOutlineMarks(container: Element, filter?: OutlineMarkFilter): Element[] {
    const picked: Element[] = [];
    const seen = new Set<Element>();
    const add = (el: Element) => {
        if (seen.has(el)) return;
        seen.add(el);
        if (isAreaMark(el)) picked.push(el);
    };
    for (const m of Array.from(container.querySelectorAll(`.${MARK_CLASS}.${MARK_SELECTED_CLASS}`))) {
        if (filter?.shown && !filter.shown(m)) continue;
        if ((m.localName || "").toLowerCase() === "g") {
            for (const s of Array.from(m.querySelectorAll("path, rect, polygon"))) add(s);
        } else add(m);
    }
    if (picked.length < 2 || picked.length > 300) return picked;
    const EPS = 1;
    const rects = picked.map(m => { try { return m.getBoundingClientRect(); } catch { return null; } });
    return picked.filter((_, i) => {
        const c = rects[i];
        if (!c) return true;
        const cArea = c.width * c.height;
        if (!(cArea > 0)) return true;
        for (let j = 0; j < rects.length; j++) {
            const r = rects[j];
            if (j === i || !r) continue;
            const a = r.width * r.height;
            if (!(a > 0) || a >= cArea) continue;
            if (r.left >= c.left - EPS && r.right <= c.right + EPS && r.top >= c.top - EPS && r.bottom <= c.bottom + EPS) return false;
        }
        return true;
    });
}

type ClientWindow = { left: number; top: number; right: number; bottom: number };

/** The window a mark is seen through, in client coordinates: its outermost svg's box, narrowed by every clip-path on
 *  the way up to `stop`. Null when nothing measures (the outline then draws unclipped). */
export function outlineWindowOf(mark: Element, stop?: Element | null): ClientWindow | null {
    let acc: ClientWindow | null = null;
    const narrow = (w: ClientWindow | null) => {
        if (!w) return;
        acc = acc ? { left: Math.max(acc.left, w.left), top: Math.max(acc.top, w.top),
                      right: Math.min(acc.right, w.right), bottom: Math.min(acc.bottom, w.bottom) } : { ...w };
    };
    for (let el: Element | null = mark; el && el !== stop; el = el.parentElement) {
        try {
            if ((el.localName || "").toLowerCase() === "svg") {
                const r = el.getBoundingClientRect();
                if (r.width > 0 && r.height > 0) narrow({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
            } else if (el.hasAttribute?.("clip-path")) narrow(clipWindowOf(el));
        } catch { /* a box that won't measure narrows nothing */ }
    }
    return acc;
}

export interface SelectionOutlineStyle {
    /** The outline's colour: the chart's text colour. */
    color: string;
    /** The halo under it, in the canvas colour, so it reads on a dark and a light region alike. */
    halo: string;
    /** The outline's width in screen pixels. Default 2. */
    width?: number;
    /** At most this many are drawn. Default 600, which keeps the DOM light on a huge selection. */
    max?: number;
    /** The window each outline is clipped to, in client coordinates, or null for none. Default: outlineWindowOf. */
    windowOf?(mark: Element): ClientWindow | null;
    /** Boxes the outline never paints over, in client coordinates: the chart's own controls (controlBoxesIn). */
    avoid?: readonly ClientWindow[];
}

/**
 * Where a chart's OWN CONTROLS are, in client coordinates: every element it declares a control (CONTROL_CLASS - a map's
 * zoom pad, a pager, a flip arrow), grown by `pad` px, and boxes within `join` px of each other merged, so a pad of
 * buttons is one box and no sliver of an outline shows between its buttons. A selection outline is never painted over
 * them: a mark on the reader's chart must not cover the button that moves it.
 */
export function controlBoxesIn(root: Element | null | undefined, opts: { pad?: number; join?: number } = {}): ClientWindow[] {
    const pad = opts.pad ?? 2, join = opts.join ?? 4;
    let boxes: ClientWindow[] = [];
    try {
        for (const el of Array.from(root?.querySelectorAll?.(`.${CONTROL_CLASS}`) ?? [])) {
            const r = el.getBoundingClientRect();
            if (!(r.width > 0) || !(r.height > 0)) continue;
            boxes.push({ left: r.left - pad, top: r.top - pad, right: r.right + pad, bottom: r.bottom + pad });
        }
    } catch { return []; }
    const near = (a: ClientWindow, b: ClientWindow) =>
        a.left - join <= b.right && b.left - join <= a.right && a.top - join <= b.bottom && b.top - join <= a.bottom;
    let merged = true;
    while (merged) {
        merged = false;
        const out: ClientWindow[] = [];
        for (const b of boxes) {
            const hit = out.find(o => near(o, b));
            if (hit) {
                hit.left = Math.min(hit.left, b.left); hit.top = Math.min(hit.top, b.top);
                hit.right = Math.max(hit.right, b.right); hit.bottom = Math.max(hit.bottom, b.bottom);
                merged = true;
            } else out.push({ ...b });
        }
        boxes = out;
    }
    return boxes;
}

/** The geometry of an area mark, copied onto a new element of the same kind, without its paint or its transform. */
function copyGeometry(doc: Document, el: Element): Element | null {
    const tag = (el.localName || "").toLowerCase();
    const keep = tag === "path" ? ["d"] : tag === "rect" ? ["x", "y", "width", "height", "rx", "ry"] : tag === "polygon" ? ["points"] : null;
    if (!keep) return null;
    const out = doc.createElementNS(SVG_NS, tag);
    let any = false;
    for (const a of keep) {
        const v = el.getAttribute(a);
        if (v != null && v !== "") { out.setAttribute(a, v); any = true; }
    }
    return any ? out : null;
}

const num = (n: number) => String(Math.round(n * 1000) / 1000);
let maskSeq = 0;

/**
 * Draws an outline around each mark (up to `max`) into `overlay`: one svg layer positioned from the overlay's own
 * top-left corner, never hit-tested and hidden from assistive technology. Each outline is the mark's own shape, placed
 * through the mark's screen matrix, so it lands on the mark however the chart transformed it; its stroke keeps its
 * width at any zoom. Returns how many it drew: a mark with no screen matrix or no geometry is skipped. It does not
 * clear the overlay first: a host clears it (clearSelectionGlyphs) before deciding whether to paint at all.
 */
export function paintSelectionOutlines(overlay: Element, marks: readonly Element[], style: SelectionOutlineStyle): number {
    const doc = overlay.ownerDocument;
    const base = overlay.getBoundingClientRect();
    const width = style.width ?? 2;
    const windowOf = style.windowOf ?? ((m: Element) => outlineWindowOf(m));
    const root = doc.createElementNS(SVG_NS, "svg");
    root.setAttribute("class", SELECTION_OUTLINE_CLASS);
    root.setAttribute("aria-hidden", "true");
    root.setAttribute("focusable", "false");
    root.setAttribute("style", "position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none");
    // THE CHART'S OWN CONTROLS ARE HOLES: the outlines are drawn through a mask that is open everywhere except over each
    // box in style.avoid, so a region running under a map's zoom pad is outlined up to the pad and never across it.
    let host: Element = root;
    const holes = (style.avoid ?? []).filter(b => b.right > b.left && b.bottom > b.top);
    if (holes.length) {
        const id = `${SELECTION_OUTLINE_CLASS}-mask-${++maskSeq}`;
        const defs = doc.createElementNS(SVG_NS, "defs");
        const mask = doc.createElementNS(SVG_NS, "mask");
        mask.setAttribute("id", id);
        mask.setAttribute("maskUnits", "userSpaceOnUse");
        const BIG = 100000;
        for (const [k, v] of [["x", -BIG], ["y", -BIG], ["width", 2 * BIG], ["height", 2 * BIG]] as const) mask.setAttribute(k, String(v));
        const open = doc.createElementNS(SVG_NS, "rect");
        for (const [k, v] of [["x", -BIG], ["y", -BIG], ["width", 2 * BIG], ["height", 2 * BIG]] as const) open.setAttribute(k, String(v));
        open.setAttribute("fill", "#fff");
        mask.appendChild(open);
        for (const b of holes) {
            const r = doc.createElementNS(SVG_NS, "rect");
            r.setAttribute("class", `${SELECTION_OUTLINE_CLASS}-hole`);
            r.setAttribute("x", num(b.left - base.left));
            r.setAttribute("y", num(b.top - base.top));
            r.setAttribute("width", num(b.right - b.left));
            r.setAttribute("height", num(b.bottom - b.top));
            r.setAttribute("fill", "#000");
            mask.appendChild(r);
        }
        defs.appendChild(mask);
        root.appendChild(defs);
        host = doc.createElementNS(SVG_NS, "g");
        host.setAttribute("mask", `url(#${id})`);
        root.appendChild(host);
    }
    let drawn = 0;
    const max = style.max ?? 600;
    for (const m of marks) {
        if (drawn >= max) break;
        let ctm: { a: number; b: number; c: number; d: number; e: number; f: number } | null = null;
        try { ctm = (m as unknown as SVGGraphicsElement).getScreenCTM?.() ?? null; } catch { ctm = null; }
        if (!ctm) continue;
        const shape = copyGeometry(doc, m);
        if (!shape) continue;
        let parent: Element = host;
        let ox = base.left, oy = base.top;
        const w = windowOf(m);
        if (w) {
            if (!(w.right > w.left) || !(w.bottom > w.top)) continue;        // clipped away entirely
            const v = doc.createElementNS(SVG_NS, "svg");
            v.setAttribute("x", num(w.left - base.left));
            v.setAttribute("y", num(w.top - base.top));
            v.setAttribute("width", num(w.right - w.left));
            v.setAttribute("height", num(w.bottom - w.top));
            v.setAttribute("overflow", "hidden");
            host.appendChild(v);
            parent = v;
            ox = w.left; oy = w.top;
        }
        const transform = `matrix(${num(ctm.a)} ${num(ctm.b)} ${num(ctm.c)} ${num(ctm.d)} ${num(ctm.e - ox)} ${num(ctm.f - oy)})`;
        for (const [stroke, sw] of [[style.halo, width + 2], [style.color, width]] as const) {
            const p = shape.cloneNode(false) as Element;
            p.setAttribute("transform", transform);
            p.setAttribute("fill", "none");
            p.setAttribute("stroke", stroke);
            p.setAttribute("stroke-width", String(sw));
            p.setAttribute("stroke-linejoin", "round");
            p.setAttribute("vector-effect", "non-scaling-stroke");
            parent.appendChild(p);
        }
        drawn++;
    }
    if (drawn > 0) overlay.appendChild(root);
    return drawn;
}
