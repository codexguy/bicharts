/*
    READING A RENDERED CHART'S GEOMETRY OFF THE DOM, and then making the frame stop cutting.

    MOVED HERE FROM THE POWER BI VISUAL (2026-09-03). The pure geometry is in `fit.ts`; this is
    the thin DOM layer that feeds it, plus `fitRenderedChart` - the one call a host makes after a
    render to get the visual's behaviour.

    WHY EVERY HOST NEEDS IT, stated once: an <svg> element clips at its own frame. A chart that
    sets `svg height = options.height` and then draws a taller body reports a box that FITS while
    the rows past the fold are not cramped, they are simply never painted. The container's
    `scrollHeight` agrees that everything fits, so no scrollbar appears, and the missing content is
    unreachable by any means the reader has. That is browser behaviour, not Power BI behaviour, so
    before this module the Excel add-in and the React demo both silently lost it.

    NOTHING HERE THROWS. A fit pass runs after a render that already succeeded; it must never be
    the reason a delivered chart fails. Every reader degrades to "today's behaviour" - which is
    clipping - rather than to a guess.
*/
import {
    contentExtentOf, needsScroll, planFrameGrow, scrollFitFor,
    FIT_CONTENT_SELECTOR, isPhantomBox, SCROLL_SLACK_PX,
    planAxisPin, axisPinPlacement,
} from "./fit";
import type { ContentExtent, MeasuredBox, AxisPinCandidate, AxisPinEdge, LabelRowBox } from "./fit";

// How many elements the ink walk will measure before giving up. Layout-flushing calls in a loop,
// so it is a real ceiling and not a formality.
const FIT_WALK_CAP = 8000;

// The uniform scale of a user-to-screen matrix. Rotation-safe (charts do rotate axis labels),
// which a bare `.a` is not.
export function ctmScaleOf(m: { a: number; b: number } | null | undefined): number {
    if (!m) return 0;
    const s = Math.hypot(m.a, m.b);
    return isFinite(s) && s > 0 ? s : 0;
}

/*
    HOW FAR THE CHART'S INK REACHES, in the SVG element's own client coordinates.

    The scroll fit measures the container's in-flow children, which for a D3 chart means the <svg>
    ELEMENT box - and a chart that sizes its SVG to the frame while drawing a row body twice that
    tall therefore reports "fits" while silently slicing rows off the bottom - a 25-row page in a
    290px SVG, 9 rows gone, no scrollbar, because the element was exactly 290 tall. The
    ink is the honest answer.

    Returns the reach RELATIVE TO the element's own top-left, so the caller can compare it against
    the element box without knowing anything about SVG coordinates. Null when there is nothing
    measurable - today's behaviour, not a scrollbar on a guess.
*/
export function svgInkReach(svg: SVGSVGElement): { right: number; bottom: number } | null {
    try {
        const box = svg.getBoundingClientRect();
        if (!(box.width > 0) || !(box.height > 0)) return null;
        const els = svg.querySelectorAll<SVGGraphicsElement>(FIT_CONTENT_SELECTOR);
        let right = -Infinity, bottom = -Infinity, seen = 0;
        for (let i = 0; i < els.length && seen < FIT_WALK_CAP; i++) {
            const r = els[i].getBoundingClientRect();
            if (r.width <= 0 && r.height <= 0) continue;
            if (isPhantomBox(r.width, r.height, box.width, box.height)) continue;
            seen++;
            if (r.right > right) right = r.right;
            if (r.bottom > bottom) bottom = r.bottom;
        }
        if (seen === 0) return null;
        return { right: right - box.left, bottom: bottom - box.top };
    } catch {
        return null;
    }
}

/*
    A CHILD'S OWN BOX IS NOT ALWAYS HOW FAR IT DRAWS.

    A caller that knows how to read an element's INK may pass a reader, and the box grows to
    whichever is further. Optional, because a host that only wants the READING (how often does a
    chart overrun its box) must be able to take the measurement without the ink walk changing what
    the series measures.
*/
export type InkReach = (el: Element) => { right: number; bottom: number } | null;

