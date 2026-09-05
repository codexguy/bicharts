/*
    DOES THE RENDERING FIT ITS FRAME, AND WHAT DO YOU DO WHEN IT DOES NOT - the pure geometry.

    MOVED HERE FROM THE POWER BI VISUAL (2026-09-03), unchanged in behaviour. It was written there
    as three separate modules, and every line of it turned out to be host-neutral: the outermost <svg> clips at its own viewport in every browser
    and every host, so a chart that sets `svg height = options.height` and draws a taller body
    loses the overflow outright - in an Excel task pane and a React page exactly as it did in the
    visual, where a paged 25-row chart lost 9 of its rows with no scrollbar anywhere to suggest
    they existed. Only the visual could measure that. Now every host can.

    What is NOT here, and deliberately: the viewBox RECONCILE and its legibility cap. That pass shrinks a chart to rescue a label hanging off an edge, and it is bound up with
    the visual's own reconcile pipeline. This module is the half that applies everywhere - decide
    whether ink is outside the frame, and grow the frame so it stops cutting.

    DOM-FREE ON PURPOSE. Everything here takes numbers and returns numbers, so it is testable
    without a browser and cannot drift into reading layout it was not handed. The DOM readers that
    feed it live in `fitDom.ts`.
*/

/*
    SLACK IS THE WHOLE DESIGN. Sub-pixel layout, a 1px stroke on the frame edge and browser
    rounding routinely put content a hair past the container. A scrollbar for two pixels of
    nothing is a defect, not a feature, so the overflow has to be big enough to be worth reaching.

    8px is a judgement, chosen because it is comfortably past rounding and stroke-width noise
    while being far below one legible row of anything.
*/
export const SCROLL_SLACK_PX = 8;

// True when content genuinely runs past the viewport and scrolling would reveal something.
// Non-finite or non-positive inputs answer false: an unmeasurable layout must degrade to
// today's clipping rather than to a scrollbar on an empty container.
export function needsScroll(contentPx: number, viewportPx: number, slackPx: number = SCROLL_SLACK_PX): boolean {
    if (!isFinite(contentPx) || !isFinite(viewportPx)) return false;
    if (contentPx <= 0 || viewportPx <= 0) return false;
    return contentPx - viewportPx > slackPx;
}

/*
    MEASURE THE CHART, NOT THE CHROME FLOATING OVER IT (2026-08-30). The invariant being defended
    is that a rendering always fits without scrolling, save for a short list of exceptions -
    a tabular chart without paging among them.

    `container.scrollHeight` answers "how far does anything inside me reach", and that is not the
    same question. A generated D3 chart routinely appends a hover tooltip as an
    ABSOLUTELY-POSITIONED div with `opacity: 0` and no `top`/`left` until the first hover - so
    before anyone hovers, the browser lays it out at its STATIC position, which is directly under
    the SVG. It is invisible, it is 14px tall (6px padding twice plus a 1px border twice), and it
    makes `scrollHeight` report 534 for a chart that drew exactly the 520 it was handed.

    Measured on a lollipop chart: the host handed the code 705x520, the code set
    `svg width=705 height=520 viewBox="0 0 705 520"` - a textbook fit - and the fit pass still saw
    `contentH: 534` and turned a scrollbar on, which then took ~20px of width off a chart that had
    needed none of it. Roughly 1% of several thousand generated charts, across 19 chart types, park a tooltip that
    way - so this is a RENDERER-level habit, not one chart's bug.

    THE RULE: an absolutely-positioned child of the container is chrome that FLOATS OVER the
    chart - a tooltip, an overlay, a badge. Scrolling to reveal it is never useful, because it
    follows the pointer to wherever the reader already is. Only in-flow children are content.

    THE ESCAPE HATCH IS THE LOAD-BEARING HALF: a chart that draws itself ENTIRELY into
    absolutely-positioned layers has no in-flow children at all, and dropping them would report an
    extent of zero and silently clip it. When nothing in-flow was measured, every box counts
    again - the same degrade-to-today's-behaviour instinct as `needsScroll`'s non-finite guard.
*/

// One measured child of the container, in container-content-box coordinates: how far it reaches
// right and down from the container's own content origin. `floating` is the computed position
// being absolute/fixed - decided by the caller, because only the DOM knows it and this module
// stays DOM-free.
export interface MeasuredBox {
    right: number;
    bottom: number;
    floating: boolean;
}

export interface ContentExtent {
    w: number;
    h: number;
    // Which boxes the answer came from - reported, so a surprising fit decision can be read back
    // rather than re-derived. "none" tells the caller to fall back to scrollWidth/scrollHeight.
    source: "in-flow" | "all-floating" | "none";
}

