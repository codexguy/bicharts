/**
 * D3 legend reconcile — DOM adapter.
 *
 * The PURE geometry lives in legendReconcile.ts (unit-tested). This is the
 * browser-side glue that the geometry can't be: find the legend group in a
 * rendered SVG, measure it + the plot content in the SVG's USER space (via
 * getScreenCTM, which captures viewBox + scaling exactly), run the plan, and
 * apply it (widen the viewBox, slide the legend). It needs browser layout
 * (getScreenCTM / DOMPoint), so its tests run on a jsdom layout stand-in — same
 * split as the label-contrast pass's applier and its pure decision. Idempotent within
 * a render via a data attribute; the caller wraps it in try/catch and owns logging.
 */
import { planLegendReconcile, planContentFit, planBottomTextPush, planAxisTickThin,
         colorbarSitsOnMarks, colorbarProbePoints, colorbarOnPlot,
         colorbarReconcileSide, ReconcileSide, swatchPairs, isLegendSignature,
         AXIS_THIN_MIN_TICKS, AXIS_THIN_GAP, ReconcileOptions, Rect, ViewBox,
         LABEL_ROW_MIN_TEXTS, isNumericLabelText, groupLabelRows, labelRowHasTrack,
         axisLabelsAreNominal, nominalLabelRooms } from "./legendReconcile";
import { fitLabelToRoom } from "./frameFitDom";
import { FIT_CONTENT_SELECTOR, isPhantomBox } from "../fit";
import { ctmScaleOf } from "../fitDom";

export interface LegendReconcileResult {
    applied: boolean;
    reason: string;
    dx?: number;
    ext?: number;
    newW?: number;
    furniture?: number; // how many right-margin groups were slid together
    fit?: string;       // "L12 R0 T0 B6" when the content-fit pass extended any side
    cb?: string;        // "dy18 h+17" when the bottom-colorbar pass pushed a colorbar down
    bt?: string;        // "moved2 dy34" when the bottom-text pass pushed axis-title/caption text below the tick labels
    fitDeclined?: string;    // "clamped" | "legibility" — the fit REFUSED, so content is clipped on purpose
    smallestTextPx?: number; // the smallest type on screen when the fit was judged
    at?: string;             // "axes1 hid6 k2" when the axis-thin pass hid colliding tick labels
    axisThin?: AxisThinReport;
    lt?: string;             // "rows1 hid1 k0" when the label-row pass hid colliding hand-placed labels (k0 = ends only)
    labelThin?: { rows: number; hidden: number; stride: number };
    dy?: number;             // a SIGNATURE legend pushed DOWN off the x-axis row (right slides carry dx)
    source?: "class" | "signature"; // which detector found the legend - the contract class, or the measured shape of one that omitted it
}

/**
 * Read the SVG's viewBox, or synthesize one from width/height (then the CTM
 * maps user==px 1:1, so it's consistent).
 */
function readViewBox(svg: SVGSVGElement): ViewBox | null {
    const vbAttr = svg.getAttribute("viewBox");
    if (vbAttr) {
        const p = vbAttr.split(/[\s,]+/).map(Number).filter(n => isFinite(n));
        if (p.length === 4) return { x: p[0], y: p[1], w: p[2], h: p[3] };
    }
    const svgRect = svg.getBoundingClientRect();
    const w = parseFloat(svg.getAttribute("width") || "") || svgRect.width;
    const h = parseFloat(svg.getAttribute("height") || "") || svgRect.height;
    if (w > 0 && h > 0) return { x: 0, y: 0, w, h };
    return null;
}

/**
 * CONTENT FIT (a Sankey's left node labels drawn into negative x were clipped
 * while the legend pass, which only watches
 * the right edge, applied cleanly): measure the union bbox of EVERY rendered
 * graphic element and extend the viewBox on all four sides to cover it. Pure
 * geometry in planContentFit; this gathers boxes in USER space and applies.
 * Runs after any legend slide (re-measures, so it sees the slid positions) and
 * also when there is no legend at all. Elements inside <defs>/<clipPath> and
 * hidden elements measure 0×0 and are filtered; off-canvas junk is rejected by
 * the plan's intersection band.
 */
/*
 * WHAT COUNTS AS CONTENT — one definition (FIT_CONTENT_SELECTOR, shared with the scroll
 * fit in ../fit), because TWO passes ask the question. The content fit asks it to decide
 * whether to grow the viewBox; the scroll fit asks it to decide whether the chart's ink
 * reaches past its own frame. Two copies of the selector would drift, and a drift here
 * means the two passes disagree about what is on screen — which is precisely the class of
 * bug both of them exist to catch.
 *
 * INFORMATION-CARRYING elements only: every <text> plus the contract-classed marks. NOT
 * every shape — one generation drew a white annotation-backdrop rect with
 * width:options.width hanging ~500 units off the right edge; fitting to that invisible
 * decoration would shrink the whole chart by ~25% to make room for nothing. Clipping
 * unclassed decorative shapes is harmless; clipping labels/marks is the bug.
 */

/*
 * A SINGLE element as large as the frame is phantom full-canvas furniture (a backdrop,
 * or an oversized hit-rect emitted with width:options.width), NOT content to fit to.
 * Growing the viewBox to cover it balloons the viewBox and scales the whole chart down
 * into a letterboxed sliver with a huge empty gutter (a marimekko's
 * `width:options.width` .d3-legend-mark hit-rect did exactly this — and because it
 * carries a contract class it slips past the unclassed-shape filter above). No
 * legitimate label / swatch / node is ~canvas-sized, so isPhantomBox only ever drops
 * phantom furniture. Ratio-based, so it reads the same in user units or in screen px.
 */

// How many elements either walk will measure before giving up. Layout-flushing calls in
// a loop, so it is a real ceiling and not a formality.
const FIT_WALK_CAP = 8000;
// getComputedStyle is the expensive half; the smallest type in a chart is decided long
// before the 400th label, and a chart with more than that has bigger problems.
const FONT_SCAN_CAP = 400;

/*
 * THE SMALLEST TYPE THE CHART ACTUALLY PAINTS, in SCREEN px.
 *
 * `getComputedStyle(el).fontSize` on SVG text resolves to USER units, not screen px — a
 * 10px label inside a viewBox scaled to 0.72 computes as "10px" and renders at 7.2. So
 * the CTM scale is applied here, and the number that comes out is the one a reader's eye
 * meets. Returns null when nothing could be measured, which disables the legibility test
 * rather than guessing at it.
 */
export function smallestRenderedTextPx(svg: SVGSVGElement, ctmScale: number): number | null {
    if (!(ctmScale > 0) || !isFinite(ctmScale)) return null;
    const texts = svg.querySelectorAll<SVGGraphicsElement>("text");
    let smallest = Infinity;
    const n = Math.min(texts.length, FONT_SCAN_CAP);
    for (let i = 0; i < n; i++) {
        try {
            const el = texts[i];
            // A label nobody can see is not a legibility constraint on anybody.
            const r = el.getBoundingClientRect();
            if (r.width <= 0 && r.height <= 0) continue;
            const px = parseFloat(getComputedStyle(el).fontSize);
            if (isFinite(px) && px > 0 && px < smallest) smallest = px;
        } catch {
            // Unstyleable element: it contributes no constraint, same as an unmeasurable one.
        }
    }
    return isFinite(smallest) ? smallest * ctmScale : null;
}

// The uniform scale of a user→screen matrix is ctmScaleOf (../fitDom). Rotation-safe
// (charts do rotate axis labels), which a bare `.a` is not.