/*
    Every child of the container in container-content-box coordinates, tagged with whether it
    FLOATS (absolute/fixed).

    `display:none` children are skipped: a hidden element occupies no space and counting it would
    re-introduce the very defect the extent walk exists to avoid, one hiding mechanism over. An
    element whose style cannot be read counts as content, which is the cautious side - it can only
    ever report MORE overflow, never less.
*/
export function measureContainerBoxes(c: HTMLElement, inkOf?: InkReach): MeasuredBox[] {
    const boxes: MeasuredBox[] = [];
    if (!c || !c.children) return boxes;
    // The container's own window, so this works in an iframe, a task pane and jsdom alike rather
    // than reaching for a global that may belong to a different document.
    const view: any = (c.ownerDocument && (c.ownerDocument as any).defaultView) || (globalThis as any);
    const cRect = c.getBoundingClientRect();
    for (let i = 0; i < c.children.length; i++) {
        const el = c.children[i] as HTMLElement;
        let floating = false;
        try {
            const cs = view.getComputedStyle(el);
            if (cs.display === "none") continue;
            floating = cs.position === "absolute" || cs.position === "fixed";
        } catch {
            // Unstyleable (detached, or a host that will not answer): count it as content.
        }
        const r = el.getBoundingClientRect();
        let right = (r.right - cRect.left - c.clientLeft) + c.scrollLeft;
        let bottom = (r.bottom - cRect.top - c.clientTop) + c.scrollTop;
        if (inkOf) {
            try {
                const ink = inkOf(el);
                if (ink) {
                    // The reach is relative to the element's own top-left, so it is anchored to
                    // the element's ORIGIN inside the container, not to its far edge.
                    const originX = (r.left - cRect.left - c.clientLeft) + c.scrollLeft;
                    const originY = (r.top - cRect.top - c.clientTop) + c.scrollTop;
                    if (isFinite(ink.right)) right = Math.max(right, originX + ink.right);
                    if (isFinite(ink.bottom)) bottom = Math.max(bottom, originY + ink.bottom);
                }
            } catch {
                // An ink reader that throws leaves the element box standing - today's answer.
            }
        }
        boxes.push({ right, bottom, floating });
    }
    return boxes;
}

export interface FitReading {
    lane: string;
    contentW: number;
    contentH: number;
    viewW: number;
    viewH: number;
    overflowsX: boolean;
    overflowsY: boolean;
    extentSource: ContentExtent["source"];
    boxes: number;
    floating: number;
    scrollW: number;
    scrollH: number;
}

/*
    The reading for one container, or null when there is nothing to measure.

    NULL RATHER THAN ZEROS for a container that is not displayed: a host that keeps several lane
    containers in the DOM and hides all but one would otherwise get a confident "0x0 fits
    perfectly" from every hidden lane on every render - false reassurances in the log built to
    answer whether charts fit.
*/
export function fitReadingFor(lane: string, c: HTMLElement | null | undefined,
                              slackPx: number = SCROLL_SLACK_PX,
                              inkOf?: InkReach): FitReading | null {
    if (!c) return null;
    const viewW = c.clientWidth, viewH = c.clientHeight;
    if (!(viewW > 0) || !(viewH > 0)) return null;

    const boxes = measureContainerBoxes(c, inkOf);
    const extent = contentExtentOf(boxes);
    // scrollWidth/Height stay the fallback for a container whose children cannot be measured at
    // all - the same degrade the fit pass makes, for the same reason.
    const contentW = extent.source === "none" ? c.scrollWidth : extent.w;
    const contentH = extent.source === "none" ? c.scrollHeight : extent.h;
    // NO READING RATHER THAN A NaN ONE. A container whose children cannot be walked AND whose
    // scroll dimensions do not answer has told us nothing; emitting "fits" from it would put a
    // false reassurance in the log on the strength of a failed measurement.
    if (!isFinite(contentW) || !isFinite(contentH)) return null;

    return {
        lane,
        contentW: Math.round(contentW),
        contentH: Math.round(contentH),
        viewW,
        viewH,
        overflowsX: needsScroll(contentW, viewW, slackPx),
        overflowsY: needsScroll(contentH, viewH, slackPx),
        extentSource: extent.source,
        boxes: boxes.length,
        floating: boxes.filter(b => b.floating).length,
        scrollW: c.scrollWidth,
        scrollH: c.scrollHeight,
    };
}

