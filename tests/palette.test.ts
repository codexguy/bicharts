import { describe, it, expect } from "vitest";
import colorsea from "colorsea";
import { buildPaletteFromSeed, pickDistinctColorFromSeed, MIN_DELTA_E }
    from "../packages/chart-host/src/palette";

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
