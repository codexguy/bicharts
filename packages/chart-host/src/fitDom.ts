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
} from "./fit";
import type { ContentExtent, MeasuredBox } from "./fit";

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
        overflowX: "hidden", overflowY: "hidden", reading: null,
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
        }
    } catch {
        // A fit pass must never break a render that already succeeded.
    }
    return result;
}
