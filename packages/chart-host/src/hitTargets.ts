// A MARK THAT IS TAGGED BUT NOT CLICKABLE IS NOT A MARK.
//
// Generated code declares a cross-filter target by stamping a class and a row-index
// attribute on an element. Two habits leave that element unable to RECEIVE a click, and
// the symptom is identical in every host: the chart looks right, the mark is tagged, and
// clicking it does nothing.
//
//   (a) The class sits on a bare <g> — a transform container with no geometry of its own
//       — whose only painted children are pointer-events:none. The canonical legend
//       swatch: <g class=d3-legend-mark><rect pe:none/><text pe:none/></g>. A click falls
//       straight THROUGH the group, so `closest()` never sees the class.
//   (b) The class sits on a painted element that is itself pointer-events:none.
//
// This pass heals both, and it matters most for the FURNITURE — legend swatches and axis
// / group headers — because those are exactly the elements a chart tends to draw as an
// inert label, and they are the ones a reader is most likely to try to click.
//
// It is purely ADDITIVE and IDEMPOTENT (injected rects carry data-lch-hit), and it only
// ever makes clickable something the chart ALREADY declared a cross-filter mark. It
// cannot turn an untagged element into a target, so it cannot regress a working chart.
// Correctness, not polish — run it after every render.

import { MARK_CLASS, LEGEND_MARK_CLASS, AXIS_FILTER_CLASS, ROW_IDX_ATTR } from "./contract";

const SVG_NS = "http://www.w3.org/2000/svg";
const HIT_ATTR = "data-lch-hit";

// Beyond this many tagged elements the pass is skipped: a chart with thousands of marks
// is a density plot whose marks are painted shapes anyway, and the getBBox() per element
// is the expensive part.
const ELEMENT_CAP = 5000;

export interface HitTargetReport {
    /** tagged elements examined */
    tagged: number;
    /** transparent hit rects injected into inert <g> marks */
    hitRects: number;
    /** painted elements flipped off pointer-events:none */
    peFlips: number;
    /** of those, how many were UNFILLED and so got 'stroke' rather than 'all' */
    peStrokeOnly: number;
}

/**
 * Make every declared cross-filter mark inside `container` actually hittable.
 * Safe to call repeatedly; returns what it changed (all zeros = nothing needed doing).
 */
export function ensureCrossfilterHitTargets(container: any, doc?: any): HitTargetReport {
    const report: HitTargetReport = { tagged: 0, hitRects: 0, peFlips: 0, peStrokeOnly: 0 };
    try {
        if (!container || typeof container.querySelectorAll !== "function") return report;
        const els = container.querySelectorAll(
            `.${MARK_CLASS}, .${LEGEND_MARK_CLASS}, .${AXIS_FILTER_CLASS}`);
        report.tagged = els.length;
        if (els.length === 0 || els.length > ELEMENT_CAP) return report;

        const ownerDoc = doc ?? container.ownerDocument;
        const view = ownerDoc?.defaultView;
        const computed = (el: any): any => {
            try { return view?.getComputedStyle ? view.getComputedStyle(el) : null; } catch { return null; }
        };

        for (const el of Array.from(els) as any[]) {
            const tag = String(el.tagName || "").toLowerCase();
            if (tag === "g") {
                // Only a <g> that declares its OWN row index is a single mark. Without one
                // it is just a container, and its children carry the marks.
                if (!el.hasAttribute?.(ROW_IDX_ATTR)) continue;
                if (el.querySelector?.(`rect[${HIT_ATTR}="1"]`)) continue;   // idempotent

                const cls = el.getAttribute?.("class") || "";
                const isFurniture = cls.indexOf(LEGEND_MARK_CLASS) >= 0 || cls.indexOf(AXIS_FILTER_CLASS) >= 0;
                if (!isFurniture) {
                    // A DATA mark group can be packed against its neighbours, and an
                    // oversized transparent rect over its bbox would steal a sibling's
                    // clicks. Stay strictly additive: fill it only when it has no hittable
                    // child at all. If something in there already catches clicks, leave the
                    // group exactly as the chart drew it.
                    let hasHittableChild = false;
                    const kids = el.querySelectorAll?.("*") ?? [];
                    for (const kid of Array.from(kids) as any[]) {
                        const ktag = String(kid.tagName || "").toLowerCase();
                        if (ktag === "g" || ktag === "tspan" || ktag === "title" || ktag === "defs") continue;
                        const cs = computed(kid);
                        // No computed style available (jsdom without a view) — assume the
                        // child IS hittable, which is the choice that changes nothing.
                        if (!cs || cs.pointerEvents !== "none") { hasHittableChild = true; break; }
                    }
                    if (hasHittableChild) continue;
                }

                // Furniture sits in a gutter of its own, so cover the whole bbox: the
                // reader clicks the legend or axis NAME, which is usually the inert part.
                let bb: any = null;
                try { bb = el.getBBox?.(); } catch { bb = null; }
                if (!bb || !(bb.width > 0) || !(bb.height > 0)) continue;
                const rect = ownerDoc.createElementNS(SVG_NS, "rect");
                rect.setAttribute("x", String(bb.x));
                rect.setAttribute("y", String(bb.y));
                rect.setAttribute("width", String(bb.width));
                rect.setAttribute("height", String(bb.height));
                rect.setAttribute("fill", "transparent");
                rect.setAttribute(HIT_ATTR, "1");
                if (rect.style) { rect.style.pointerEvents = "all"; rect.style.cursor = "pointer"; }
                // FIRST child, so it sits behind the real swatches and only fills the gaps
                // and the label rather than covering the paint.
                el.insertBefore(rect, el.firstChild);
                report.hitRects++;
            } else {
                // A painted element carrying the class — just make sure it can be clicked.
                //
                // 'all' FOR A FILLED SHAPE, 'stroke' FOR AN OUTLINE, and the difference is
                // not cosmetic. `pointer-events: all` hit-tests the fill REGION even when
                // fill is 'none', so flipping an unfilled outline turns its whole interior
                // into a hit target. Overlays are drawn last, so that interior then sits on
                // top of the marks it merely outlines and swallows their clicks and hovers
                // — and it carries no <title>, so the native tooltip underneath stops
                // appearing too. Seen on a choropleth whose "above average" overlay drew
                // hundreds of fill:none paths over the region paths. 'stroke' gives the
                // outline the clickability the flip exists for, without inventing a hit
                // area the chart never painted.
                const cs = computed(el);
                if (cs && cs.pointerEvents === "none") {
                    // `fill` is an SVG PRESENTATION ATTRIBUTE as well as a CSS property, and
                    // the attribute is what codegen almost always writes. Read the attribute
                    // first and fall back to the computed value, so the outline case is
                    // decided the same way whether the chart wrote `fill="none"` or styled
                    // it — and so it is still decided at all in an environment whose CSS
                    // engine does not map SVG presentation attributes.
                    const fill = String(el.getAttribute?.("fill") ?? cs.fill ?? "").trim().toLowerCase();
                    const unfilled = fill === "none" || fill === "transparent" || fill === "rgba(0, 0, 0, 0)";
                    if (el.style) el.style.pointerEvents = unfilled ? "stroke" : "all";
                    report.peFlips++;
                    if (unfilled) report.peStrokeOnly++;
                }
            }
        }
    } catch { /* an affordance repair is never worth failing a render over */ }
    return report;
}
