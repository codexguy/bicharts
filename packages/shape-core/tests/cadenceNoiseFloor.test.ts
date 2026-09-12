// The NOISE FLOOR behind DEFAULT_GAP_FACTOR, pinned.
//
// The standing rule for any threshold on a sample statistic: simulate inputs where the effect
// is genuinely ABSENT and see what the statistic reports anyway, before choosing the number.
// The effect here is "a hole a line would bridge dishonestly"; the null is a series with no
// hole, only scattered single misses, which a line may honestly bridge.
//
// These tests exist so a later re-fit has to explain the same points. If one fails, the
// statistic's behaviour changed — do not move the assertion to match it without re-running the
// sweep and re-reading where the noise stops.
import { describe, it, expect } from "vitest";
import { measureCadence, DEFAULT_GAP_FACTOR } from "../src/cadence";

// mulberry32. A plain LCG produces non-converging noise that reads as a property of the
// statistic rather than of the generator, so the sweep uses a real one.
function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const MS = 86400000;
const D0 = Date.UTC(2025, 0, 1);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function dailyWithMisses(n: number, missPct: number, r: () => number): string[] {
    const out: string[] = [];
    for (let i = 0; i < n; i++) if (r() >= missPct) out.push(iso(D0 + i * MS));
    return out;
}
function weekdaysWithMisses(n: number, missPct: number, r: () => number): string[] {
    const out: string[] = [];
    let i = 0, made = 0;
    while (made < n && i < n * 3) {
        const ms = D0 + i * MS; const wd = new Date(ms).getUTCDay();
        if (wd >= 1 && wd <= 5) { if (r() >= missPct) out.push(iso(ms)); made++; }
        i++;
    }
    return out;
}
function monthly(n: number, missPct: number, r: () => number): string[] {
    const out: string[] = [];
    for (let i = 0; i < n; i++) if (r() >= missPct) out.push(iso(Date.UTC(2015, i, 1)));
    return out;
}

const SEEDS = 400;
function worstOverSeeds(make: (r: () => number) => string[]) {
    let maxGap = 0, maxRuns = 0;
    for (let s = 0; s < SEEDS; s++) {
        const c = measureCadence(make(rng(s + 1)));
        if (!c) continue;
        maxGap = Math.max(maxGap, c.largestGapUnits);
        maxRuns = Math.max(maxRuns, c.runs);
    }
    return { maxGap, maxRuns };
}

describe("cadence noise floor (2026-09-12)", () => {
    // SWEPT PER SIZE, never pooled: pooling sizes of wildly different n hides whether the
    // statistic scales with n, and that is the thing the constant depends on.
    const SIZES = [16, 30, 90, 365];

    it("a contiguous series has no gap and no boundary at any length", () => {
        for (const n of SIZES) {
            const { maxGap, maxRuns } = worstOverSeeds(r => dailyWithMisses(n, 0, r));
            expect(maxGap, `daily n=${n}`).toBe(1);
            expect(maxRuns, `daily n=${n}`).toBe(1);
        }
        for (const n of [20, 60, 250]) {
            const { maxGap, maxRuns } = worstOverSeeds(r => weekdaysWithMisses(n, 0, r));
            expect(maxGap, `weekday n=${n}`).toBe(1);
            expect(maxRuns, `weekday n=${n}`).toBe(1);
        }
    });

    it("scattered misses up to 5% never split a run — at ANY series length or grain", () => {
        // This is the whole reason the constant is 5. At realistic miss rates the largest gap
        // the null case produces is 5 periods, so a boundary at "> 5" cannot be reached by
        // noise. A lower factor would break every real series that drops the odd reading.
        for (const miss of [0.02, 0.05]) {
            for (const n of SIZES) {
                const { maxGap, maxRuns } = worstOverSeeds(r => dailyWithMisses(n, miss, r));
                expect(maxGap, `daily n=${n} miss=${miss}`).toBeLessThanOrEqual(DEFAULT_GAP_FACTOR);
                expect(maxRuns, `daily n=${n} miss=${miss}`).toBe(1);
            }
            for (const n of [20, 60, 250]) {
                const { maxRuns } = worstOverSeeds(r => weekdaysWithMisses(n, miss, r));
                expect(maxRuns, `weekday n=${n} miss=${miss}`).toBe(1);
            }
            const { maxRuns: moRuns } = worstOverSeeds(r => monthly(36, miss, r));
            expect(moRuns, `monthly miss=${miss}`).toBe(1);
        }
    });

    it("the floor is FLAT in n, so a constant is correctly specified (not a sqrt(n) term)", () => {
        // R20's spreadRatio fell as 1/sqrt(n) and every constant threshold was therefore wrong
        // in both directions at once. This statistic does not: it is the maximum of many small
        // draws, and across a 20x range in n the worst gap moves by one period. Were this to
        // change, the constant would have to become a function of n.
        const small = worstOverSeeds(r => dailyWithMisses(16, 0.05, r)).maxGap;
        const large = worstOverSeeds(r => dailyWithMisses(365, 0.05, r)).maxGap;
        expect(Math.abs(large - small)).toBeLessThanOrEqual(1);
    });

    it("a REAL hole of 5+ periods always splits, and one of 4 or fewer never does", () => {
        const withHole = (hole: number) => {
            const v: string[] = [];
            for (let i = 0; i < 20; i++) v.push(iso(D0 + i * MS));
            for (let i = 0; i < 20; i++) v.push(iso(D0 + (20 + hole + i) * MS));
            return measureCadence(v)!;
        };
        for (const hole of [1, 2, 3, 4]) {
            expect(withHole(hole).runs, `${hole}-day hole`).toBe(1);
        }
        for (const hole of [5, 6, 8, 12, 20]) {
            const c = withHole(hole);
            expect(c.runs, `${hole}-day hole`).toBe(2);
            expect(c.largestGapUnits, `${hole}-day hole`).toBe(hole + 1);
        }
    });

    it("the production sensor series this was built for", () => {
        // 16 readings, 1-8 September and 1-8 October. The chart drew one smooth curve
        // across the hole and fitted a trend through it.
        const v: string[] = [];
        for (let i = 0; i < 8; i++) v.push(iso(Date.UTC(2026, 8, 1) + i * MS));
        for (let i = 0; i < 8; i++) v.push(iso(Date.UTC(2026, 9, 1) + i * MS));
        const c = measureCadence(v, { includeBounds: true })!;
        expect(c.grain).toBe("day");
        expect(c.points).toBe(16);
        expect(c.expectedPoints).toBe(38);
        expect(c.coveragePct).toBe(42.1);
        expect(c.runs).toBe(2);
        expect(c.largestGapUnits).toBe(23);
        expect(c.runBounds).toEqual([
            { from: "2026-09-01", to: "2026-09-08", points: 8 },
            { from: "2026-10-01", to: "2026-10-08", points: 8 },
        ]);
    });
});
