import { describe, it, expect } from "vitest";
import {
    planLegendReconcile,
    planContentFit,
    planBottomTextPush,
    colorbarReconcileSide,
    colorbarSitsOnMarks,
    colorbarProbePoints,
    colorbarOnPlot,
    COLORBAR_ON_PLOT_COVER,
    swatchPairs,
    isLegendSignature,
    SWATCH_MAX_PX,
    SIGNATURE_MIN_PAIRS,
    rightmostOverlappingPlotEdge,
    bottommostOverlappingPlotEdge,
    Rect,
    ViewBox,
    MAX_GUTTER_FRACTION,
    MAX_FIT_FRACTION,
    FIT_PAD,
} from "../../src/legendFit/legendReconcile";

// All coordinates are SVG USER units (== viewBox units); the caller maps client
// px into this space via getScreenCTM before calling.
const vb: ViewBox = { x: 0, y: 0, w: 800, h: 600 };
const rect = (left: number, top: number, right: number, bottom: number): Rect => ({ left, top, right, bottom });

describe("rightmostOverlappingPlotEdge", () => {
    it("is the rightmost edge among elements beside the legend", () => {
        const legend = rect(600, 100, 760, 400);
        const e = rightmostOverlappingPlotEdge(legend, [
            rect(0, 100, 620, 200),  // beside, right=620
            rect(0, 300, 680, 400),  // beside, right=680 ← rightmost
            rect(0, 0, 900, 50),     // a top title (no vertical overlap)
        ]);
        expect(e).toBe(680);
    });

    it("ignores elements not vertically overlapping the legend", () => {
        expect(rightmostOverlappingPlotEdge(rect(600, 200, 760, 400), [rect(0, 0, 800, 40)])).toBe(-Infinity);
    });

    it("ignores a full-width background that spans the legend", () => {
        expect(rightmostOverlappingPlotEdge(rect(600, 100, 760, 400), [rect(0, 0, 800, 600)])).toBe(-Infinity);
    });
});

describe("bottommostOverlappingPlotEdge", () => {
    it("is the bottommost edge among elements above the legend", () => {
        const bar = rect(200, 560, 600, 580); // horizontal colorbar
        const e = bottommostOverlappingPlotEdge(bar, [
            rect(200, 540, 400, 565),  // above, bottom=565
            rect(300, 540, 600, 572),  // above, bottom=572 ← bottommost
            rect(0, 0, 40, 600),       // a left axis title (no horizontal overlap)
        ]);
        expect(e).toBe(572);
    });
    it("ignores elements not horizontally overlapping the legend", () => {
        expect(bottommostOverlappingPlotEdge(rect(200, 560, 600, 580), [rect(0, 0, 40, 600)])).toBe(-Infinity);
    });
    it("ignores a full-height background that spans the legend", () => {
        expect(bottommostOverlappingPlotEdge(rect(200, 560, 600, 580), [rect(0, 0, 800, 600)])).toBe(-Infinity);
    });
});

describe("planLegendReconcile — bottom side (horizontal colorbar)", () => {
    it("pushes a bottom colorbar down + extends viewBox HEIGHT when the x-axis overprints it", () => {
        const bar = rect(200, 575, 600, 595);       // wide, short, bottom-anchored
        const xaxis = rect(200, 560, 600, 585);     // x-axis ticks/title reaching to 585
        const plan = planLegendReconcile(bar, [xaxis], vb, {}, "bottom");
        expect(plan.action).toBe("reserve");
        expect(plan.legendDx).toBe(0);
        expect(plan.legendDy).toBe(18);             // (585 + pad 8) - 575
        expect(plan.ext).toBe(17);                  // (595 + 18 + edgePad 4) - 600
        expect(plan.newViewBox.h).toBe(617);        // 600 + 17
        expect(plan.newViewBox.w).toBe(800);        // width untouched
    });
    it("returns none when nothing sits above the colorbar", () => {
        const plan = planLegendReconcile(rect(200, 575, 600, 595), [rect(200, 596, 600, 600)], vb, {}, "bottom");
        expect(plan.action).toBe("none");
        expect(plan.reason).toBe("no-overlap");
    });
    it("ignores a vertical legend on the bottom pass (not-horizontal-legend)", () => {
        // content overprints from ABOVE (top 340 < legend top 350) so the overlap
        // is found, then the vertical aspect ratio bails it.
        const plan = planLegendReconcile(rect(700, 350, 770, 590), [rect(0, 340, 720, 560)], vb, {}, "bottom");
        expect(plan.action).toBe("none");
        expect(plan.reason).toBe("not-horizontal-legend");
    });
    it("ignores a horizontal strip anchored at the TOP (not-bottom-legend)", () => {
        // a top-region horizontal strip with content overprinting from above —
        // overlap is found + it's horizontal, but it isn't anchored at the bottom.
        const plan = planLegendReconcile(rect(200, 40, 600, 60), [rect(200, 20, 600, 50)], vb, {}, "bottom");
        expect(plan.action).toBe("none");
        expect(plan.reason).toBe("not-bottom-legend");
    });
});

