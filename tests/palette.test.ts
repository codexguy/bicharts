import { describe, it, expect } from "vitest";
import colorsea from "colorsea";
import { buildPalette, buildPaletteFromSeed, pickDistinctColorFromSeed, orderMostDistinct, MIN_DELTA_E }
    from "../packages/chart-host/src/palette";
import { deltaEHex } from "../packages/chart-host/src/deltaE";

// THE PROPERTY THAT MATTERS IS PERCEPTUAL SEPARATION, not any particular hex.
//
// Asserting exact colours would pin the walk's internal step order, which is tuning and is
// allowed to move. What may never move is the reason the walk exists: two colours a reader
// cannot tell apart must not both end up in one chart's legend. So the tests measure the same
// CIE2000 distance the implementation does and assert on THAT.
const deltaE = (a: string, b: string) => colorsea(a).deltaE(colorsea(b), "CIE2000");

/** Smallest pairwise distance in a palette - the number a reader actually experiences. */
function tightestPair(colors: string[]): number {
    let worst = Number.POSITIVE_INFINITY;
    for (let i = 0; i < colors.length; i++) {
        for (let j = i + 1; j < colors.length; j++) {
            worst = Math.min(worst, deltaE(colors[i], colors[j]));
        }
    }
    return worst;
}

describe("buildPaletteFromSeed", () => {
    it("returns the requested count", () => {
        expect(buildPaletteFromSeed("#1f77b4", 10)).toHaveLength(10);
        expect(buildPaletteFromSeed("#1f77b4", 1)).toHaveLength(1);
    });

    it("leads with the seed, so a one-series chart is the host's own colour", () => {
        // The whole argument for reading the workbook's accent is that a small chart looks like
        // it belongs there. That only holds if slot 1 IS the accent.
        expect(buildPaletteFromSeed("#1f77b4", 6)[0].toLowerCase()).toBe("#1f77b4");
    });

    it("keeps every pair perceptually distinct at the ten slots Excel exposes", () => {
        // Ten is what the Excel add-in's Settings shows (workbook-seeded palette, 2026-09-09).
        // A palette that collides inside that range is the defect this module exists to prevent.
        for (const seed of ["#1f77b4", "#c00000", "#2ca02c", "#7030a0", "#ffc000", "#000000"]) {
            const p = buildPaletteFromSeed(seed, 10);
            expect(tightestPair(p), `seed ${seed}`).toBeGreaterThanOrEqual(MIN_DELTA_E);
        }
    });

    it("is deterministic, so a persisted palette re-derives to the same colours", () => {
        // A host stores the generated set and may rebuild it later. If the walk drifted, a saved
        // chart would silently change colour on reopen.
        expect(buildPaletteFromSeed("#1f77b4", 12)).toEqual(buildPaletteFromSeed("#1f77b4", 12));
    });

    it("grows by extension - asking for more never rewrites the earlier slots", () => {
        // The Settings pane shows ten and can expand to twenty. Slot 3 must not change colour
        // because the reader clicked "show all".
        const ten = buildPaletteFromSeed("#1f77b4", 10);
        const twenty = buildPaletteFromSeed("#1f77b4", 20);
        expect(twenty.slice(0, 10)).toEqual(ten);
    });

    it("stays near the seed's hue before it rotates away", () => {
        // The early slots are the ones a two- or three-series chart uses, and they are the
        // reason one brand colour is worth reading at all: they must still read as that colour
        // rather than as a stranger. Later slots are allowed to travel.
        const [, second, third] = buildPaletteFromSeed("#1f77b4", 10);
        const seedHue = colorsea("#1f77b4").hsl()[0];
        const hueGap = (h: number) => Math.min(Math.abs(h - seedHue), 360 - Math.abs(h - seedHue));
        expect(hueGap(colorsea(second).hsl()[0])).toBeLessThanOrEqual(45);
        expect(hueGap(colorsea(third).hsl()[0])).toBeLessThanOrEqual(45);
    });

    it("spreads an ACHROMATIC seed, which the seed's own walk cannot do", () => {
        // THE CASE POWER BI NEVER SHOWED US. On black, white or any pure grey, colorsea reports
        // hue as NaN, and saturate() and spin() are both no-ops - so the walk's hue and
        // saturation steps do nothing and only lightness moves. Before sweepCandidates existed,
        // ten slots from #000000 produced four greys and six repeats of #000000, i.e. a legend
        // with six entries in identical colours. The visual never hit it because Power BI hands
        // it a DIFFERENT theme colour per slot; a workbook has one accent and it can be a grey
        // header fill.
        for (const seed of ["#000000", "#ffffff", "#808080"]) {
            const p = buildPaletteFromSeed(seed, 10);
            expect(new Set(p.map(c => c.toLowerCase())).size, `seed ${seed} produced duplicates`).toBe(10);
            expect(tightestPair(p), `seed ${seed}`).toBeGreaterThanOrEqual(MIN_DELTA_E);
        }
    });

    it("keeps synthesised colours off both page extremes", () => {
        // A near-white or near-black mark is invisible against one of the two page colours the
        // add-in actually renders on, which is worse than being off-theme.
        for (const seed of ["#000000", "#ffffff"]) {
            for (const hex of buildPaletteFromSeed(seed, 20).slice(1)) {
                const l = colorsea(hex).hsl()[2];
                expect(l, `${seed} -> ${hex}`).toBeGreaterThan(15);
                expect(l, `${seed} -> ${hex}`).toBeLessThan(90);
            }
        }
    });

    it("answers empty for nonsense input rather than throwing", () => {
        // A host that could not resolve an accent passes "" and must fall through to its own
        // default, not crash a render.
        expect(buildPaletteFromSeed("", 10)).toEqual([]);
        expect(buildPaletteFromSeed("#1f77b4", 0)).toEqual([]);
        expect(buildPaletteFromSeed("#1f77b4", -3)).toEqual([]);
    });
});

