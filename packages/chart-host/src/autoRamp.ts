// WHAT "AUTOMATIC" MEANS FOR A COLOUR SCALE, DEFINED ONCE.
//
// Every host offers Colour scale Low / High pickers, and every host says that leaving them blank
// means "automatic". Until this module, nothing defined automatic: the prompt asked each chart for
// `options.colorScaleLow || <your automatic low colour>`, so each generation invented one. The one
// that raised this took `d3.color(palette[0]).brighter(1.4)` - brighter() multiplies RGB, so a green
// accent clipped to a saturated lime - and drew six quantile bins at fill-opacity 0.5 whose
// neighbours sat 1.7 to 2.2 CIEDE2000 apart as painted: a legend promising six classes that the
// marks could not show. The panes, meanwhile, painted #ffffff and #1f6feb in the pickers, which is
// not what any chart drew.
//
// So automatic is now a VALUE, resolved here from the same palette and background the chart
// receives, handed to every chart as options.colorScaleAutoLow / colorScaleAutoHigh, and shown by
// each host's pickers. A chart reads `options.colorScaleLow || options.colorScaleAutoLow`, and the
// same two colours reach the Power BI visual, the Excel add-in and any React host.
//
// THE RULES THE TWO ENDS OBEY, and where each comes from:
//   - The HIGH end is the accent: the report palette's first colour, or, when that colour is too
//     close to the canvas to carry a ramp (a white first colour on a white canvas), the next palette
//     colour that can. In high contrast the host's accent, which is already HC-safe.
//   - The LOW end is a tint of that accent, taken from the canvas towards the accent in CIE Lab,
//     and it must stay CLEARLY distinct from the canvas as drawn. Not a near-white: the prompt's
//     own palette rule dropped that recommendation on 2026-06-14 after a near-white low end
//     vanished into a white canvas, and the cross-filter dim fades marks TOWARDS the canvas, so a
//     low end already near it has nowhere left to fade.
//   - Between them, AUTO_RAMP_CLASSES evenly spaced classes, painted at AUTO_RAMP_DRAWN_OPACITY
//     over the canvas, must each sit at least AUTO_RAMP_MIN_STEP_DELTA_E from their neighbour. When
//     the accent is too light (a gold on white) the high end is walked away from the canvas in
//     lightness until they do.

import { hexToLab, labToHex, deltaE2000, type Lab } from "./deltaE";
import { SAME_SHADE_DELTA_E } from "./colourSpread";

/**
 * Classes the automatic ramp must keep apart. A binned legend rarely carries more than seven, and
 * the chart that raised this drew six; ColorBrewer's sequential schemes stop at nine because past
 * that no ramp of one hue separates its neighbours. A chart drawing fewer classes gets wider steps.
 */
export const AUTO_RAMP_CLASSES = 7;

/**
 * The fill-opacity the guarantee is made at. Dense dot charts paint at 0.5 so overlaps stay
 * readable, and that halves every colour difference against a light canvas; a guarantee made at
 * full opacity would be broken by exactly the charts that need it most. Opaque fills get more.
 */
export const AUTO_RAMP_DRAWN_OPACITY = 0.5;

/**
 * Minimum CIEDE2000 between neighbouring classes as painted: 2.3, the just-noticeable difference
 * usually quoted for colour patches side by side. CIEDE2000 was fitted so that its own threshold
 * sits nearer 1, so this errs towards more separation, which is the safe direction for a legend.
 */
export const AUTO_RAMP_MIN_STEP_DELTA_E = 2.3;

/** The accent when neither the palette nor the theme offers one a ramp can be built on. */
const FALLBACK_ACCENT = "#3182bd";

/** A palette colour closer than this to the canvas cannot be the dark end of a ramp. */
const MIN_ACCENT_VS_CANVAS = 20;

export interface AutoColorScaleInput {
    palette?: string[] | null;
    backgroundColor?: string | null;
    themeBg?: string | null;
    themeFg?: string | null;
    themeAccent?: string | null;
    isHighContrast?: boolean | null;
}