describe("planLegendReconcile", () => {
    it("returns none when nothing sits beside the legend", () => {
        const plan = planLegendReconcile(rect(700, 0, 780, 600), [rect(0, 0, 650, 600)], vb);
        expect(plan.action).toBe("none");
        expect(plan.reason).toBe("no-overlap");
    });

    it("slides the legend to clear the plot AND extends the viewBox to fit it", () => {
        // plot reaches 680 under a legend at left=600 (80 overlap); legend right=760.
        const plan = planLegendReconcile(rect(600, 100, 760, 400), [rect(0, 100, 680, 400)], vb);
        expect(plan.action).toBe("reserve");
        expect(plan.legendDx).toBe(88);          // (680 + pad 8) - 600
        expect(plan.ext).toBe(52);               // (760 + 88 + edgePad 4) - 800
        expect(plan.newViewBox.w).toBe(852);
        expect(plan.newViewBox.h).toBe(600);     // height untouched
    });

    it("THE FIX: gives the legend's RIGHT edge clearance (ext > slide), so text isn't clipped", () => {
        // legend hugs the viewBox right edge (right=800) → was clipped. plot reaches
        // 660 under legend left=640 (20 overlap). The v1 bug set ext==slide, leaving
        // the right edge just as clipped; now ext exceeds the slide by edgePad + overhang.
        const plan = planLegendReconcile(rect(640, 100, 800, 400), [rect(0, 100, 660, 400)], vb);
        expect(plan.action).toBe("reserve");
        expect(plan.legendDx).toBe(28);          // (660 + pad 8) - 640
        expect(plan.ext).toBe(32);               // (800 + 28 + edgePad 4) - 800
        expect(plan.ext).toBeGreaterThan(plan.legendDx); // the whole point
        expect(plan.newViewBox.w).toBe(832);
    });

    it("edgePad controls the right-of-legend gutter independently of the slide pad", () => {
        // tighter edgePad → smaller ext, same slide
        const base = planLegendReconcile(rect(600, 100, 760, 400), [rect(0, 100, 680, 400)], vb);
        const tight = planLegendReconcile(rect(600, 100, 760, 400), [rect(0, 100, 680, 400)], vb, { edgePad: 0 });
        expect(tight.legendDx).toBe(base.legendDx);   // slide unchanged
        expect(tight.ext).toBeLessThan(base.ext);     // gutter tighter
        expect(tight.ext).toBe(48);                   // (760+88+0) - 800
    });

    it("defers a LEFT-placed legend (its right edge is left of the overlapping plot)", () => {
        const plan = planLegendReconcile(rect(80, 100, 240, 400), [rect(200, 100, 760, 400)], vb);
        expect(plan.action).toBe("none");
        expect(plan.reason).toBe("not-right-legend");
    });

    it("SLIDES a right-anchored legend even when plot labels poke past its right edge (a Sankey)", () => {
        // The old embedded-legend test (legend.right < plotRight) bailed here —
        // store-column labels reached x=780 while the legend stack sat at
        // [600..720], so the live session shipped the overlap (~50% of gens,
        // depending on label lengths). A right-ANCHORED legend must slide past
        // the labels instead.
        const legend = rect(600, 100, 720, 400);
        const plot = [rect(0, 100, 660, 400), rect(620, 180, 780, 200)]; // a label crossing under + past the legend
        const plan = planLegendReconcile(legend, plot, vb);
        expect(plan.action).toBe("reserve");
        expect(plan.legendDx).toBe(780 + 8 - 600); // clears the longest label + pad
    });

    it("defers a horizontal TOP/BOTTOM legend strip", () => {
        const plan = planLegendReconcile(rect(300, 0, 800, 40), [rect(0, 20, 760, 560)], vb);
        expect(plan.action).toBe("none");
        expect(plan.reason).toBe("not-vertical-legend");
    });

    it("SLIDES a NEAR-SQUARE legend whose row labels make it slightly wider than tall (a loan funnel with a mixed group)", () => {
        // A 2-swatch vertical legend + 'Above avg'/'Below avg' labels measures
        // ~67w × 60h — slightly wider than tall. The old `legH < legW` test wrongly
        // read that as a horizontal strip and bailed; a near-square legend CAN
        // slide right, so only a CLEARLY horizontal strip (w > 2h) defers now.
        const legend = rect(715, 75, 782, 135);          // 67 × 60, near-square, right-anchored
        const plot = [rect(0, 80, 744, 95)];              // a mean-line 'Avg: $..' label reaching x=744 under it
        const plan = planLegendReconcile(legend, plot, vb);
        expect(plan.action).toBe("reserve");
        expect(plan.legendDx).toBe(744 + 8 - 715);        // clears the Avg label + pad
    });

    it("ignores a hairline overlap (<= MIN_OVERLAP)", () => {
        const plan = planLegendReconcile(rect(640, 100, 800, 400), [rect(0, 100, 641, 400)], vb);
        expect(plan.action).toBe("none");
        expect(plan.reason).toBe("no-overlap");
    });

    it("defers to re-layout when the extension would be too big", () => {
        // FIXTURE NOTE (the embedded-legend test is
        // anchor-based — legend.left must be in the right 45% of the canvas, so
        // the old left=300 fixture bailed "not-right-legend" before reaching the
        // ext cap). Same behavior under test: a right-anchored VERTICAL legend
        // (h 550 > w 500) whose slide would need a giant extension (a legend
        // already CLIPPED past the right edge) still defers. plot reaches 780
        // under legend left=460 → dx=328; legend.right=960 → ext=492 > 60% of 800.
        const plan = planLegendReconcile(rect(460, 30, 960, 580), [rect(0, 50, 780, 560)], vb);
        expect(plan.action).toBe("none");
        expect(plan.reason).toBe("none-too-big");
    });

    it("stricter options: ignore a moderate overlap the defaults would fix", () => {
        const legend = rect(600, 100, 760, 400);
        const plot = [rect(0, 100, 610, 400)]; // 10-unit overlap
        expect(planLegendReconcile(legend, plot, vb).action).toBe("reserve");
        expect(planLegendReconcile(legend, plot, vb, { minOverlap: 16 }).action).toBe("none");
    });

    it("stricter options: defer a fix that needs a biggish extension", () => {
        // FIXTURE NOTE (anchor-based embedded test — see above).
        // Right-anchored legend at left=450, plot to 610 → dx=168,
        // ext=(798+168+4)-800=170 ≈ 0.21 of width: above the strict 0.2 cap
        // (defers) but under the liberal default (reserves).
        const legend = rect(450, 50, 798, 560);
        const plot = [rect(0, 50, 610, 560)];
        expect(planLegendReconcile(legend, plot, vb).action).toBe("reserve");
        expect(planLegendReconcile(legend, plot, vb, { maxGutterFraction: 0.2 }).reason).toBe("none-too-big");
        expect(170).toBeGreaterThan(vb.w * 0.2); // sanity: 170 > 160
    });

    it("returns none with no viewBox", () => {
        expect(planLegendReconcile(rect(600, 100, 760, 400), [rect(0, 100, 680, 400)], null).reason).toBe("no-viewbox");
    });

    it("returns none when boxes are missing", () => {
        expect(planLegendReconcile(null, [rect(0, 0, 680, 600)], vb).reason).toBe("missing-box");
        expect(planLegendReconcile(rect(600, 100, 760, 400), [], vb).reason).toBe("missing-box");
    });

    it("MAX_GUTTER_FRACTION default is exported and sane", () => {
        expect(MAX_GUTTER_FRACTION).toBeGreaterThan(0);
        expect(MAX_GUTTER_FRACTION).toBeLessThanOrEqual(1);
    });
});

