// The GENERIC half of the visual's D3 host-bridge click/hover mark resolution
// (chart-host Phase C — moved VERBATIM from the Power BI visual, comments included;
// the PBI half — selectionManager dispatch, panel-suppress flags, tooltips, glyphs —
// stays in the visual). Everything here is pure DOM computation over the contract's
// mark grammar (.d3-mark/.d3-legend-mark/.d3-axis-filter + data-row-idx); the only
// side channel is the injected diagnostic log callback, so both the visual and any
// other host (createChartHost, tests) resolve clicks identically.
//
// Each function carries the prod lesson that created it — do not simplify.

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

    const rowIdxsFromMark = (el: Element | null): number[] => {
        if (!el) return [];
        const raw = el.getAttribute("data-row-idx");
        if (!raw) return [];
        const out: number[] = [];
        for (const tok of raw.split(",")) {
            const n = parseInt(tok.trim(), 10);
            if (!isNaN(n) && n >= 0) out.push(n);
        }
        return out;
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
