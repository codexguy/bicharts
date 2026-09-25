// The GENERIC half of the visual's D3 host-bridge click/hover mark resolution
// (chart-host Phase C — moved VERBATIM from the Power BI visual, comments included;
// the PBI half — selectionManager dispatch, panel-suppress flags, tooltips, glyphs —
// stays in the visual). Everything here is pure DOM computation over the contract's
// mark grammar (.d3-mark/.d3-legend-mark/.d3-axis-filter + data-row-idx); the only
// side channel is the injected diagnostic log callback, so both the visual and any
// other host (createChartHost, tests) resolve clicks identically.
//
// Each function carries the prod lesson that created it — do not simplify.
//
// The selection GLYPHS (2026-09-25) joined it: where a selected mark's glyph goes
// (collectD3GlyphCenters) and the painting of the glyphs into an overlay
// (paintSelectionGlyphs), moved verbatim from the visual. What a host paints, and
// whether at all, stays the host's: the glyph setting, the flow-chart suppression,
// the theme colours and any other renderer's centres.

import { CONTROL_CLASS, MARK_CLASS, MARK_SELECTED_CLASS } from "./contract";

/**
 * The rows a mark names: its data-row-idx read as a comma list of non-negative whole
 * numbers. A token that is not one names no row and is skipped; no attribute, no rows.
 */
export function rowIdxsFromMark(el: Element | null): number[] {
    if (!el) return [];
    const raw = el.getAttribute("data-row-idx");
    if (!raw) return [];
    const out: number[] = [];
    for (const tok of raw.split(",")) {
        const n = parseInt(tok.trim(), 10);
        if (!isNaN(n) && n >= 0) out.push(n);
    }
    return out;
}

/** The keys held during a click. Cmd counts as Ctrl. */
export interface SelectionModifiers {
    ctrl?: boolean;
    shift?: boolean;
}

/**
 * THE SELECTION A CLICK LEAVES - the one rule every host applies to a click on a mark that names
 * `rowIdxs`, from the selection it holds (`current`).
 *
 * With Ctrl/Cmd or Shift the semantics are TOGGLE-PER-ROW, not union: each clicked row that is
 * selected is removed and each that is not is added, so Ctrl-clicking a selected mark takes it
 * off, and a mark spanning several rows (a legend swatch) toggles each of them - a naive union
 * would leave a mark lit after the reader Ctrl-clicked it off. Toggling the last row off is a
 * legitimate way to reach empty.
 *
 * Without a modifier a click REPLACES the selection, and a click on exactly the current selection
 * - the same rows, compared with the selection the host holds now, never with a remembered click -
 * clears it: the other half of the gesture. So a plain click that returns [] is a toggle-off.
 * Comparing with a remembered click instead went stale whenever the selection changed under it (a
 * clear from elsewhere, a re-derived selection), and the next click on the mark then did nothing.
 */
export function nextSelection(current: Iterable<number> | null | undefined, rowIdxs: readonly number[], mods: SelectionModifiers = {}): number[] {
    const cur = Array.from(current ?? []);
    if (mods.ctrl || mods.shift) {
        const next = new Set(cur);
        for (const r of rowIdxs) {
            if (next.has(r)) next.delete(r);
            else next.add(r);
        }
        return Array.from(next);
    }
    const same = cur.length === rowIdxs.length && rowIdxs.every(r => cur.includes(r));
    return same ? [] : rowIdxs.slice();
}

/**
 * True when a click's target sits inside a reader-operated control the chart drew (CONTROL_CLASS
 * on the target or an ancestor), looking no further out than `container` - a page that wraps the
 * whole chart in the class does not make every click a control click. A text node is read through
 * its parent. A click inside a control is neither a selection nor a click on empty canvas.
 */
export function isInsideControl(target: EventTarget | Node | null | undefined, container: Element): boolean {
    let el: any = target;
    if (el && el.nodeType !== 1) el = el.parentElement ?? el.parentNode ?? null;
    while (el && el !== container) {
        if (el.nodeType === 1 && el.classList?.contains?.(CONTROL_CLASS)) return true;
        el = el.parentElement ?? el.parentNode ?? null;
    }
    return false;
}

