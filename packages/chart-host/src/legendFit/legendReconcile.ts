/**
 * D3 legend / plot reconciliation — pure geometry.
 *
 * The measured sibling of the label-contrast pass. A generated D3 chart
 * can draw its legend ON TOP of plot content, or with its text running off the
 * right edge, because legend WIDTH is data-dependent — the generator can't reserve
 * the right gutter at author time without measuring rendered text, which only
 * exists after render. So we measure post-render and fix it.
 *
 * Coordinates: EVERYTHING here is in the SVG's USER space (== viewBox units).
 * The caller maps the measured client-px bounding boxes into user space via
 * svg.getScreenCTM().inverse() before calling — that one matrix captures the
 * viewBox, preserveAspectRatio and any container scaling/letterboxing exactly,
 * so this module needs no px↔unit scale factor.
 *
 * The fix is TWO independent quantities (the bug in v1 was conflating them):
 *   - SLIDE (legendDx): move the legend right just enough that its LEFT edge
 *     clears the rightmost plot content it overlaps, + pad.
 *   - EXTEND (ext): widen the viewBox just enough that the slid legend's RIGHT
 *     edge sits inside it, + pad. Widening the viewBox makes the SVG scale to
 *     fit its container, so nothing is clipped and the plot isn't reflowed.
 * The first version set EXTEND = SLIDE, which left the legend's right edge exactly
 * as clipped as before and made the gutter overlap-sized rather than need-sized
 * (a Sankey's legend text stayed cut off at the viewport edge, with more gutter
 * than necessary).
 *
 * DOM-free: the caller gathers user-space boxes + the viewBox and applies the
 * plan (set newViewBox, translate the legend group by legendDx). Tests feed
 * plain numbers and assert the plan.
 */