function fitSvgToContent(svg: SVGSVGElement): { applied: boolean; fit?: string; declined?: string; smallestTextPx?: number } {
    const vbox = readViewBox(svg);
    if (!vbox) return { applied: false };
    const ctm = svg.getScreenCTM();
    if (!ctm) return { applied: false };
    const inv = ctm.inverse();
    const toUser = (r: DOMRect): Rect => {
        const a = new DOMPoint(r.left, r.top).matrixTransform(inv);
        const b = new DOMPoint(r.right, r.bottom).matrixTransform(inv);
        return { left: Math.min(a.x, b.x), right: Math.max(a.x, b.x), top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) };
    };
    const els = svg.querySelectorAll<SVGGraphicsElement>(FIT_CONTENT_SELECTOR);
    const rects: Rect[] = [];
    for (let i = 0; i < els.length && rects.length < FIT_WALK_CAP; i++) {
        const r = els[i].getBoundingClientRect();
        if (r.width <= 0 && r.height <= 0) continue; // defs/hidden; keep 0-width lines
        const ur = toUser(r);
        if (isPhantomBox(ur.right - ur.left, ur.bottom - ur.top, vbox.w, vbox.h)) continue;
        rects.push(ur);
    }
    // THE COST SIDE OF THE PLAN. Measured before the viewBox moves, because the shrink is
    // expressed relative to what the reader is looking at right now.
    const smallestTextPx = smallestRenderedTextPx(svg, ctmScaleOf(ctm)) ?? undefined;
    const plan = planContentFit(rects, vbox, { smallestTextPx });
    // A REFUSAL THAT LEAVES NO TRACE IS A REFUSAL NOBODY CAN DIAGNOSE. "clamped" and
    // "legibility" mean content stayed clipped ON PURPOSE, which reads identically to the
    // pass never running — so the reason is carried out to the log line rather than
    // collapsing into a bare false.
    if (plan.action !== "fit") {
        return { applied: false, declined: plan.reason, smallestTextPx };
    }
    svg.setAttribute("viewBox", `${plan.newViewBox.x} ${plan.newViewBox.y} ${plan.newViewBox.w} ${plan.newViewBox.h}`);
    if (!svg.getAttribute("preserveAspectRatio")) svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    const c = plan.cut;
    return { applied: true, fit: `L${c.left} R${c.right} T${c.top} B${c.bottom}` };
}

/**
 * SELF-MANAGED SCROLL LAYOUT. A chart that renders its
 * content as HTML inside a <foreignObject> with its OWN inner scroll body — a
 * table-with-embedded scorecard (30 users × 32px rows scrolling inside a ~525px body) —
 * manages its own frame. Its below-the-fold rows are SCROLLED, not clipped. The
 * content-fit pass, which exists to rescue clipped SVG content, reads those off-canvas
 * row <text>/marks as clipped and grows the viewBox (+239 on the bottom in that case);
 * preserveAspectRatio then draws the taller viewBox to fit, letterboxing the chart into
 * huge left/right gutters with everything shrunk (~72%) and the text illegibly small.
 * NONE of the reconcile passes (legend slide / colorbar push / bottom-text / content-fit)
 * apply to a self-scrolling HTML table, so skip the whole thing. Detected STRUCTURALLY (a
 * <foreignObject> containing an element that scrolls its own content), never by chart-type
 * name — any future self-managed layout is covered automatically.
 */
// Pure predicate (unit-tested): does an inline style string OR a computed overflow value
// declare a self-scrolling box? auto/scroll on overflow or overflow-x/-y = yes; hidden/
// visible/absent = no. Kept separate from the DOM traversal so the discriminating logic is
// testable without a browser/jsdom.
export function styleDeclaresScroll(inlineStyle: string | null | undefined, overflow?: string, overflowY?: string): boolean {
    if (inlineStyle && /overflow(-[xy])?\s*:\s*(auto|scroll)/i.test(inlineStyle)) return true;
    const v = (s?: string) => s === "auto" || s === "scroll";
    return v(overflow) || v(overflowY);
}

function hasSelfManagedScrollLayout(svg: SVGSVGElement): boolean {
    const fos = svg.querySelectorAll("foreignObject");
    if (fos.length === 0) return false;
    const win = svg.ownerDocument && svg.ownerDocument.defaultView;
    const CAP = 2000;
    let seen = 0;
    for (let i = 0; i < fos.length; i++) {
        const kids = fos[i].querySelectorAll("*");
        for (let j = 0; j < kids.length && seen < CAP; j++, seen++) {
            const el = kids[j] as HTMLElement;
            // Inline style first (the D3 generator sets `.style('overflow-y','auto')`, which
            // jsdom exposes but does not always compute); then the computed style (browser).
            const inline = (el.getAttribute && el.getAttribute("style")) || "";
            let cs: CSSStyleDeclaration | null = null;
            if (win) { try { cs = win.getComputedStyle(el); } catch { cs = null; } }
            if (styleDeclaresScroll(inline, cs?.overflow, cs?.overflowY)) return true;
        }
        if (seen >= CAP) break;
    }
    return false;
}

/**
 * AXIS TICK THINNING. A horizontal axis whose own tick labels overlap each
 * other - eleven "Jan 2026" into a 312px plot, or "50K | 60K | 70K" along a
 * numeric axis. The decision (which stride clears it) is planAxisTickThin; this
 * is the DOM half: find each axis, establish it IS horizontal, measure the real
 * text, and hide the labels the plan drops.
 *
 * MEASURED, NOT ESTIMATED, and that is the whole reason this lives client-side.
 * The server exec-gate breadcrumb has to approximate text width as
 * chars * fontSize * 0.6 because jsdom has no getComputedTextLength - its own
 * author called that good enough to triage on and not good enough to spend a
 * regeneration on. Here the box is the browser's own.
 *
 * Hides the text only. The tick LINE and the gridline stay, so the reader keeps
 * every position they align against and loses only a redundant caption.
 * Conservative and fail-open throughout: fewer than four ticks, any rotated
 * label (rotation is the generation's own answer to density and pairs badly
 * with thinning), a vertical axis, or an axis still colliding when only its two
 * ends survive all leave the axis exactly as it was drawn.
 */
/** What the axis pass did, for the caller's log line. cut / shrunk / nominal appear only when a
 *  NOMINAL axis was fitted instead of thinned; colliding counts labels still touching a
 *  neighbour after the cut kept their first character (a band too narrow for even that). */
export interface AxisThinReport { axes: number; hidden: number; stride: number; cut?: number; shrunk?: number; nominal?: boolean; colliding?: number }

type AxisThinPhaseResult = { applied: boolean; at?: string } & AxisThinReport;