export interface FitRenderedChartOptions {
    /** Name for this container in the returned reading. Purely descriptive. */
    lane?: string;
    /** How far content must exceed the viewport before it counts. Defaults to SCROLL_SLACK_PX. */
    slackPx?: number;
    /**
     * Grow the chart's <svg> to whatever it actually drew, so the container has something to
     * scroll TO. Default true - it is the half of this pass that recovers content that is
     * otherwise unreachable. Set false to take the READING without touching the chart.
     */
    grow?: boolean;
    /**
     * Set `overflowX` / `overflowY` on the container. Default true. Set false when the host owns
     * its own scrolling and only wants to be told.
     */
    applyOverflow?: boolean;
    /**
     * When the container scrolls vertically, keep the chart's horizontal axis in view by pinning
     * a copy of it at the viewport edge while the original is scrolled out. Default true. The
     * copy hides itself whenever the original is on screen, so there is never a second axis.
     * Set false for a host that draws its own sticky header.
     */
    pinAxis?: boolean;
}

export interface FitRenderedChartResult {
    /** The frame was grown, so content that was being clipped is now painted. */
    grew: boolean;
    growFrom: number;
    growTo: number;
    growReason: string;
    /** What the container's overflow was set to (or would have been). */
    overflowX: "hidden" | "auto";
    overflowY: "hidden" | "auto";
    /** The post-grow reading, or null when nothing could be measured. */
    reading: FitReading | null;
    /** The axis pin: what was pinned when the container scrolls, or why nothing was. */
    axisPin: AxisPinReport;
}

export interface AxisPinReport {
    pinned: boolean;
    /** "pinned", or the fail-open reason: not-scrolling, disabled, no-svg, no-ctm, no-axis,
     *  vertical-only, band-too-tall, unmeasurable, overflow-not-applied, threw. */
    reason: string;
    /** The pinned band's height on screen, px. */
    bandPx: number;
    /** Where the ORIGINAL axis sits in the chart body: top third, bottom third, or between. */
    axisAt: "top" | "bottom" | "middle" | "";
    /** Visible tick labels in the copy. */
    labels: number;
    /** Furniture texts that shared the band and came along (a "Today" caption, an axis title). */
    carried: number;
    /** Where the copy sat at the moment of the pass - null when the original was in view. */
    edge: AxisPinEdge | null;
}

const noPin = (reason: string): AxisPinReport =>
    ({ pinned: false, reason, bandPx: 0, axisAt: "", labels: 0, carried: 0, edge: null });

// Parked on the CONTAINER, which every host reuses across renders, so the previous render's pin
// (its overlay and its scroll listener) can be found and torn down before the next one decides.
const CONTAINER_SLOT_AXIS_PIN = "__bicAxisPin";
const SVG_NS = "http://www.w3.org/2000/svg";
// The most furniture texts the copy will carry beside the axis. A caption and a title are the
// case; a whole row of something is a sign the band was misjudged, and the axis alone is safe.
const AXIS_PIN_MAX_CARRIED = 12;

interface AxisPinState { overlay: HTMLElement; onScroll: () => void; }

/** Remove a previous render's pinned axis - its overlay and its scroll listener. Safe to call
 *  when there is none. Hosts that clear the container themselves still need this for the
 *  listener, which outlives the overlay. */
export function unpinScrolledAxis(container: HTMLElement | null | undefined): void {
    if (!container) return;
    const st = (container as any)[CONTAINER_SLOT_AXIS_PIN] as AxisPinState | undefined;
    if (!st) return;
    try { container.removeEventListener("scroll", st.onScroll); } catch { /* already gone */ }
    try { if (st.overlay.parentNode) st.overlay.parentNode.removeChild(st.overlay); } catch { /* already gone */ }
    try { delete (container as any)[CONTAINER_SLOT_AXIS_PIN]; } catch { /* non-configurable host */ }
}

// A display:none / visibility:hidden text is not a label the reader sees, and the axis-thinning
// pass hides labels by attribute, so both routes count.
function textHidden(t: Element, view: any): boolean {
    if (t.getAttribute("display") === "none" || t.getAttribute("visibility") === "hidden") return true;
    try {
        const cs = view.getComputedStyle(t);
        if (cs && (cs.display === "none" || cs.visibility === "hidden")) return true;
    } catch { /* unstyleable: visible */ }
    return false;
}