export interface Rect {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export interface ViewBox {
    x: number;
    y: number;
    w: number;
    h: number;
}

// Which margin the legend/colorbar is being reconciled against. "right" is the
// original (vertical legend slid right, viewBox WIDTH extended); "bottom" is the
// vertical analogue (horizontal colorbar/legend pushed DOWN, viewBox HEIGHT
// extended) — the case the generator can't pre-reserve for a bottom colorbar that
// overprints the x-axis ticks/title.
export type ReconcileSide = "right" | "bottom";

export interface ReconcilePlan {
    action: "none" | "reserve";
    legendDx: number;    // translate the legend group right by this many user units (right side)
    legendDy: number;    // translate the legend group down by this many user units (bottom side)
    ext: number;         // user units added to the viewBox (width on "right", height on "bottom")
    newViewBox: ViewBox; // the viewBox to set (== input when action is "none")
    reason: string;
}

// Default thresholds, in USER units (≈ px for a 1:1
// viewBox). Act on almost any overlap, and extend the viewBox up to this
// fraction of its width before deferring to real reflow (render-then-review).
// A host that wants the pass to act less often passes STRICTER values (see
// ReconcileOptions) so the SAME logic only fires in narrow, high-confidence
// cases — the only difference between the two modes.
export const MIN_OVERLAP = 2;
export const MAX_GUTTER_FRACTION = 0.6;

export interface ReconcileOptions {
    /** Ignore overlaps at or below this many user units (default MIN_OVERLAP). */
    minOverlap?: number;
    /** Defer if the viewBox extension would exceed this fraction of its width
     *  (default MAX_GUTTER_FRACTION). */
    maxGutterFraction?: number;
    /** Gap (user units) left between the legend's LEFT and the plot (default 8). */
    pad?: number;
    /** Gap (user units) left between the legend's RIGHT and the viewBox edge
     *  (default 4). Smaller than `pad` so the legend hugs the right edge — this
     *  is the lever for "too much gutter to the right of the legend". */
    edgePad?: number;
}

function overlap1D(aLo: number, aHi: number, bLo: number, bHi: number): number {
    return Math.min(aHi, bHi) - Math.max(aLo, bLo);
}

/**
 * The rightmost right-edge among plot elements that vertically overlap the
 * legend and do NOT horizontally span it. Per-element (not a union) so a title
 * or axis label that isn't actually beside the legend doesn't count, and a
 * full-width plot background (which spans the legend) is ignored — that's not a
 * collision a right gutter fixes. Returns -Infinity when nothing sits beside it.
 */
export function rightmostOverlappingPlotEdge(legendBox: Rect, plotRects: Rect[]): number {
    let edge = -Infinity;
    for (const r of plotRects) {
        if (!r) continue;
        if (overlap1D(legendBox.top, legendBox.bottom, r.top, r.bottom) <= 0) continue; // not beside it
        if (r.left <= legendBox.left && r.right >= legendBox.right) continue; // spanning background
        if (r.right > edge) edge = r.right;
    }
    return edge;
}

/**
 * The bottom-most bottom-edge among plot elements whose box INTERSECTS the legend
 * (horizontal AND vertical overlap) without fully spanning it. The 90°-rotated
 * analogue of rightmostOverlappingPlotEdge — for a horizontal bottom
 * legend/colorbar overprinted by the x-axis ticks/title. Box-intersection (not a
 * "starts above" test) so a colorbar whose own TITLE sits above its gradient —
 * making the union box taller than the colliders — still detects the x-axis
 * labels that overlap the gradient. Content that clears the legend entirely
 * (a cell row above, a footer below) doesn't intersect and is ignored. Returns
 * -Infinity when nothing intersects.
 */
export function bottommostOverlappingPlotEdge(legendBox: Rect, plotRects: Rect[]): number {
    let edge = -Infinity;
    for (const r of plotRects) {
        if (!r) continue;
        if (overlap1D(legendBox.left, legendBox.right, r.left, r.right) <= 0) continue; // no horizontal overlap
        if (overlap1D(legendBox.top, legendBox.bottom, r.top, r.bottom) <= 0) continue;  // clears above/below — no intersect
        if (r.left <= legendBox.left && r.right >= legendBox.right
            && r.top <= legendBox.top && r.bottom >= legendBox.bottom) continue;          // full spanning background
        if (r.bottom > edge) edge = r.bottom;
    }
    return edge;
}

/**
 * Decide whether/how to reconcile an overlapping/clipped D3 legend.
 *
 * @param legendBox  legend group bbox in USER space
 * @param plotRects  per-element plot-content bboxes (marks + non-legend text) in USER space
 * @param viewBox    the SVG's current viewBox
 * @param opts       strictness thresholds (mode-dependent)
 */
export function planLegendReconcile(
    legendBox: Rect | null,
    plotRects: Rect[] | null,
    viewBox: ViewBox | null,
    opts: ReconcileOptions = {},
    side: ReconcileSide = "right",
): ReconcilePlan {
    const minOverlap = opts.minOverlap ?? MIN_OVERLAP;
    const maxGutterFraction = opts.maxGutterFraction ?? MAX_GUTTER_FRACTION;
    const pad = opts.pad ?? 8;
    const edgePad = opts.edgePad ?? 4;

    const none = (reason: string, vb: ViewBox | null): ReconcilePlan => ({
        action: "none",
        legendDx: 0,
        legendDy: 0,
        ext: 0,
        newViewBox: vb || { x: 0, y: 0, w: 0, h: 0 },
        reason,
    });

    if (!legendBox || !plotRects || plotRects.length === 0) return none("missing-box", viewBox);
    if (!viewBox || viewBox.w <= 0 || viewBox.h <= 0) return none("no-viewbox", viewBox);

    const legW = legendBox.right - legendBox.left;
    const legH = legendBox.bottom - legendBox.top;

    // BOTTOM: horizontal colorbar/legend pushed DOWN, viewBox HEIGHT extended —
    // the 90°-rotation of the right pass below (slide-right → push-down,
    // widen-width → extend-height, vertical-legend → horizontal-strip). This is
    // the case the generator can't pre-reserve: a bottom colorbar overprinting the
    // x-axis ticks / axis title.
    if (side === "bottom") {
        const plotBottom = bottommostOverlappingPlotEdge(legendBox, plotRects);
        if (plotBottom === -Infinity) return none("no-overlap", viewBox);
        // Overlap = how far plot content (x-axis ticks / title) reaches past the
        // legend's TOP edge, downward.
        const overlap = plotBottom - legendBox.top;
        if (overlap <= minOverlap) return none("no-overlap", viewBox);
        // Bottom-strip only: a CLEARLY HORIZONTAL bar (width > 2× height). A
        // vertical/square legend isn't a bottom strip — that's the right pass.
        if (legW <= legH * 2.0) return none("not-horizontal-legend", viewBox);
        // Anchored in the BOTTOM region of the canvas (mirror of not-right-legend).
        if (legendBox.top < viewBox.y + 0.55 * viewBox.h) return none("not-bottom-legend", viewBox);
        // PUSH the legend down so its TOP clears the plot + pad.
        const legendDy = (plotBottom + pad) - legendBox.top; // > minOverlap > 0
        // EXTEND the viewBox height so the pushed legend's BOTTOM + edgePad fits.
        const viewBoxBottom = viewBox.y + viewBox.h;
        const extB = Math.max(0, Math.ceil((legendBox.bottom + legendDy + edgePad) - viewBoxBottom));
        if (extB > viewBox.h * maxGutterFraction) return none("none-too-big", viewBox);
        return {
            action: "reserve",
            legendDx: 0,
            legendDy: Math.ceil(legendDy),
            ext: extB,
            newViewBox: { x: viewBox.x, y: viewBox.y, w: viewBox.w, h: viewBox.h + extB },
            reason: "reserve",
        };
    }

    const plotRight = rightmostOverlappingPlotEdge(legendBox, plotRects);
    if (plotRight === -Infinity) return none("no-overlap", viewBox);

    // Overlap = how far the plot content reaches past the legend's LEFT edge.
    const overlap = plotRight - legendBox.left;
    if (overlap <= minOverlap) return none("no-overlap", viewBox);

    // Right-side, vertical legend only. A horizontal strip (wider than tall)
    // isn't ours. "Embedded in the plot": an earlier test bailed whenever ANY plot
    // content reached past the legend's RIGHT edge (legendBox.right <
    // plotRight) — but that also fires for a GENUINE right-margin legend whose
    // neighbouring labels merely poke past it (a Sankey whose store-column
    // labels extended right of the Channel/Region legend stack read as
    // "not-right-legend", so there was no slide and the overlap shipped, in about
    // half of renders since it depends on label lengths). The slide formula
    // handles that case fine — it moves the legend past plotRight and the
    // viewBox widens. So bail only when the legend isn't ANCHORED in the right
    // region of the canvas at all (a left/center legend genuinely embedded in
    // the plot — relocating that across the chart is a heavier re-layout's
    // job, not a slide's).
    // Skip only a CLEARLY HORIZONTAL strip (a top/bottom row of swatches: very
    // wide, short — can't usefully slide right). An earlier `legH < legW` test also
    // bailed on a near-SQUARE vertical legend whose row labels make its bbox
    // slightly wider than tall (a 2-swatch vertical funnel legend measured 67×60
    // including its "Above avg"/"Below avg" labels and was wrongly read as
    // horizontal). A vertical/square legend CAN slide right; only a wide strip
    // can't. Threshold 2.0: width must exceed 2× height to count as a strip.
    if (legW > legH * 2.0) return none("not-vertical-legend", viewBox);
    if (legendBox.left < viewBox.x + 0.55 * viewBox.w) return none("not-right-legend", viewBox);

    // SLIDE: move the legend right so its LEFT clears the plot + pad.
    const legendDx = (plotRight + pad) - legendBox.left; // > minOverlap > 0
    // EXTEND: widen the viewBox so the SLID legend's RIGHT + edgePad is inside it.
    const viewBoxRight = viewBox.x + viewBox.w;
    const ext = Math.max(0, Math.ceil((legendBox.right + legendDx + edgePad) - viewBoxRight));

    // Too much extension to do in place without shrinking the plot to a sliver →
    // defer to real reflow; report it so we can count these.
    if (ext > viewBox.w * maxGutterFraction) return none("none-too-big", viewBox);

    return {
        action: "reserve",
        legendDx: Math.ceil(legendDx),
        legendDy: 0,
        ext,
        newViewBox: { x: viewBox.x, y: viewBox.y, w: viewBox.w + ext, h: viewBox.h },
        reason: "reserve",
    };
}

/**
 * WHICH MARGIN A STRUCTURALLY-FOUND COLORBAR BELONGS IN.
 *
 * The colorbar pass was first written for ONE case — a horizontal bar in the bottom margin
 * overprinting the x-axis — so it asked `planLegendReconcile` for side "bottom" and nothing
 * else. A VERTICAL colorbar inset into the plot was therefore detected, measured, refused
 * ("not-horizontal-legend") and shipped covering the marks. A treemap with `margin.right = 4`,
 * a colorbar at `plotW - barW - 52` and a `rgba(255,255,255,0.88)` plate under it is that case
 * exactly — the generated code's own comment reads *"Background plate so legend is readable
 * over treemap tiles"*, so the occlusion was deliberate, and two cells and their labels went
 * behind it.
 *
 * The right-side remedy already existed for a legend that carries `.d3-legend-mark`; a colorbar
 * carries no contract class, which is the only reason it was out of reach. So this picks the
 * side from the bar's own geometry and the rest of the machinery is unchanged.
 *
 * THE TESTS HERE MIRROR THE PLANNER'S OWN GATES, deliberately — a strip wider than 2× its
 * height can only go down, anything else can only go right, and each must already be anchored
 * in the margin it is being pushed into. Returning null where the planner would refuse keeps
 * the two from disagreeing: a caller that guesses gets a "not-…" reason instead of a move, and
 * a decorative gradient panel in the middle of the canvas is nobody's furniture.
 */
/**
 * IS THE COLORBAR DRAWN ON TOP OF THE CHART? Measured against the GRADIENT BAR itself,
 * not the group box - and by plain intersection, not by the edge test the right slide uses.
 *
 * BOTH of those choices were forced by a corpus of rendered charts, and each was wrong the
 * first time:
 *
 *  - THE GROUP BOX IS AMBIGUOUS. It also holds the ticks, the title and a backing plate, so
 *    "marks reach past the group's left edge" reads the same for a colorbar sitting on the
 *    plot and for one parked correctly in the gutter with a label hanging left of its bar.
 *    Over 401 rendered charts that ambiguity was the whole problem: gating on the group box
 *    moved 89 charts, only 37 of which had a mark near the bar at all. The BAR's own box has
 *    no such ambiguity - a mark under it means the colorbar was drawn over the chart, full
 *    stop. That reading finds 15.
 *  - `rightmostOverlappingPlotEdge` SKIPS A MARK THAT SPANS THE BOX, which is right for a
 *    full-width backdrop and exactly wrong here: a treemap tile drawn behind the colorbar
 *    spans it, and that is the case where the occlusion is TOTAL. It answered "nothing
 *    overlaps" on a bar sitting entirely on a tile.
 *
 * A MAJORITY, because a colorbar beside the marks still gets its edge touched. The measured
 * spread of `cover` over the 15 is
 * 1.00 1.00 1.00 0.97 | 0.57 0.49 0.41 | 0.25 0.25 0.13 0.06 0.05 0.03 0.01 0.01
 * - the top four are bars drawn wholly on a mark, and the tail from 0.25 down is the last
 * bar of a chart grazing a bar parked in the gutter, which is the content-fit pass's business
 * and not a reason to re-lay-out a cached chart. 0.5 is the default, not a discovery: it is
 * the one number here that a reader should feel free to move.
 */
export const COLORBAR_ON_PLOT_COVER = 0.5;

/**
 * WHERE TO ASK "IS ANYTHING PAINTED HERE?" - an evenly spaced grid strictly inside the
 * bar, inset half a cell so no probe lands on its own edge.
 *
 * A BOX IS NOT INK, and this pass learned it the expensive way. Gating on box
 * intersection alone fired on a density-contour plot whose OUTERMOST contour
 * is a thin diagonal band from the top-left to the bottom-right: its bounding box is
 * 705x664 of a 776x779 canvas and therefore covers the colorbar completely, while its
 * ink comes nowhere near it. A box-only test shipped at 50% precision on the corpus.
 * The remedy is the browser's own answer - isPointInFill / isPointInStroke at these
 * points.
 */
export function colorbarProbePoints(bar: Rect | null, cols = 3, rows = 5): { x: number; y: number }[] {
    if (!bar || !(cols > 0) || !(rows > 0)) return [];
    const w = bar.right - bar.left, h = bar.bottom - bar.top;
    if (!(w > 0) || !(h > 0)) return [];
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
            pts.push({ x: bar.left + (w * (i + 0.5)) / cols, y: bar.top + (h * (j + 0.5)) / rows });
        }
    }
    return pts;
}