function thinAxisTicksPhase(svg: SVGSVGElement): AxisThinPhaseResult {
    const none: AxisThinPhaseResult = { applied: false, axes: 0, hidden: 0, stride: 1 };
    const ticks = svg.querySelectorAll<SVGGraphicsElement>(".tick");
    if (ticks.length < AXIS_THIN_MIN_TICKS) return none;

    // One axis == one parent of .tick groups. D3 emits every tick of an axis as
    // a sibling under the <g> the axis was called on, so the parent IS the axis.
    const byAxis = new Map<Element, SVGGraphicsElement[]>();
    for (let i = 0; i < ticks.length; i++) {
        const parent = ticks[i].parentElement;
        if (!parent) continue;
        const list = byAxis.get(parent);
        if (list) list.push(ticks[i]); else byAxis.set(parent, [ticks[i]]);
    }

    const isRotated = (el: Element | null): boolean => {
        let n: Element | null = el;
        while (n && n !== svg) {
            const t = n.getAttribute ? n.getAttribute("transform") : null;
            if (t && t.indexOf("rotate") >= 0) return true;
            n = n.parentElement;
        }
        return false;
    };

    let axesTouched = 0, hiddenTotal = 0, strideUsed = 1, cutTotal = 0, shrunkTotal = 0, nominalAxes = 0, collidingTotal = 0;
    byAxis.forEach((group, axis) => {
        if (group.length < AXIS_THIN_MIN_TICKS) return;
        if (axis.getAttribute("data-lch-ticks-thinned") === "1") return;

        const texts: SVGGraphicsElement[] = [];
        const boxes: Rect[] = [];
        let rotated = false;
        for (const tick of group) {
            const t = tick.querySelector<SVGGraphicsElement>("text");
            if (!t) continue;
            if (isRotated(t)) { rotated = true; break; }
            const r = t.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) continue;
            texts.push(t);
            boxes.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
        }
        if (rotated || boxes.length < AXIS_THIN_MIN_TICKS) return;

        // HORIZONTAL ONLY. A horizontal axis spreads its labels across x; a
        // y-axis spreads them down y, and thinning that one deletes ROWS rather
        // than redundant captions.
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const b of boxes) {
            const cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2;
            if (cx < minX) minX = cx;
            if (cx > maxX) maxX = cx;
            if (cy < minY) minY = cy;
            if (cy > maxY) maxY = cy;
        }
        if ((maxX - minX) <= (maxY - minY)) return;

        const plan = planAxisTickThin(boxes, AXIS_THIN_GAP);
        if (plan.hide.length === 0) return;

        // A NOMINAL AXIS IS NEVER THINNED: on a band of names each label is
        // the only record of its bar, and on a filterable axis its click target. Each label is cut
        // to its band instead - shrunk first, then shortened with the full name in a <title> - and
        // never below its first character, so every bar keeps a name and every name stays
        // clickable. Rotating instead would need the bottom margin grown under a chart whose
        // layout the generation owns; a cut stays inside the box the label already had.
        if (axisLabelsAreNominal(texts.map(t => ownTextOf(t)))) {
            const anchor = anchorKindOf(texts[0]);
            const anchors = boxes.map(b => anchor === "start" ? b.left : anchor === "end" ? b.right : (b.left + b.right) / 2);
            const rooms = nominalLabelRooms(anchors, AXIS_THIN_GAP);
            let cut = 0, shrunk = 0;
            texts.forEach((t, i) => {
                const width = boxes[i].right - boxes[i].left;
                if (!(rooms[i] < width)) return;
                const done = fitLabelToRoom(t, width, Math.max(1, rooms[i]), () => t.getBoundingClientRect().width, 1);
                if (done === "cut") cut++; else if (done === "shrunk") shrunk++;
            });
            if (cut + shrunk === 0) return;
            const after: Rect[] = texts.map(t => { const r = t.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; })
                .sort((p, q) => p.left - q.left);
            let colliding = 0;
            for (let i = 1; i < after.length; i++) if (after[i].left < after[i - 1].right) colliding++;
            axis.setAttribute("data-lch-ticks-thinned", "1");
            axesTouched++;
            nominalAxes++;
            cutTotal += cut;
            shrunkTotal += shrunk;
            collidingTotal += colliding;
            return;
        }

        for (const idx of plan.hide) texts[idx].setAttribute("display", "none");
        axis.setAttribute("data-lch-ticks-thinned", "1");
        axesTouched++;
        hiddenTotal += plan.hide.length;
        if (plan.stride > strideUsed) strideUsed = plan.stride;
    });

    if (axesTouched === 0) return none;
    const out: AxisThinPhaseResult = {
        applied: true,
        at: "axes" + axesTouched + " hid" + hiddenTotal + " k" + strideUsed + (nominalAxes > 0 ? " cut" + cutTotal + " shr" + shrunkTotal : ""),
        axes: axesTouched, hidden: hiddenTotal, stride: strideUsed,
    };
    if (nominalAxes > 0) {
        out.nominal = true;
        out.cut = cutTotal;
        out.shrunk = shrunkTotal;
        if (collidingTotal > 0) out.colliding = collidingTotal;
    }
    return out;
}

/** The label a reader sees: the element's own text nodes, never its <title> tooltip. */
function ownTextOf(el: Element): string {
    let s = "";
    el.childNodes.forEach(n => { if (n.nodeType === 3) s += n.nodeValue || ""; });
    return s.trim() !== "" ? s : (el.textContent || "");
}

/** The text-anchor the label is drawn with - its own, else the nearest ancestor's (d3.axis sets it
 *  on the axis group). Middle when nothing says. */
function anchorKindOf(el: Element): "start" | "middle" | "end" {
    for (let n: Element | null = el; n; n = n.parentElement) {
        const v = (n.getAttribute && n.getAttribute("text-anchor")) || ((n as any).style && (n as any).style.textAnchor) || "";
        if (v === "start" || v === "end" || v === "middle") return v;
    }
    try {
        const v = typeof getComputedStyle === "function" ? getComputedStyle(el).getPropertyValue("text-anchor") : "";
        if (v === "start" || v === "end") return v;
    } catch { /* no layout */ }
    return "middle";
}

/** Is there a rotate() anywhere between `el` and `stop`? Rotation is a generation's own answer
 *  to density and pairs badly with thinning, so a rotated label row is left alone. */
function hasRotateAbove(el: Element, stop: Element): boolean {
    let n: Element | null = el;
    while (n && n !== stop) {
        const t = n.getAttribute ? n.getAttribute("transform") : null;
        if (t && t.indexOf("rotate") >= 0) return true;
        n = n.parentElement;
    }
    return false;
}

/**
 * Is this row of labels a colorbar's or an axis's - labels along a track in a group that
 * holds no plot marks - rather than a row of DATA labels? The lowest common ancestor <g> of
 * the row is the group in question. A group holding any `.d3-mark` is data territory (a
 * treemap's cells, a deck's cards, a heatmap's tiles all keep their value text beside their
 * mark); a row whose common ancestor is the <svg> itself is a flat layout this pass has no
 * business reasoning about. Otherwise the group's non-mark shapes are the track candidates and
 * the pure predicate decides. Fail-closed on every doubt: the cost of a miss is an ugly legend,
 * the cost of a false hit is a deleted number.
 */
function rowSitsOnTrack(els: SVGGraphicsElement[], rowBoxes: Rect[], svg: SVGSVGElement): boolean {
    let lca: Element | null = els[0].parentElement;
    while (lca && lca !== svg && !els.every(e => (lca as Element).contains(e))) lca = lca.parentElement;
    if (!lca || lca === svg) return false;
    if (lca.querySelector(".d3-mark")) return false;
    const cands: Rect[] = [];
    const shapes = lca.querySelectorAll<SVGGraphicsElement>("rect, line, path, polyline");
    for (let i = 0; i < shapes.length; i++) {
        const el = shapes[i];
        if (el.closest(".d3-mark")) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0) continue;
        cands.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
    }
    return labelRowHasTrack(rowBoxes, cands);
}

/**
 * LABEL ROWS THAT NEVER CALLED d3.axis. thinAxisTicksPhase keys on
 * `.tick`, so a row of labels a generation PLACED BY HAND - a colorbar's three tick values,
 * a hand-rolled axis - is invisible to it. One choropleth's colorbar put "210,000" and "378,000" on
 * one baseline with 0.0px between them, which no intersection test can see and every
 * reader can.
 *
 * The population is deliberately narrow: NUMERIC texts only (isNumericLabelText), at least
 * three on one baseline (two is the colorbar's own min/max form), none rotated, none inside
 * a d3 axis (that row belongs to the axis-thin pass), none inside shared-helper furniture
 * (`g.llm-zoom-pad` / `g.llm-zoom-btn` glyphs and `g.llm-map-labels` are not tick values),
 * none inside a nested <svg> (a tabular's mini-charts own their rows) and none already
 * hidden - AND the row has to sit along a track in a mark-free group (rowSitsOnTrack), which
 * is what separates a colorbar or an axis from a row of data labels. The planner is the axis
 * one - stride first, both ends as the fallback, nothing when even the ends collide - so a
 * three-label colorbar that abuts keeps its min and its max, which is exactly what the
 * generator draws. Hides the TEXT only; swatches and lines stay.
 */
