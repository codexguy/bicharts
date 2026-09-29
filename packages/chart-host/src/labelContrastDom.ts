/*
    RECOLOURING IN-MARK LABELS THAT THE GENERATED CODE MIS-JUDGED - the DOM half.

    MOVED HERE FROM THE POWER BI VISUAL. The pure decision is in `labelContrast.ts`; this is the
    thin DOM layer that feeds it, plus `applyLabelContrast` - the one call a host makes after a
    render to get the visual's behaviour.

    WHY EVERY HOST NEEDS IT, stated once: a generated chart puts a value or category label ON a
    coloured tile, bar or cell and picks the label's colour from the mark's NOMINAL hue. The
    mark's ACTUAL rendered fill is something else - a 0.18-opacity band over white reads pale, a
    translucent pill over a tile composites to a third colour - and only a post-render measurement
    of the real DOM knows the difference. That is browser behaviour, not Power BI behaviour, so
    before this module the Excel add-in and a React page shipped every one of those unreadable
    labels that the visual had already learned to fix.

    THE SHAPE OF THE PASS. For every <text> in the container: find the filled shapes drawn
    BENEATH it whose geometry actually backs its glyph box (isPointInFill over a small sample
    grid - a bounding box is exact for a rect and wrong for a ring, whose box contains its hole),
    pick the topmost opaque one as the cell and any translucent shape drawn above it as a pill,
    composite the real stack over the page background, and hand the result to decideLabelColor.
    Then apply what it says. Every guard in here is an incident; the comments name them so a
    future edit knows what it is about to reopen.

    NOTHING HERE THROWS. It runs after a render that already succeeded and must never be the
    reason a delivered chart fails. Where the engine cannot answer a geometry question (jsdom, a
    detached node) the pass keeps the coarser answer it already had, never a guess.
*/
import {
    decideLabelColor, toRGBA, compositeOver, MIN_CONTRAST, isPillBackdropAlpha,
    PILL_MIN_ALPHA, PILL_OPAQUE_ALPHA, cellSuppressesNormalize, pillBacksGlyph,
    backingHoldsGlyph, glyphSampleGrid, straddleSampleGrid, straddles, minContrastOver, pickColorOver,
    STRADDLE_PILL_ALPHA, STRADDLE_TARGET_CONTRAST,
} from "./labelContrast";

/** The attribute a recoloured (or pill-backed) label carries, so a second pass in the same
 *  render leaves it alone. Generated code that rebuilds its text nodes clears it by construction. */
export const LABEL_CONTRAST_DONE_ATTR = "data-lch-contrast";

/** How many shapes / texts the pass will consider before declining. Layout reads in a loop, so
 *  it is a real ceiling: a 5,000-cell heatmap is the size of thing this exists for, a 50,000-node
 *  scatter is not, and on the latter the pass costs more than the defect it would fix. */
export const LABEL_CONTRAST_CAP = 2000;

export interface LabelContrastOptions {
    /** The opaque canvas the marks sit on. Default white; a host with a themed or high-contrast
     *  background passes it, or every "is this label readable" answer is measured against the
     *  wrong page. */
    pageBg?: string;
    /** Override the DOM ceiling. */
    cap?: number;
}

export interface LabelContrastReport {
    /** Filled shapes harvested as candidate backings. */
    rects: number;
    /** Labels that resolved a backing and were judged. */
    scanned: number;
    /** Labels recoloured. `fixed === scanned` is the module's own tell for a pass that is not
     *  measuring anything - see the incident notes in labelContrast.ts. */
    fixed: number;
    /** Translucent backdrops boosted to opaque so they actually back their label. */
    pillsBoosted: number;
    /** Labels whose candidates' BOXES contained them but whose FILLS did not - a ring's hole. */
    offFill: number;
    /** Labels mostly over the page with one end clipping a mark - handed back to the chart. */
    pageMajority: number;
    /** Labels with a painting shape over their box that was set aside because it is drawn ON TOP
     *  of them - an occluder, never a background. See drawnBeneath. */
    paintedOver: number;
    /** Labels straddling a fill edge that got a page-coloured pill of their own instead of a
     *  recolour - one colour cannot read on two surfaces with opposite needs. */
    straddlePills: number;
    /** Adopted pills grown to cover their label's whole box, so no glyph starts off the pill. */
    pillsExtended: number;
    /** Labels partly covered by a shape drawn after them in their own group, moved above it. */
    raised: number;
    /** Why the pass did nothing, when it did nothing. */
    skipped?: "no-container" | "no-shapes" | "too-many-shapes" | "too-many-texts" | "error";
}

