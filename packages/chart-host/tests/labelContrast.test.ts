// MOVED HERE FROM THE POWER BI VISUAL together with the module it pins. Every case below was
// written against an incident in that host; the module is now shared, so the incidents are
// every host's to keep closed.
import { describe, it, expect } from "vitest";
import {
    toRGBA,
    compositeOver,
    relativeLuminance,
    contrastRatio,
    decideLabelColor,
    isPillBackdropAlpha,
    cellSuppressesNormalize,
    pillBacksGlyph,
    backingHoldsGlyph,
    glyphSampleGrid,
    GLYPH_SAMPLE_N,
    PILL_MIN_COVERAGE,
    BACKING_MAJORITY,
    DARK_TEXT,
    LIGHT_TEXT,
    MIN_CONTRAST,
} from "../src/labelContrast";

describe("toRGBA", () => {
    it("parses hex, rgb, rgba and keywords", () => {
        expect(toRGBA("#fff")).toEqual([255, 255, 255, 1]);
        expect(toRGBA("#28002f")).toEqual([40, 0, 47, 1]);
        expect(toRGBA("rgb(10,20,30)")).toEqual([10, 20, 30, 1]);
        expect(toRGBA("rgba(255,255,255,0.85)")).toEqual([255, 255, 255, 0.85]);
        expect(toRGBA("white")).toEqual([255, 255, 255, 1]);
        expect(toRGBA("none")![3]).toBe(0);
    });
    it("returns null on garbage", () => {
        expect(toRGBA("not-a-color")).toBeNull();
        expect(toRGBA(null)).toBeNull();
    });
});

describe("compositeOver / luminance / contrast", () => {
    it("composites a low-opacity dark hue over white to a pale colour", () => {
        const bg = compositeOver([40, 0, 47, 0.18], [255, 255, 255]);
        // ~ (216, 209, 218) — pale lavender
        expect(bg[0]).toBeGreaterThan(200);
        expect(bg[2]).toBeGreaterThan(200);
        expect(relativeLuminance(bg)).toBeGreaterThan(0.5); // reads LIGHT
    });
    it("luminance endpoints and black/white contrast", () => {
        expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5);
        expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0, 5);
        expect(contrastRatio(relativeLuminance([0, 0, 0]), relativeLuminance([255, 255, 255]))).toBeCloseTo(21, 5);
    });
});

// The BLACK-LEGEND-BOX bug (an incident: one generation: "why are some legend entries
// having a black background?"). The contrast fail-safe finds a translucent shape between the
// cell and the label and BOOSTS it to opacity 0.9 so it actually backs the glyph. A
// cross-filter hit-rect (`fill:'transparent'`, spanning the whole legend entry) matched that
// finder, and since toRGBA('transparent') is [0,0,0,0] the boost rewrote it to rgb(0,0,0) —
// painting a black box over the legend. An invisible shape is a HIT TARGET, not a backdrop.
describe("isPillBackdropAlpha — what may serve as a label backdrop", () => {
    it("REJECTS the fully-transparent cross-filter hit-rect (the black-box bug)", () => {
        expect(isPillBackdropAlpha(toRGBA("transparent")![3])).toBe(false);
        expect(isPillBackdropAlpha(toRGBA("none")![3])).toBe(false);
        expect(isPillBackdropAlpha(0)).toBe(false);
    });
    it("still ACCEPTS a genuine translucent pill", () => {
        expect(isPillBackdropAlpha(0.18)).toBe(true);   // the channel-treemap header band
        expect(isPillBackdropAlpha(0.5)).toBe(true);
        expect(isPillBackdropAlpha(0.84)).toBe(true);
    });
    it("REJECTS an opaque shape — that is the cell, not a pill", () => {
        expect(isPillBackdropAlpha(0.85)).toBe(false);
        expect(isPillBackdropAlpha(1)).toBe(false);
    });
    it("a hit-rect's RGB is not a colour anyone chose — proving why alpha 0 must be excluded", () => {
        // Both keywords collapse to BLACK once the alpha is dropped, which is exactly what
        // the boost did. The guard is the only thing standing between them and the canvas.
        expect(toRGBA("transparent")!.slice(0, 3)).toEqual([0, 0, 0]);
        expect(toRGBA("none")!.slice(0, 3)).toEqual([0, 0, 0]);
    });
});