describe("planContentFit", () => {
    it("THE CASE: extends the viewBox LEFT for labels drawn into negative x (a Sankey)", () => {
        // the generation used margin.left=20 with text-anchor:end labels at x0-6 → labels
        // hang ~80 units into negative x. The legend pass only watches the right
        // edge; this pass must cover the left.
        const plan = planContentFit([rect(-82, 100, 14, 116), rect(0, 0, 800, 600)], vb);
        expect(plan.action).toBe("fit");
        expect(plan.cut.left).toBe(86);          // ceil(82 + pad 4)
        expect(plan.cut.right).toBe(0);
        expect(plan.newViewBox.x).toBe(-86);
        expect(plan.newViewBox.w).toBe(886);
        expect(plan.newViewBox.h).toBe(600);
    });

    it("extends on EVERY side content hangs past, independently", () => {
        const plan = planContentFit([
            rect(-20, 100, 10, 116),   // left overhang 20
            rect(700, -12, 760, 4),    // top overhang 12
            rect(640, 200, 830, 216),  // right overhang 30
            rect(100, 560, 200, 624),  // bottom overhang 24
        ], vb);
        expect(plan.action).toBe("fit");
        expect(plan.cut).toEqual({ left: 24, top: 16, right: 34, bottom: 28 });
        expect(plan.newViewBox).toEqual({ x: -24, y: -16, w: 800 + 24 + 34, h: 600 + 16 + 28 });
    });

    it("EXTEND-only: never shrinks when content is smaller than the canvas", () => {
        const plan = planContentFit([rect(200, 150, 600, 450)], vb);
        expect(plan.action).toBe("none");
        expect(plan.reason).toBe("fits");
        expect(plan.newViewBox).toEqual(vb);
    });

    it("ignores a hairline overhang (<= minOverhang)", () => {
        expect(planContentFit([rect(-2, 100, 100, 116)], vb).action).toBe("none");
    });

    it("ignores junk parked far off-canvas instead of blowing up the viewBox", () => {
        // a work element at x=-9999 (beyond the 35% band) must not count; the
        // genuinely-hanging label still gets its fit.
        const plan = planContentFit([rect(-9999, 100, -9900, 116), rect(-40, 100, 60, 116), rect(0, 0, 800, 600)], vb);
        expect(plan.action).toBe("fit");
        expect(plan.cut.left).toBe(44);          // from the -40 label, not the junk
    });

    // CONTRACT CHANGE: this test used to assert that an over-cap overhang was extended BY
    // THE CAP. That is the behaviour that was removed: the cap is by definition less than the content needs, so applying
    // it paid the full shrink and left the content clipped anyway. Measured on a corpus, 14 of
    // 103 applied fits were clamped and every one landed at 0.73-0.75 scale — the entire
    // disaster tail. The scenario is kept verbatim; only the expectation moved.
    it("does NOT extend a side whose overhang exceeds MAX_FIT_FRACTION — the cap would buy a shrink and still clip", () => {
        // the rect's RIGHT edge is in-band so it IS considered, but its
        // overhang 279 + pad exceeds the 280 cap (0.35*800) → unrescuable.
        const plan = planContentFit([rect(-279, 100, 60, 116), rect(0, 0, 800, 600)], vb);
        expect(plan.action).toBe("none");
        expect(plan.reason).toBe("clamped");
        expect(plan.newViewBox).toEqual(vb);
    });

    it("backs off PER SIDE: a rescuable left is still extended beside an unrescuable bottom", () => {
        // The Gantt shape: a row body hanging far past the bottom cannot be
        // covered, but a 20-unit label off the left can. Refusing the whole plan would
        // throw away a rescue that works.
        const plan = planContentFit([
            rect(-20, 100, 10, 116),      // left overhang 20 — rescuable
            rect(100, 560, 200, 1200),    // bottom overhang 600 — past the 210 cap
            rect(0, 0, 800, 600),
        ], vb);
        expect(plan.action).toBe("fit");
        expect(plan.cut.left).toBe(24);
        expect(plan.cut.bottom).toBe(0);
    });

    it("still extends a side whose overhang sits exactly AT the cap", () => {
        // ceil(over + pad) === ceil(cap) is affordable, so it is still taken — the
        // back-off is for what the cap cannot cover, not for everything near it.
        const over = MAX_FIT_FRACTION * 800 - FIT_PAD;           // 276
        const plan = planContentFit([rect(-over, 100, 60, 116), rect(0, 0, 800, 600)], vb);
        expect(plan.action).toBe("fit");
        expect(plan.cut.left).toBe(Math.ceil(MAX_FIT_FRACTION * 800));
    });

    it("returns none on degenerate inputs", () => {
        expect(planContentFit(null, vb).reason).toBe("no-content");
        expect(planContentFit([], vb).reason).toBe("no-content");
        expect(planContentFit([rect(0, 0, 100, 100)], null).reason).toBe("no-viewbox");
        expect(planContentFit([rect(50, 50, 50, 50)], vb).reason).toBe("no-content"); // zero-area only
    });
});

