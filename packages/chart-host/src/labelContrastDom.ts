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

    THE SHAPE OF THE PASS. For every <text> in the container: find the filled shapes whose
    geometry actually backs its glyph box (isPointInFill over a small sample grid - a bounding
    box is exact for a rect and wrong for a ring, whose box contains its hole), pick the topmost
    opaque one as the cell and any translucent shape drawn above it as a pill, composite the real
    stack over the page background, and hand the result to decideLabelColor. Then apply what it
    says. Every guard in here is an incident; the comments name them so a future edit knows what
    it is about to reopen.

    NOTHING HERE THROWS. It runs after a render that already succeeded and must never be the
    reason a delivered chart fails. Where the engine cannot answer a geometry question (jsdom, a
    detached node) the pass keeps the coarser answer it already had, never a guess.
*/
import {
    decideLabelColor, toRGBA, compositeOver, MIN_CONTRAST, isPillBackdropAlpha,
    PILL_MIN_ALPHA, PILL_OPAQUE_ALPHA, cellSuppressesNormalize, pillBacksGlyph,
    backingHoldsGlyph, glyphSampleGrid,
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
    /** Why the pass did nothing, when it did nothing. */
    skipped?: "no-container" | "no-shapes" | "too-many-shapes" | "too-many-texts" | "error";
}

const EMPTY: LabelContrastReport = { rects: 0, scanned: 0, fixed: 0, pillsBoosted: 0, offFill: 0, pageMajority: 0 };

type HostRect = { r: DOMRect; fill: string; op: number; area: number; el: Element; ord: number };

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
    THE ONE CALL A HOST MAKES AFTER A RENDER.

    Idempotent within a render (LABEL_CONTRAST_DONE_ATTR), additive (it only ever sets a text's
    fill and, for a pill, a rect's fill/opacity), and bounded. Returns what it did so a host can
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
            rects.push({ r, fill, op: isFinite(op) ? op : 1, area: r.width * r.height, el, ord: ord++ });
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
            const boxed = rects
                .map(mk => ({ mk, ov: ovArea(mk.r) }))
                .filter(x => x.ov > 0);
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
            if (unmeasured === 0 && pts.length > 0) {
                let held = 0;
                for (let i = 0; i < painted.length; i++) if (painted[i]) held++;
                if (!backingHoldsGlyph(glyphArea * (held / pts.length), glyphArea)) { report.pageMajority++; continue; }
            }
            report.scanned++;

            // The visible background = the OPAQUE shape backing the MOST of the glyph (tie ->
            // topmost paint order). Opaque-first so a translucent pill is not mistaken for the
            // tile; topmost tie-break so a treemap leaf wins over its parent.
            const opaqueUnder = under.filter(x => effAlpha(x.mk) >= PILL_OPAQUE_ALPHA);
            const cellEntry = (opaqueUnder.length ? opaqueUnder : under)
                .reduce((a, b) => ((b.ov > a.ov) || (b.ov === a.ov && b.mk.ord > a.mk.ord)) ? b : a);
            const cell = cellEntry.mk;
            // A contrast PILL: a translucent label backdrop painted ABOVE the cell (higher paint
            // order) and under the text - boosted below so it actually backs the glyph.
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
                }
            }

            const cur = tx.getAttribute("fill")
                || (win && typeof win.getComputedStyle === "function" ? win.getComputedStyle(tx).fill : "");
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
