// PERCEPTUAL COLOUR DISTANCE, WITHOUT THE BUG.
//
// The colour-spread census needs one number: how different do these two fills look? colorsea can
// answer it, and this module exists because its answer is WRONG in the region the census cares
// most about.
//
// colorsea substitutes the UNCORRECTED chroma difference (C2 - C1) for the G-corrected one
// (C'2 - C'1) that CIEDE2000 specifies. The G correction is largest when mean chroma is small, so
// the error grows as colour drains out:
//
//     lower chroma of the pair    < 1    5-10   10-20   20-40    40+
//     worst |colorsea - CIE2000|  4.34   1.25   0.67    0.19     0.004
//
// SAME_SHADE_DELTA_E is 5. The pale end of a sequential ramp - the exact population the census
// measures, and the exact place a washed-out chart piles its marks up - sits in the low-chroma
// bands, where colorsea's error is the same size as the threshold being tested. That is not a
// rounding difference; it would decide the answer.
//
// deltaE.test.ts localises the discrepancy to that one term (this module's own arithmetic, with
// that single substitution made, reproduces colorsea to 0.006 across a sweep of the cube) so a
// later reader does not "fix" this file to match the library.
//
// The bundle is a secondary benefit and a smaller one than it looks: colorsea is about 26 KB of
// the eager closure, and chart-host's budget is dominated by shape-core's bundled reference data
// (531 KB), which is a separate problem with its own item. palette.ts still uses colorsea for its
// HSL walk; retiring it there is a bigger job with its own behaviour surface.
//
// The maths is not an approximation: sRGB -> linear -> XYZ (D65) -> CIE L*a*b*, then CIEDE2000 as
// published.

/** CIE L*a*b*, D65. */
export interface Lab { L: number; a: number; b: number; }