// ── THE LEGIBILITY CAP ───────────────────────────────────────
// Extending makes the SVG scale to fit its container, so every fit is paid for in text
// size. The corpus (103 applied fits) says the bill is usually invisible — 50 of
// them shrink by 2% — and occasionally ruinous. These pin the line between the two.
describe("planContentFit — the fit is paid for in legibility", () => {
    // CHEAP: 60 units past a 600-tall frame → cut 64, newH 664, shrink 0.904.
    const cheap: Rect[] = [rect(100, 560, 200, 660), rect(0, 0, 800, 600)];
    // DEAR: 40 units past a 300-tall frame → cut 44, newH 344, shrink 0.872. Affordable
    // (44 is well under the 105 cap), so the LEGIBILITY test is what decides it — which is
    // the whole point: a clamped plan is refused before this code is reached.
    const vbShort: ViewBox = { x: 0, y: 0, w: 800, h: 300 };
    const dear: Rect[] = [rect(100, 280, 200, 340), rect(0, 0, 800, 300)];

    it("waves through a shrink that costs a 10px label less than a pixel", () => {
        // min(floor 10, smallest 10) - grace 1 = 9, and 10 * 0.904 = 9.04. This is the
        // 50-render cohort; refusing it would switch the pass off for no gain.
        expect(planContentFit(cheap, vb, { smallestTextPx: 10 }).action).toBe("fit");
    });

    it("refuses a shrink that takes 10px type below 9", () => {
        const plan = planContentFit(dear, vbShort, { smallestTextPx: 10 });   // 10 → 8.72
        expect(plan.action).toBe("none");
        expect(plan.reason).toBe("legibility");
        expect(plan.newViewBox).toEqual(vbShort);
    });

    it("judges type that ALREADY sits below the floor against ITS OWN size, not the floor", () => {
        // 29 of 51 measured generations declare 8-9px, which predates this pass and which
        // refusing the fit does not repair — the label would stay small AND go back to
        // being clipped. So a 9px chart may spend a pixel too, and no more.
        expect(planContentFit(cheap, vb, { smallestTextPx: 9 }).action).toBe("fit");    // 9 → 8.13, floor 8
        expect(planContentFit(dear, vbShort, { smallestTextPx: 9 }).action).toBe("none"); // 9 → 7.85
    });

    it("gives LARGE type room to shrink where 10px type has none — the floor is the constraint, not the ratio", () => {
        // Top AND bottom overhangs, 125 each: newH 858, shrink 0.699. A 14px chart still
        // paints 9.8px and is allowed; the same shrink on a 10px chart paints 7.0 and is
        // not. A ratio-based cap could not tell those two apart.
        const twoSided: Rect[] = [rect(100, -125, 200, 50), rect(100, 550, 200, 725), rect(0, 0, 800, 600)];
        expect(planContentFit(twoSided, vb, { smallestTextPx: 14 }).action).toBe("fit");
        expect(planContentFit(twoSided, vb, { smallestTextPx: 10 }).action).toBe("none");
    });

    it("is DISABLED, not defaulted, when the text could not be measured", () => {
        // An unmeasurable chart keeps today's behaviour rather than being refused on a
        // guess — the same degrade every other pass in this file makes. Every one of these
        // would be refused if the value were believed.
        for (const bad of [undefined, NaN, 0, -3]) {
            expect(planContentFit(dear, vbShort, { smallestTextPx: bad as number }).action).toBe("fit");
        }
    });

    it("takes the floor from options, so the mirrored floor is a knob and not a constant", () => {
        // 12px at 0.904 → 10.8. Under a floor of 10 that spends 1.2 of a 10px budget and
        // is allowed; under a floor of 14 the allowance is 11 and it is not.
        expect(planContentFit(cheap, vb, { smallestTextPx: 12, minLegiblePx: 10 }).action).toBe("fit");
        expect(planContentFit(cheap, vb, { smallestTextPx: 12, minLegiblePx: 14 }).action).toBe("none");
    });

    it("a floor RAISED above type that is already under it changes nothing — by design", () => {
        // min(floor, smallest) is what makes the pass answerable only for the pixels IT
        // spends. Moving the floor above the chart's own size cannot retroactively make
        // the chart's declaration this pass's fault.
        expect(planContentFit(cheap, vb, { smallestTextPx: 9, minLegiblePx: 20 }).action).toBe("fit");
    });
});