/** A majority of the bar's own area has a mark painted under it. */
export function colorbarOnPlot(inkHits: number, probes: number, minCover: number = COLORBAR_ON_PLOT_COVER): boolean {
    return probes > 0 && inkHits / probes >= minCover;
}

export function colorbarSitsOnMarks(
    bar: Rect | null,
    marks: Rect[] | null,
    minCover: number = COLORBAR_ON_PLOT_COVER,
): boolean {
    if (!bar || !marks || marks.length === 0) return false;
    const barArea = (bar.right - bar.left) * (bar.bottom - bar.top);
    if (!(barArea > 0)) return false;
    for (const m of marks) {
        if (!m) continue;
        const ox = Math.min(bar.right, m.right) - Math.max(bar.left, m.left);
        const oy = Math.min(bar.bottom, m.bottom) - Math.max(bar.top, m.top);
        // A hairline in either axis is a shared edge, not an occlusion.
        if (ox <= MIN_OVERLAP || oy <= MIN_OVERLAP) continue;
        if ((ox * oy) / barArea >= minCover) return true;
    }
    return false;
}

export function colorbarReconcileSide(bar: Rect | null, viewBox: ViewBox | null): ReconcileSide | null {
    if (!bar || !viewBox || viewBox.w <= 0 || viewBox.h <= 0) return null;
    const w = bar.right - bar.left;
    const h = bar.bottom - bar.top;
    if (!(w > 0) || !(h > 0)) return null;
    if (w > h * 2.0) {
        // A wide, short strip. Sliding it right does nothing; it can only be pushed down,
        // and only if it is already sitting in the bottom band.
        return bar.top >= viewBox.y + 0.55 * viewBox.h ? "bottom" : null;
    }
    // Vertical or near-square: the right-margin case. Near-square counts — a two-tick colorbar
    // with its labels measures barely taller than wide, and the funnel legend that taught the
    // legend pass this lesson measured 67x60.
    return bar.left >= viewBox.x + 0.55 * viewBox.w ? "right" : null;
}