export function contentExtentOf(boxes: MeasuredBox[]): ContentExtent {
    if (!boxes || boxes.length === 0) return { w: 0, h: 0, source: "none" };

    const usable = boxes.filter(b =>
        b && isFinite(b.right) && isFinite(b.bottom) && (b.right > 0 || b.bottom > 0));
    if (usable.length === 0) return { w: 0, h: 0, source: "none" };

    const inFlow = usable.filter(b => !b.floating);
    const counted = inFlow.length > 0 ? inFlow : usable;

    let w = 0, h = 0;
    for (const b of counted) {
        if (b.right > w) w = b.right;
        if (b.bottom > h) h = b.bottom;
    }
    return { w, h, source: inFlow.length > 0 ? "in-flow" : "all-floating" };
}

// The pair of CSS overflow values for a rendered chart. Returned together rather than decided at
// two call sites, because "scrolls vertically" and "scrolls horizontally" are independent answers
// and mixing them up produces the worst outcome available: a horizontal scrollbar stealing the
// last rows of a chart that only needed vertical room.
export interface ScrollFit {
    overflowX: "hidden" | "auto";
    overflowY: "hidden" | "auto";
}

export function scrollFitFor(
    contentW: number, contentH: number,
    viewportW: number, viewportH: number,
    slackPx: number = SCROLL_SLACK_PX
): ScrollFit {
    return {
        overflowX: needsScroll(contentW, viewportW, slackPx) ? "auto" : "hidden",
        overflowY: needsScroll(contentH, viewportH, slackPx) ? "auto" : "hidden",
    };
}

/*
    WHAT COUNTS AS CONTENT, and it is ONE definition because two passes ask it.

    INFORMATION-CARRYING elements only: every <text> plus the contract-classed marks. NOT every
    shape - one generation drew a white annotation-backdrop rect with `width: options.width`
    hanging ~500 units off the right edge, and fitting to that invisible decoration would shrink
    the whole chart by ~25% to make room for nothing. Clipping unclassed decorative shapes is
    harmless; clipping labels and marks is the bug.
*/
export const FIT_CONTENT_SELECTOR = "text, .d3-mark, .d3-legend-mark";

/*
    A SINGLE element as large as the frame is phantom full-canvas furniture (a backdrop, or an
    oversized hit-rect emitted with `width: options.width`), NOT content to fit to. Growing to
    cover it balloons the frame and scales the whole chart down into a letterboxed sliver with a
    huge empty gutter. A marimekko whose `width: options.width` `.d3-legend-mark` hit-rect did
    exactly this, and which carries a contract class so it slips past the unclassed-shape
    filter above. No legitimate label, swatch or node is ~canvas-sized, so this
    only ever drops phantom furniture. Ratio-based, so it reads the same in user units or in px.
*/
export const PHANTOM_FRACTION = 0.95;
export function isPhantomBox(w: number, h: number, refW: number, refH: number): boolean {
    return w > refW * PHANTOM_FRACTION || h > refH * PHANTOM_FRACTION;
}

/*
    GROW THE FRAME TO THE INK, and the reason this exists at all is a mistake worth writing down:
    MEASURING the ink is not enough, because there is nothing to scroll TO.

    The outermost <svg> clips at its own viewport - the UA stylesheet sets `overflow: hidden` on
    every element that establishes a viewport, which the SVG spec mandates - so a chart that
    declares `height=290` and draws a 584-unit row body never PAINTS the rows past 290. Turning
    the container's overflow to `auto` reveals nothing: the element really is 290 tall, and the
    missing rows are not below the fold, they were never drawn. A paged chart lost 9 of the 25
    rows on its page exactly this way, with no scrollbar anywhere to suggest they existed.

    So the remedy is the frame, not the container. There are two ways to make hidden ink visible
    and they are not interchangeable:

      A. GROW THE viewBox        - same element, content scales DOWN, everything visible smaller.
                                   Right for a label hanging a few units off an edge. That is the
                                   visual's own viewBox reconcile, capped by legibility,
                                   and it is NOT in this package.
      B. GROW THE ELEMENT        - content stays at 1:1 and the CONTAINER scrolls.
                                   Right for a row body that is twice the frame, where scaling to
                                   fit would mean 7px type.

    Where A exists it runs first and takes what it can afford, so ink still outside afterwards is
    by definition ink that scaling could not rescue. Where it does not exist - every host but the
    visual - B is simply the whole remedy. Both dimensions move together: the element by
    `pxDelta`, the viewBox by `pxDelta / scale`, which holds the on-screen scale EXACTLY constant
    (when the scale is height-limited the two ratios cancel; when it is width-limited it was never
    the binding constraint). Nothing on screen moves or resizes; the frame simply stops cutting.

    VERTICAL ONLY. Horizontal overflow is a defect in every chart type including this family - a
    horizontal scrollbar steals the rows the reader came for - so a chart drawing past its right
    edge keeps being clipped and keeps being wrong.
*/