/** sRGB companding, inverted: the gamma curve back to linear light. */
function linearise(c: number): number {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

// D65 white point, the sRGB reference. Lab is meaningless without one, and mixing D50 into an
// sRGB pipeline is the classic way to get numbers that look plausible and are wrong by a unit
// or two - which matters here, where the whole point is a threshold at 5.
const Xn = 0.95047, Yn = 1.0, Zn = 1.08883;
const EPS = 216 / 24389, KAPPA = 24389 / 27;

function f(t: number): number {
    return t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116;
}

/** sRGB (0-255 per channel) to CIE L*a*b*. */
export function rgbToLab(r: number, g: number, b: number): Lab {
    const R = linearise(r), G = linearise(g), B = linearise(b);
    const X = 0.4124564 * R + 0.3575761 * G + 0.1804375 * B;
    const Y = 0.2126729 * R + 0.7151522 * G + 0.0721750 * B;
    const Z = 0.0193339 * R + 0.1191920 * G + 0.9503041 * B;
    const fx = f(X / Xn), fy = f(Y / Yn), fz = f(Z / Zn);
    return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** `#rgb` / `#rrggbb` to Lab. Returns null on anything else rather than guessing. */
export function hexToLab(hex: string): Lab | null {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return null;
    const h = m[1].length === 3
        ? m[1][0] + m[1][0] + m[1][1] + m[1][1] + m[1][2] + m[1][2]
        : m[1];
    return rgbToLab(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16));
}

const RAD = Math.PI / 180, DEG = 180 / Math.PI;

/**
 * Chroma below this counts as NEUTRAL, and the standard's undefined-hue branch applies.
 *
 * The formulation says "if C'1 C'2 = 0", and taken literally that test almost never fires. A
 * true grey does not convert to a* = b* = 0 exactly: the sRGB-to-XYZ matrix rows do not sum to
 * the white point in binary floating point, so #666666 lands at a* = -8.5e-6, b* = 3.4e-6. That
 * is a chroma of nine millionths and a hue angle of pure noise - and CIEDE2000 then takes the
 * MEAN of that noise angle and the other colour's real hue to weight its T term, which threw
 * #666666 against #996699 out by 4.3 units. Not a rounding difference; a wrong branch.
 *
 * 1e-4 is far below any chroma a real colour has and far above the residue. (Libraries that
 * round Lab to two decimals before comparing get the right branch by accident, which is why the
 * disagreement only ever showed up on greys.)
 */
const NEUTRAL_CHROMA = 1e-4;

/**
 * CIEDE2000, with the standard parametric weights (kL = kC = kH = 1).
 *
 * Transcribed from the published formulation rather than from another implementation - which is
 * why it does not match colorsea, and why deltaE.test.ts proves that is colorsea's doing rather
 * than a slip here. The two fiddly parts, which is where transcriptions usually go
 * wrong: the mean hue h-bar must account for the 360-degree wrap (and is undefined, so taken as
 * the sum, when either chroma is zero), and the rotation term applies only in the blue region -
 * without it, two blues read as further apart than they look, which is exactly the region a
 * sequential ramp spends most of its length in.
 */
export function deltaE2000(c1: Lab, c2: Lab): number {
    const C1 = Math.hypot(c1.a, c1.b), C2 = Math.hypot(c2.a, c2.b);
    const Cbar = (C1 + C2) / 2;
    const C7 = Math.pow(Cbar, 7);
    const G = 0.5 * (1 - Math.sqrt(C7 / (C7 + Math.pow(25, 7))));

    const a1p = (1 + G) * c1.a, a2p = (1 + G) * c2.a;
    const C1p = Math.hypot(a1p, c1.b), C2p = Math.hypot(a2p, c2.b);

    const neutral = C1p < NEUTRAL_CHROMA || C2p < NEUTRAL_CHROMA;
    const h1p = C1p < NEUTRAL_CHROMA ? 0 : ((Math.atan2(c1.b, a1p) * DEG) + 360) % 360;
    const h2p = C2p < NEUTRAL_CHROMA ? 0 : ((Math.atan2(c2.b, a2p) * DEG) + 360) % 360;

    const dLp = c2.L - c1.L;
    const dCp = C2p - C1p;

    let dhp: number;
    if (neutral) dhp = 0;
    else if (Math.abs(h2p - h1p) <= 180) dhp = h2p - h1p;
    else if (h2p - h1p > 180) dhp = h2p - h1p - 360;
    else dhp = h2p - h1p + 360;
    const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * RAD);

    const Lbarp = (c1.L + c2.L) / 2;
    const Cbarp = (C1p + C2p) / 2;

    let hbarp: number;
    if (neutral) hbarp = h1p + h2p;
    else if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
    else if (h1p + h2p < 360) hbarp = (h1p + h2p + 360) / 2;
    else hbarp = (h1p + h2p - 360) / 2;

    const T = 1
        - 0.17 * Math.cos((hbarp - 30) * RAD)
        + 0.24 * Math.cos((2 * hbarp) * RAD)
        + 0.32 * Math.cos((3 * hbarp + 6) * RAD)
        - 0.20 * Math.cos((4 * hbarp - 63) * RAD);

    const dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
    const Cbarp7 = Math.pow(Cbarp, 7);
    const RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + Math.pow(25, 7)));
    const RT = -RC * Math.sin(2 * dTheta * RAD);

    const Lm50 = Math.pow(Lbarp - 50, 2);
    const SL = 1 + (0.015 * Lm50) / Math.sqrt(20 + Lm50);
    const SC = 1 + 0.045 * Cbarp;
    const SH = 1 + 0.015 * Cbarp * T;

    const tL = dLp / SL, tC = dCp / SC, tH = dHp / SH;
    return Math.sqrt(tL * tL + tC * tC + tH * tH + RT * tC * tH);
}

/** CIEDE2000 between two `#rrggbb` colours. NaN when either cannot be parsed. */
export function deltaEHex(a: string, b: string): number {
    const la = hexToLab(a), lb = hexToLab(b);
    return la && lb ? deltaE2000(la, lb) : NaN;
}