describe("decideLabelColor", () => {
    it("FIXES white text on a 0.18-opacity dark header (the channel-treemap bug)", () => {
        const d = decideLabelColor("#ffffff", "#28002f", 0.18, "#ffffff");
        expect(d.fix).toBe(true);
        expect(d.color).toBe(DARK_TEXT); // pale background → dark text wins
    });
    it("leaves dark text on the same pale header alone", () => {
        const d = decideLabelColor("#111111", "#28002f", 0.18, "#ffffff");
        expect(d.fix).toBe(false);
    });
    it("leaves white text on a fully-opaque dark fill alone", () => {
        const d = decideLabelColor("#ffffff", "#12239e", 1, "#ffffff");
        expect(d.fix).toBe(false);
    });
    it("fixes white-on-white to dark", () => {
        const d = decideLabelColor("#ffffff", "#ffffff", 1, "#ffffff");
        expect(d.fix).toBe(true);
        expect(d.color).toBe(DARK_TEXT);
    });
    it("fixes black text on a fully-opaque dark fill to light", () => {
        const d = decideLabelColor("#000000", "#12239e", 1, "#ffffff");
        expect(d.fix).toBe(true);
        expect(d.color).toBe(LIGHT_TEXT);
    });
    it("composites semi-transparent label colour before judging", () => {
        // rgba white at 0.85 over a pale fill is still light → unreadable → fix
        const d = decideLabelColor("rgba(255,255,255,0.85)", "#28002f", 0.18, "#ffffff");
        expect(d.fix).toBe(true);
        expect(d.color).toBe(DARK_TEXT);
    });
    it("no-ops (skips) when the mark fill cannot be parsed", () => {
        const d = decideLabelColor("#ffffff", "url(#grad)", 1, "#ffffff");
        expect(d.fix).toBe(false);
        expect(d.reason).toBe("fill-unparsed");
    });
    it("honours a custom min-contrast trip point", () => {
        // borderline case passes at 3.0 but trips at a stricter 7.0
        const lax = decideLabelColor("#ffffff", "#6b6b6b", 1, "#ffffff", 3.0);
        const strict = decideLabelColor("#ffffff", "#6b6b6b", 1, "#ffffff", 7.0);
        expect(strict.fix && !lax.fix).toBe(true);
    });
});


// A CARD IS NOT A TILE - the deck's semantic colours survive the fail-safe.
//
// one generation (the report: "these show as black text until I flip them - then they have color, and when
// I flip them back, they have color when it was black before"). The pass runs with normalize=true
// so labels sharing a coloured tile end up one colour. On the flippable multi-card the "tile" is
// a card filled with the PAGE background, and the value colour IS the meaning - teal above the
// cohort median, orange below. The log said fixed 78 of 78 scanned: a fail-safe that corrects one
// hundred percent of what it inspects is not measuring anything. The colour returned on a flip
// only because paint() recreates the text nodes after the pass has already run.
describe("normalize does not apply on the page background", () => {
    const PAGE = "#ffffff";

    it("leaves a legible semantic colour alone when the backing IS the page", () => {
        // #197278 on white is ~5.9:1 - comfortably legible, and it means something.
        const d = decideLabelColor("#197278", PAGE, 1, PAGE, MIN_CONTRAST, true);
        expect(d.fix).toBe(false);
        expect(d.reason).toBe("ok");
    });

    it("still recolours an ILLEGIBLE label on the page - legibility outranks intent", () => {
        const d = decideLabelColor("#eeeeee", PAGE, 1, PAGE, MIN_CONTRAST, true);
        expect(d.fix).toBe(true);
        expect(d.color).toBe(DARK_TEXT);
    });

    it("STILL normalizes on a real tile, which is what the flag is for", () => {
        // Both black and white clear the floor on this tile, so unify-to-one-colour is exactly
        // the point - and must be untouched by the card fix.
        const d = decideLabelColor("#197278", "#e66c37", 1, PAGE, MIN_CONTRAST, true);
        expect(d.fix).toBe(true);
    });

    it("treats a card within rounding distance of the page as the page", () => {
        const d = decideLabelColor("#197278", "#fefefe", 1, PAGE, MIN_CONTRAST, true);
        expect(d.fix).toBe(false);
    });

    it("a transparent card composites to the page and counts as the page", () => {
        // The deck's card rect carries the visual background, which defaults to transparent.
        const d = decideLabelColor("#197278", "transparent", 1, PAGE, MIN_CONTRAST, true);
        expect(d.fix).toBe(false);
    });

    it("holds on a DARK page too - the rule is 'same as the page', not 'white'", () => {
        const d = decideLabelColor("#7fd6c8", "#1a1a1a", 1, "#1a1a1a", MIN_CONTRAST, true);
        expect(d.fix).toBe(false);
    });
});