// A ceiling on the grow, against a chart that parks a stray mark far off-canvas: 20x the frame
// is ~1,800 rows at 22px on a 290px tile, past any legitimate row body and well short of the
// `y=9999` junk this guards against. It is a sanity bound, not a layout opinion - and when it
// bites the chart is clipped exactly as it is today.
export const MAX_FRAME_GROW_FACTOR = 20;

export interface FrameGrowPlan {
    grow: boolean;
    heightPx: number;    // the element height to set (== current when grow is false)
    viewBoxH: number;    // the viewBox height to set (== current when there is no viewBox)
    reason: string;
}

/**
 * @param inkBottomPx  how far the chart's ink reaches below the element's top, in px
 * @param elHeightPx   the element's current rendered height, in px
 * @param viewBoxH     the current viewBox height in user units, or 0 when there is no viewBox
 *                     (then user units ARE px and only the element moves)
 * @param ctmScale     px per user unit, from the live screen CTM
 */
export function planFrameGrow(
    inkBottomPx: number, elHeightPx: number, viewBoxH: number, ctmScale: number,
    slackPx: number = SCROLL_SLACK_PX, maxFactor: number = MAX_FRAME_GROW_FACTOR
): FrameGrowPlan {
    const none = (reason: string): FrameGrowPlan =>
        ({ grow: false, heightPx: elHeightPx, viewBoxH, reason });

    if (!isFinite(inkBottomPx) || !isFinite(elHeightPx) || elHeightPx <= 0) return none("unmeasurable");
    if (!needsScroll(inkBottomPx, elHeightPx, slackPx)) return none("fits");
    // A grow past the ceiling is not a tall chart, it is a chart with something parked in the
    // weeds. Clipping is the honest answer there, and it is the answer it already gets.
    if (inkBottomPx > elHeightPx * maxFactor) return none("beyond-ceiling");

    const heightPx = Math.ceil(inkBottomPx);
    const delta = heightPx - elHeightPx;
    // No viewBox means user units are px, so only the element moves. With one, both move and the
    // scale is preserved to the pixel.
    if (!(viewBoxH > 0)) return { grow: true, heightPx, viewBoxH, reason: "grow-no-viewbox" };
    if (!(ctmScale > 0) || !isFinite(ctmScale)) return none("no-scale");
    return { grow: true, heightPx, viewBoxH: viewBoxH + delta / ctmScale, reason: "grow" };
}

/*
    A SCROLLING ROW BODY TAKES ITS AXIS WITH IT (2026-09-04) - the pure half of the axis pin.

    The row-scrollable family (a schedule chart, a table with embedded marks) is told to size ONE
    <svg> to its content and let the host scroll it. That is correct for the rows - the row is the
    datum - and it silently costs the reader the one thing that makes a bar a date range rather than
    a coloured stripe: the time axis is drawn INSIDE that svg, so it scrolls away with the rows.
    Measured on three real 90-task schedule charts, each with its axis somewhere different (top,
    bottom, bottom): the axis was on screen for about 1-2% of the scroll range, one wheel notch at
    one end. Every schedule tool pins its timescale as a header for exactly this reason.

    The pin copies the horizontal axis into an overlay that sits at the viewport edge nearest the
    original WHILE THE ORIGINAL IS OUT OF VIEW, and hides itself when the original scrolls back in.
    That is the sticky-header contract: it never covers anything the reader could otherwise see at
    the same time as the axis, and there is never a second axis on screen. Everything here is
    numbers-in, numbers-out; the DOM half (which group is the axis, the clone, the overlay) is in
    `fitDom.ts`, and the split is the same one the frame grow uses.
*/

// A row needs at least this many labels to be an axis worth pinning. One label is a caption.
export const AXIS_PIN_MIN_LABELS = 2;
// Breathing room around the label row so descenders and the tick line are inside the band.
export const AXIS_PIN_BAND_PAD_PX = 2;
// A band taller than this fraction of the viewport is not a header row, it is the chart. A pin
// that ate 40% of a 250px tile would hide the rows it exists to label.
export const AXIS_PIN_MAX_BAND_FRACTION = 0.4;
// How far a thin track (the axis's domain line) may sit from the label row and still belong to
// the band. A d3 axis puts its domain 6-9px from the labels; a gridline 300px away is not a track.
export const AXIS_PIN_TRACK_REACH_PX = 12;

export interface LabelRowBox { left: number; top: number; right: number; bottom: number; }