/**
 * CONTENT FIT — the universal "nothing gets cut off" pass (a Sankey used
 * margin.left=20 with text-anchor:end node labels at x0-6, so left labels hung ~80
 * units into NEGATIVE x and were clipped — while the legend mechanism, which only
 * ever measures the legend column and extends the RIGHT edge, applied cleanly.
 * Whack-a-mole by design: every targeted fix watches one edge).
 *
 * This is edge- and chart-agnostic: take the union bbox of ALL rendered
 * content and EXTEND the viewBox on whichever sides content hangs past, + pad.
 * Extend-only — never shrink (intentional margins/whitespace are not ours to
 * reclaim). Runs after any legend slide (it re-measures, so it covers the slid
 * legend's final position too) and also when there is NO legend at all.
 *
 * Outlier defense: a generation may park junk far off-canvas (work elements at
 * x=-9999). A rect is considered only if it intersects the viewBox expanded by
 * maxFitFraction per side; the final extension is also clamped to that
 * fraction. A real hanging label sits just past the edge and is unaffected;
 * parked junk is ignored rather than blowing the canvas up.
 */
export interface ContentFitPlan {
    action: "none" | "fit";
    newViewBox: ViewBox;
    reason: string;
    /** user units added per side (0 when that side didn't move) */
    cut: { left: number; top: number; right: number; bottom: number };
}

export const MAX_FIT_FRACTION = 0.35; // per-side cap, fraction of the viewBox dimension
export const FIT_PAD = 4;

/*
    THE FIT IS PAID FOR IN LEGIBILITY, AND TWO WAYS OF PAYING IT ARE ALWAYS A LOSS
    (measured on a paged Gantt chart and a corpus of rendered charts).

    Extending the viewBox makes the SVG scale to fit its container, so every extension
    SHRINKS the whole chart — text included. That is a bargain worth making when a small
    rescale rescues a clipped label, and the corpus says it usually is: of 103 applied
    content-fits, 78 shrink by 6% or less and 50 of those by 2%, which is the
    "nobody can see it" case this pass was designed around.

    The two losing cases, both measured on that corpus:

    (1) A CLAMPED EXTENSION BUYS NOTHING. When the overhang exceeds maxFitFraction the old
        code applied the CAP anyway — the full shrink, and the content still clipped,
        because the cap is by definition less than the content needs. 14 of the 103 were
        clamped, and they are the entire disaster tail: every one landed at 0.73-0.75
        scale. The worst kind was a 590x290 Gantt whose 25-row body wanted +298 on
        the bottom, took +102, and drew its 10px row labels at 7.4px while STILL cutting
        9 of the 25 rows. A side that cannot be rescued is now left exactly where it was:
        clipped, at full size, for the scroll pass to deal with.

    (2) A SHRINK THAT COSTS MORE THAN A PIXEL OF THE SMALLEST TEXT. The floor for readable
        type (MIN_LEGIBLE_PX below) is the one answer to "how small is too small". But a
        floor test alone is the wrong instrument here, and the corpus says so loudly: 29 of
        51 measured generations DECLARE 8-9px text, so "refuse any fit that ends below
        10px" would have refused 90% of them - not a cap, a kill switch, and one driven by
        a violation that predates the reconcile and that refusing the fit does not repair
        (the label stays small AND goes back to being clipped). So the test binds on what
        this pass is RESPONSIBLE for: the reconcile may cost at most GRACE px of the
        smallest text, measured against the floor or the chart's own smallest, whichever
        is lower. A 10px chart may shrink to 0.9, a 14px chart to 0.64, and the 0.98
        cohort sails through - while 0.75 through 0.87 (6 of the 39 measured, landing at
        6.0-8.0px on screen) is refused.
*/
export const LEGIBILITY_GRACE_PX = 1;

export interface ContentFitOptions {
    /** Ignore per-side overhangs at or below this many user units (default MIN_OVERLAP). */
    minOverhang?: number;
    /** Per-side extension cap as a fraction of the viewBox dimension (default MAX_FIT_FRACTION). */
    maxFitFraction?: number;
    /** Padding (user units) between content and the new viewBox edge (default FIT_PAD). */
    pad?: number;
    /**
     * The smallest text the chart currently paints, in SCREEN px — declared user units
     * already multiplied by the live CTM scale, because that is the number a reader's eye
     * meets. Omitted (or non-finite) disables the legibility test entirely, which is the
     * honest degrade: a chart whose text could not be measured must keep today's behaviour
     * rather than be refused on a guess.
     */
    smallestTextPx?: number;
    /** The readable floor in px (default MIN_LEGIBLE_PX). */
    minLegiblePx?: number;
    /** How much of the smallest text the fit may spend (default LEGIBILITY_GRACE_PX). */
    legibilityGracePx?: number;
}