export interface AutoColorScale {
    low: string;
    high: string;
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `#rgb` / `#rrggbb` normalised to `#rrggbb`, or null for anything else (names, rgba, ""). */
function normHex(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const m = HEX.exec(raw.trim());
    if (!m) return null;
    const h = m[1].length === 3 ? m[1].split("").map(c => c + c).join("") : m[1];
    return "#" + h.toLowerCase();
}

function mixLab(a: Lab, b: Lab, t: number): Lab {
    return { L: a.L + (b.L - a.L) * t, a: a.a + (b.a - a.a) * t, b: a.b + (b.b - a.b) * t };
}

/** A colour painted at `alpha` over the canvas, blended in sRGB the way a browser composites. */
function paintedOver(fg: string, canvas: string, alpha: number): Lab {
    const f = [1, 3, 5].map(i => parseInt(fg.slice(i, i + 2), 16));
    const c = [1, 3, 5].map(i => parseInt(canvas.slice(i, i + 2), 16));
    const mixed = f.map((v, i) => Math.round(v * alpha + c[i] * (1 - alpha))).map(v => v.toString(16).padStart(2, "0"));
    return hexToLab("#" + mixed.join(""))!;
}

/** The smallest neighbour-to-neighbour distance of the ramp, as painted. */
export function autoRampMinStep(low: string, high: string, canvas: string,
    classes = AUTO_RAMP_CLASSES, opacity = AUTO_RAMP_DRAWN_OPACITY): number {
    const lo = hexToLab(low), hi = hexToLab(high);
    const bg = normHex(canvas);
    if (!lo || !hi || !bg || classes < 2) return NaN;
    let prev: Lab | null = null, min = Infinity;
    for (let k = 0; k < classes; k++) {
        const painted = paintedOver(labToHex(mixLab(lo, hi, k / (classes - 1))), bg, opacity);
        if (prev) min = Math.min(min, deltaE2000(prev, painted));
        prev = painted;
    }
    return min;
}

/** The canvas the ramp is painted on: the visual's own background, else the theme's, else white. */
export function autoRampCanvas(p: AutoColorScaleInput): string {
    return normHex(p.backgroundColor) ?? normHex(p.themeBg) ?? "#ffffff";
}

let memoKey = "";
let memoValue: AutoColorScale = { low: "", high: "" };

/**
 * The automatic Low and High colours for a continuous colour scale. Deterministic, never throws,
 * and cheap enough to call on every render (the last answer is kept for the same inputs).
 */
export function resolveAutoColorScale(p: AutoColorScaleInput): AutoColorScale {
    const canvas = autoRampCanvas(p);
    const palette = Array.isArray(p.palette) ? p.palette : [];
    const key = [canvas, p.isHighContrast ? 1 : 0, p.themeAccent ?? "", p.themeFg ?? "", palette.join(",")].join("|");
    if (key === memoKey) return memoValue;

    const bg = hexToLab(canvas)!;
    const darkCanvas = bg.L < 50;
    const usable = (hex: string | null): hex is string => {
        const lab = hex ? hexToLab(hex) : null;
        return !!lab && deltaE2000(lab, bg) >= MIN_ACCENT_VS_CANVAS;
    };
    const candidates = p.isHighContrast
        ? [normHex(p.themeAccent), normHex(p.themeFg)]
        : [...palette.map(normHex), normHex(p.themeAccent), normHex(p.themeFg)];
    const accent = candidates.find(usable) ?? FALLBACK_ACCENT;
    const A = hexToLab(accent)!;

    // Low end: the lightest tint of the accent that still reads against the canvas when painted
    // at the drawn opacity.
    let t = 0.1;
    let low = mixLab(bg, A, t);
    while (t < 0.6 && deltaE2000(paintedOver(labToHex(low), canvas, AUTO_RAMP_DRAWN_OPACITY), bg) < SAME_SHADE_DELTA_E) {
        t += 0.02;
        low = mixLab(bg, A, t);
    }
    const lowHex = labToHex(low);

    // High end: the accent, walked away from the canvas in lightness until every step clears.
    let high: Lab = { ...A };
    let highHex = labToHex(high);
    for (let step = 0; step < 80 && autoRampMinStep(lowHex, highHex, canvas) < AUTO_RAMP_MIN_STEP_DELTA_E; step++) {
        const L = Math.max(4, Math.min(98, high.L + (darkCanvas ? 1 : -1)));
        if (L === high.L) break;
        high = { ...high, L };
        highHex = labToHex(high);
    }

    memoKey = key;
    memoValue = { low: lowHex, high: highHex };
    return memoValue;
}