const EMPTY: LabelContrastReport = { rects: 0, scanned: 0, fixed: 0, pillsBoosted: 0, offFill: 0, pageMajority: 0, paintedOver: 0,
                                      straddlePills: 0, pillsExtended: 0, raised: 0 };

type HostRect = { r: DOMRect; fill: string; op: number; area: number; el: Element; ord: number; root: Element | null };

/*
    WHICH SAMPLE POINTS LAND INSIDE THE SHAPE'S FILL, not just how many. The count is all the
    per-shape ranking needs, but the caller also has to know whether two marks cover the SAME
    points or DIFFERENT ones to union them - a label overflowing a small tile onto its neighbours
    is wholly on marks; a label straddling a ring's hole is mostly on canvas; per-shape counts
    cannot tell those apart. Returns null when the engine cannot answer (no isPointInFill, a
    detached node), and the caller keeps the bounding-box overlap it already had - so this can
    only ever narrow a backing, never invent one.
*/
function backedSamples(el: Element, pts: { x: number; y: number }[]): boolean[] | null {
    try {
        const ge = el as SVGGeometryElement;
        if (typeof ge.isPointInFill !== "function" || typeof ge.getScreenCTM !== "function") return null;
        const m = ge.getScreenCTM();
        const svg = ge.ownerSVGElement;
        if (!m || !svg || typeof svg.createSVGPoint !== "function") return null;
        if (pts.length === 0) return null;
        const inv = m.inverse();
        const hit: boolean[] = [];
        for (let i = 0; i < pts.length; i++) {
            const p = svg.createSVGPoint();
            p.x = pts[i].x; p.y = pts[i].y;
            hit.push(ge.isPointInFill(p.matrixTransform(inv)));
        }
        return hit;
    } catch {
        return null; // no layout engine / cross-document node
    }
}

/*
    A SHAPE PAINTED OVER A LABEL IS NOT THAT LABEL'S BACKGROUND (an incident: the ring value
    labels of a rose chart, "$2,000,000" and "$3,000,000", repainted #ffffff on a WHITE page).

    The chart drew its grid rings first - each ring's value on a page-coloured plate - and the
    opaque wedges after them, so the longest wedges cover the first half of those two labels.
    Nothing here asked which was drawn first, so the wedge under the covered half was taken for
    the label's background and the whole label was recoloured to contrast with it: the half that
    is actually visible, sitting on the plate and the canvas, vanished. Measured in real Chromium
    on that generation's own code at its real size: rects 55, scanned 3, fixed 3 - the same
    `fixed === scanned` tell this module already names.

    Inside one <svg> the painter's model settles it: document order IS paint order (SVG has no
    z-index any browser honours), so a shape that comes AFTER the text occludes it. Recolouring
    cannot make a covered glyph readable, and a translucent occluder adopted as a "pill" gets
    BOOSTED to 0.9 over the very text it was supposed to back. Such a shape is dropped from
    candidacy; the label is judged against what is really beneath it, or left alone when nothing
    is.

    ACROSS two <svg> elements, order is CSS stacking (position, z-index), which document order
    does NOT decide - an absolutely-positioned label layer can sit above a marks layer that
    follows it. So the rule is scoped to one outermost <svg>, and a shape in another one keeps
    the behaviour this pass has always had: it can only ever narrow a backing, never invent one.
*/
// Node.DOCUMENT_POSITION_FOLLOWING, spelled out: this module must not need a DOM global to load.
const DOC_POSITION_FOLLOWING = 4;

/** The outermost <svg> an element is drawn in, looking no further out than the container. */
function paintRoot(el: Element, container: Element): Element | null {
    let root: Element | null = null;
    for (let n: Element | null = el.parentElement; n; n = n.parentElement) {
        if (String(n.tagName || "").toLowerCase() === "svg") root = n;
        if (n === container) break;
    }
    return root;
}

/** True unless the shape is drawn ON TOP of the text - later in document order in the same SVG.
 *  Unknowable (another SVG, no compareDocumentPosition) keeps the answer the pass already had. */