// THE SECOND HALF OF THE SAME INCIDENT (an incident: one generation): the moment an EXPLICIT
// card background was set, "fixed" jumped 2 -> 72 on the same deck. The page-match guard above
// only protects the canvas colour; a reader-chosen near-white card misses it by a few RGB
// steps and normalize comes back on for every label. The deck's panels carry lch-deck-panel
// (a RequiredCodeTokens entry for the lane), so the caller can tell "uniform chosen surface"
// from "data-coloured tile" and pass normalize=false for the former.
describe("cellSuppressesNormalize - a panel is not a tile", () => {
    it("matches the deck panel class alone and inside a class list", () => {
        expect(cellSuppressesNormalize("lch-deck-panel")).toBe(true);
        expect(cellSuppressesNormalize("d3-mark dk-hit lch-deck-panel")).toBe(true);
    });

    it("does NOT match a superstring - the class is a contract token, not a substring", () => {
        expect(cellSuppressesNormalize("lch-deck-panel-header")).toBe(false);
        expect(cellSuppressesNormalize("xlch-deck-panel")).toBe(false);
    });

    it("leaves ordinary marks, empty and missing class attributes normalizing", () => {
        expect(cellSuppressesNormalize("d3-mark")).toBe(false);
        expect(cellSuppressesNormalize("")).toBe(false);
        expect(cellSuppressesNormalize(null)).toBe(false);
        expect(cellSuppressesNormalize(undefined)).toBe(false);
    });

    it("with normalize off, a legible semantic colour survives on a NON-page card fill", () => {
        // #197278 on an off-white card (#f5f5f5) is still ~5.4:1. This is the exact
        // combination the page-match guard cannot protect and the panel opt-out must.
        const d = decideLabelColor("#197278", "#f5f5f5", 1, "#ffffff", MIN_CONTRAST, false);
        expect(d.fix).toBe(false);
        expect(d.reason).toBe("ok");
    });

    it("an ILLEGIBLE colour on a chosen card fill is still recoloured", () => {
        // Legibility outranks intent on a panel exactly as on the canvas: pale text on a
        // pale card gets the best-contrast pick even with normalize suppressed.
        const d = decideLabelColor("#eeeeee", "#f5f5f5", 1, "#ffffff", MIN_CONTRAST, false);
        expect(d.fix).toBe(true);
        expect(d.color).toBe(DARK_TEXT);
    });
});