describe("buildPalette - the host names the base colours", () => {
    // A REPORT THEME'S COLOURS ARE AUTHORED, and the point of asking the host per slot is that
    // they come back UNCHANGED. Power BI hands out a different colour per slot; feed those in
    // separately and the walk settles at step 1 every time, so the chart is coloured by the
    // theme rather than by our arithmetic.
    //
    // These are the tests that fail if someone ever "simplifies" a host with a colour API onto
    // buildPaletteFromSeed. That change is invisible in the output - the single-seed form also
    // returns a plausible list of distinct colours - so it needs a test, not a comment.
    const THEME = ["#01b8aa", "#374649", "#fd625e", "#f2c80f", "#5f6b6d", "#8ad4eb"];

    it("returns an authored theme verbatim", () => {
        const p = buildPalette(i => THEME[i], THEME.length);
        expect(p.map(c => c.toLowerCase())).toEqual(THEME);
    });

    it("is NOT what spreading from the first colour produces", () => {
        // The regression guard proper. If these ever match, the per-slot seeding has been lost.
        const authored = buildPalette(i => THEME[i], THEME.length);
        const spread = buildPaletteFromSeed(THEME[0], THEME.length);
        expect(authored.map(c => c.toLowerCase())).not.toEqual(spread.map(c => c.toLowerCase()));
    });

    it("still separates two authored colours a reader could not tell apart", () => {
        // Deferring to the host is not the same as trusting it blindly: a theme with two
        // near-identical entries would put both in one legend, which is the defect the walk
        // exists to prevent. The FIRST is kept as authored; the second moves.
        const p = buildPalette(i => (i === 0 ? "#1f77b4" : "#1f78b5"), 2);
        expect(p[0].toLowerCase()).toBe("#1f77b4");
        expect(deltaE(p[0], p[1])).toBeGreaterThanOrEqual(MIN_DELTA_E);
    });

    it("carries the last supplied colour forward when the host runs out", () => {
        // A provider may have fewer authored colours than slots. That is "spread from here",
        // not a hole in the palette.
        const p = buildPalette(i => (i < 2 ? THEME[i] : ""), 8);
        expect(p).toHaveLength(8);
        expect(p.slice(0, 2).map(c => c.toLowerCase())).toEqual(THEME.slice(0, 2));
        expect(tightestPair(p)).toBeGreaterThanOrEqual(MIN_DELTA_E);
    });

    it("answers empty when the host never names a colour, rather than inventing one", () => {
        expect(buildPalette(() => "", 10)).toEqual([]);
        expect(buildPalette(() => null, 10)).toEqual([]);
    });

    it("survives a provider that throws", () => {
        // A host API can fail mid-call. Losing the palette from that point is acceptable;
        // taking the render down with it is not.
        const p = buildPalette(i => { if (i === 3) throw new Error("host went away"); return THEME[0]; }, 6);
        expect(p.length).toBeGreaterThan(0);
        expect(tightestPair(p)).toBeGreaterThanOrEqual(MIN_DELTA_E);
    });

    it("makes buildPaletteFromSeed exactly the constant-provider case", () => {
        expect(buildPaletteFromSeed("#4472c4", 12)).toEqual(buildPalette(() => "#4472c4", 12));
    });
});