function thinLabelRowsPhase(svg: SVGSVGElement): { applied: boolean; lt?: string; rows: number; hidden: number; stride: number } {
    const none = { applied: false, rows: 0, hidden: 0, stride: 0 };
    const all = svg.querySelectorAll<SVGGraphicsElement>("text");
    if (all.length < LABEL_ROW_MIN_TEXTS) return none;
    const texts: SVGGraphicsElement[] = [];
    const boxes: Rect[] = [];
    for (let i = 0; i < all.length; i++) {
        const t = all[i];
        if (t.closest("svg") !== svg) continue;
        if (t.closest(".tick, g.llm-zoom-pad, g.llm-zoom-btn, g.llm-map-labels, foreignObject")) continue;
        if (t.getAttribute("display") === "none") continue;
        if (!isNumericLabelText(t.textContent || "")) continue;
        if (hasRotateAbove(t, svg)) continue;
        const r = t.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        texts.push(t);
        boxes.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
    }
    if (boxes.length < LABEL_ROW_MIN_TEXTS) return none;

    let rowsTouched = 0, hiddenTotal = 0, strideUsed = 0;
    for (const row of groupLabelRows(boxes)) {
        if (row.length < LABEL_ROW_MIN_TEXTS) continue;
        const rowBoxes = row.map(i => boxes[i]);
        if (!rowSitsOnTrack(row.map(i => texts[i]), rowBoxes, svg)) continue;
        const plan = planAxisTickThin(rowBoxes, AXIS_THIN_GAP, LABEL_ROW_MIN_TEXTS);
        if (plan.hide.length === 0) continue;
        for (const k of plan.hide) {
            texts[row[k]].setAttribute("display", "none");
            texts[row[k]].setAttribute("data-lch-label-thinned", "1");
        }
        rowsTouched++;
        hiddenTotal += plan.hide.length;
        if (plan.stride > strideUsed) strideUsed = plan.stride;
    }
    if (rowsTouched === 0) return none;
    return {
        applied: true,
        lt: "rows" + rowsTouched + " hid" + hiddenTotal + " k" + strideUsed,
        rows: rowsTouched, hidden: hiddenTotal, stride: strideUsed,
    };
}

function axisThinReportOf(r: AxisThinPhaseResult): AxisThinReport {
    const out: AxisThinReport = { axes: r.axes, hidden: r.hidden, stride: r.stride };
    if (r.nominal) { out.nominal = true; out.cut = r.cut; out.shrunk = r.shrunk; if (r.colliding) out.colliding = r.colliding; }
    return out;
}

export function reconcileLegendInSvg(svg: SVGSVGElement, opts: ReconcileOptions = {}): LegendReconcileResult {
    if (svg.getAttribute("data-lch-legend-fixed") === "1") return { applied: false, reason: "already-fixed" };
    if (hasSelfManagedScrollLayout(svg)) {
        svg.setAttribute("data-lch-legend-fixed", "1");
        return { applied: false, reason: "self-managed-layout" };
    }
    const legendRes = reconcileLegendPhase(svg, opts);
    // COLORBAR: a colorbar overprinting content it should sit beside — a horizontal
    // one in the bottom margin over the x-axis, or a vertical one inset into the plot
    // over the marks. Found STRUCTURALLY (gradient-filled rect), not by class — the
    // generator leaves it unclassed. Runs after the right slide, before content-fit.
    let cbRes: { applied: boolean; cb?: string } = { applied: false };
    try { cbRes = reconcileColorbarPhase(svg, opts); } catch { /* fail-open: legend result stands */ }
    // BOTTOM TEXT: an axis-title / caption <text> drawn ON TOP OF the rotated x-axis
    // tick labels (overlap, not clipping — fitSvgToContent won't separate it). Runs
    // BEFORE content-fit so the fit pass then grows the viewBox for the pushed text.
    // AXIS THINNING: a horizontal axis colliding with ITSELF. Runs BEFORE the
    // bottom-text phase because a hidden label measures zero, so that phase then
    // seats a title below the labels that SURVIVED rather than below one that is
    // no longer on screen.
    let atRes: AxisThinPhaseResult = { applied: false, axes: 0, hidden: 0, stride: 1 };
    try { atRes = thinAxisTicksPhase(svg); } catch { /* fail-open: legend result stands */ }
    // LABEL ROWS the axis pass cannot see (no `.tick`): same planner, numeric rows only.
    let ltRes: { applied: boolean; lt?: string; rows: number; hidden: number; stride: number } =
        { applied: false, rows: 0, hidden: 0, stride: 0 };
    try { ltRes = thinLabelRowsPhase(svg); } catch { /* fail-open: legend result stands */ }
    let btRes: { applied: boolean; bt?: string } = { applied: false };
    try { btRes = reconcileBottomTextPhase(svg); } catch { /* fail-open: legend result stands */ }
    // The content-fit pass runs REGARDLESS of the legend outcome — charts with
    // no legend (or a bailed legend plan) clip labels too, and a successful
    // slide can itself leave content past an edge the slide never measured.
    let fitRes: { applied: boolean; fit?: string; declined?: string; smallestTextPx?: number } = { applied: false };
    try { fitRes = fitSvgToContent(svg); } catch { /* fail-open: legend result stands */ }
    return {
        ...legendRes,
        applied: legendRes.applied || cbRes.applied || atRes.applied || ltRes.applied || btRes.applied || fitRes.applied,
        reason: legendRes.applied ? legendRes.reason : cbRes.applied ? "colorbar" : atRes.applied ? "axis-thin" : ltRes.applied ? "label-thin" : btRes.applied ? "bottom-text" : fitRes.applied ? "fit" : legendRes.reason,
        cb: cbRes.cb,
        bt: btRes.bt,
        at: atRes.at,
        axisThin: atRes.applied ? axisThinReportOf(atRes) : undefined,
        lt: ltRes.lt,
        labelThin: ltRes.applied ? { rows: ltRes.rows, hidden: ltRes.hidden, stride: ltRes.stride } : undefined,
        fit: fitRes.fit,
        // Only when the fit DECLINED for a reason of its own ("clamped" / "legibility") —
        // not for "fits" or "no-content", which are silence for the right reasons.
        fitDeclined: fitRes.declined === "clamped" || fitRes.declined === "legibility" ? fitRes.declined : undefined,
        smallestTextPx: fitRes.smallestTextPx !== undefined ? Math.round(fitRes.smallestTextPx * 10) / 10 : undefined,
    };
}

/**
 * LEGENDS THAT NEVER ANNOUNCED THEMSELVES. The
 * maximal mark-free <g> subtrees of the chart, judged by the legend signature in
 * legendReconcile.ts. Walk top-down and stop descending once a group qualifies as
 * mark-free, so an axis is one block and a legend nested inside the plot group is
 * found on the way down. Axes are skipped STRUCTURALLY - d3's axis generator always
 * emits g.tick / path.domain - which is the one exclusion a signature is allowed.
 */
