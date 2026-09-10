import { describe, it, expect } from "vitest";
import colorsea from "colorsea";
import { deltaEHex, hexToLab, deltaE2000 } from "../src/deltaE";

// WHY THIS MODULE DOES NOT MATCH THE LIBRARY, AND WHY THAT IS CORRECT.
//
// src/deltaE.ts is CIEDE2000 as published. colorsea is not: it substitutes the UNCORRECTED
// chroma difference (C2 - C1) for the G-corrected one (C'2 - C'1) the formulation specifies.
// The two therefore agree on saturated colours and diverge as chroma falls, because the G
// correction colorsea drops is largest when mean chroma is small.
//
// That is a claim, so it is proved rather than asserted. `colorseaVariant` below is this
// module's own arithmetic with that ONE substitution made; it reproduces colorsea to 0.006
// across a sweep of the colour cube while the published formula differs by up to 4.34. One
// term accounts for the whole difference, which is what makes it a diagnosis instead of a
// disagreement.
//
// THE POINT OF THE FILE is that a later reader must not "fix" src/deltaE.ts to match colorsea.
// The census threshold, SAME_SHADE_DELTA_E, is 5, and the pale end of a sequential ramp - where
// a washed-out chart piles up its marks - sits in the low-chroma bands where colorsea is off by
// as much as 4.34. There the library's error is the same size as the measurement.
//
// colorsea stays a devDependency for exactly this comparison. palette.ts still uses it at
// runtime for its HSL walk; that swap was measured separately and changes none of the walk's
// verdicts (0 flips at MIN_DELTA_E over 3,040 pairs from 16 seeds), but it is a bigger job and
// is not what this module is for.

const TOL = 0.05;

/** Chroma below which colorsea's substitution starts to show. */
const CHROMATIC = 1;

function chroma(hex: string): number {
    const l = hexToLab(hex)!;
    return Math.hypot(l.a, l.b);
}

/** This module's arithmetic with colorsea's one substitution, to localise the difference. */
function colorseaVariant(hexA: string, hexB: string): number {
    const RAD = Math.PI / 180, DEG = 180 / Math.PI;
    const c1 = hexToLab(hexA)!, c2 = hexToLab(hexB)!;
    const C1 = Math.hypot(c1.a, c1.b), C2 = Math.hypot(c2.a, c2.b);
    const Cbar = (C1 + C2) / 2, C7 = Math.pow(Cbar, 7);
    const G = 0.5 * (1 - Math.sqrt(C7 / (C7 + Math.pow(25, 7))));
    const a1p = (1 + G) * c1.a, a2p = (1 + G) * c2.a;
    const C1p = Math.hypot(a1p, c1.b), C2p = Math.hypot(a2p, c2.b);
    const neutral = C1p < 1e-4 || C2p < 1e-4;
    const h1p = C1p < 1e-4 ? 0 : ((Math.atan2(c1.b, a1p) * DEG) + 360) % 360;
    const h2p = C2p < 1e-4 ? 0 : ((Math.atan2(c2.b, a2p) * DEG) + 360) % 360;
    const dLp = c2.L - c1.L;
    const dCp = C2 - C1;                                  // <-- the substitution
    let dhp = 0;
    if (!neutral) {
        if (Math.abs(h2p - h1p) <= 180) dhp = h2p - h1p;
        else if (h2p - h1p > 180) dhp = h2p - h1p - 360;
        else dhp = h2p - h1p + 360;
    }
    const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * RAD);
    const Lbarp = (c1.L + c2.L) / 2, Cbarp = (C1p + C2p) / 2;
    let hbarp: number;
    if (neutral) hbarp = h1p + h2p;
    else if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
    else if (h1p + h2p < 360) hbarp = (h1p + h2p + 360) / 2;
    else hbarp = (h1p + h2p - 360) / 2;
    const T = 1 - 0.17 * Math.cos((hbarp - 30) * RAD) + 0.24 * Math.cos((2 * hbarp) * RAD)
        + 0.32 * Math.cos((3 * hbarp + 6) * RAD) - 0.20 * Math.cos((4 * hbarp - 63) * RAD);
    const dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
    const Cbarp7 = Math.pow(Cbarp, 7);
    const RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + Math.pow(25, 7)));
    const RT = -RC * Math.sin(2 * dTheta * RAD);
    const Lm50 = Math.pow(Lbarp - 50, 2);
    const SL = 1 + (0.015 * Lm50) / Math.sqrt(20 + Lm50);
    const SC = 1 + 0.045 * Cbarp, SH = 1 + 0.015 * Cbarp * T;
    const tL = dLp / SL, tC = dCp / SC, tH = dHp / SH;
    return Math.sqrt(tL * tL + tC * tC + tH * tH + RT * tC * tH);
}