function drawnBeneath(shape: HostRect, text: Element, textRoot: Element | null): boolean {
    if (!shape.root || shape.root !== textRoot) return true;
    if (typeof shape.el.compareDocumentPosition !== "function") return true;
    return (shape.el.compareDocumentPosition(text) & DOC_POSITION_FOLLOWING) !== 0;
}

/*
    THE BACKGROUND UNDER EACH SAMPLE POINT: every shape that paints there, composited in paint
    order over the page. Null when any shape cannot answer the geometry (jsdom, a detached node) -
    a straddle is only ever declared on a measured label.
*/
function sampleBackgrounds(
    shapes: HostRect[], pts: { x: number; y: number }[], pageRGB: [number, number, number],
    effAlpha: (mk: HostRect) => number,
): [number, number, number][] | null {
    if (pts.length === 0 || shapes.length === 0) return null;
    const ordered = shapes.slice().sort((a, b) => a.ord - b.ord);
    const masks: boolean[][] = [];
    for (const mk of ordered) {
        const m = backedSamples(mk.el, pts);
        if (m === null) return null;
        masks.push(m);
    }
    return pts.map((_, i) => {
        let bg: [number, number, number] = [pageRGB[0], pageRGB[1], pageRGB[2]];
        for (let k = 0; k < ordered.length; k++) {
            if (!masks[k][i]) continue;
            const a = effAlpha(ordered[k]);
            if (a < PILL_MIN_ALPHA) continue;
            const c = toRGBA(ordered[k].fill);
            if (c) bg = compositeOver([c[0], c[1], c[2], a], bg);
        }
        return bg;
    });
}

/*
    A PILL BACKS ITS WHOLE LABEL (an incident: a Bullet chart's value labels on dark navy bars).
    The chart drew each value right-aligned at the bar's end and sized its light backdrop by a
    character-count estimate, so the pill started one glyph after the text did: the pass boosted
    the pill, judged the label against it, and the first digit stayed dark on navy - "50%" read
    "0%", "100%" read "l00%". An adopted pill therefore grows to cover the label's box (a padded
    union, never a shrink), in the pill's own coordinates. Axis-aligned rects only: a rotated or
    skewed frame has no box to union, and it is left as it is.
*/
function extendPillOver(pill: Element, tr: DOMRect): boolean {
    try {
        if (String(pill.tagName || "").toLowerCase() !== "rect") return false;
        const ge = pill as SVGGraphicsElement;
        if (typeof ge.getScreenCTM !== "function") return false;
        const m = ge.getScreenCTM();
        if (!m || Math.abs(m.b) > 1e-6 || Math.abs(m.c) > 1e-6 || !(m.a > 0) || !(m.d > 0)) return false;
        const inv = m.inverse();
        const toUser = (x: number, y: number) => ({ x: inv.a * x + inv.c * y + inv.e, y: inv.b * x + inv.d * y + inv.f });
        const a = toUser(tr.left, tr.top), b = toUser(tr.right, tr.bottom);
        const num = (k: string) => { const v = parseFloat(pill.getAttribute(k) || ""); return isFinite(v) ? v : NaN; };
        const x = num("x"), y = num("y"), w = num("width"), h = num("height");
        if (![x, y, w, h].every(v => isFinite(v)) || !(w > 0) || !(h > 0)) return false;
        const pad = 1 / m.a;
        const x0 = Math.min(x, Math.min(a.x, b.x) - pad), x1 = Math.max(x + w, Math.max(a.x, b.x) + pad);
        const y0 = Math.min(y, Math.min(a.y, b.y) - pad), y1 = Math.max(y + h, Math.max(a.y, b.y) + pad);
        if (x0 >= x - 0.01 && x1 <= x + w + 0.01 && y0 >= y - 0.01 && y1 <= y + h + 0.01) return false;
        pill.setAttribute("x", String(+x0.toFixed(2)));
        pill.setAttribute("y", String(+y0.toFixed(2)));
        pill.setAttribute("width", String(+(x1 - x0).toFixed(2)));
        pill.setAttribute("height", String(+(y1 - y0).toFixed(2)));
        return true;
    } catch {
        return false;
    }
}