/*
    THE BACKDROP THE COPY SITS ON. The overlay has to be opaque or the rows scroll through the
    labels. The chart's own full-canvas backdrop rect is the best answer - it is the colour the
    chart chose for its theme; failing that, the first painted background up the container's
    ancestry; failing that, white.
*/
function backdropFill(svg: SVGSVGElement, container: HTMLElement, view: any, svgBox: DOMRect): string {
    try {
        const rects = svg.querySelectorAll("rect");
        for (let i = 0; i < rects.length && i < 6; i++) {
            const r = rects[i];
            if (r.closest(".d3-mark")) continue;
            const b = r.getBoundingClientRect();
            if (b.width >= svgBox.width * 0.9 && b.height >= svgBox.height * 0.9) {
                let fill = "";
                try { fill = view.getComputedStyle(r).fill || ""; } catch { /* attribute below */ }
                if (!fill || fill === "none") fill = r.getAttribute("fill") || "";
                if (fill && fill !== "none" && fill !== "transparent") return fill;
                break;
            }
        }
    } catch { /* fall through to the container */ }
    try {
        let el: Element | null = container;
        for (let hops = 0; el && hops < 12; hops++, el = el.parentElement) {
            const bg = view.getComputedStyle(el).backgroundColor;
            if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") return bg;
        }
    } catch { /* white */ }
    return "#ffffff";
}

// Clone `el` into `root`, reproducing its ancestor chain up to (excluding) `svg` as SHALLOW
// clones, so every transform, class and font attribute on the way down still applies and the copy
// lands at exactly the original's coordinates. Ids are stripped: two elements with one id in one
// document is what breaks url(#...) references, and the copy is never referenced.
function cloneWithChain(el: Element, svg: SVGSVGElement, root: Element): void {
    const chain: Element[] = [];
    let n: Element | null = el.parentElement;
    while (n && n !== svg) { chain.unshift(n); n = n.parentElement; }
    let parent: Element = root;
    for (const anc of chain) {
        const c = anc.cloneNode(false) as Element;
        parent.appendChild(c);
        parent = c;
    }
    parent.appendChild(el.cloneNode(true));
    const ids = root.querySelectorAll("[id]");
    for (let i = 0; i < ids.length; i++) ids[i].removeAttribute("id");
}