describe("pickDistinctColorFromSeed", () => {
    it("returns the seed untouched when nothing has been issued", () => {
        const { hex } = pickDistinctColorFromSeed("#1f77b4", new Set());
        expect(hex.toLowerCase()).toBe("#1f77b4");
    });

    it("moves away from a colour already issued", () => {
        const issued = new Set(["#1f77b4"]);
        const { hex } = pickDistinctColorFromSeed("#1f77b4", issued);
        expect(deltaE(hex, "#1f77b4")).toBeGreaterThanOrEqual(MIN_DELTA_E);
    });

    it("treats the existing set as readonly - the caller registers", () => {
        // The give-up branch registers a DIFFERENT value than it returns, which only works if
        // the caller owns the set. A module that mutated it would make that contract a lie.
        const issued = new Set(["#1f77b4"]);
        pickDistinctColorFromSeed("#1f77b4", issued);
        expect([...issued]).toEqual(["#1f77b4"]);
    });
});

describe("orderMostDistinct - a host's own pool, most distinct first", () => {
    // A pool with the defect in it: two blues a reader can barely tell apart, listed far enough
    // apart that a host walking the list in order would give a four-series chart both of them.
    const POOL = ["#1f77b4", "#ff7f0e", "#2a80bf", "#2ca02c", "#9467bd", "#8c564b"];
    const nearestEarlier = (order: string[], k: number) =>
        Math.min(...order.slice(0, k).map(c => deltaEHex(order[k], c)));

    it("keeps the lead first and returns every pool colour exactly once, unchanged", () => {
        const order = orderMostDistinct("#2ca02c", POOL);
        expect(order[0]).toBe("#2ca02c");
        expect([...order].sort()).toEqual([...POOL].sort());
    });

    it("takes next whichever colour is farthest from everything already chosen", () => {
        // The definition, checked by brute force at every step rather than trusted.
        const order = orderMostDistinct("#1f77b4", POOL);
        for (let k = 1; k < order.length; k++) {
            const rivals = order.slice(k).map((_, j) => nearestEarlier([...order.slice(0, k), order[k + j]], k));
            expect(nearestEarlier(order, k), `slot ${k}`).toBeCloseTo(Math.max(...rivals), 9);
        }
    });

    it("never gives a later slot more separation than an earlier one", () => {
        // What makes the order worth having: the slots a small chart uses are the best separated.
        const order = orderMostDistinct("#1f77b4", POOL);
        for (let k = 2; k < order.length; k++) {
            expect(nearestEarlier(order, k), `slot ${k}`).toBeLessThanOrEqual(nearestEarlier(order, k - 1) + 1e-9);
        }
    });

    it("sends the near-duplicate blue to the back instead of into a small chart", () => {
        const order = orderMostDistinct("#1f77b4", POOL);
        expect(order[order.length - 1]).toBe("#2a80bf");
        // And the listed order, the thing a host would otherwise use, does worse on the first four.
        const listed = POOL.slice(0, 4);
        expect(tightestPair(order.slice(0, 4))).toBeGreaterThan(tightestPair(listed));
    });

    it("is deterministic, so a persisted palette re-derives to the same colours", () => {
        expect(orderMostDistinct("#ff7f0e", POOL)).toEqual(orderMostDistinct("#ff7f0e", POOL));
    });

    it("takes a lead from outside the pool, and drops a pool entry that repeats it", () => {
        expect(orderMostDistinct("#C00000", POOL)[0]).toBe("#C00000");
        const withRepeat = orderMostDistinct("#1F77B4", POOL);
        expect(withRepeat[0]).toBe("#1F77B4");
        expect(withRepeat.filter(c => c.toLowerCase() === "#1f77b4")).toHaveLength(1);
    });

    it("drops what it cannot measure, and starts from the pool when the lead is unusable", () => {
        expect(orderMostDistinct("", ["#zzz", "rgb(1,2,3)", "#1f77b4", "#ff7f0e"])).toEqual(["#1f77b4", "#ff7f0e"]);
        expect(orderMostDistinct("not a colour", ["#1f77b4"])).toEqual(["#1f77b4"]);
        expect(orderMostDistinct(null, [])).toEqual([]);
    });

    it("feeds buildPalette without being altered when the pool is already well separated", () => {
        // The intended pipeline. A pool whose members all clear the floor comes out verbatim.
        const order = orderMostDistinct("#1f77b4", ["#ff7f0e", "#2ca02c", "#9467bd"]);
        expect(buildPalette(i => order[i], order.length)).toEqual(order);
    });
});