/*
    MIRRORS THE SERVICE'S MINIMUM-FONT-SIZE SETTING, which is 10 in the deployed
    configuration. It is a MIRROR and not a wire field on purpose: the alternative is a new
    option through the render-options whitelist, which is a channel that has silently
    dropped fields before, and an inert lever here would fail OPEN - the pass would keep
    shrinking and nothing would say so. A mirror that drifts high refuses a few legal fits;
    a mirror that drifts low costs a pixel. Both are recoverable; a dropped field is not.
*/
export const MIN_LEGIBLE_PX = 10;

export function planContentFit(
    contentRects: Rect[] | null,
    viewBox: ViewBox | null,
    opts: ContentFitOptions = {},
): ContentFitPlan {
    const zero = { left: 0, top: 0, right: 0, bottom: 0 };
    const none = (reason: string): ContentFitPlan => ({
        action: "none",
        newViewBox: viewBox || { x: 0, y: 0, w: 0, h: 0 },
        reason,
        cut: zero,
    });
    if (!viewBox || viewBox.w <= 0 || viewBox.h <= 0) return none("no-viewbox");
    if (!contentRects || contentRects.length === 0) return none("no-content");

    const minOverhang = opts.minOverhang ?? MIN_OVERLAP;
    const maxFit = opts.maxFitFraction ?? MAX_FIT_FRACTION;
    const pad = opts.pad ?? FIT_PAD;

    const capX = maxFit * viewBox.w;
    const capY = maxFit * viewBox.h;
    const vbR = viewBox.x + viewBox.w;
    const vbB = viewBox.y + viewBox.h;

    // Union of content near the canvas (junk parked beyond the expanded band is
    // ignored entirely — it isn't something a sane gutter can or should show).
    let uL = Infinity, uT = Infinity, uR = -Infinity, uB = -Infinity;
    for (const r of contentRects) {
        if (!r || r.right <= r.left || r.bottom <= r.top) continue;
        if (r.right < viewBox.x - capX || r.left > vbR + capX) continue;
        if (r.bottom < viewBox.y - capY || r.top > vbB + capY) continue;
        if (r.left < uL) uL = r.left;
        if (r.top < uT) uT = r.top;
        if (r.right > uR) uR = r.right;
        if (r.bottom > uB) uB = r.bottom;
    }
    if (uL === Infinity) return none("no-content");

    // Per-side overhang past the current viewBox (0 when inside).
    const overL = Math.max(0, viewBox.x - uL);
    const overT = Math.max(0, viewBox.y - uT);
    const overR = Math.max(0, uR - vbR);
    const overB = Math.max(0, uB - vbB);

    // EXTEND-only, per side: overhang + pad, and only for sides whose overhang is
    // material. A side that needs MORE than the cap is not extended at all — the cap is
    // by definition short of what the content needs, so applying it pays the shrink and
    // leaves the side clipped regardless (note (1) above). PER SIDE, not per plan: a
    // 20-unit label hanging off the left is still worth rescuing when an unrescuable row
    // body hangs off the bottom.
    let clamped = 0;
    const ext = (over: number, cap: number) => {
        if (over <= minOverhang) return 0;
        const need = Math.ceil(over + pad);
        if (need > Math.ceil(cap)) { clamped++; return 0; }
        return need;
    };
    const cut = {
        left: ext(overL, capX),
        top: ext(overT, capY),
        right: ext(overR, capX),
        bottom: ext(overB, capY),
    };
    if (cut.left === 0 && cut.top === 0 && cut.right === 0 && cut.bottom === 0) {
        return none(clamped > 0 ? "clamped" : "fits");
    }

    // WHAT THE FIT COSTS THE READER (note (2) above). Extending makes the SVG scale to
    // fit its container, so the shrink is the ratio of old frame to new — computed here
    // rather than taken from the caller, because the plan is the only place that knows
    // the final viewBox.
    const shrink = Math.min(
        viewBox.w / (viewBox.w + cut.left + cut.right),
        viewBox.h / (viewBox.h + cut.top + cut.bottom),
    );
    const smallest = opts.smallestTextPx;
    if (typeof smallest === "number" && isFinite(smallest) && smallest > 0) {
        const floorPx = opts.minLegiblePx ?? MIN_LEGIBLE_PX;
        const grace = opts.legibilityGracePx ?? LEGIBILITY_GRACE_PX;
        // Against the floor, or against the chart's own smallest when it already sits
        // below it — the reconcile is answerable for the pixels IT spends, not for a
        // sub-floor size it inherited.
        const allowed = Math.min(floorPx, smallest) - grace;
        if (smallest * shrink < allowed) return none("legibility");
    }

    return {
        action: "fit",
        newViewBox: {
            x: viewBox.x - cut.left,
            y: viewBox.y - cut.top,
            w: viewBox.w + cut.left + cut.right,
            h: viewBox.h + cut.top + cut.bottom,
        },
        reason: "fit",
        cut,
    };
}

// ── Bottom-text furniture ───────────────────────────────────────────────────
// A bare axis-title / caption <text> drawn ON TOP OF the rotated x-axis tick
// labels (the generator put it at a fixed `plotH + 42`, inside the labels rather
// than below them). fitSvgToContent only prevents CLIPPING, not
// this OVERLAP, so this plans a downward push to seat the text below the deepest
// tick label. CONSERVATIVE: fires only for a text that intersects >= 2 tick
// labels (a SPANNING title/caption) — a narrow per-item legend label (which a
// push would detach from its swatch) intersects at most one and is left alone.
//
// TWO RULES THE FIRST CUT LACKED. The pass reads
// the tick labels of BOTH axes, so a Y-AXIS TITLE rotated -90 in a narrow left
// margin looked like a caption to it: its glyph box lies INSIDE the span of the
// wide y tick labels beside it, two of them fall in its vertical extent, and the
// "floor" it was pushed under was the deepest tick ON THE PAGE — the x axis. The
// title was translated ~200px down to below the x axis, the viewBox grew to cover
// it, and the whole chart then drew at 83%.
//   RULE 1: a spanning bottom caption is always WIDER than it is tall, and never
//   carries a rotate. A taller-than-wide box is a rotated text, never a caption.
//   RULE 2: the floor is the deepest of the ticks the candidate actually HIT, not
//   of every tick on the page — a y-axis hit can then only ever push a few pixels.
// Both rules can only REMOVE a push or SHORTEN one; nothing unpushed today starts
// moving. The original caption is wider than tall and its hit set IS the whole
// tick set, so it keeps exactly the push it had.
export const BOTTOM_TEXT_MIN_TICK_HITS = 2;