/*
    PIN THE HORIZONTAL AXIS OF A SCROLLING CHART - the DOM half. See `fit.ts` for why.

    Runs after the container has been given `overflowY: auto`. Finds the horizontal d3 axis (one
    axis == one parent of `.tick` groups; d3's own structure, never a heuristic), measures its
    label row, and builds an absolutely-positioned overlay AFTER the chart's <svg> holding a copy
    of that axis plus any furniture text that shares its band (a "Today" caption, an axis title).
    The overlay's <svg> uses the chart's live screen CTM to show exactly the band's slice of the
    chart's user space at 1:1, so the copy is pixel-identical to the original. A scroll listener
    places the overlay at the viewport edge nearest the original while the original is out of
    view, and hides it otherwise. The original is never touched.

    Absolute on purpose: the fit measurement already classifies absolutely-positioned children as
    floating chrome, so the overlay can never be mistaken for content on the next pass; and it
    comes AFTER the chart's <svg> because both fit passes take the first <svg> as the chart.

    NOTHING HERE THROWS. Every doubt degrades to no pin, which is today's behaviour.
*/
export function pinScrolledAxis(container: HTMLElement | null | undefined,
                                svg: SVGSVGElement | null | undefined): AxisPinReport {
    unpinScrolledAxis(container);
    if (!container) return noPin("no-container");
    if (!svg) return noPin("no-svg");
    try {
        const doc = svg.ownerDocument;
        const view: any = (doc && (doc as any).defaultView) || (globalThis as any);
        const svgBox = svg.getBoundingClientRect();
        if (!(svgBox.width > 0) || !(svgBox.height > 0)) return noPin("unmeasurable");
        const m = typeof svg.getScreenCTM === "function" ? svg.getScreenCTM() : null;
        if (!m || !(m.a > 0) || !(m.d > 0) || !isFinite(m.e) || !isFinite(m.f)) return noPin("no-ctm");
        const viewportH = container.clientHeight;
        if (!(viewportH > 0)) return noPin("unmeasurable");

        // Boxes relative to the svg's own top-left, in px.
        const rel = (r: DOMRect): LabelRowBox =>
            ({ left: r.left - svgBox.left, top: r.top - svgBox.top, right: r.right - svgBox.left, bottom: r.bottom - svgBox.top });

        // ONE AXIS == ONE PARENT OF .tick GROUPS. Only this root's ticks: a table that draws one
        // mini-svg per row must not pool every row's axis into one.
        const ticks = svg.querySelectorAll(".tick");
        const byAxis = new Map<Element, Element[]>();
        for (let i = 0; i < ticks.length; i++) {
            const t = ticks[i];
            if (t.closest("svg") !== svg) continue;
            const p = t.parentElement;
            if (!p) continue;
            const list = byAxis.get(p);
            if (list) list.push(t); else byAxis.set(p, [t]);
        }
        const axes: Element[] = [];
        const cands: AxisPinCandidate[] = [];
        byAxis.forEach((group, axis) => {
            const labels: LabelRowBox[] = [];
            for (const tick of group) {
                const txt = tick.querySelector("text");
                if (!txt || textHidden(txt, view)) continue;
                const r = txt.getBoundingClientRect();
                if (!(r.width > 0) || !(r.height > 0)) continue;
                labels.push(rel(r));
            }
            const tracks: LabelRowBox[] = [];
            for (let i = 0; i < axis.children.length; i++) {
                const ch = axis.children[i];
                if (ch.tagName.toLowerCase() !== "path" || !(ch.getAttribute("class") || "").split(/\s+/).includes("domain")) continue;
                const r = ch.getBoundingClientRect();
                // A thin, wide box is a horizontal domain line; anything taller is a y-axis's.
                if (r.width > 0 && r.height <= 4) tracks.push(rel(r));
            }
            cands.push({ index: axes.length, labels, tracks });
            axes.push(axis);
        });

        const plan = planAxisPin(cands, viewportH);
        if (!plan.pin || !plan.band) return noPin(plan.reason);
        const axis = axes[plan.index];
        // CLAMPED TO THE SVG'S OWN BOX. A rotated label row routinely descends a few px past the
        // frame the chart declared, and the svg clips it there - so that part of the band is never
        // on screen in the original, and a band that reaches past the frame can never "fit the
        // viewport", which kept the copy up at the very end of the scroll, over an original that
        // was already showing. The copy shows what the original shows, no more.
        const band = { top: Math.max(0, plan.band.top), bottom: Math.min(svgBox.height, plan.band.bottom) };
        const bandPx = band.bottom - band.top;
        if (!(bandPx > 0)) return noPin("unmeasurable");

        // FURNITURE THAT SHARES THE BAND comes along: a "Today" caption over a today rule, an
        // axis title. Never a tick's own text (that is the axis), never a mark's label.
        const carried: Element[] = [];
        const texts = svg.querySelectorAll("text");
        for (let i = 0; i < texts.length && carried.length < AXIS_PIN_MAX_CARRIED; i++) {
            const t = texts[i];
            if (t.closest("svg") !== svg) continue;
            if (t.closest(".tick") || t.closest(".d3-mark") || t.closest(".d3-legend-mark")) continue;
            if (axis.contains(t) || textHidden(t, view)) continue;
            const r = rel(t.getBoundingClientRect());
            if (!(r.right > r.left) || !(r.bottom > r.top)) continue;
            if (r.top >= band.top && r.bottom <= band.bottom) carried.push(t);
        }

        // THE COPY. A fresh <svg> showing the band's slice of the chart's user space at 1:1:
        // the viewBox is the band converted through the live CTM, the element is the band's
        // on-screen size, and preserveAspectRatio "none" makes the mapping exact by construction.
        const pinSvg = doc.createElementNS(SVG_NS, "svg") as SVGSVGElement;
        for (const a of ["font-family", "font-size", "font-weight", "font", "fill", "color", "text-rendering"]) {
            const v = svg.getAttribute(a);
            if (v) pinSvg.setAttribute(a, v);
        }
        const styles = svg.querySelectorAll("style");
        for (let i = 0; i < styles.length; i++) pinSvg.appendChild(styles[i].cloneNode(true));
        const vbX = (svgBox.left - m.e) / m.a, vbY = (svgBox.top + band.top - m.f) / m.d;
        const vbW = svgBox.width / m.a, vbH = bandPx / m.d;
        pinSvg.setAttribute("viewBox", `${vbX} ${vbY} ${vbW} ${vbH}`);
        pinSvg.setAttribute("preserveAspectRatio", "none");
        pinSvg.setAttribute("width", String(svgBox.width));
        pinSvg.setAttribute("height", String(bandPx));
        pinSvg.setAttribute("aria-hidden", "true");
        pinSvg.style.display = "block";
        pinSvg.style.pointerEvents = "none";
        const back = doc.createElementNS(SVG_NS, "rect");
        back.setAttribute("x", String(vbX)); back.setAttribute("y", String(vbY));
        back.setAttribute("width", String(vbW)); back.setAttribute("height", String(vbH));
        back.setAttribute("fill", backdropFill(svg, container, view, svgBox));
        pinSvg.appendChild(back);
        cloneWithChain(axis, svg, pinSvg);
        for (const t of carried) cloneWithChain(t, svg, pinSvg);

        const overlay = doc.createElement("div");
        overlay.setAttribute("data-bic-axis-pin", "1");
        const o = overlay.style;
        o.position = "absolute"; o.margin = "0"; o.padding = "0"; o.border = "0";
        o.width = `${svgBox.width}px`; o.height = `${bandPx}px`;
        o.overflow = "hidden"; o.pointerEvents = "none"; o.zIndex = "3"; o.display = "none";
        overlay.appendChild(pinSvg);

        // The overlay positions against the container, which has to be a containing block.
        // Static -> relative changes nothing else about a block container's layout.
        try {
            const cs = view.getComputedStyle(container);
            const pos = (cs && cs.position) || container.style.position;
            if (!pos || pos === "static") container.style.position = "relative";
        } catch { container.style.position = container.style.position || "relative"; }

        // The band in CONTENT coordinates (the scroll origin), so placement is a pure comparison
        // against scrollTop. Absolute children of a scroll container scroll WITH the content, so
        // the overlay's `top` is re-set to the viewport edge on every scroll.
        const cRect = container.getBoundingClientRect();
        const svgLeft = (svgBox.left - cRect.left - container.clientLeft) + container.scrollLeft;
        const svgTop = (svgBox.top - cRect.top - container.clientTop) + container.scrollTop;
        const contentBand = { top: svgTop + band.top, bottom: svgTop + band.bottom };
        const place = (): AxisPinEdge | null => {
            const st = container.scrollTop, vh = container.clientHeight;
            const edge = axisPinPlacement(contentBand, st, vh);
            if (!edge) { o.display = "none"; return null; }
            o.display = "block";
            o.left = `${svgLeft}px`;
            o.top = `${edge === "top" ? st : st + vh - bandPx}px`;
            return edge;
        };
        const onScroll = () => {
            try {
                if (!overlay.isConnected) { unpinScrolledAxis(container); return; }
                place();
            } catch { /* a scroll handler must never throw into the host */ }
        };
        container.appendChild(overlay);
        container.addEventListener("scroll", onScroll, { passive: true } as any);
        (container as any)[CONTAINER_SLOT_AXIS_PIN] = { overlay, onScroll } as AxisPinState;
        const edge = place();

        const mid = (band.top + band.bottom) / 2 / svgBox.height;
        return {
            pinned: true, reason: "pinned",
            bandPx: Math.round(bandPx),
            axisAt: mid < 1 / 3 ? "top" : mid > 2 / 3 ? "bottom" : "middle",
            labels: cands[plan.index].labels.length,
            carried: carried.length,
            edge,
        };
    } catch {
        unpinScrolledAxis(container);
        return noPin("threw");
    }
}