export function findSignatureLegendGroups(svg: SVGSVGElement): Element[] {
    const SHAPES = "rect,circle,ellipse,line,path,polygon,polyline";
    const PLOT_MARK = ".d3-mark:not(.d3-legend-mark)";
    const out: Element[] = [];
    const px = (el: Element): Rect => {
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    const walk = (g: Element): void => {
        for (let i = 0; i < g.children.length; i++) {
            const ch = g.children[i];
            const tag = ch.tagName.toLowerCase();
            if (tag !== "g") continue;                                  // defs, clipPath, shapes: not blocks
            // HELPER FURNITURE IS NOT A LEGEND: the geo-zoom helper's d-pad is seven buttons of one size
            // with a glyph beside each, so it fits the signature, and it is drawn before a flow map's key.
            if (ch.matches("g.llm-zoom-pad, g.llm-zoom-btn")) continue;
            const markFree = !ch.querySelector(PLOT_MARK) && !!ch.querySelector("text") && !!ch.querySelector(SHAPES);
            if (!markFree) { walk(ch); continue; }
            if (ch.querySelector("g.tick, path.domain") || /axis/i.test(ch.getAttribute("class") || "")) continue;
            const shapes = Array.from(ch.querySelectorAll<SVGGraphicsElement>(SHAPES)).map(px);
            const texts = Array.from(ch.querySelectorAll<SVGGraphicsElement>("text")).map(px).filter(t => t.right > t.left);
            if (isLegendSignature(swatchPairs(shapes, texts))) out.push(ch);
        }
    };
    walk(svg);
    return out;
}

function reconcileLegendPhase(svg: SVGSVGElement, opts: ReconcileOptions = {}): LegendReconcileResult {
    const legendMarks = svg.querySelectorAll<SVGGraphicsElement>(".d3-legend-mark");
    // WHICH DETECTOR FOUND THE LEGEND. "class" is the contract; "signature" is the
    // measured shape of a legend that omitted it. The signature path is used only when
    // nothing is classed, so a chart that follows the contract cannot change its answer.
    let source: "class" | "signature" = "class";
    let signatureGroups: Element[] = [];
    if (legendMarks.length === 0) {
        signatureGroups = findSignatureLegendGroups(svg);
        if (signatureGroups.length === 0) { svg.setAttribute("data-lch-legend-fixed", "1"); return { applied: false, reason: "no-legend" }; }
        source = "signature";
    }
    const plotMarks = svg.querySelectorAll<SVGGraphicsElement>(".d3-mark");
    if (plotMarks.length === 0) { svg.setAttribute("data-lch-legend-fixed", "1"); return { applied: false, reason: "no-marks", source }; }

    // A group is slidable only if it holds no PLOT marks (a .d3-mark that isn't
    // a legend swatch) — else sliding it would move the chart.
    const groupHasPlotMark = (el: Element): boolean => {
        const dm = el.querySelectorAll<SVGGraphicsElement>(".d3-mark");
        for (let j = 0; j < dm.length; j++) if (!dm[j].classList.contains("d3-legend-mark")) return true;
        return false;
    };

    // Lowest common ancestor <g> of the legend marks — the group we'll slide. A
    // signature legend IS its group, so it needs no ancestor search.
    let legendGroup: Element | null = source === "signature" ? signatureGroups[0] : legendMarks[0].parentElement;
    while (source === "class" && legendGroup && legendGroup !== svg) {
        let containsAll = true;
        for (let i = 0; i < legendMarks.length; i++) {
            if (!legendGroup.contains(legendMarks[i])) { containsAll = false; break; }
        }
        if (containsAll) break;
        legendGroup = legendGroup.parentElement;
    }
    // MULTI-GROUP LEGENDS (seen on a shipping Sankey): the generator
    // often emits SEVERAL svg-child legend groups — a port-colour legend, a
    // "Revenue Scale" key, an "Anomaly" key — EACH carrying .d3-legend-mark
    // entries. The LCA of marks spanning sibling groups is the <svg> itself, and
    // the old code bailed "no-clean-group" HERE — before ever measuring overlap —
    // so the whole reserve/slide mechanism silently never ran on exactly the
    // multi-key charts that overlap the most. Instead: cluster the legend marks
    // into their TOP-LEVEL (svg-child) containers and treat every container as
    // part of the furniture stack — the rest of the pipeline (union bbox →
    // overlap plan → widen viewBox → slide each group) is unchanged.
    let legendContainers: Element[];
    let mixedGroup = false;
    if (source === "signature") {
        // Every signature group is its own container; they are mark-free by
        // construction, so the impure-group question cannot arise.
        legendContainers = signatureGroups;
    } else if (!legendGroup || legendGroup === svg) {
        const set = new Set<Element>();
        for (let i = 0; i < legendMarks.length; i++) {
            let el: Element | null = legendMarks[i];
            while (el && (el.parentElement as Element | null) !== (svg as Element)) el = el.parentElement as Element | null;
            if (!el) return { applied: false, reason: "no-clean-group" };
            set.add(el);
        }
        legendContainers = Array.from(set);
        for (const c of legendContainers) {
            if (groupHasPlotMark(c)) return { applied: false, reason: "impure-group" };
        }
        legendGroup = legendContainers[0];
    } else {
        if (groupHasPlotMark(legendGroup)) {
            // MIXED GROUP (seen on a loan funnel and a waterfall): the generation appended the
            // legend swatches into the SAME group as the plot marks
            // (`g.append('rect').attr('class','d3-legend-mark')` alongside the
            // bars). The LCA is the plot group, so we can't slide it without
            // dragging the chart — the old code BAILED here ("impure-group") and
            // the legend shipped overlapping the corner labels. Instead, slide
            // the INDIVIDUAL legend swatches (+ their own text furniture, gathered
            // below by the at/right-of-swatch-left test) and leave the plot marks
            // and plot annotations (e.g. a mean-line "Avg: $.." label, which sits
            // LEFT of the swatch column) put.
            mixedGroup = true;
            legendContainers = Array.from(legendMarks);
        } else {
            legendContainers = [legendGroup];
        }
    }

    // Map measured client-px boxes into the SVG's USER space.
    const ctm = svg.getScreenCTM();
    if (!ctm) return { applied: false, reason: "no-ctm" };
    const inv = ctm.inverse();
    const toUserRect = (r: DOMRect): Rect => {
        // No rotation in these charts → opposite corners give x/y extents.
        const a = new DOMPoint(r.left, r.top).matrixTransform(inv);
        const b = new DOMPoint(r.right, r.bottom).matrixTransform(inv);
        return { left: Math.min(a.x, b.x), right: Math.max(a.x, b.x), top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) };
    };
    const userRectOf = (el: Element): Rect => toUserRect((el as SVGGraphicsElement).getBoundingClientRect());

    // ViewBox: read it, or synthesize from width/height (then the CTM maps
    // user==px 1:1, so it's consistent).
    let vbox: ViewBox | null = null;
    const vbAttr = svg.getAttribute("viewBox");
    if (vbAttr) {
        const p = vbAttr.split(/[\s,]+/).map(Number).filter(n => isFinite(n));
        if (p.length === 4) vbox = { x: p[0], y: p[1], w: p[2], h: p[3] };
    }
    if (!vbox) {
        const svgRect = svg.getBoundingClientRect();
        const w = parseFloat(svg.getAttribute("width") || "") || svgRect.width;
        const h = parseFloat(svg.getAttribute("height") || "") || svgRect.height;
        if (w > 0 && h > 0) vbox = { x: 0, y: 0, w, h };
    }
    if (!vbox) return { applied: false, reason: "no-viewbox" };

    // Anchor box for same-x sibling matching: the union of all legend containers.
    let lbL = Infinity, lbT = Infinity, lbR = -Infinity, lbB = -Infinity;
    for (const c of legendContainers) {
        const cb = userRectOf(c);
        lbL = Math.min(lbL, cb.left); lbT = Math.min(lbT, cb.top);
        lbR = Math.max(lbR, cb.right); lbB = Math.max(lbB, cb.bottom);
    }
    const legendBox: Rect = { left: lbL, top: lbT, right: lbR, bottom: lbB };

    // RIGHT-MARGIN FURNITURE: the generator often stacks the legend with sibling
    // annotation elements in the SAME column — a 2nd "encoding" legend, a
    // reference note, and (seen on a Sankey) the
    // legend's own UNCLASSED <text> labels when the generation appends swatch rects
    // and texts DIRECTLY to the svg with no wrapping <g>: the classed swatches
    // then resolve as their own containers and slide, while "Online"/"Region"/
    // header texts stay behind, still overlapping the plot. So gather every
    // legend container plus ANY svg-child sibling (g, text, rect — not just
    // <g>) that (a) sits in the legend's column (bbox.left at/right of the
    // stack's left edge minus tol) and (b) neither is nor contains a PLOT mark
    // — and slide them all together. Plot node labels are classed `.d3-mark`,
    // so they can never be swept up by (b); full-width backdrops fail (a).
    const tol = Math.max(8, vbox.w * 0.015);
    const isOrHasPlotMark = (el: Element): boolean => {
        if (el.matches && el.matches(".d3-mark") && !(el.classList && el.classList.contains("d3-legend-mark"))) return true;
        return groupHasPlotMark(el);
    };
    const furniture: Element[] = legendContainers.slice();
    if (mixedGroup) {
        // MIXED GROUP: the legend swatches live inside the plot group, so we
        // CAN'T sweep svg-child siblings (that's the plot itself). Instead gather
        // the legend's OWN texts from within the plot group, distinguished from
        // plot annotations by position: a legend's label/title sits AT OR RIGHT
        // of the swatch column's left edge (labels to the right of each swatch,
        // the title directly above at the swatch x), while a plot annotation that
        // merely lands nearby — a mean-line "Avg: $.." label, a "% of top" stage
        // label — sits LEFT of it. So take `<text>` (and stray non-mark rects)
        // inside legendGroup whose LEFT is >= the swatch column left (tiny tol)
        // and whose vertical band is near the legend. Plot bars are `.d3-mark`
        // (excluded); plot value labels sit left of the swatch column (excluded).
        const xTol = Math.min(4, tol);
        const yPad = Math.max(28, (legendBox.bottom - legendBox.top));
        const cand = legendGroup.querySelectorAll<SVGGraphicsElement>("text, rect");
        for (let i = 0; i < cand.length; i++) {
            const el = cand[i];
            if (furniture.indexOf(el) >= 0) continue;
            if (isOrHasPlotMark(el)) continue;
            const ub = userRectOf(el);
            if (ub.right <= ub.left || ub.bottom <= ub.top) continue;
            if (ub.left < legendBox.left - xTol) continue;                 // left of the swatch column → plot annotation
            if (ub.bottom < legendBox.top - yPad || ub.top > legendBox.bottom + yPad) continue; // far above/below the legend
            furniture.push(el);
        }
    } else {
        const parent = legendGroup.parentElement;
        if (parent) {
            const sibs = parent.children;
            for (let i = 0; i < sibs.length; i++) {
                const el = sibs[i];
                if (furniture.indexOf(el) >= 0) continue;
                const tag = el.tagName.toLowerCase();
                if (tag === "defs" || tag === "style" || tag === "title") continue;
                if (isOrHasPlotMark(el)) continue;
                const ub = userRectOf(el);
                if (ub.right <= ub.left || ub.bottom <= ub.top) continue;
                if (ub.left >= legendBox.left - tol) furniture.push(el);
            }
        }
    }

    // CONVERGENCE LOOP (seen live): a dx:27 slide was applied
    // yet the legend still overprinted the node labels — a single
    // measure→plan→apply pass TRUSTS the plan instead of VERIFYING the outcome,
    // and the `data-lch-legend-fixed` stamp then blocks any retry forever. So:
    // apply, RE-MEASURE the real DOM, and re-plan — up to 3 passes — until the
    // plan reports no remaining overlap. Each pass re-derives the CTM (the
    // viewBox may have been widened by the previous pass, which changes the
    // user↔px mapping) and re-measures furniture + plot content at their REAL
    // post-slide positions, so any underestimate in pass N is corrected by pass
    // N+1 rather than shipped. Single-pass cases behave exactly as before.
    const CAP = 4000;
    const inFurniture = (node: Node): boolean => furniture.some(f => f.contains(node));
    let totalDx = 0, totalDy = 0, totalExt = 0, passes = 0;
    let lastReason = "no-overlap";
    let lastW = vbox.w;
    for (let pass = 0; pass < 3; pass++) {
        const ctmP = svg.getScreenCTM();
        if (!ctmP) break;
        const invP = ctmP.inverse();
        const toUserP = (r: DOMRect): Rect => {
            const a = new DOMPoint(r.left, r.top).matrixTransform(invP);
            const b = new DOMPoint(r.right, r.bottom).matrixTransform(invP);
            return { left: Math.min(a.x, b.x), right: Math.max(a.x, b.x), top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) };
        };
        // Re-read the viewBox (pass > 0 may have widened it).
        let vbP: ViewBox | null = null;
        const vbA = svg.getAttribute("viewBox");
        if (vbA) {
            const p = vbA.split(/[\s,]+/).map(Number).filter(n => isFinite(n));
            if (p.length === 4) vbP = { x: p[0], y: p[1], w: p[2], h: p[3] };
        }
        if (!vbP) vbP = vbox;

        // Union bbox of the whole furniture stack at its CURRENT position.
        let uL = Infinity, uT = Infinity, uR = -Infinity, uB = -Infinity;
        for (const f of furniture) {
            const ub = toUserP((f as SVGGraphicsElement).getBoundingClientRect());
            uL = Math.min(uL, ub.left); uT = Math.min(uT, ub.top);
            uR = Math.max(uR, ub.right); uB = Math.max(uB, ub.bottom);
        }
        const unionBox: Rect = { left: uL, top: uT, right: uR, bottom: uB };

        // Plot content = marks + every <text> NOT inside ANY furniture group.
        const plotRects: Rect[] = [];
        for (let i = 0; i < plotMarks.length && plotRects.length < CAP; i++) {
            if (inFurniture(plotMarks[i])) continue;
            const r = plotMarks[i].getBoundingClientRect();
            if (r.width > 0 && r.height > 0) plotRects.push(toUserP(r));
        }
        const texts = svg.querySelectorAll<SVGGraphicsElement>("text");
        for (let i = 0; i < texts.length && plotRects.length < CAP; i++) {
            if (inFurniture(texts[i])) continue;
            const r = texts[i].getBoundingClientRect();
            if (r.width > 0 && r.height > 0) plotRects.push(toUserP(r));
        }

        // WHICH MARGIN. A classed legend keeps the right slide it has had since June,
        // untouched. A SIGNATURE legend picks its margin from its own geometry the way
        // the colorbar pass does - the corpus put 25 of its 74 colliding legends along
        // the BOTTOM, over the x-axis tick row, where a right slide is no remedy. A
        // legend inset in the left or centre of the plot gets null and is left alone:
        // relocating that across the chart is a re-layout, not a slide.
        const side: ReconcileSide | null = source === "class" ? "right" : colorbarReconcileSide(unionBox, vbP);
        if (!side) { lastReason = "not-a-margin-legend"; break; }
        const plan = planLegendReconcile(unionBox, plotRects, vbP, opts, side);
        lastReason = plan.reason;
        if (plan.action !== "reserve") break;

        svg.setAttribute("viewBox", `${plan.newViewBox.x} ${plan.newViewBox.y} ${plan.newViewBox.w} ${plan.newViewBox.h}`);
        if (!svg.getAttribute("preserveAspectRatio")) svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
        // Slide EVERY furniture group by the same dx (prepend so it composes with
        // the group's existing translate).
        for (const f of furniture) {
            const prior = f.getAttribute("transform") || "";
            // legendDy is 0 on the right side, so a classed legend's transform is
            // byte-identical to what it was.
            f.setAttribute("transform", `translate(${plan.legendDx},${plan.legendDy}) ${prior}`.trim());
        }
        totalDx += plan.legendDx; totalDy += plan.legendDy; totalExt += plan.ext; lastW = plan.newViewBox.w; passes++;
    }
    svg.setAttribute("data-lch-legend-fixed", "1");
    if (passes === 0) return { applied: false, reason: lastReason, furniture: furniture.length, source };
    return {
        applied: true, reason: passes > 1 ? `reserve-x${passes}` : "reserve",
        dx: totalDx, dy: totalDy || undefined, ext: totalExt, newW: lastW, furniture: furniture.length, source,
    };
}