/*
    A LABEL HALF UNDER A MARK DRAWN AFTER IT IS RAISED ABOVE THAT MARK (an incident: a Pareto
    chart drew its dashed 80% line and the line's label, then the bars - so the first bar covered
    everything after "80%" and a reader saw a threshold with no name). Recolouring cannot make a
    covered glyph readable, which is why a shape drawn over a label is never its background; but a
    label that is PARTLY covered is a label the chart meant to show, and the part a reader can see
    proves it. So such a label moves to the end of its own parent - after its occluder in paint
    order - and is then judged against the occluder like any backing (a straddle gets a pill).

    Narrow on purpose. Every occluder must sit inside the label's own parent, so the move keeps the
    label's coordinate system, its inherited attributes and its place in any selection the chart
    holds on that parent; an occluder in another group (a rose chart's wedges over its ring values'
    group) leaves the label where it is. Only opaque occluders count, only a measured label moves,
    and a label covered WHOLLY is left alone - nothing of it shows, so nothing says it was meant to.
*/
function raiseOverOccluders(
    tx: SVGGraphicsElement, occluders: HostRect[], tr: DOMRect, effAlpha: (mk: HostRect) => number,
): boolean {
    try {
        const parent = tx.parentNode as Element | null;
        if (!parent || typeof parent.contains !== "function") return false;
        if (!occluders.every(o => parent.contains(o.el))) return false;
        const pts = straddleSampleGrid(tr);
        if (pts.length === 0) return false;
        const covered = pts.map(() => false);
        let opaque = 0;
        for (const o of occluders) {
            if (effAlpha(o) < PILL_OPAQUE_ALPHA) continue;
            const m = backedSamples(o.el, pts);
            if (m === null) return false;
            opaque++;
            for (let i = 0; i < m.length; i++) if (m[i]) covered[i] = true;
        }
        const n = covered.filter(Boolean).length;
        if (opaque === 0 || n === 0 || n === pts.length) return false;
        parent.appendChild(tx);
        return true;
    } catch {
        return false;
    }
}

/** The class a pill this pass paints carries, so a reader of the DOM (or a test) can tell it from
 *  the chart's own shapes. */
export const LABEL_PILL_CLASS = "lch-label-pill";

/*
    A PILL OF THE LABEL'S OWN, drawn immediately BEFORE the text in its own parent - so it paints
    under the text and over everything the text was drawn over - with the text's own transform, so
    a rotated label gets a rotated pill. Sized from getBBox, the text's box in its own user space.
    Null when the engine cannot answer (no getBBox, an empty box): the caller keeps the best single
    colour instead.
*/
function addPill(tx: SVGGraphicsElement, fill: string): Element | null {
    try {
        const parent = tx.parentNode as Element | null;
        if (!parent || typeof (tx as any).getBBox !== "function") return null;
        const bb = (tx as any).getBBox();
        if (!bb || !(bb.width > 0) || !(bb.height > 0)) return null;
        const doc = tx.ownerDocument;
        if (!doc) return null;
        const r = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
        const px = Math.max(2, bb.height * 0.2), py = 1;
        r.setAttribute("x", String(+(bb.x - px).toFixed(2)));
        r.setAttribute("y", String(+(bb.y - py).toFixed(2)));
        r.setAttribute("width", String(+(bb.width + 2 * px).toFixed(2)));
        r.setAttribute("height", String(+(bb.height + 2 * py).toFixed(2)));
        r.setAttribute("rx", "2");
        r.setAttribute("fill", fill);
        r.setAttribute("fill-opacity", String(STRADDLE_PILL_ALPHA));
        r.setAttribute("pointer-events", "none");
        r.setAttribute("class", LABEL_PILL_CLASS);
        r.setAttribute(LABEL_CONTRAST_DONE_ATTR, "1");
        const tf = tx.getAttribute("transform");
        if (tf) r.setAttribute("transform", tf);
        parent.insertBefore(r, tx);
        return r;
    } catch {
        return null;
    }
}