describe("planBottomTextPush — axis-title vs rotated tick labels", () => {
    // Three rotated tick labels along the x-axis, deepest bottom at y=560.
    const ticks: Rect[] = [
        rect(100, 520, 140, 550),
        rect(200, 520, 240, 555),
        rect(300, 520, 340, 560),
    ];

    it("pushes a SPANNING title that overlaps >=2 tick labels below the deepest one", () => {
        // Title centered, overlapping all three ticks (the failure case: title at plotH+42 inside the labels).
        const title = rect(120, 530, 320, 548);
        const p = planBottomTextPush(title, ticks, 6);
        expect(p.move).toBe(true);
        // seats it below the floor (560) + gap (6): dy = 566 - 530 = 36
        expect(p.dy).toBe(36);
    });

    it("leaves a NARROW label that overlaps only ONE tick alone (legend-label protection)", () => {
        const oneHit = rect(205, 530, 235, 548); // intersects only the middle tick
        expect(planBottomTextPush(oneHit, ticks, 6).move).toBe(false);
    });

    it("does not move a title already seated below the tick labels", () => {
        const belowTitle = rect(120, 580, 320, 596); // no tick overlap
        expect(planBottomTextPush(belowTitle, ticks, 6).move).toBe(false);
    });

    it("no-ops with no tick labels", () => {
        expect(planBottomTextPush(rect(0, 0, 100, 20), [], 6).move).toBe(false);
    });

    // ── a rotated y-axis title is not a caption ────────────────────────────
    // The pass reads the tick labels of BOTH axes. A y-axis title rotated -90 in a
    // narrow left margin has a tall, thin box that lies INSIDE the span of the wide
    // y tick labels it overprints, so it hit two of them and was pushed below the
    // deepest tick ON THE PAGE — the x axis, ~200px down. The viewBox grew to cover
    // it and the chart drew at 83%.
    it("THE ROTATED-TITLE CASE: a rotated y-axis title inside its own tick labels is NOT a bottom caption", () => {
        // 11 wide x 90 tall at x = -60..-49, 11px type rotated -90 in a 68px left margin.
        const yTitle = rect(-60, 120, -49, 210);
        // Two `450,000,000` y tick labels, right-anchored at x = -9, ~62px wide: the
        // title's box is inside their span and two of them fall in its vertical extent.
        // The x-axis ticks are the deepest thing on the page — the floor the old code took.
        const bothAxes: Rect[] = [
            rect(-71, 130, -9, 142),
            rect(-71, 180, -9, 192),
            rect(40, 296, 90, 308),
            rect(340, 296, 390, 308),
        ];
        const p = planBottomTextPush(yTitle, bothAxes, 6);
        expect(p.move).toBe(false);
        expect(p.dy).toBe(0);
        // The old code found its two hits and would have pushed it (296+12+6) - 120 = 194px
        // down, to below the x axis. Both hits are still there; the ASPECT is what refuses.
        const hits = bothAxes.filter(t =>
            yTitle.left < t.right && yTitle.right > t.left &&
            yTitle.top < t.bottom && yTitle.bottom > t.top).length;
        expect(hits).toBe(2);
    });

    it("RULE 1: a candidate TALLER than it is wide is a rotated text, never a spanning caption", () => {
        // Two x tick labels that touch in x, so a narrow vertical box can hit both —
        // the hit gate is satisfied and only the aspect rule is left to refuse.
        const tight: Rect[] = [rect(100, 520, 180, 550), rect(170, 520, 250, 555)];
        const tall = rect(172, 450, 178, 560);   // 6 wide x 110 tall
        expect(planBottomTextPush(tall, tight, 6).move).toBe(false);
        // Laid out horizontally instead — same hits, same ticks — it IS a caption again,
        // which is what makes the aspect the rule and not a side effect of the geometry.
        const wide = rect(120, 530, 230, 548);
        expect(planBottomTextPush(wide, tight, 6).move).toBe(true);
        // ...and the same wide box carrying a rotate is refused on the transform alone.
        expect(planBottomTextPush(wide, tight, 6, "rotate(-90)").move).toBe(false);
        expect(planBottomTextPush(wide, tight, 6, "translate(4,2)").move).toBe(true);
    });

    it("RULE 2: the floor is the deepest tick the caption HIT, not the deepest on the page", () => {
        // Two shallow ticks under the caption (deepest bottom 500) and one much deeper
        // tick far to the right that the caption never touches (bottom 560).
        const mixed: Rect[] = [
            rect(100, 470, 160, 495),
            rect(180, 470, 240, 500),
            rect(600, 520, 660, 560),
        ];
        const caption = rect(90, 480, 260, 498);  // 170 wide x 18 tall, hits the two shallow ones
        const p = planBottomTextPush(caption, mixed, 6);
        expect(p.move).toBe(true);
        // dy = (500 + 6) - 480 = 26. The old floor-over-ALL-ticks gave (560 + 6) - 480 = 86,
        // i.e. 60px of frame spent on a tick the caption was nowhere near.
        expect(p.dy).toBe(26);
    });
});