// THE THIRD FACE OF THE SAME FLICKER (an incident: one generation): "notice HR label text is
// white. if I flip the card twice, note the color change." The panel opt-out had already
// stopped normalize, but the value still came out white, because the pass had adopted the
// wrong BACKGROUND: the deck's big value sits above a translucent "vs median" chip, its 88px
// glyph box grazes the chip's top edge, and any-overlap was enough to call that chip the
// value's backdrop - boost it opaque, composite it in, and pick white against it.
describe("pillBacksGlyph - a backdrop backs the whole label", () => {
    // A 200x40 glyph box; areas below are expressed against it.
    const GLYPH = 200 * 40;

    it("accepts a chip drawn around its own label (full coverage)", () => {
        expect(pillBacksGlyph(GLYPH, GLYPH)).toBe(true);
    });

    it("REJECTS a neighbouring chip the descender grazes - the one generation geometry", () => {
        // The value's box overlaps the chip below it by two pixels of its height.
        expect(pillBacksGlyph(200 * 2, GLYPH)).toBe(false);
    });

    it("rejects a shape covering less than the threshold, accepts at it", () => {
        expect(pillBacksGlyph(GLYPH * (PILL_MIN_COVERAGE - 0.01), GLYPH)).toBe(false);
        expect(pillBacksGlyph(GLYPH * PILL_MIN_COVERAGE, GLYPH)).toBe(true);
    });

    it("measures the GLYPH, so a large pill behind a short label still counts", () => {
        // The overlap can only ever be the glyph box itself; a pill twice its size still
        // covers 100% OF THE GLYPH, which is the question being asked.
        expect(pillBacksGlyph(GLYPH, GLYPH)).toBe(true);
    });

    it("is safe on degenerate geometry rather than throwing or dividing by zero", () => {
        expect(pillBacksGlyph(0, GLYPH)).toBe(false);
        expect(pillBacksGlyph(GLYPH, 0)).toBe(false);
        expect(pillBacksGlyph(Number.NaN, GLYPH)).toBe(false);
        expect(pillBacksGlyph(Number.POSITIVE_INFINITY, GLYPH)).toBe(false);
    });

    it("the channel-treemap header band it was written for still qualifies", () => {
        // The original pill: a band drawn behind its label, covering it entirely.
        expect(pillBacksGlyph(GLYPH * 0.98, GLYPH)).toBe(true);
    });
});

// A BOUNDING BOX IS NOT A FILL (an incident: one generation: "the kpi in the center is only
// present when you hover it"). A gauge's centre number sits in the ARC'S HOLE — inside the arc
// path's bounding box, nowhere near its ink — so bbox overlap resolved it onto the value arc and
// normalize repainted it white against a saturated blue it does not sit on. The adapter now
// hit-tests these sample points against the shape's real fill; this is the pure half of that.
describe("glyphSampleGrid — the points a backing is tested at", () => {
    const BOX = { left: 100, top: 50, width: 60, height: 20 };

    it("returns n squared points, all strictly INSIDE the box", () => {
        const pts = glyphSampleGrid(BOX, 3);
        expect(pts).toHaveLength(9);
        for (const p of pts) {
            expect(p.x).toBeGreaterThan(BOX.left);
            expect(p.x).toBeLessThan(BOX.left + BOX.width);
            expect(p.y).toBeGreaterThan(BOX.top);
            expect(p.y).toBeLessThan(BOX.top + BOX.height);
        }
    });

    it("never lands ON an edge — an edge point is ambiguous for isPointInFill", () => {
        for (const p of glyphSampleGrid(BOX, 4)) {
            expect(p.x).not.toBe(BOX.left);
            expect(p.x).not.toBe(BOX.left + BOX.width);
            expect(p.y).not.toBe(BOX.top);
            expect(p.y).not.toBe(BOX.top + BOX.height);
        }
    });

    it("spreads across the box rather than clustering at the centre — the Qingdao lesson", () => {
        // Centre-point sampling is what overlap-area replaced: a label overflowing its tile has
        // its centre on the gap. A grid keeps points ON the tile, so such a label stays scanned.
        const pts = glyphSampleGrid(BOX, 3);
        const xs = new Set(pts.map(p => p.x));
        const ys = new Set(pts.map(p => p.y));
        expect(xs.size).toBe(3);
        expect(ys.size).toBe(3);
        expect(Math.min(...xs)).toBeLessThan(BOX.left + BOX.width / 3);
        expect(Math.max(...xs)).toBeGreaterThan(BOX.left + 2 * BOX.width / 3);
    });

    it("defaults to GLYPH_SAMPLE_N and is safe on degenerate geometry", () => {
        expect(glyphSampleGrid(BOX)).toHaveLength(GLYPH_SAMPLE_N * GLYPH_SAMPLE_N);
        expect(glyphSampleGrid({ left: 0, top: 0, width: 0, height: 10 })).toEqual([]);
        expect(glyphSampleGrid({ left: 0, top: 0, width: 10, height: 0 })).toEqual([]);
        expect(glyphSampleGrid(BOX, 0)).toEqual([]);
        expect(glyphSampleGrid(null as any)).toEqual([]);
    });
});