export interface MarkResolverEnv {
    root: HTMLElement;                              // the chart container (hit scope)
    doc: Document;                                  // owner document (elementsFromPoint)
    log: (tag: string, data: object) => void;       // diagnostic sink (ctx.log in the visual)
}

export interface MarkResolver {
    isInvisibleStrokePath(el: Element): boolean;
    distToPathCenterline(el: SVGPathElement, x: number, y: number): number;
    refineHitCorridor(mark: HTMLElement | null, x: number, y: number, sel: string): HTMLElement | null;
    findMark(target: EventTarget | null, sel?: string, ev?: MouseEvent): HTMLElement | null;
    rowIdxsFromMark(el: Element | null): number[];
    penetrateOverlayAt(x: number, y: number, sel: string): HTMLElement | null;
    resolveByGeometry(x: number, y: number, sel: string): HTMLElement | null;
}

export function createMarkResolver(env: MarkResolverEnv): MarkResolver {
    const { root, doc, log } = env;

    // The visual can rely on the browser's GLOBAL `Element`; chart-host cannot. It runs
    // against foreign documents too — a jsdom sidecar, the server exec gate, a test that
    // builds its own JSDOM — where the global is absent or belongs to a DIFFERENT realm,
    // and `instanceof` across realms is false even for a real element. Resolve the
    // constructor from the document's own view, then duck-type as the last resort.
    const isElement = (t: any): boolean => {
        const E = (doc as any)?.defaultView?.Element ?? (globalThis as any).Element;
        if (E && t instanceof E) return true;
        return !!t && typeof t.closest === "function" && typeof t.getAttribute === "function";
    };
    const viewStyle = (n: Element): string => {
        try {
            const gcs = (doc as any)?.defaultView?.getComputedStyle
                ?? (typeof getComputedStyle === "function" ? getComputedStyle : null);
            return gcs ? gcs(n as any).pointerEvents : "";
        } catch { return ""; }
    };

    // Overlapping invisible hit corridors (prod: thin Yantian→Vancouver arc vs the
    // fat Hong Kong corridor stacked on top — 3 of 6 points along the thinnest arc
    // resolved to a DIFFERENT route). Disambiguate at event time: when the resolved
    // mark is an invisible stroke corridor, ask elementsFromPoint for the FULL hit
    // stack and pick the corridor whose CENTERLINE passes closest to the click —
    // the most precise claim wins. Clicks away from any thin corridor see a
    // single-corridor stack and resolve exactly as before. Structural (no
    // chart-type list); line charts' same-width companions are unaffected (ties
    // keep the topmost).
    const isInvisibleStrokePath = (el: Element): boolean => {
        if (el.tagName.toLowerCase() !== "path") return false;
        const f = el.getAttribute("fill");
        if (f !== null && f !== "" && f !== "none" && f !== "transparent") return false;
        const s = (el.getAttribute("stroke") || "").trim().toLowerCase();
        const so = parseFloat(el.getAttribute("stroke-opacity") || "1");
        return s === "transparent" || s === "none" || so <= 0.01;
    };

    // Screen-space distance from (x,y) to the path's CENTERLINE, by sampling.
    // 64 samples on a few-hundred-px arc ≈ 5-10px resolution — plenty to rank
    // "which arc did the user aim at" (corridors are ≥14px apart in the failing
    // cases). Click-time only; few candidates.
    const distToPathCenterline = (el: SVGPathElement, x: number, y: number): number => {
        const L = el.getTotalLength();
        if (!(L > 0)) return Number.MAX_VALUE;
        const m = el.getScreenCTM();
        if (!m) return Number.MAX_VALUE;
        let best = Number.MAX_VALUE;
        const N = 64;
        for (let i = 0; i <= N; i++) {
            const pt = el.getPointAtLength((L * i) / N);
            const dx = m.a * pt.x + m.c * pt.y + m.e - x;
            const dy = m.b * pt.x + m.d * pt.y + m.f - y;
            const d = dx * dx + dy * dy;
            if (d < best) best = d;
        }
        return Math.sqrt(best);
    };

    const refineHitCorridor = (mark: HTMLElement | null, x: number, y: number, sel: string): HTMLElement | null => {
        try {
            if (!mark || !isInvisibleStrokePath(mark) || !mark.getAttribute("data-row-idx")) return mark;
            // Gather ALL competing invisible corridors at this point. With
            // only one, the plain resolution stands.
            const stack = doc.elementsFromPoint(x, y);
            const candidates: Element[] = [];
            for (const el of stack) {
                if (!root.contains(el)) continue;
                if (!el.matches || !el.matches(sel)) continue;
                if (!el.getAttribute("data-row-idx")) continue;
                if (!isInvisibleStrokePath(el)) continue;
                candidates.push(el);
            }
            if (candidates.indexOf(mark) < 0) candidates.push(mark);
            if (candidates.length < 2) return mark;
            // The user aimed at a CENTERLINE, not a corridor: pick the
            // candidate whose path passes closest to the click point.
            // (Width ties — two overlapping min-width corridors — made a
            // width-based rule useless; distance is the real intent.)
            let best: Element = mark;
            let bestD = Number.MAX_VALUE;
            for (const el of candidates) {
                const d = distToPathCenterline(el as SVGPathElement, x, y);
                if (d < bestD) { bestD = d; best = el; }
            }
            if (best !== mark) {
                log("d3-hit-corridor-refined", {
                    candidates: candidates.length, distPx: Math.round(bestD),
                    fromRows: (mark.getAttribute("data-row-idx") || "").slice(0, 24),
                    toRows: (best.getAttribute("data-row-idx") || "").slice(0, 24),
                });
            }
            return best as HTMLElement;
        } catch { return mark; }
    };

    const findMark = (target: EventTarget | null, sel: string = ".d3-mark", ev?: MouseEvent): HTMLElement | null => {
        if (!isElement(target)) return null;
        const el = target as unknown as Element;
        // closest() crosses SVG boundaries — works for both <rect
        // class="d3-mark"> and <g class="d3-mark"><rect/></g>.
        const m = el.closest(sel) as HTMLElement | SVGElement | null;
        // With event coordinates available, resolve overlapping invisible
        // hit corridors to the narrowest one containing the point.
        if (m && ev) return refineHitCorridor(m as HTMLElement, ev.clientX, ev.clientY, sel);
        return m as HTMLElement | null;
    };

    // Overlay penetration (2026-06-23): a full-canvas background / spacer rect
    // with a PAINTABLE fill (fill:'transparent' is NOT fill:'none') and default
    // pointer-events, appended ON TOP of the marks, swallows the click — e.target is
    // then the inert overlay, findMark finds no mark, and cross-filter silently dies
    // (a production route-yield heatmap: clicking cells AND axis labels did nothing).
    // Walk the hit-stack at the point and take the first real mark UNDERNEATH the
    // overlay. This runs ONLY on the branch that already does nothing, so it never
    // alters a click that already resolved to a mark; a genuinely empty click (no
    // mark under the point) still resolves to null and no-ops.
    const penetrateOverlayAt = (x: number, y: number, sel: string): HTMLElement | null => {
        try {
            const stack = doc.elementsFromPoint(x, y);
            for (const el of stack) {
                if (!root.contains(el) || !isElement(el)) continue;
                // The stacked element may BE the mark, or be an inner decoration
                // WITHIN one (a HITTABLE bar / cell shape inside a `.d3-mark`
                // group). elementsFromPoint returns hit-testable leaf shapes but
                // NOT their <g> ancestors, so resolve UP via closest() to the
                // enclosing mark. NOTE: elementsFromPoint HONOURS
                // pointer-events:none (it omits those elements), so this only
                // recovers a mark whose inner shapes are pointer-events-ENABLED; a
                // row whose children are ALL pointer-events:none is invisible here
                // and is handled by the GEOMETRIC fallback. (closest() crosses SVG
                // boundaries and only runs on the already-no-mark branch, so it
                // never changes a click that resolved normally.)
                const cand = (el.matches(sel) ? el : el.closest(sel)) as Element | null;
                if (!cand || !root.contains(cand) || !cand.getAttribute("data-row-idx")) continue;
                log("d3_click-overlay-penetrated", { tag: el.tagName, cls: el.getAttribute("class"), via: el === cand ? "self" : "closest" });
                return cand as unknown as HTMLElement;
            }
        } catch { /* elementsFromPoint unsupported — fall through to no-op */ }
        return null;
    };

    // GEOMETRIC last resort (2026-06-29, a production Tabular-with-embedded chart
    // row-select dead): when a `.d3-mark` ROW and ALL its children are
    // pointer-events:none with NO enabled hit surface, the row is
    // hit-test-INVISIBLE — elementFromPoint returns whatever is BEHIND it and
    // elementsFromPoint OMITS it (both honour pointer-events:none), so neither
    // findMark nor the closest() stack walk can recover it. Resolve by pure
    // GEOMETRY: getBoundingClientRect ignores pointer-events, so hit-test the
    // click against every mark box and take the SMALLEST (most specific) one
    // containing the point. Runs ONLY after every pointer-events path already
    // failed, so it never alters a click that resolved normally.
    const resolveByGeometry = (x: number, y: number, sel: string): HTMLElement | null => {
        try {
            const cands = root.querySelectorAll<SVGElement | HTMLElement>(sel);
            // Cap: this is for table-like (small-N) row charts; a chart with
            // thousands of marks isn't the all-none pathology and we don't want
            // a per-empty-click O(n) rect sweep.
            let best: Element | null = null, bestArea = Number.MAX_VALUE;
            if (cands.length <= 600) {
                for (const el of Array.from(cands)) {
                    if (!el.getAttribute("data-row-idx")) continue;
                    const r = (el as any).getBoundingClientRect ? el.getBoundingClientRect() : null;
                    if (!r || r.width <= 0 || r.height <= 0) continue;
                    if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
                    const area = r.width * r.height;
                    if (area < bestArea) { bestArea = area; best = el; }
                }
            }
            // SCOPING GUARD — only resolve a mark that is genuinely UNCLICKABLE
            // (no painted descendant with pointer-events enabled). That is exactly
            // the pathology: a row whose every shape is pointer-events:none. If the
            // mark HAS a hittable shape then a real click on it would already have
            // resolved above, so being here means the click hit a GAP inside the
            // mark's box — treat as empty (let the panel toggle), do NOT hijack it.
            // Keeps the fallback inert for every normally-hittable D3 chart.
            const hasHittableShape = (node: Element): boolean => {
                const SHAPE = /^(rect|circle|ellipse|path|line|polygon|polyline|text|image|use)$/;
                const all = [node, ...Array.from(node.querySelectorAll("*"))];
                for (const n of all) {
                    const tag = (n.tagName || "").toLowerCase();
                    if (!SHAPE.test(tag)) continue;
                    const pe = viewStyle(n);
                    if (pe && pe !== "none") return true;
                }
                return false;
            };
            if (best && !hasHittableShape(best)) {
                log("d3_click-geom-resolved", { rows: (best.getAttribute("data-row-idx") || "").slice(0, 24) });
                return best as unknown as HTMLElement;
            } else if (best) {
                log("d3_click-geom-skip-hittable", {});
            }
        } catch { /* getBoundingClientRect / getComputedStyle unsupported — fall through */ }
        return null;
    };

    return { isInvisibleStrokePath, distToPathCenterline, refineHitCorridor, findMark, rowIdxsFromMark, penetrateOverlayAt, resolveByGeometry };
}