describe("colorbarReconcileSide - which margin a structurally-found colorbar belongs in", () => {
    // The first case: a D3 treemap 890x390 with margin.right = 4, whose
    // colorbar group (backing plate included) measures x 818..890, y 254..384 - a
    // vertical column pinned to the right edge, drawn ON TOP of the treemap cells.
    const vbTreemap: ViewBox = { x: 0, y: 0, w: 890, h: 390 };

    it("THE CASE: a vertical colorbar inset at the right edge asks for the RIGHT margin", () => {
        expect(colorbarReconcileSide(rect(818, 254, 890, 384), vbTreemap)).toBe("right");
    });

    it("a wide bottom strip still asks for the BOTTOM margin (the June genesis case)", () => {
        // 360 wide x 14 tall, sitting low: the faceted-heatmap colorbar over the x-axis.
        expect(colorbarReconcileSide(rect(220, 560, 580, 574), vb)).toBe("bottom");
    });

    it("a NEAR-SQUARE bar counts as a column, not a strip (the 67x60 funnel legend)", () => {
        expect(colorbarReconcileSide(rect(700, 100, 767, 160), vb)).toBe("right");
    });

    it("refuses a gradient panel in the MIDDLE of the canvas - nobody's margin furniture", () => {
        expect(colorbarReconcileSide(rect(300, 200, 360, 400), vb)).toBeNull();
        expect(colorbarReconcileSide(rect(100, 260, 500, 300), vb)).toBeNull();
    });

    it("refuses a wide strip that is not bottom-anchored, and a column that is not right-anchored", () => {
        expect(colorbarReconcileSide(rect(100, 20, 700, 60), vb)).toBeNull();   // strip along the TOP
        expect(colorbarReconcileSide(rect(20, 100, 60, 400), vb)).toBeNull();   // column on the LEFT
    });

    it("agrees with the planner it feeds - every side it names is a side the plan accepts", () => {
        // A side the planner would refuse is worse than no side: the caller would take a
        // "not-..." reason for an answer and the two would disagree about the same box.
        const marks = [rect(0, 254, 886, 384)];                       // treemap cells behind it
        const bar = rect(818, 254, 890, 384);
        const side = colorbarReconcileSide(bar, vbTreemap)!;
        expect(planLegendReconcile(bar, marks, vbTreemap, {}, side).action).toBe("reserve");
    });

    it("no box, no viewBox, or a degenerate box -> null", () => {
        expect(colorbarReconcileSide(null, vb)).toBeNull();
        expect(colorbarReconcileSide(rect(700, 100, 760, 400), null)).toBeNull();
        expect(colorbarReconcileSide(rect(700, 100, 700, 400), vb)).toBeNull();
    });
});