export function planBottomTextPush(
    candidate: Rect,
    tickBoxes: Rect[],
    gap = 6,
    transform = "",
): { move: boolean; dy: number } {
    if (tickBoxes.length === 0) return { move: false, dy: 0 };
    // RULE 1. The aspect test stands alone — a rotate applied by an ANCESTOR never
    // reaches this string, and the measured box catches it anyway. The transform is
    // the cheap second half for the caller that can supply one honestly; the default
    // is "no transform known", which is the behaviour every other caller had.
    if (!(candidate.right - candidate.left > candidate.bottom - candidate.top)) return { move: false, dy: 0 };
    if (/rotate\s*\(/i.test(transform)) return { move: false, dy: 0 };
    let hits = 0;
    let floor = -Infinity;
    for (const t of tickBoxes) {
        if (candidate.left < t.right && candidate.right > t.left &&
            candidate.top < t.bottom && candidate.bottom > t.top) {
            hits++;
            if (t.bottom > floor) floor = t.bottom;   // RULE 2: over the HIT ticks only
        }
    }
    if (hits < BOTTOM_TEXT_MIN_TICK_HITS) return { move: false, dy: 0 };
    const dy = (floor + gap) - candidate.top;
    return dy > 0.5 ? { move: true, dy } : { move: false, dy: 0 };
}

// -- The legend SIGNATURE ----------------------------------------------------
// A legend that carries no `.d3-legend-mark` is invisible to every lever this
// file feeds - and 878 of the 1,522 legends in the D3 corpus carry none. This
// is the structural signature that finds them, MEASURED before it was written:
// a mark-free group holding >= 2 (small shape + adjacent text) pairs whose
// swatches are all the SAME size.
//
// THE SAME-SIZE TEST IS THE WHOLE DISCRIMINATOR. Pairs alone recognised 86% of
// the self-declared legends but was 10 of 20 on hand review of the colliding
// blocks it found; the misses were table rows, card chrome, a sunburst label
// layer, a node with its label, and a navigation pad - charts whose MARKS are
// rows of shape + text, and every one of them varies its shape sizes. Requiring
// one swatch size drops all of them: 76% recall, 30 of 30 on hand review, and no
// chart-name exclusion needed (adding one changed nothing).
//
// Pixels, not user units, on purpose: the survey measured client boxes, and a
// signature has to ship as it was measured. Axes are excluded by the CALLER,
// structurally (g.tick / path.domain) - never here, never by heuristic.
export const SWATCH_MAX_PX = 28;
export const SWATCH_LABEL_GAP_PX = 30;
export const SIGNATURE_MIN_PAIRS = 2;

export interface SwatchPairs {
    pairs: number;       // small shapes with a label beside them
    sameSize: boolean;   // every paired swatch shares one rounded w x h
}

export function swatchPairs(shapes: Rect[], texts: Rect[]): SwatchPairs {
    let pairs = 0;
    const sizes = new Set<string>();
    for (const s of shapes) {
        const w = s.right - s.left, h = s.bottom - s.top;
        if (!(w > 0 || h > 0)) continue;                         // nothing drawn
        if (w > SWATCH_MAX_PX || h > SWATCH_MAX_PX) continue;    // a mark, a bar, a panel - not a swatch
        const beside = texts.some(t =>
            t.left >= s.right - 2 && t.left - s.right <= SWATCH_LABEL_GAP_PX
            && Math.min(t.bottom, s.bottom) - Math.max(t.top, s.top) > 0);
        if (!beside) continue;
        pairs++;
        sizes.add(Math.round(w) + "x" + Math.round(h));
    }
    return { pairs, sameSize: pairs > 1 && sizes.size === 1 };
}

export function isLegendSignature(p: SwatchPairs): boolean {
    return p.pairs >= SIGNATURE_MIN_PAIRS && p.sameSize;
}

// -- Axis tick-label thinning ------------------------------------------------
// A HORIZONTAL axis whose tick labels overlap each other. The generation picks a
// tick interval from the DATA (a month step because the span is under a year, a
// $10K step because the extent is $100K) and never asks how much width the plot
// actually has, so a 312px plot gets eleven "Jan 2026" labels and the axis reads
// as a smear. A proxy for width stands in for the measurement, failing exactly
// where it matters.
//
// WHY THINNING RATHER THAN A REGENERATION. Dropping every k-th label is what the
// model would have written had it measured (`ticks(utcMonth.every(2))`), so the
// outcome is identical and costs no pass, no credit and no round trip; the tick
// LINES stay, so the gridlines a reader aligns against are untouched and the
// result looks chosen rather than damaged. It also reaches CACHED generations,
// which a prompt change never does.
//
// STRIDE, NOT GREEDY. A greedy left-to-right keep-if-it-fits leaves irregular
// gaps that read as missing data. One stride over the whole axis is what an axis
// is supposed to look like.
//
// HORIZONTAL ONLY, deliberately. A vertical axis that collides needs more HEIGHT,
// not fewer rows - and on a row-scrolling chart the row IS the datum, so hiding
// every other one would delete exactly what the scrolling exists to
// protect. The caller decides orientation and does not call this for a y-axis.
export const AXIS_THIN_MIN_TICKS = 4;
export const AXIS_THIN_GAP = 2;

export interface AxisThinPlan {
    stride: number;    // 1 = nothing hidden
    hide: number[];    // indices INTO THE INPUT array, in input order
    reason: string;
}

/**
 * Boxes are the tick labels of ONE axis, in any order (they are sorted here by
 * left edge, and `hide` comes back indexed against the INPUT). Returns the
 * smallest stride that clears every adjacent collision.
 *
 * Fail-open in both directions: too few ticks to be worth thinning, and an axis
 * still colliding when only its two ends survive, both hide NOTHING. An ugly
 * axis is recoverable by resizing the tile; an axis stripped to one label is not.
 */
export function planAxisTickThin(boxes: Rect[], gap = AXIS_THIN_GAP, minTicks = AXIS_THIN_MIN_TICKS): AxisThinPlan {
    const n = boxes.length;
    if (n < minTicks) return { stride: 1, hide: [], reason: "too-few" };

    const order = boxes.map((b, i) => ({ b, i })).sort((p, q) => p.b.left - q.b.left);
    const collides = (a: Rect, b: Rect): boolean => b.left < a.right + gap;

    let any = false;
    for (let i = 1; i < n; i++) {
        if (collides(order[i - 1].b, order[i].b)) { any = true; break; }
    }
    if (!any) return { stride: 1, hide: [], reason: "no-overlap" };

    const cleanAt = (k: number): boolean => {
        let prev = -1;
        for (let i = 0; i < n; i += k) {
            if (prev >= 0 && collides(order[prev].b, order[i].b)) return false;
            prev = i;
        }
        return true;
    };

    for (let k = 2; k <= Math.floor(n / 2); k++) {
        if (!cleanAt(k)) continue;
        const hide: number[] = [];
        for (let i = 0; i < n; i++) if (i % k !== 0) hide.push(order[i].i);
        return { stride: k, hide: hide.sort((a, b) => a - b), reason: "stride" };
    }

    // Nothing regular clears it. Keep the two ends - an axis still has to say
    // what it spans - but only if THEY clear each other.
    if (collides(order[0].b, order[n - 1].b)) return { stride: 1, hide: [], reason: "unfixable" };
    const hide: number[] = [];
    for (let i = 1; i < n - 1; i++) hide.push(order[i].i);
    return { stride: 0, hide: hide.sort((a, b) => a - b), reason: "ends-only" };
}

// LABEL ROWS THAT NEVER CALLED d3.axis. The axis-thin pass keys
// on `.tick`, which is what d3.axis emits, so a row of labels a generation PLACED BY HAND
// is invisible to it. One choropleth put three legend numbers on a 120px colorbar by
// bin index - x = 0, 48, 120, anchored start / middle / end - and at the rendered 10px the
// first two abutted at exactly 0.0px: "210,00378,000". Not an overlap, a MISSING GAP,
// which is why no intersection guard ever spoke.
//
// Same planner, same fail-open posture, a NARROWER population: only rows of NUMERIC text
// (digits plus the usual formatting furniture), at least three on one baseline. Two labels
// are the archetype's own min/max form and are never touched; a caption or a title is not
// numeric and is never touched. Measured before it shipped: of 42 sequential-choropleth
// generations rendered in Chromium at their own viewports, ONE moved and none was
// within 3px of moving.
export const LABEL_ROW_MIN_TEXTS = 3;
export const LABEL_ROW_Y_TOLERANCE = 2;

/**
 * A tick-like label: at least one digit, and nothing but digits and the furniture a number
 * format adds - separators, sign, decimal point, currency, percent, a K/M/B suffix, a
 * time colon. "Jan 2026" and "1 region unmatched" are not numeric; "$1.2M" and "-3.5%" are.
 */
export function isNumericLabelText(s: string): boolean {
    const t = (s || "").trim();
    if (!t || !/\d/.test(t)) return false;
    return /^[\s$\u20ac\u00a3\u00a5%+\-\u2013\u2212.,0-9kKmMbB:]+$/.test(t);
}

// A NOMINAL AXIS IS NEVER THINNED. The axis-thin pass rests on the premise that a hidden tick
// loses only "a redundant caption" - true on a date or numeric axis, where the neighbours imply
// it, and false on a band of NAMES, where each label is the only record of its bar (and, on a
// filterable axis, its click target). A Pareto of five failure modes lost two of its names that
// way. So the pass first asks whether the labels are ORDERED - every one a number or a
// date-like caption - and treats anything else as nominal.
const EN_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
    "january", "february", "march", "april", "june", "july", "august", "september", "october", "november", "december"];