/** A glyph's centre, in pixels from the overlay's own top-left corner. */
export interface GlyphCenter { x: number; y: number }

/**
 * Where each SELECTED mark in `container` gets its glyph (every `.d3-mark` that also carries the
 * selected class), pushed onto `out` in document order, relative to `baseRect` (the overlay's own
 * client rect). Throws what the platform throws; a host that must not fail its paint catches it.
 */
export function collectD3GlyphCenters(container: Element, baseRect: { left: number; top: number }, out: GlyphCenter[]): void {
        const Point: any = (container.ownerDocument?.defaultView as any)?.DOMPoint ?? (globalThis as any).DOMPoint;
        const marks = container.querySelectorAll<SVGElement | HTMLElement>(`.${MARK_CLASS}.${MARK_SELECTED_CLASS}`);
        // CONTAINER SUPPRESSION (a production D3 treemap, 2026-06-02):
        // hierarchical charts draw a parent backdrop rect (e.g. a channel
        // container with data-row-idx = ALL its children's rows) AND per-leaf
        // rects, both `.d3-mark`. Because a mark counts as selected when ANY of
        // its rows is selected, selecting ONE leaf also marks the enclosing
        // backdrop selected → a stray glyph drops at the backdrop's upper-right
        // corner, landing on a sibling tile (a glyph that reads as a store's but is
        // really its channel container's). A backdrop's children already carry the real
        // glyphs, so skip any selected mark whose bbox strictly ENCLOSES another
        // selected mark. Geometric (not row-count) test: only nested charts
        // (treemap/icicle) nest — flat charts (bars/cells/points) never do, so
        // this is a no-op there. O(n²); bounded to keep it cheap on big
        // selections (above the cap we accept the rare redundant container glyph).
        const rects: DOMRect[] = [];
        for (let i = 0; i < marks.length; i++) {
            const r = (marks[i] as Element).getBoundingClientRect();
            rects.push(r);
        }
        const CONTAINMENT_CAP = 300;
        const EPS = 1; // px tolerance for "inside"
        const filterContainers = marks.length <= CONTAINMENT_CAP;
        const enclosesAnother = (ci: number): boolean => {
            const c = rects[ci];
            const cArea = c.width * c.height;
            if (cArea <= 0) return false;
            for (let mj = 0; mj < rects.length; mj++) {
                if (mj === ci) continue;
                const m = rects[mj];
                const mArea = m.width * m.height;
                if (mArea <= 0 || mArea >= cArea) continue; // must be strictly smaller
                if (m.left >= c.left - EPS && m.right <= c.right + EPS &&
                    m.top >= c.top - EPS && m.bottom <= c.bottom + EPS) return true;
            }
            return false;
        };
        for (let i = 0; i < marks.length; i++) {
            const el = marks[i] as Element;
            const r = rects[i];
            if (r.width === 0 && r.height === 0) continue;
            if (filterContainers && enclosesAnother(i)) continue; // backdrop/container — skip
            const tag = el.tagName.toLowerCase();
            let sx: number | undefined;
            let sy: number | undefined;
            // EXPLICIT GLYPH ANCHOR (a geo choropleth, 2026-07-22): a mark may
            // declare data-cx/data-cy — its own glyph position in the element's local
            // (SVG user) coords — when its natural centre is a poor anchor. An AREA mark
            // like a country <path> has no point centre and its path-length midpoint
            // lands on the coastline; the choropleth archetype stamps the projected
            // centroid here so a selected pale country still gets a dot in its middle.
            // General (any mark can opt in); transformed to screen through the CTM.
            const cxA = el.getAttribute("data-cx"), cyA = el.getAttribute("data-cy");
            if (cxA != null && cyA != null && typeof (el as SVGGraphicsElement).getScreenCTM === "function") {
                const ctm = (el as SVGGraphicsElement).getScreenCTM();
                const cxN = parseFloat(cxA), cyN = parseFloat(cyA);
                if (ctm && isFinite(cxN) && isFinite(cyN)) {
                    const p = new Point(cxN, cyN).matrixTransform(ctm);
                    sx = p.x; sy = p.y;
                }
            }
            // PATH marks (chord ribbons, pie/donut arcs, sankey ribbons, lines):
            // the bounding-box CENTER is often NOT on the mark — a curved chord
            // ribbon's bbox center drifts toward the circle center, dropping a
            // dot in empty space (2026-05-31: a Shanghai→Tacoma ribbon's
            // dot "hovered in Hong Kong"). Place the glyph at the path's
            // geometric MIDPOINT instead (a point guaranteed ON the path),
            // transformed to screen space through the element's CTM.
            if (sx === undefined && tag === "path" && typeof (el as any).getPointAtLength === "function") {
                try {
                    const len = (el as any).getTotalLength();
                    const ctm = (el as SVGGraphicsElement).getScreenCTM();
                    if (len > 0 && ctm) {
                        // ARC-SECTOR paths (pie / donut / sunburst — emitted by
                        // d3.arc as `M A L A Z`: arc commands, NO Bézier) need the
                        // wedge CENTROID, not the path-length midpoint. For a typical
                        // narrow wedge len/2 lands on the straight RADIAL EDGE (the
                        // angular boundary), so the glyph reads as belonging to the
                        // neighbouring segment (a sunburst, 2026-06-06). Detect the
                        // sector by its command alphabet — has an arc (A/a) and NO
                        // Bézier (C/S/Q/T) — and place the glyph at the average of
                        // perimeter samples (the angular bisector at mid-radius,
                        // provably inside an annular sector). Ribbons (chord `Q`),
                        // links (sankey `C`) and lines/areas (`C`) FAIL this test and
                        // keep the len/2 midpoint that already works for them — so
                        // this cannot regress the chord/sankey placement (the
                        // "ribbon dot hovered in Hong Kong" fix stays).
                        const dAttr = el.getAttribute("d") || "";
                        const isArcSector = /[Aa]/.test(dAttr) && !/[CcSsQqTt]/.test(dAttr);
                        let local: DOMPoint | undefined;
                        if (isArcSector) {
                            const N = 24;
                            let ax = 0, ay = 0;
                            for (let k = 0; k < N; k++) {
                                const sp = (el as any).getPointAtLength((len * k) / N) as DOMPoint;
                                ax += sp.x; ay += sp.y;
                            }
                            const cand = new Point(ax / N, ay / N);
                            // Guard: only use the centroid if it actually lands inside
                            // the wedge fill. A FULL-ring donut slice (360°) centroids
                            // on the hole → isPointInFill false → fall back to midpoint.
                            let inside = true;
                            try {
                                if (typeof (el as any).isPointInFill === "function") {
                                    inside = (el as any).isPointInFill(cand);
                                }
                            } catch { inside = true; }
                            if (inside) local = cand;
                        }
                        if (!local) local = (el as any).getPointAtLength(len / 2) as DOMPoint;
                        const p = local.matrixTransform(ctm);
                        sx = p.x; sy = p.y;
                    }
                } catch { /* fall back to bbox below */ }
            }
            if (sx === undefined || sy === undefined) {
                // RECTANGULAR marks (bars, heatmap cells) carry a CENTER data
                // label, so put the glyph in the upper-right (inset) to clear it
                // — top-right of a rect is always INSIDE the mark. Other marks
                // (scatter <circle>) use the bbox center.
                const isRect = tag === "rect";
                sx = isRect ? r.left + r.width * 0.80 : r.left + r.width / 2;
                sy = isRect ? r.top + r.height * 0.20 : r.top + r.height / 2;
            }
            out.push({ x: sx - baseRect.left, y: sy - baseRect.top });
        }
}