/*
    THE ONE CALL A HOST MAKES AFTER A RENDER.

    Idempotent within a render (LABEL_CONTRAST_DONE_ATTR), additive (it only ever sets a text's
    fill and, for a pill, a rect's fill/opacity and box - or paints a pill of its own under a
    label that straddles two surfaces), and bounded. Returns what it did so a host can
    log it; the numbers are the ones the visual has logged since this pass existed, so a line
    from any host reads the same way.
*/
export function applyLabelContrast(
    container: HTMLElement | null | undefined,
    opts: LabelContrastOptions = {},
): LabelContrastReport {
    const report: LabelContrastReport = { ...EMPTY };
    if (!container) { report.skipped = "no-container"; return report; }
    const CAP = opts.cap ?? LABEL_CONTRAST_CAP;
    const pageBg = opts.pageBg || "#ffffff";
    try {
        // Harvest EVERY filled background shape - <rect> AND <path> - regardless of class.
        // Codegen tags marks for CROSS-FILTER, not contrast-backing: a nested treemap classes
        // only the PARENT tiles, so a harvest keyed on the mark class never saw the LEAF tiles
        // that actually sit behind the value labels. `ord` = paint order (later = on top) so the
        // TOPMOST visible background under each glyph can be resolved rather than the largest.
        const rects: HostRect[] = [];
        let ord = 0;
        const pushShape = (el: Element) => {
            const tag = el.tagName.toLowerCase();
            if (tag !== "rect" && tag !== "path") return;
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) return;
            let fill = el.getAttribute("fill") || "";
            const win: any = container.ownerDocument?.defaultView;
            if ((!fill || fill === "none") && win && typeof win.getComputedStyle === "function") {
                fill = win.getComputedStyle(el).fill || "";
            }
            if (!fill || fill === "none") return;
            const opAttr = el.getAttribute("fill-opacity");
            const op = opAttr === null ? 1 : parseFloat(opAttr);
            rects.push({ r, fill, op: isFinite(op) ? op : 1, area: r.width * r.height, el, ord: ord++,
                         root: paintRoot(el, container) });
        };
        const shapeEls = container.querySelectorAll<SVGGraphicsElement>("rect, path");
        if (shapeEls.length === 0) { report.skipped = "no-shapes"; return report; }
        if (shapeEls.length > CAP) { report.skipped = "too-many-shapes"; return report; }
        for (let i = 0; i < shapeEls.length; i++) pushShape(shapeEls[i]);
        if (rects.length === 0) { report.skipped = "no-shapes"; return report; }
        report.rects = rects.length;

        // Effective alpha = the fill's own alpha (rgba()) x its fill-opacity attr. A pill can be
        // made translucent either way; a heatmap once used an rgba() alpha with NO fill-opacity
        // attr, which an attr-only check missed.
        const pageRGBA = toRGBA(pageBg) || ([255, 255, 255, 1] as [number, number, number, number]);
        const pageRGB: [number, number, number] = [pageRGBA[0], pageRGBA[1], pageRGBA[2]];
        const effAlpha = (mk: HostRect) => { const c = toRGBA(mk.fill); return (c ? c[3] : 1) * mk.op; };

        const texts = container.querySelectorAll<SVGGraphicsElement>("text");
        if (texts.length > CAP) { report.skipped = "too-many-texts"; return report; }
        const win: any = container.ownerDocument?.defaultView;
        for (let t = 0; t < texts.length; t++) {
            const tx = texts[t];
            if (tx.getAttribute(LABEL_CONTRAST_DONE_ATTR) === "1") continue; // idempotent
            const tr = tx.getBoundingClientRect();
            if (tr.width <= 0 || tr.height <= 0) continue;
            // Resolve the background by greatest OVERLAP with the glyph box, NOT a single
            // centre-point hit: a small or overflowing label's centre can land on a tile border
            // or gap, so centre sampling found no background, skipped it, and it stayed
            // default-black while its SAME-colour neighbours flipped. Overlap-area is stable for
            // tiny tiles.
            const ovArea = (r: DOMRect) =>
                Math.max(0, Math.min(r.right, tr.right) - Math.max(r.left, tr.left)) *
                Math.max(0, Math.min(r.bottom, tr.bottom) - Math.max(r.top, tr.top));
            const glyphArea = tr.width * tr.height;
            // Bounding boxes first (cheap, and all 99% of shapes need), then refine each survivor
            // to the area it REALLY backs. The prefilter keeps the point tests bounded: they run
            // on the handful of shapes whose box overlaps this glyph, never on the whole harvest.
            // A shape drawn OVER the label is dropped here - it is an occluder, not a backing -
            // and counted once per label when it actually paints, so the rule is visible in the
            // telemetry line rather than inferred from a fix that stopped happening.
            const txRoot = paintRoot(tx, container);
            let over = 0;
            const occluders: HostRect[] = [];
            const boxed = rects
                .map(mk => ({ mk, ov: ovArea(mk.r) }))
                .filter(x => {
                    if (!(x.ov > 0)) return false;
                    if (drawnBeneath(x.mk, tx, txRoot)) return true;
                    if (effAlpha(x.mk) >= PILL_MIN_ALPHA) { over++; occluders.push(x.mk); }
                    return false;
                });
            // A PARTLY COVERED LABEL IS RAISED - see raiseOverOccluders. Its occluders are then
            // beneath it, and it is judged against them like any other backing.
            const raised = occluders.length > 0 && raiseOverOccluders(tx, occluders, tr, effAlpha);
            if (raised) {
                report.raised++;
                tx.setAttribute(LABEL_CONTRAST_DONE_ATTR, "1");
                for (const mk of occluders) boxed.push({ mk, ov: ovArea(mk.r) });
                over = 0;
            }
            if (over > 0) report.paintedOver++;
            // One grid per glyph, shared by every candidate, so the hits can be UNIONED.
            // `painted` accumulates the points held by shapes that actually put colour down: a
            // fill:'transparent' cross-filter hit target passes isPointInFill over its whole disc
            // and would otherwise report a ring's hole as covered - the alpha IS the colour there,
            // exactly as the pill floor says.
            const pts = glyphSampleGrid({ left: tr.left, top: tr.top, width: tr.width, height: tr.height });
            const painted: boolean[] = pts.map(() => false);
            let unmeasured = 0;
            const under = boxed
                .map(x => {
                    const mask = backedSamples(x.mk.el, pts);
                    if (mask === null) { unmeasured++; return x; }
                    let inside = 0;
                    const paints = effAlpha(x.mk) >= PILL_MIN_ALPHA;
                    for (let i = 0; i < mask.length; i++) {
                        if (!mask[i]) continue;
                        inside++;
                        if (paints) painted[i] = true;
                    }
                    return { mk: x.mk, ov: glyphArea * (inside / mask.length) };
                })
                .filter(x => x.ov > 0);
            // Every candidate's box contained the glyph and none of their FILLS did: the label is
            // on the canvas inside a concavity - a ring's hole is the case that matters.
            if (under.length === 0 && boxed.length > 0) report.offFill++;
            if (under.length === 0) continue; // axis / legend / title / caption / a ring's hole
            // THE PAGE IS A SURFACE TOO - see backingHoldsGlyph. Decidable only when EVERY candidate
            // answered geometrically: one unmeasured shape and the union is an undercount, so the
            // pass keeps the behaviour it had rather than declining to fix a label it cannot see.
            // A label this pass RAISED is not handed back on a page majority: it now sits over the
            // shape it was hidden under, which the chart never judged, so only the straddle rule
            // below may speak for it - and nothing else does.
            let raisedOnPage = false;
            if (unmeasured === 0 && pts.length > 0) {
                let held = 0;
                for (let i = 0; i < painted.length; i++) if (painted[i]) held++;
                if (!backingHoldsGlyph(glyphArea * (held / pts.length), glyphArea)) {
                    if (!raised) { report.pageMajority++; continue; }
                    raisedOnPage = true;
                }
            }
            report.scanned++;

            // The visible background = the OPAQUE shape backing the MOST of the glyph (tie ->
            // topmost paint order), among the shapes drawn BENEATH it. Opaque-first so a
            // translucent pill is not mistaken for the tile; topmost tie-break so a treemap leaf
            // wins over its parent.
            const opaqueUnder = under.filter(x => effAlpha(x.mk) >= PILL_OPAQUE_ALPHA);
            const cellEntry = (opaqueUnder.length ? opaqueUnder : under)
                .reduce((a, b) => ((b.ov > a.ov) || (b.ov === a.ov && b.mk.ord > a.mk.ord)) ? b : a);
            const cell = cellEntry.mk;
            // A contrast PILL: a translucent label backdrop painted ABOVE the cell (higher paint
            // order) and under the text - the second half now enforced by the candidate filter
            // above rather than assumed - boosted below so it actually backs the glyph.
            //
            // ALPHA-0 IS NOT A PILL. A fully transparent shape is an invisible HIT TARGET, not a
            // backdrop: the legend rule emits a full-entry fill:'transparent' rect so the whole
            // entry is clickable, and the hit-target pass injects more of exactly the same. Those
            // rects sit above an opaque basemap and under the label - the precise shape this
            // finder looks for - and boosting one paints BLACK boxes behind every legend entry.
            // toRGBA maps 'transparent' AND 'none' to [0,0,0,0]: the alpha WAS the colour.
            //
            // AND IT MUST ACTUALLY BACK THE GLYPH, not merely touch it: see pillBacksGlyph. A big
            // card value whose descender box grazed the chip below it once adopted that chip as
            // its backdrop and was recoloured white against a background it does not sit on.
            const pill = under.find(x =>
                x.mk !== cell && isPillBackdropAlpha(effAlpha(x.mk)) && x.mk.ord > cell.ord
                && pillBacksGlyph(x.ov, glyphArea))?.mk;

            // True opaque background under the glyph: cell over page, then pill over that.
            // Compositing the real stack (not just the cell) is what a single-fill path cannot do.
            const cellRGBA = toRGBA(cell.fill);
            let bgRGB = cellRGBA
                ? compositeOver([cellRGBA[0], cellRGBA[1], cellRGBA[2], cellRGBA[3] * cell.op], pageRGB)
                : pageRGB;
            if (pill) {
                const pr = toRGBA(pill.fill);
                if (pr) {
                    // Boost the pill to (near-)opaque so it actually backs the text rather than
                    // washing out over a mid/pale cell - "opacity pills, not halos": make the
                    // pill do its job. Rewrite the fill to its opaque form AND pin fill-opacity
                    // (covers either translucency source) so the boost holds however it was dimmed.
                    bgRGB = compositeOver([pr[0], pr[1], pr[2], 0.9], bgRGB);
                    pill.el.setAttribute("fill", `rgb(${pr[0]}, ${pr[1]}, ${pr[2]})`);
                    pill.el.setAttribute("fill-opacity", "0.9");
                    report.pillsBoosted++;
                    // ...and it backs the WHOLE label - see extendPillOver.
                    if (extendPillOver(pill.el, tr)) report.pillsExtended++;
                }
            }

            const cur = tx.getAttribute("fill")
                || (win && typeof win.getComputedStyle === "function" ? win.getComputedStyle(tx).fill : "");

            // A LABEL OVER TWO SURFACES GETS A PILL, NOT A FLIP - see straddles(). Only on a
            // measured label with no backdrop of its own: every shape beneath it answered the
            // geometry on the finer straddle grid, and at least two surfaces each hold a real share
            // of it. The author's colour stands when it already reads (STRADDLE_TARGET_CONTRAST) on
            // every one of them; otherwise the label gets a page-coloured pill and the one colour
            // that reads on it.
            if (!pill && unmeasured === 0) {
                const bgs = sampleBackgrounds(boxed.map(x => x.mk), straddleSampleGrid(tr), pageRGB, effAlpha);
                if (bgs && straddles(bgs)) {
                    if (minContrastOver(cur, bgs) >= STRADDLE_TARGET_CONTRAST) continue;   // reads everywhere: leave it
                    const pillEl = addPill(tx, `rgb(${pageRGB[0]}, ${pageRGB[1]}, ${pageRGB[2]})`);
                    const behind = pillEl
                        ? bgs.map(b => compositeOver([pageRGB[0], pageRGB[1], pageRGB[2], STRADDLE_PILL_ALPHA], b))
                        : bgs;
                    if (pillEl) report.straddlePills++;
                    const pick = pickColorOver(cur, behind);
                    if (!pick.keep) { tx.setAttribute("fill", pick.color); report.fixed++; }
                    tx.setAttribute(LABEL_CONTRAST_DONE_ATTR, "1");
                    continue;
                }
            }
            if (raisedOnPage) continue;
            // normalize=true: unify EVERY in-mark label on a tile to one best-contrast colour (not
            // just the unreadable ones), so a tile cannot show mixed black/white text where both
            // happen to clear the threshold. EXCEPT when the backing cell is a deck PANEL: a
            // uniform reader-chosen surface, not a data tile, so author colours that clear the
            // floor survive on it at ANY fill - see cellSuppressesNormalize.
            const normalize = !cellSuppressesNormalize(cell.el.getAttribute("class"));
            const d = decideLabelColor(cur, `rgb(${bgRGB[0]}, ${bgRGB[1]}, ${bgRGB[2]})`, 1, pageBg, MIN_CONTRAST, normalize);
            if (d.fix) {
                tx.setAttribute("fill", d.color);
                report.fixed++;
            }
            if (pill || d.fix) tx.setAttribute(LABEL_CONTRAST_DONE_ATTR, "1");
        }
        return report;
    } catch {
        report.skipped = "error";
        return report;
    }
}