/**
 * THE COLORBAR'S OWN FURNITURE, FOUND STRUCTURALLY. The class-based legend finder
 * above can't see a colorbar — the generator leaves the gradient rect UNCLASSED (and
 * reuses .d3-legend-mark for the clickable AXIS labels, which are COLLIDERS here,
 * not furniture). So: a <rect> filled url(#<gradient>) that isn't a plot mark; its
 * parent <g> is the colorbar group, which is what carries the tick labels, the
 * title and — the case that made this matter — a backing plate.
 *
 * Exported so the corpus replay measures with the SHIPPED detector instead of a
 * copy of it; a replay that re-implements the predicate tests the translation.
 */
export function findColorbarFurniture(svg: SVGSVGElement): { groups: Element[]; bars: SVGGraphicsElement[] } {
    const none = { groups: [] as Element[], bars: [] as SVGGraphicsElement[] };
    // Gradient ids defined anywhere in the SVG.
    const gradIds = new Set<string>();
    const grads = svg.querySelectorAll("linearGradient[id], radialGradient[id]");
    for (let i = 0; i < grads.length; i++) {
        const id = grads[i].getAttribute("id");
        if (id) gradIds.add("#" + id);
    }
    if (gradIds.size === 0) return none;

    // Gradient-filled rects that are NOT plot marks → colorbar bars.
    const bars: SVGGraphicsElement[] = [];
    const rects = svg.querySelectorAll<SVGGraphicsElement>("rect");
    for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (r.classList && r.classList.contains("d3-mark") && !r.classList.contains("d3-legend-mark")) continue;
        const fill = r.getAttribute("fill") || (r.style && r.style.fill) || "";
        const m = /url\((#[^)\s]+)\)/.exec(fill);
        if (m && gradIds.has(m[1])) bars.push(r);
    }
    if (bars.length === 0) return none;

    // Furniture = each bar's parent <g> (the colorbar group), deduped; fall back
    // to the bar itself when it sits directly under <svg>. The BARS are kept apart
    // from the groups: the group is what MOVES (it carries the ticks, the title and
    // the plate), the bar is what the occlusion test MEASURES.
    const furnSet = new Set<Element>();
    for (const bar of bars) {
        const p = bar.parentElement;
        furnSet.add(p && p !== (svg as Element) && p.tagName.toLowerCase() === "g" ? p : bar);
    }
    return { groups: Array.from(furnSet), bars };
}

/**
 * IS THERE MARK INK UNDER THE BAR? The browser's own answer, asked at
 * colorbarProbePoints: `isPointInFill` / `isPointInStroke` on each candidate mark.
 *
 * WHY NOT THE BOUNDING BOX. A density-contour plot's outermost contour
 * can be a thin diagonal band; its box is 705x664 of a 776x779 canvas, so it "covers" a
 * colorbar its ink never reaches. Box-only, this pass moved that chart - a correctly
 * placed colorbar on a chart with no defect - which is half of everything it moved.
 *
 * `bar` arrives in USER space and the probes are mapped back through the SVG's CTM into
 * SCREEN space, then into each ELEMENT's own space: a mark inside a transformed group
 * has its own matrix, and asking isPointInFill in the wrong one silently answers about a
 * different place on the canvas. Fail-open twice over - an element with no geometry API
 * (an <image>, a <foreignObject>) or no CTM counts as ink, because the box already said
 * it was there and refusing to move on a technicality reinstates the defect.
 */
function barHasMarkInkUnderIt(
    svg: SVGSVGElement,
    bar: Rect,
    ctm: DOMMatrix,
    inFurniture: (n: Node) => boolean,
): boolean {
    const probes = colorbarProbePoints(bar);
    if (probes.length === 0) return false;
    const screen = probes.map(p => new DOMPoint(p.x, p.y).matrixTransform(ctm));
    const marks = svg.querySelectorAll<SVGGraphicsElement>(".d3-mark");
    const hit = new Array(probes.length).fill(false);
    let hits = 0;
    for (let i = 0; i < marks.length && hits < probes.length; i++) {
        const el = marks[i];
        if (inFurniture(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        const geo = el as unknown as SVGGeometryElement;
        let inv: DOMMatrix | null = null;
        const canProbe = typeof geo.isPointInFill === "function";
        if (canProbe) {
            const m = el.getScreenCTM();
            inv = m ? m.inverse() : null;
        }
        for (let p = 0; p < screen.length; p++) {
            if (hit[p]) continue;
            const s = screen[p];
            // Cheap reject first: the element's own client box.
            if (s.x < r.left || s.x > r.right || s.y < r.top || s.y > r.bottom) continue;
            let painted = true;
            if (canProbe && inv) {
                const q = new DOMPoint(s.x, s.y).matrixTransform(inv);
                try {
                    painted = geo.isPointInFill(q)
                        || (typeof geo.isPointInStroke === "function" && geo.isPointInStroke(q));
                } catch {
                    painted = true;   // unaskable: the box stands
                }
            }
            if (painted) { hit[p] = true; hits++; }
        }
    }
    return colorbarOnPlot(hits, probes.length);
}

/**
 * COLORBAR pass (first seen on a faceted heatmap):
 * a colorbar the class-based finder cannot see, drawn over content it should sit
 * beside. Push it clear + extend the viewBox on that side (planLegendReconcile).
 * The planner's own gates (strip-vs-column, margin-anchored, must-overlap-content)
 * keep a decorative / area-fill gradient from triggering. Browser-only
 * (getScreenCTM) + fail-open.
 *
 * BOTH MARGINS. It first asked for side "bottom" and nothing
 * else, which was the shape of the first case — so a VERTICAL colorbar inset into
 * the plot was detected, measured, refused "not-horizontal-legend", and shipped
 * covering the marks. The side now comes from the bar's own geometry
 * (colorbarReconcileSide); everything downstream is the machinery that already
 * moved classed legends off the plot.
 */
function reconcileColorbarPhase(svg: SVGSVGElement, opts: ReconcileOptions = {}): { applied: boolean; reason: string; cb?: string } {
    const found = findColorbarFurniture(svg);
    const furniture = found.groups;
    if (furniture.length === 0) return { applied: false, reason: "no-colorbar" };

    const vbox0 = readViewBox(svg);
    if (!vbox0) return { applied: false, reason: "no-viewbox" };

    const inFurniture = (node: Node): boolean => furniture.some(f => f === node || f.contains(node));
    const CAP = 4000;
    let totalDx = 0, totalDy = 0, totalExt = 0, passes = 0;
    let lastReason = "no-overlap";
    let sideUsed: ReconcileSide = "bottom";

    for (let pass = 0; pass < 3; pass++) {
        const ctm = svg.getScreenCTM();
        if (!ctm) break;
        const inv = ctm.inverse();
        const toUser = (r: DOMRect): Rect => {
            const a = new DOMPoint(r.left, r.top).matrixTransform(inv);
            const b = new DOMPoint(r.right, r.bottom).matrixTransform(inv);
            return { left: Math.min(a.x, b.x), right: Math.max(a.x, b.x), top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) };
        };
        const vbP = readViewBox(svg) || vbox0;

        // Union of the colorbar furniture at its current position.
        let uL = Infinity, uT = Infinity, uR = -Infinity, uB = -Infinity;
        for (const f of furniture) {
            const ub = toUser((f as SVGGraphicsElement).getBoundingClientRect());
            uL = Math.min(uL, ub.left); uT = Math.min(uT, ub.top);
            uR = Math.max(uR, ub.right); uB = Math.max(uB, ub.bottom);
        }
        const unionBox: Rect = { left: uL, top: uT, right: uR, bottom: uB };

        // Colliders = plot marks + ALL text NOT inside the colorbar furniture (the
        // .d3-legend-mark x-axis labels are colliders here, not furniture).
        const plotRects: Rect[] = [];
        const marks = svg.querySelectorAll<SVGGraphicsElement>(".d3-mark");
        for (let i = 0; i < marks.length && plotRects.length < CAP; i++) {
            if (inFurniture(marks[i])) continue;
            const r = marks[i].getBoundingClientRect();
            if (r.width > 0 && r.height > 0) plotRects.push(toUser(r));
        }
        // Marks occupy [0, markCount); the text that follows is a collider for the
        // BOTTOM push only — see the right-side gate below.
        const markCount = plotRects.length;
        const texts = svg.querySelectorAll<SVGGraphicsElement>("text");
        for (let i = 0; i < texts.length && plotRects.length < CAP; i++) {
            if (inFurniture(texts[i])) continue;
            const r = texts[i].getBoundingClientRect();
            if (r.width > 0 && r.height > 0) plotRects.push(toUser(r));
        }

        // WHICH MARGIN, decided from the bar itself and re-decided every pass — the
        // union box moves as the furniture moves, and a pass that changed the answer
        // would be pushing against its own previous move.
        const side = colorbarReconcileSide(unionBox, vbP);
        if (!side) { lastReason = "not-a-margin-colorbar"; break; }

        // THE RIGHT SIDE CARRIES AN EXTRA GATE, AND THE BOTTOM DELIBERATELY DOES NOT.
        // The bottom push answers "the x-axis has grown INTO the margin the colorbar is
        // parked in" — furniture against furniture, where any overlap is the defect and
        // where this pass has shipped since June. The right slide answers a different
        // question, "the colorbar was drawn ON the chart", and the corpus says the two
        // must not share a predicate: on the group box alone the right branch moved 89 of
        // 401 rendered generations, where only 15 have a mark under the bar at all. So the
        // right side must SEE the marks it is covering (colorbarSitsOnMarks), and the
        // bottom side keeps exactly the behaviour it had.
        if (side === "right") {
            let bL = Infinity, bT = Infinity, bR = -Infinity, bB = -Infinity;
            for (const bar of found.bars) {
                const bb = toUser(bar.getBoundingClientRect());
                bL = Math.min(bL, bb.left); bT = Math.min(bT, bb.top);
                bR = Math.max(bR, bb.right); bB = Math.max(bB, bb.bottom);
            }
            const barBox: Rect = { left: bL, top: bT, right: bR, bottom: bB };
            // Marks only. A colorbar that covers no mark is not covering the chart, and a
            // LABEL it lands near is the content-fit / bottom-text passes' business.
            const markRects = plotRects.slice(0, markCount);
            if (!(bR > -Infinity) || !colorbarSitsOnMarks(barBox, markRects)
                || !barHasMarkInkUnderIt(svg, barBox, ctm, inFurniture)) {
                lastReason = "colorbar-clear-of-marks";
                break;
            }
        }
        sideUsed = side;

        const plan = planLegendReconcile(unionBox, plotRects, vbP, opts, side);
        lastReason = plan.reason;
        if (plan.action !== "reserve") break;

        svg.setAttribute("viewBox", `${plan.newViewBox.x} ${plan.newViewBox.y} ${plan.newViewBox.w} ${plan.newViewBox.h}`);
        if (!svg.getAttribute("preserveAspectRatio")) svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
        // Move EVERY colorbar group by the same delta (prepend so it composes with
        // the group's existing translate). Only one of dx/dy is ever non-zero — the
        // planner zeroes the axis it is not reserving against.
        for (const f of furniture) {
            const prior = f.getAttribute("transform") || "";
            f.setAttribute("transform", `translate(${plan.legendDx},${plan.legendDy}) ${prior}`.trim());
        }
        totalDx += plan.legendDx; totalDy += plan.legendDy; totalExt += plan.ext; passes++;
    }

    if (passes === 0) return { applied: false, reason: lastReason };
    return {
        applied: true, reason: "reserve",
        cb: sideUsed === "right" ? `dx${totalDx} w+${totalExt}` : `dy${totalDy} h+${totalExt}`,
    };
}

/**
 * BOTTOM TEXT FURNITURE (a binned bubble matrix
 * drew its x-axis title at a fixed `plotH + 42`, landing it ON TOP OF the rotated
 * tick labels; the bottom-colorbar phase didn't apply (no colorbar) and
 * fitSvgToContent only prevents clipping, not this overlap). Pushes a SPANNING
 * axis-title / caption <text> down to sit below the deepest tick label. Pure
 * decision (>=2 tick-hit gate, dy) lives in planBottomTextPush; this is the DOM
 * glue. Conservative + fail-open: only bare <text> that spans >=2 tick labels
 * moves, so a narrow per-item legend label (which a push would detach from its
 * swatch) is left alone, and a correctly-placed title (no tick overlap) is untouched.
 */
function reconcileBottomTextPhase(svg: SVGSVGElement): { applied: boolean; bt?: string } {
    const vbox = readViewBox(svg);
    if (!vbox) return { applied: false };
    const ctm = svg.getScreenCTM();
    if (!ctm) return { applied: false };
    const inv = ctm.inverse();
    const toUser = (r: DOMRect): Rect => {
        const a = new DOMPoint(r.left, r.top).matrixTransform(inv);
        const b = new DOMPoint(r.right, r.bottom).matrixTransform(inv);
        return { left: Math.min(a.x, b.x), right: Math.max(a.x, b.x), top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) };
    };
    // Axis tick labels = <text> inside a `.tick` group (the D3 axis). They are the
    // floor a spanning title/caption must sit BELOW; they themselves never move.
    const tickEls = svg.querySelectorAll<SVGGraphicsElement>(".tick text");
    if (tickEls.length === 0) return { applied: false };
    const tickBoxes: Rect[] = [];
    for (let i = 0; i < tickEls.length; i++) {
        const r = tickEls[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0) tickBoxes.push(toUser(r));
    }
    if (tickBoxes.length === 0) return { applied: false };

    const inTick = (n: Node): boolean => {
        let p: Element | null = (n as Element);
        while (p) { if (p.classList && p.classList.contains("tick")) return true; p = p.parentElement; }
        return false;
    };

    const GAP = 6;
    let moved = 0, maxDy = 0, maxBottom = -Infinity;
    const texts = svg.querySelectorAll<SVGGraphicsElement>("text");
    const CAP = 4000;
    for (let i = 0; i < texts.length && i < CAP; i++) {
        const el = texts[i];
        if (inTick(el)) continue;
        if (el.classList && (el.classList.contains("d3-mark") || el.classList.contains("d3-legend-mark"))) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        const box = toUser(r);
        // The element's OWN transform, read before anything is written to it: a
        // `rotate(-90)` y-axis title is not a bottom caption whatever its box says.
        // An ancestor's rotate never reaches this string, which is why
        // the planner's aspect test is the rule and this is only its cheap second half.
        const prior = el.getAttribute("transform") || "";
        const plan = planBottomTextPush(box, tickBoxes, GAP, prior);
        if (!plan.move) continue;
        el.setAttribute("transform", `translate(0,${plan.dy}) ${prior}`.trim());
        moved++;
        if (plan.dy > maxDy) maxDy = plan.dy;
        const nb = box.bottom + plan.dy;
        if (nb > maxBottom) maxBottom = nb;
    }
    if (moved === 0) return { applied: false };
    // Grow the viewBox bottom if the pushed text now extends past it (fitSvgToContent
    // runs after and would also catch this, but keep the phase self-contained).
    if (maxBottom > vbox.y + vbox.h) {
        const newH = (maxBottom - vbox.y) + GAP;
        svg.setAttribute("viewBox", `${vbox.x} ${vbox.y} ${vbox.w} ${newH}`);
        if (!svg.getAttribute("preserveAspectRatio")) svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    }
    return { applied: true, bt: `moved${moved} dy${Math.round(maxDy)}` };
}