/** A spread that exercises the formula's corners, not just mid-greys. */
const SAMPLE = [
    "#000000", "#ffffff", "#808080", "#7f7f7f",
    "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#00ffff", "#ff00ff",
    // Sequential ramp stops - the population the colour-spread census actually measures.
    "#f7fbff", "#deebf7", "#c6dbef", "#9ecae1", "#6baed6", "#4292c6", "#2171b5", "#08519c", "#08306b",
    "#fff5f0", "#fee0d2", "#fcbba1", "#fc9272", "#fb6a4a", "#ef3b2c", "#cb181d", "#99000d",
    // Viridis - a curved, multi-hue ramp.
    "#440154", "#46327e", "#365c8d", "#277f8e", "#1fa187", "#4ac16d", "#a0da39", "#fde725",
    // Categorical, the off-axis colours the ramp test has to reject.
    "#4e79a7", "#f28e2c", "#e15759", "#76b7b2", "#59a14f", "#edc948", "#b07aa1", "#ff9da7",
    // The blue region, where the CIEDE2000 rotation term is load-bearing.
    "#1a1aff", "#3333cc", "#000080", "#191970", "#4169e1",
    // Near-neutrals, where chroma approaches zero and the hue terms go undefined.
    "#fefefe", "#010101", "#7f807f", "#c0c0c1", "#666666", "#999999",
];

describe("deltaE2000 agrees with colorsea wherever the correction is negligible", () => {
    // The two converge as chroma RISES, because the G correction that colorsea drops shrinks
    // with mean chroma. Measured over a sweep of the cube, worst |difference| by the pair's
    // LOWER chroma:
    //
    //     chroma < 1     4.337        chroma 10-20   0.667
    //     chroma 5-10    1.246        chroma 20-40   0.191
    //                                 chroma 40+     0.004
    //
    // So "they agree" is only true of saturated colours, and this says so with the number
    // rather than picking a bar that happens to pass.
    const SATURATED = 40;

    it("matches to 0.05 on the saturated pairs, where the dropped term is negligible", () => {
        let worst = 0, worstPair = "", pairs = 0;
        for (let i = 0; i < SAMPLE.length; i++) {
            for (let j = i; j < SAMPLE.length; j++) {
                if (chroma(SAMPLE[i]) < SATURATED || chroma(SAMPLE[j]) < SATURATED) continue;
                const mine = deltaEHex(SAMPLE[i], SAMPLE[j]);
                const theirs = colorsea(SAMPLE[i]).deltaE(colorsea(SAMPLE[j]), "CIE2000");
                const d = Math.abs(mine - theirs);
                pairs++;
                if (d > worst) { worst = d; worstPair = `${SAMPLE[i]} vs ${SAMPLE[j]} (${mine} vs ${theirs})`; }
            }
        }
        expect(pairs).toBeGreaterThan(40);
        expect(worst, `worst disagreement: ${worstPair}`).toBeLessThan(TOL);
    });

    it("diverges MONOTONICALLY as chroma falls, which is the signature of the dropped term", () => {
        // A difference that grew randomly would mean a transcription error somewhere else.
        const hx = (n: number) => n.toString(16).padStart(2, "0");
        const band = (c: number) => c < 1 ? 0 : c < 10 ? 1 : c < 20 ? 2 : c < 40 ? 3 : 4;
        const worst = [0, 0, 0, 0, 0];
        for (let r = 0; r < 256; r += 17)
            for (let g = 0; g < 256; g += 17)
                for (let b = 0; b < 256; b += 51) {
                    const A = "#" + hx(r) + hx(g) + hx(b);
                    const B = "#" + hx(255 - r) + hx(g) + hx(255 - b);
                    const k = band(Math.min(chroma(A), chroma(B)));
                    worst[k] = Math.max(worst[k], Math.abs(deltaEHex(A, B)
                        - colorsea(A).deltaE(colorsea(B), "CIE2000")));
                }
        for (let k = 1; k < worst.length; k++) {
            expect(worst[k], `band ${k} vs ${k - 1}`).toBeLessThan(worst[k - 1]);
        }
        expect(worst[4]).toBeLessThan(TOL);
        expect(worst[0]).toBeGreaterThan(4);
    });
});