/**
 * Does a row of label boxes run ACROSS the chart rather than DOWN it? A horizontal axis spreads
 * its label centres over x; a y-axis spreads them over y, and pinning a y-axis would pin the
 * ROWS - the exact thing the scroll exists to reveal. Ties are vertical: a single label has no
 * direction and is not an axis.
 */
export function isHorizontalLabelRow(boxes: LabelRowBox[]): boolean {
    if (!boxes || boxes.length < 2) return false;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const b of boxes) {
        const cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2;
        if (!isFinite(cx) || !isFinite(cy)) return false;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
    }
    return (maxX - minX) > (maxY - minY);
}

export interface AxisBand { top: number; bottom: number; }

/**
 * The vertical band a label row occupies, padded, widened to take in a thin track (the domain
 * line) that sits within reach of the labels. Tracks further away are ignored on purpose: a
 * gridline drawn as a full-height tick line is part of the plot, not of the header.
 */
export function labelBand(boxes: LabelRowBox[], tracks: LabelRowBox[] = [],
                          pad: number = AXIS_PIN_BAND_PAD_PX,
                          trackReach: number = AXIS_PIN_TRACK_REACH_PX): AxisBand | null {
    if (!boxes || boxes.length === 0) return null;
    let top = Infinity, bottom = -Infinity;
    for (const b of boxes) {
        if (!isFinite(b.top) || !isFinite(b.bottom)) continue;
        if (b.top < top) top = b.top;
        if (b.bottom > bottom) bottom = b.bottom;
    }
    if (!isFinite(top) || !isFinite(bottom) || bottom <= top) return null;
    for (const t of tracks || []) {
        if (!isFinite(t.top) || !isFinite(t.bottom)) continue;
        const gap = t.bottom < top ? top - t.bottom : t.top > bottom ? t.top - bottom : 0;
        if (gap > trackReach) continue;
        if (t.top < top) top = t.top;
        if (t.bottom > bottom) bottom = t.bottom;
    }
    return { top: top - pad, bottom: bottom + pad };
}

export interface AxisPinCandidate {
    /** The caller's handle for this axis - returned in the plan. */
    index: number;
    /** One box per VISIBLE tick label, in any one consistent coordinate space. */
    labels: LabelRowBox[];
    /** Thin tracks that may belong to the band (a horizontal domain line). Optional. */
    tracks?: LabelRowBox[];
}

export interface AxisPinPlan {
    pin: boolean;
    index: number;
    band: AxisBand | null;
    reason: string;
}

/**
 * Which axis to pin, and the band it occupies. Coordinates are whatever the caller measured in;
 * the plan only compares them, and `viewportH` (same units) bounds the band. With two horizontal
 * axes the one with more labels wins - it is the one carrying the scale.
 */
export function planAxisPin(candidates: AxisPinCandidate[], viewportH: number,
                            minLabels: number = AXIS_PIN_MIN_LABELS,
                            maxFraction: number = AXIS_PIN_MAX_BAND_FRACTION): AxisPinPlan {
    const none = (reason: string): AxisPinPlan => ({ pin: false, index: -1, band: null, reason });
    if (!isFinite(viewportH) || viewportH <= 0) return none("unmeasurable");
    let sawAxis = false, best: AxisPinCandidate | null = null;
    for (const c of candidates || []) {
        if (!c || !c.labels || c.labels.length < minLabels) continue;
        sawAxis = true;
        if (!isHorizontalLabelRow(c.labels)) continue;
        if (!best || c.labels.length > best.labels.length) best = c;
    }
    if (!best) return none(sawAxis ? "vertical-only" : "no-axis");
    const band = labelBand(best.labels, best.tracks || []);
    if (!band) return none("unmeasurable");
    if ((band.bottom - band.top) > viewportH * maxFraction) return none("band-too-tall");
    return { pin: true, index: best.index, band, reason: "pinned" };
}

export type AxisPinEdge = "top" | "bottom";

/**
 * Where the pinned copy sits for this scroll position, or null when the original axis is in view
 * and the copy must get out of the way. `band` is in CONTENT coordinates (the scroll origin), the
 * viewport is [scrollTop, scrollTop + viewportH]. The copy appears as soon as the original is CUT
 * by an edge, not only once it has fully left: a half-visible label row reads worse than a whole
 * one drawn over it.
 */
export function axisPinPlacement(band: AxisBand, scrollTop: number, viewportH: number): AxisPinEdge | null {
    if (!band || !isFinite(band.top) || !isFinite(band.bottom)) return null;
    if (!isFinite(scrollTop) || !isFinite(viewportH) || viewportH <= 0) return null;
    if (band.top < scrollTop) return "top";
    if (band.bottom > scrollTop + viewportH) return "bottom";
    return null;
}