describe("colorbarSitsOnMarks - is the colorbar drawn ON the chart?", () => {
    // The bar: 10 wide, 100 tall, at the right edge, with a treemap tile behind it.
    const bar = rect(824, 272, 834, 372);

    it("THE CASE: a treemap tile drawn BEHIND the bar - the tile SPANS it, and that is total occlusion", () => {
        // The tile covers the bar completely. rightmostOverlappingPlotEdge deliberately
        // SKIPS a spanning box (a full-width backdrop is not a collision a gutter fixes),
        // which is why the edge test answered "nothing overlaps" on the very case the
        // occlusion is worst - hence a plain intersection here.
        const tile = rect(660, 254, 886, 384);
        expect(colorbarSitsOnMarks(bar, [tile])).toBe(true);
        expect(rightmostOverlappingPlotEdge(bar, [tile])).toBe(-Infinity);
    });

    it("a colorbar parked in a real gutter is left alone", () => {
        const marks = [rect(60, 100, 780, 380), rect(60, 20, 700, 90)];
        expect(colorbarSitsOnMarks(bar, marks)).toBe(false);
    });

    it("a mark GRAZING the bar's edge is not occlusion", () => {
        // The last bar of a chart reaching 4 units under a 10-wide colorbar: 40% of it.
        expect(colorbarSitsOnMarks(bar, [rect(60, 300, 828, 340)])).toBe(false);
    });

    it("the majority threshold is the lever, and it is honoured", () => {
        const half = [rect(60, 272, 829, 372)];   // covers 5 of the bar's 10 units
        expect(colorbarSitsOnMarks(bar, half, 0.9)).toBe(false);
        expect(colorbarSitsOnMarks(bar, half, 0.4)).toBe(true);
        expect(COLORBAR_ON_PLOT_COVER).toBe(0.5);
    });

    it("a hairline in EITHER axis is a shared edge, not an occlusion", () => {
        // Full width of the bar, but only 2 units tall - a rule, not a mark under it.
        expect(colorbarSitsOnMarks(rect(824, 272, 834, 274), [rect(60, 272, 900, 274)])).toBe(false);
    });

    it("no bar, no marks, or a degenerate bar -> false", () => {
        expect(colorbarSitsOnMarks(null, [rect(0, 0, 900, 400)])).toBe(false);
        expect(colorbarSitsOnMarks(bar, [])).toBe(false);
        expect(colorbarSitsOnMarks(bar, null)).toBe(false);
        expect(colorbarSitsOnMarks(rect(824, 272, 824, 372), [rect(0, 0, 900, 400)])).toBe(false);
    });
});