// A MARK THAT HOLDS A MINORITY OF THE GLYPH IS NOT ITS BACKGROUND (an incident on a small-multiple progress ring: "the color contrast sucks with the white text").
// The ring-hole rule handled a centre number sitting WHOLLY in the hole; the small-multiple
// sub-label straddles instead - wider than the hole, both ends clipping the arc - and the pass
// repainted the whole line white against a colour most of it is not on. The fractions below are
// the ones measured in real Chromium on that generation's own code at the tile's real size,
// in a real browser rather than jsdom.
describe("backingHoldsGlyph - the page is a surface too", () => {
    const GLYPH = 90 * 12;   // the "180,000 of 200,000" sub-label's glyph box

    it("REJECTS the ring straddle at both fractions the repro measured", () => {
        // 2 of 9 sample points on the arc at 610x404, 4 of 9 at 610x374. Most of the label is
        // over the hole, which is page - so the arc does not get to choose its colour.
        expect(backingHoldsGlyph(GLYPH * (2 / 9), GLYPH)).toBe(false);
        expect(backingHoldsGlyph(GLYPH * (4 / 9), GLYPH)).toBe(false);
    });

    it("KEEPS a label wholly on a tile - the case the fail-safe exists for", () => {
        expect(backingHoldsGlyph(GLYPH, GLYPH)).toBe(true);
    });

    it("KEEPS the Qingdao overflow, because the union spans the NEIGHBOURING tiles", () => {
        // A label hanging off a small treemap tile is still on marks either side of it: the
        // union is what clears the bar, and no single tile would have.
        expect(backingHoldsGlyph(GLYPH * (3 / 9), GLYPH)).toBe(false);   // one tile alone
        expect(backingHoldsGlyph(GLYPH * (9 / 9), GLYPH)).toBe(true);    // that tile + neighbours
    });

    it("KEEPS a thin stacked segment whose label box overshoots it top and bottom", () => {
        // 6 of 9 - the ascender/descender rows hang off a short segment. Still a majority, so a
        // genuinely unreadable in-bar label is still rescued; the floor sits below this on
        // purpose (see BACKING_MAJORITY) rather than above it.
        expect(backingHoldsGlyph(GLYPH * (6 / 9), GLYPH)).toBe(true);
    });

    it("splits exactly at the majority, not near it", () => {
        expect(backingHoldsGlyph(GLYPH * (BACKING_MAJORITY - 0.01), GLYPH)).toBe(false);
        expect(backingHoldsGlyph(GLYPH * BACKING_MAJORITY, GLYPH)).toBe(true);
    });

    it("is safe on degenerate geometry rather than throwing or dividing by zero", () => {
        expect(backingHoldsGlyph(0, GLYPH)).toBe(false);
        expect(backingHoldsGlyph(GLYPH, 0)).toBe(false);
        expect(backingHoldsGlyph(Number.NaN, GLYPH)).toBe(false);
        expect(backingHoldsGlyph(Number.POSITIVE_INFINITY, GLYPH)).toBe(false);
    });
});