const EN_DAYS = ["mon", "tue", "tues", "wed", "thu", "thur", "thurs", "fri", "sat", "sun",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
let calendarWords: Set<string> | null = null;

/** English month and day names plus the runtime locale's (a German report's "M\u00e4rz" is a month). */
function calendarWordSet(): Set<string> {
    if (calendarWords) return calendarWords;
    const set = new Set<string>([...EN_MONTHS, ...EN_DAYS]);
    try {
        const add = (s: string) => { const w = s.toLowerCase().replace(/\.$/, "").trim(); if (w) set.add(w); };
        for (const month of ["short", "long"] as const) {
            const f = new Intl.DateTimeFormat(undefined, { month });
            for (let m = 0; m < 12; m++) add(f.format(new Date(2026, m, 15)));
        }
        for (const weekday of ["short", "long"] as const) {
            const f = new Intl.DateTimeFormat(undefined, { weekday });
            for (let d = 0; d < 7; d++) add(f.format(new Date(2026, 0, 4 + d)));
        }
    } catch { /* no Intl: English only */ }
    calendarWords = set;
    return set;
}

/**
 * A date-like axis caption: a year (2026, FY2026, "Jan 2026"), a month or weekday name, a quarter,
 * half or week ("Q3", "H1", "W12"), a slashed date ("1/15", "15.01.2026") or a clock time ("6 PM").
 * Deliberately generous: a label read as ordered is thinned as before, so the cost of a wrong
 * "date" is today's behaviour, never worse.
 */
export function isDateLikeLabelText(s: string): boolean {
    const t = (s || "").trim();
    if (!t) return false;
    if (/(^|\D)(1[89]|20)\d{2}(\D|$)/.test(t)) return true;
    if (/^(Q|H|T|W|FY|CW|KW)\s?\d{1,2}$/i.test(t) || /\bQ[1-4]\b/.test(t)) return true;
    if (/^\d{1,4}[\/.\-]\d{1,2}([\/.\-]\d{1,4})?$/.test(t)) return true;
    if (/^\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.)$/i.test(t)) return true;
    const words = t.toLowerCase().split(/[\s,.'\-\/]+/).filter(w => w !== "");
    const cal = calendarWordSet();
    return words.length > 0 && words.length <= 3 && words.some(w => cal.has(w))
        && words.every(w => cal.has(w) || /^\d{1,4}(st|nd|rd|th)?$/.test(w));
}

/** Ordered = a number (isNumericLabelText) or a date-like caption (isDateLikeLabelText). */
export function isOrderedAxisLabelText(s: string): boolean {
    return isNumericLabelText(s) || isDateLikeLabelText(s);
}

/** A NOMINAL axis: at least one non-empty label that is neither a number nor date-like. One name
 *  among dates counts - that name has no neighbour to imply it. Empty labels say nothing. */
export function axisLabelsAreNominal(labels: string[]): boolean {
    return labels.some(s => (s || "").trim() !== "" && !isOrderedAxisLabelText(s));
}

/**
 * The room each label of a nominal axis may take, in input order: the step to its NARROWER
 * neighbour less `gap`. `anchors` are the labels' anchor x positions (centre for middle, left
 * edge for start, right edge for end - one anchor kind per axis), so the step is the band pitch
 * whatever the labels' widths. Two labels each within that room cannot collide, whichever anchor
 * they share. A lone anchor has no band and no limit.
 */
export function nominalLabelRooms(anchors: number[], gap = AXIS_THIN_GAP): number[] {
    const n = anchors.length;
    if (n < 2) return anchors.map(() => Infinity);
    const order = anchors.map((x, i) => ({ x, i })).sort((p, q) => p.x - q.x);
    const out = new Array<number>(n);
    for (let k = 0; k < n; k++) {
        const left = k > 0 ? order[k].x - order[k - 1].x : Infinity;
        const right = k < n - 1 ? order[k + 1].x - order[k].x : Infinity;
        out[order[k].i] = Math.min(left, right) - gap;
    }
    return out;
}

/**
 * Group label boxes into horizontal ROWS - same vertical centre within `tol` px. Returns
 * index lists into the input, each sorted by left edge; rows of one are dropped because a
 * lone label has nothing to collide with.
 */
export function groupLabelRows(boxes: Rect[], tol = LABEL_ROW_Y_TOLERANCE): number[][] {
    const used: boolean[] = new Array(boxes.length).fill(false);
    const rows: number[][] = [];
    for (let i = 0; i < boxes.length; i++) {
        if (used[i]) continue;
        const cy = (boxes[i].top + boxes[i].bottom) / 2;
        const row = [i];
        used[i] = true;
        for (let j = i + 1; j < boxes.length; j++) {
            if (used[j]) continue;
            const cj = (boxes[j].top + boxes[j].bottom) / 2;
            if (Math.abs(cj - cy) <= tol) { row.push(j); used[j] = true; }
        }
        if (row.length >= 2) rows.push(row.sort((a, b) => boxes[a].left - boxes[b].left));
    }
    return rows;
}

// LABELS ALONG A TRACK. The first full-history replay of the label-row pass (2,759 OK D3
// generations in Chromium) moved 16 charts, and hand review split them cleanly: the two
// colorbars and a hand-rolled axis were the case the pass exists for; the rest were rows of
// DATA labels - treemap cell values, heatmap cell values, the headline value on every card
// of a flip deck, bubble labels - where hiding every other one deletes the number the reader
// came for. A numeric row alone cannot tell a colorbar from a row of data labels. What can:
// a colorbar's labels (and an axis's) sit ALONG A TRACK - the swatch bar, the gradient rect,
// the domain line - a non-mark shape whose horizontal extent covers the row, within a few
// font sizes of it. Data labels have no track under them; they have their marks.
export const LABEL_ROW_TRACK_COVER = 0.8;   // the track must span at least this much of the row
export const LABEL_ROW_TRACK_REACH = 3;     // ... and sit within this many font sizes of it

/**
 * Does a horizontal track run under (or over) this row of labels? `row` is the row's label
 * boxes; `candidates` are the non-mark rect / line / path boxes of the row's own group. The
 * candidates within reach are unioned - a five-swatch bar is five rects - and the union has
 * to cover `cover` of the row's span. Pure, so the geometry is testable without a DOM.
 */
export function labelRowHasTrack(row: Rect[], candidates: Rect[],
                                 cover = LABEL_ROW_TRACK_COVER, reach = LABEL_ROW_TRACK_REACH): boolean {
    if (row.length === 0 || candidates.length === 0) return false;
    let l = Infinity, r = -Infinity, cy = 0, fs = 0;
    for (const b of row) {
        if (b.left < l) l = b.left;
        if (b.right > r) r = b.right;
        cy += (b.top + b.bottom) / 2;
        fs += b.bottom - b.top;
    }
    cy /= row.length;
    fs /= row.length;
    if (!(r > l) || !(fs > 0)) return false;
    let tl = Infinity, tr = -Infinity, any = false;
    for (const c of candidates) {
        if (!(c.right > c.left)) continue;
        if (Math.abs((c.top + c.bottom) / 2 - cy) > reach * fs) continue;
        any = true;
        if (c.left < tl) tl = c.left;
        if (c.right > tr) tr = c.right;
    }
    if (!any) return false;
    const overlap = Math.min(r, tr) - Math.max(l, tl);
    return overlap >= cover * (r - l);
}