/** The class every painted selection glyph carries. */
export const SELECTION_GLYPH_CLASS = "lch-sel-glyph";

/** Removes every glyph (every child) from the overlay. */
export function clearSelectionGlyphs(overlay: Element | null | undefined): void {
    if (overlay) {
        while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
    }
}

export interface SelectionGlyphStyle {
    /** The character drawn at each centre. */
    symbol: string;
    /** The glyph's colour. */
    color: string;
    /** The halo drawn on every side of it, so it reads on a dark and a light mark alike. */
    halo: string;
    /** At most this many are drawn. Default 600, which keeps the DOM light on a huge selection. */
    max?: number;
}

/**
 * Draws one glyph per centre (up to `max`) into `overlay`, positioned from the overlay's own
 * top-left corner and never hit-tested. Returns how many it drew. It does not clear the overlay
 * first: a host clears it (clearSelectionGlyphs) before deciding whether to paint at all.
 */
export function paintSelectionGlyphs(overlay: Element, centers: readonly GlyphCenter[], style: SelectionGlyphStyle): number {
    const doc = overlay.ownerDocument;
    const frag = doc.createDocumentFragment();
    const count = Math.min(centers.length, style.max ?? 600);
    for (let i = 0; i < count; i++) {
        const c = centers[i];
        const g = doc.createElement("span");
        g.className = SELECTION_GLYPH_CLASS;
        g.textContent = style.symbol;
        g.style.position = "absolute";
        g.style.left = c.x + "px";
        g.style.top = c.y + "px";
        g.style.transform = "translate(-50%, -50%)";
        g.style.font = "700 11px/1 system-ui, -apple-system, Segoe UI, sans-serif";
        g.style.color = style.color;
        const halo = style.halo;
        g.style.textShadow = `-1px -1px 1px ${halo}, 1px -1px 1px ${halo}, -1px 1px 1px ${halo}, 1px 1px 1px ${halo}, 0 0 2px ${halo}`;
        g.style.pointerEvents = "none";
        frag.appendChild(g);
    }
    overlay.appendChild(frag);
    return count;
}