/*
    THE ONE CALL A HOST MAKES AFTER A RENDER.

    Order matters and is the whole design: grow the frame FIRST, then measure, then set overflow.
    Turning the container's overflow to `auto` before the frame grows scrolls to nothing - the
    element really is only as tall as it says, and the missing rows were never painted. Growing
    first is what makes the scrollbar mean something.

    ONE INK WALK, TWO CONSUMERS. Reading the ink costs a getBoundingClientRect per text and mark,
    so the grow and the extent walk share one result rather than each taking a pass over a chart
    that can carry thousands of marks. Reusing the PRE-grow ink is exact: growing the frame moves
    no content, and once grown the element box covers the ink anyway.

    VERTICAL GROW ONLY - see `planFrameGrow`. The horizontal answer is still reported, because a
    chart drawing past its right edge is worth knowing about even though the remedy is not a
    scrollbar.
*/
export function fitRenderedChart(
    container: HTMLElement | null | undefined,
    opts: FitRenderedChartOptions = {}
): FitRenderedChartResult {
    const slackPx = opts.slackPx ?? SCROLL_SLACK_PX;
    const result: FitRenderedChartResult = {
        grew: false, growFrom: 0, growTo: 0, growReason: "no-container",
        overflowX: "hidden", overflowY: "hidden", reading: null, axisPin: noPin("no-container"),
    };
    if (!container) return result;

    try {
        // The chart's own frame: an <svg> among the container's children. Charts that draw into a
        // wrapper div are handled by the descendant lookup, and a host whose container holds
        // several is served by the first - the generated contract is one chart per container.
        let svg: SVGSVGElement | null = null;
        for (let i = 0; i < container.children.length && !svg; i++) {
            const el = container.children[i] as Element;
            if (el.tagName && el.tagName.toLowerCase() === "svg") svg = el as unknown as SVGSVGElement;
        }
        if (!svg) svg = container.querySelector("svg");

        let inkCache: { right: number; bottom: number } | null | undefined;
        const svgInk = (el: SVGSVGElement) => {
            if (inkCache === undefined) inkCache = svgInkReach(el);
            return inkCache;
        };
        const inkOf: InkReach = el =>
            el && el.tagName && el.tagName.toLowerCase() === "svg"
                ? svgInk(el as unknown as SVGSVGElement)
                : null;

        if (svg && opts.grow !== false) {
            try {
                const ink = svgInk(svg);
                const elH = svg.getBoundingClientRect().height;
                const vb = svg.viewBox && svg.viewBox.baseVal ? svg.viewBox.baseVal.height : 0;
                const ctm = typeof svg.getScreenCTM === "function" ? svg.getScreenCTM() : null;
                const plan = planFrameGrow(
                    ink ? ink.bottom : NaN, elH, vb, ctmScaleOf(ctm), slackPx);
                result.growFrom = Math.round(elH);
                result.growTo = plan.heightPx;
                result.growReason = plan.reason;
                if (plan.grow) {
                    svg.setAttribute("height", String(plan.heightPx));
                    if (vb > 0) {
                        const b = svg.viewBox.baseVal;
                        svg.setAttribute("viewBox", `${b.x} ${b.y} ${b.width} ${plan.viewBoxH}`);
                    }
                    result.grew = true;
                }
            } catch {
                // A frame that will not measure keeps today's clipping.
                result.growReason = "grow-threw";
            }
        } else if (!svg) {
            result.growReason = "no-svg";
        } else {
            result.growReason = "grow-disabled";
        }

        const reading = fitReadingFor(opts.lane ?? "chart", container, slackPx, inkOf);
        result.reading = reading;

        const boxes = measureContainerBoxes(container, inkOf);
        const extent = contentExtentOf(boxes);
        const svgBox = svg ? svg.getBoundingClientRect() : null;
        // scrollWidth/Height remain the fallback for a container whose children cannot be measured
        // at all - an unmeasurable layout keeps exactly the behaviour it has today.
        const contentW = extent.source === "none"
            ? Math.max(container.scrollWidth, svgBox ? svgBox.width : 0) : extent.w;
        const contentH = extent.source === "none"
            ? Math.max(container.scrollHeight, svgBox ? svgBox.height : 0) : extent.h;
        const fit = scrollFitFor(contentW, contentH, container.clientWidth, container.clientHeight, slackPx);
        result.overflowX = fit.overflowX;
        result.overflowY = fit.overflowY;
        if (opts.applyOverflow !== false) {
            container.style.overflowX = fit.overflowX;
            container.style.overflowY = fit.overflowY;
            // AND THE AXIS STAYS WHILE THE ROWS SCROLL. Only once the container actually
            // scrolls, and LAST: the copy is taken from the axis as it finally stands.
            if (fit.overflowY !== "auto") { unpinScrolledAxis(container); result.axisPin = noPin("not-scrolling"); }
            else if (opts.pinAxis === false) { unpinScrolledAxis(container); result.axisPin = noPin("disabled"); }
            else result.axisPin = pinScrolledAxis(container, svg);
        } else {
            unpinScrolledAxis(container);
            result.axisPin = noPin("overflow-not-applied");
        }
    } catch {
        // A fit pass must never break a render that already succeeded.
    }
    return result;
}