describe("colorbarProbePoints / colorbarOnPlot - a box is not ink", () => {
    it("lays probes strictly INSIDE the bar, inset half a cell so none lands on an edge", () => {
        const pts = colorbarProbePoints(rect(100, 200, 130, 300), 3, 5);
        expect(pts.length).toBe(15);
        for (const p of pts) {
            expect(p.x).toBeGreaterThan(100);
            expect(p.x).toBeLessThan(130);
            expect(p.y).toBeGreaterThan(200);
            expect(p.y).toBeLessThan(300);
        }
        expect(pts[0]).toEqual({ x: 105, y: 210 });          // half a cell in on both axes
        expect(pts[pts.length - 1]).toEqual({ x: 125, y: 290 });
    });

    it("a degenerate bar or a zero grid gets no probes, and no probes is never 'on the plot'", () => {
        expect(colorbarProbePoints(null)).toEqual([]);
        expect(colorbarProbePoints(rect(100, 200, 100, 300))).toEqual([]);
        expect(colorbarProbePoints(rect(100, 200, 130, 300), 0, 5)).toEqual([]);
        expect(colorbarOnPlot(0, 0)).toBe(false);
    });

    it("a MAJORITY of the bar must have ink under it (see below)", () => {});
});

describe("swatchPairs / isLegendSignature - the shape of a legend that never announced itself", () => {
    // A swatch column: 12x12 squares at x 700, labels 6px to their right.
    const swatch = (y: number) => rect(700, y, 712, y + 12);
    const label = (y: number, w = 40) => rect(718, y - 1, 718 + w, y + 13);

    it("THE CASE: the dendrogram colour legend over its leaf labels - four same-size swatches, each labelled", () => {
        const shapes = [swatch(100), swatch(118), swatch(136), swatch(154)];
        const texts = [label(100), label(118), label(136), label(154)];
        const p = swatchPairs(shapes, texts);
        expect(p.pairs).toBe(4);
        expect(p.sameSize).toBe(true);
        expect(isLegendSignature(p)).toBe(true);
    });

    it("a table row is NOT a legend: shape + text pairs, but the shapes differ in size", () => {
        // Tabular-with-embedded: a 12x12 icon, a 24x8 sparkline bar, an 18x18 status dot, each with a label.
        const shapes = [rect(100, 100, 112, 112), rect(200, 102, 224, 110), rect(300, 97, 318, 115)];
        const texts = [label(100).left !== 0 ? rect(118, 99, 160, 113) : rect(0, 0, 0, 0), rect(230, 99, 270, 113), rect(324, 99, 360, 113)];
        const p = swatchPairs(shapes, texts);
        expect(p.pairs).toBe(3);
        expect(p.sameSize).toBe(false);
        expect(isLegendSignature(p)).toBe(false);
    });

    it("a single-entry legend is below the floor - and that gap is stated, not hidden", () => {
        const p = swatchPairs([swatch(100)], [label(100)]);
        expect(p.pairs).toBe(1);
        expect(isLegendSignature(p)).toBe(false);
        expect(SIGNATURE_MIN_PAIRS).toBe(2);
    });

    it("a mark is not a swatch: anything over SWATCH_MAX_PX on either side is skipped", () => {
        const bars = [rect(100, 100, 100 + SWATCH_MAX_PX + 1, 112), rect(100, 130, 100 + SWATCH_MAX_PX + 1, 142)];
        const texts = [rect(140, 99, 180, 113), rect(140, 129, 180, 143)];
        expect(swatchPairs(bars, texts).pairs).toBe(0);
    });

    it("the label must sit BESIDE the swatch - to its right, within the gap, on its row", () => {
        const shapes = [swatch(100), swatch(118)];
        expect(swatchPairs(shapes, [rect(760, 99, 800, 113), rect(760, 117, 800, 131)]).pairs).toBe(0);   // 48px away: too far
        expect(swatchPairs(shapes, [rect(640, 99, 690, 113), rect(640, 117, 690, 131)]).pairs).toBe(0);   // to the LEFT
        expect(swatchPairs(shapes, [rect(718, 140, 758, 154), rect(718, 160, 758, 174)]).pairs).toBe(0);  // below the rows
    });

    it("a zero-size shape is nothing, and a zero-height text is not a label", () => {
        expect(swatchPairs([rect(700, 100, 700, 100)], [label(100)]).pairs).toBe(0);
    });

    it("the majority of the bar must have ink under it", () => {
        expect(colorbarOnPlot(15, 15)).toBe(true);            // a tile behind all of it
        expect(colorbarOnPlot(8, 15)).toBe(true);
        expect(colorbarOnPlot(7, 15)).toBe(false);
        // a diagonal contour whose BOX covers the bar and whose ink misses it.
        expect(colorbarOnPlot(0, 15)).toBe(false);
        expect(colorbarOnPlot(7, 15, 0.4)).toBe(true);        // the threshold is the lever
        expect(COLORBAR_ON_PLOT_COVER).toBe(0.5);
    });
});