describe("where they diverge, the divergence is colorsea's and it is localised", () => {
    // DO NOT 'FIX' src/deltaE.ts TO MATCH colorsea. This is what says why.
    it("colorsea is reproduced EXACTLY by substituting the uncorrected chroma difference", () => {
        const hx = (n: number) => n.toString(16).padStart(2, "0");
        let worstVariant = 0, worstPublished = 0, pairs = 0;
        for (let r = 0; r < 256; r += 17)
            for (let g = 0; g < 256; g += 51)
                for (let b = 0; b < 256; b += 51) {
                    const A = "#" + hx(r) + hx(g) + hx(b);
                    const B = "#" + hx(255 - r) + hx(g) + hx(255 - b);
                    const theirs = colorsea(A).deltaE(colorsea(B), "CIE2000");
                    worstVariant = Math.max(worstVariant, Math.abs(colorseaVariant(A, B) - theirs));
                    worstPublished = Math.max(worstPublished, Math.abs(deltaEHex(A, B) - theirs));
                    pairs++;
                }
        expect(pairs).toBeGreaterThan(500);
        // One substitution accounts for the whole difference...
        expect(worstVariant).toBeLessThan(0.02);
        // ...and without it the two really do diverge, so the test above is not vacuous.
        expect(worstPublished).toBeGreaterThan(4);
    });

    it("names the shape of it: a grey against a colour", () => {
        // #666666 is a true neutral; CIEDE2000 puts it 23.2 from #996699, colorsea says 18.8.
        expect(deltaEHex("#666666", "#996699")).toBeCloseTo(23.18, 1);
        expect(colorsea("#666666").deltaE(colorsea("#996699"), "CIE2000")).toBeCloseTo(18.84, 1);
    });
});

describe("basic properties", () => {
    it("is zero for a colour against itself, and symmetric", () => {
        for (const c of SAMPLE) expect(deltaEHex(c, c)).toBeCloseTo(0, 10);
        expect(deltaEHex("#4e79a7", "#f28e2c")).toBeCloseTo(deltaEHex("#f28e2c", "#4e79a7"), 10);
    });

    it("puts black-to-white at the far end of the scale", () => {
        expect(deltaEHex("#000000", "#ffffff")).toBeGreaterThan(99);
    });

    it("converts Lab the same as colorsea does, to two decimals", () => {
        // The conversion is NOT where the two differ - worth pinning, so a future divergence
        // cannot be misread as a white-point or matrix problem.
        for (const c of ["#ff0000", "#00ff00", "#0000ff", "#4e79a7", "#08306b", "#fde725"]) {
            const mine = hexToLab(c)!;
            const theirs = (colorsea(c) as any).lab();
            expect(mine.L).toBeCloseTo(theirs[0], 1);
            expect(mine.a).toBeCloseTo(theirs[1], 1);
            expect(mine.b).toBeCloseTo(theirs[2], 1);
        }
    });

    it("reads #rgb shorthand the same as its long form", () => {
        expect(deltaEHex("#fff", "#000")).toBeCloseTo(deltaEHex("#ffffff", "#000000"), 10);
    });

    it("returns NaN rather than a plausible number for something it cannot parse", () => {
        expect(deltaEHex("rebeccapurple", "#000")).toBeNaN();
        expect(deltaEHex("rgb(1,2,3)", "#000")).toBeNaN();
        expect(hexToLab("nonsense")).toBeNull();
    });

    it("takes Lab directly, for callers that already converted", () => {
        const a = hexToLab("#4e79a7")!, b = hexToLab("#f28e2c")!;
        expect(deltaE2000(a, b)).toBeCloseTo(deltaEHex("#4e79a7", "#f28e2c"), 10);
    });
});
