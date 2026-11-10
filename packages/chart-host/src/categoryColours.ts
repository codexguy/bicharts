// CAN THE READER TELL THE CATEGORIES APART, IN THE COLOURS ACTUALLY PAINTED?
//
// A categorical palette is checked where it is chosen, but generated code may build its own scale, a mark may be drawn
// at partial opacity, and a selection dims every other category to a fraction of its colour. Each of those moves the
// colours a reader compares away from the palette that was checked. This reads the colours really painted, one per
// category, and reports how close the closest two are: at full strength, as painted over the page (the element's own
// opacity), and at the dim level a selection applies.
//
// A REPORT, NEVER A REPAINT. The floor (CATEGORY_DELTA_E_FLOOR, set by eye) is applied to the colours as painted, and the
// pairs under it are reported as a finding a host can log; marks a selection dims are measured but exempt. Nothing is
// recoloured: where a chart places its categories on a palette is fixed where the chart is written, and a palette the
// host sends is the author's. The distances under simulated red-green colour vision are reported alongside, for the
// record only: almost no palette keeps three or more categories apart for those readers, so they carry no verdict.

import { LEGEND_MARK_CLASS, MARK_CLASS, ROW_IDX_ATTR, DIM_OPACITY_DEFAULT, CATEGORY_DELTA_E_FLOOR } from "./contract";
import { hexToLab, rgbToLab, deltaE2000, type Lab } from "./deltaE";
import { MIN_RAMP_FILLS, RAMP_SLACK_MAX } from "./colourSpread";

/** More distinct colours than this is a continuous colour channel, not categories: the census declines. */
export const MAX_CATEGORY_SLOTS = 24;

/**
 * From this many colours a set lying on one path, its lightness rising or falling along it (turning at most once, as
 * a diverging ramp's does at its centre), is declined as a ramp. Below it the shape is reported
 * (`rampLike`) but not declined: four or five categorical colours can sit on one path by chance, and a set of
 * categories that does is exactly the too-close case this census exists to see (two greens and two blue-greys read
 * as a ramp, yet were drawn as four categories).
 */
export const RAMP_DECLINE_MIN_SLOTS = 6;

/** Beyond this many tagged elements the census is skipped, as the other censuses do. */
const ELEMENT_CAP = 5000;

/** At most this many pairs under the floor are listed (the closest first); `pairsBelowFloorCount` counts them all. */
export const MAX_LISTED_PAIRS = 10;

export interface CategoryColourCensusOptions {
    /** The page background the chart is painted on; white when absent or unreadable. */
    pageBg?: string;
    /** The opacity a selection leaves on the other categories (0..1); chart-host's default when absent. */
    dimOpacity?: number;
}

export interface CategoryColourCensus {
    /** Where the colours came from: "legend" (one per swatch), "marks" (the distinct mark colours), or "" for none. */
    source: string;
    /** Why nothing is reported: "" when reported, else "none" (fewer than two colours), "ramp" or "too-many". */
    declined: string;
    /** Distinct category colours found (0 when declined for having none). */
    slots: number;
    /** The closest two colours, as painted hex at full strength; empty when not reported. */
    closestPair: string[];
    /** CIEDE2000 of the closest pair at full strength (one decimal); null when not reported. */
    closestDeltaE: number | null;
    /** The same, after each colour is blended at its element's own opacity over the page; null when not reported. */
    closestDeltaEPainted: number | null;
    /** The same at the dim level (own opacity times the dim level, over the page); null when not reported. */
    closestDeltaEDimmed: number | null;
    /** The dim level used. */
    dimOpacity: number;
    /** True when the colours lie on one path, as a sequential ramp's do (reported below RAMP_DECLINE_MIN_SLOTS). */
    rampLike: boolean;
    /** With a legend: true when every legend colour is painted on some mark; null without a legend or marks. */
    legendMatchesMarks: boolean | null;
    /** The floor the painted colours are held to (CATEGORY_DELTA_E_FLOOR). */
    floor: number;
    /** True when the closest pair AS PAINTED is under the floor; false when it clears it; null when not reported. */
    belowFloor: boolean | null;
    /** How many pairs, as painted, are under the floor (0 when not reported). */
    pairsBelowFloorCount: number;
    /** Those pairs, closest first (at most MAX_LISTED_PAIRS): each colour at full strength and the painted distance. */
    pairsBelowFloor: CategoryColourPair[];
    /** The closest pair as painted (the colours at full strength); empty when not reported. */
    closestPairPainted: string[];
    /** The closest painted distance under simulated deuteranopia (Machado 2009, severity 1); null when not reported. */
    closestDeltaEDeutan: number | null;
    /** The same under simulated protanopia; null when not reported. */
    closestDeltaEProtan: number | null;
}

/** Two category colours (at full strength) and their CIEDE2000 distance as painted. */
export interface CategoryColourPair {
    colours: [string, string];
    deltaE: number;
}

type RGB = [number, number, number];

interface Paint {
    rgb: RGB;
    alpha: number;
}

function emptyCensus(declined: string, dimOpacity: number, slots = 0, source = ""): CategoryColourCensus {
    return {
        source, declined, slots, closestPair: [], closestDeltaE: null, closestDeltaEPainted: null,
        closestDeltaEDimmed: null, dimOpacity, rampLike: false, legendMatchesMarks: null,
        floor: CATEGORY_DELTA_E_FLOOR, belowFloor: null, pairsBelowFloorCount: 0, pairsBelowFloor: [], closestPairPainted: [],
        closestDeltaEDeutan: null, closestDeltaEProtan: null,
    };
}

function styleOf(el: any, doc: any): any {
    try {
        const view = doc?.defaultView;
        return view?.getComputedStyle ? view.getComputedStyle(el) : null;
    } catch {
        return null;
    }
}

/** `#rgb`, `#rrggbb`, `rgb()` and `rgba()` to a colour and its alpha; null for none, transparent or unreadable. */
function parsePaint(raw: unknown): Paint | null {
    if (raw === null || raw === undefined) return null;
    const s = String(raw).trim().toLowerCase();
    if (!s || s === "none" || s === "transparent" || s.startsWith("url(")) return null;
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
    if (hex) {
        const h = hex[1].length === 3 ? hex[1].replace(/./g, c => c + c) : hex[1];
        return { rgb: [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)], alpha: 1 };
    }
    const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(s);
    if (!m) return null;
    let alpha = 1;
    if (m[4] !== undefined) alpha = m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    if (!(alpha > 0)) return null;
    return { rgb: [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])], alpha: Math.min(1, alpha) };
}

function numberOr1(v: unknown): number {
    if (v === null || v === undefined || String(v).trim() === "") return 1;
    const n = parseFloat(String(v));
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
}

/** An element's own opacity written on it or on its ancestors up to the container (attribute or inline style). */
function ownOpacity(el: any, container: any): number {
    let a = 1;
    for (let n = el; n && n !== container; n = n.parentNode) {
        if (typeof n.getAttribute !== "function") break;
        a *= numberOr1(n.getAttribute("opacity"));
        a *= numberOr1(n.style?.opacity);
    }
    return a;
}

/**
 * The colour an element paints: its fill, or its stroke when it has no fill (a line). The attribute is read first,
 * since generated code writes presentation attributes and jsdom's CSS engine does not map them.
 */
function paintOf(el: any, doc: any): Paint | null {
    const cs = styleOf(el, doc);
    const fill = parsePaint(firstSet(el.getAttribute?.("fill"), el.style?.fill, cs?.fill));
    if (fill) return { rgb: fill.rgb, alpha: fill.alpha * numberOr1(firstSet(el.getAttribute?.("fill-opacity"), el.style?.fillOpacity)) };
    const stroke = parsePaint(firstSet(el.getAttribute?.("stroke"), el.style?.stroke, cs?.stroke));
    if (stroke) return { rgb: stroke.rgb, alpha: stroke.alpha * numberOr1(firstSet(el.getAttribute?.("stroke-opacity"), el.style?.strokeOpacity)) };
    return null;
}

/** The first value actually written: a browser reports an unset style property as "", not null. */
function firstSet(...vals: unknown[]): string | null {
    for (const v of vals) if (v !== null && v !== undefined && String(v).trim() !== "") return String(v);
    return null;
}

/** An element's paint, or its first painted descendant's (a swatch or a mark drawn as a group). */
function paintWithin(el: any, doc: any, container: any): Paint | null {
    let p = paintOf(el, doc);
    let at = el;
    if (!p && typeof el.querySelectorAll === "function") {
        for (const child of Array.from(el.querySelectorAll("*")) as any[]) {
            p = paintOf(child, doc);
            if (p) { at = child; break; }
        }
    }
    return p ? { rgb: p.rgb, alpha: p.alpha * ownOpacity(at, container) } : null;
}

const hexOf = (rgb: RGB) => "#" + rgb.map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");

function blend(rgb: RGB, alpha: number, bg: RGB): RGB {
    const a = Math.max(0, Math.min(1, alpha));
    return [rgb[0] * a + bg[0] * (1 - a), rgb[1] * a + bg[1] * (1 - a), rgb[2] * a + bg[2] * (1 - a)]
        .map(Math.round) as RGB;
}

/** One colour per category: the distinct colours, each with the opacity most of its elements are painted at. */
function slotsOf(paints: Paint[]): { rgb: RGB; alpha: number }[] {
    const byColour = new Map<string, { rgb: RGB; alphas: Map<number, number> }>();
    for (const p of paints) {
        const k = p.rgb.join(",");
        const slot = byColour.get(k) ?? { rgb: p.rgb, alphas: new Map<number, number>() };
        const a = Math.round(p.alpha * 100) / 100;
        slot.alphas.set(a, (slot.alphas.get(a) ?? 0) + 1);
        byColour.set(k, slot);
    }
    return [...byColour.values()].map(s => ({
        rgb: s.rgb,
        alpha: [...s.alphas].sort((x, y) => y[1] - x[1] || y[0] - x[0])[0][0],
    }));
}

// Machado, Oliveira and Fernandes (2009), severity 1.0, applied in linear sRGB: what a reader with no working M (deutan)
// or L (protan) cones sees. The same matrices the offline painted-colour table uses, so the two agree.
const MACHADO_DEUTAN = [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]];
const MACHADO_PROTAN = [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]];

const toLinear = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const toSrgb = (v: number) => { const x = Math.max(0, Math.min(1, v)); return 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055); };

function simulatedLab(rgb: RGB, m: number[][]): Lab {
    const lin = rgb.map(toLinear);
    const out = m.map(row => toSrgb(row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]));
    return rgbToLab(out[0], out[1], out[2]);
}

/** Every pair whose distance is under `floor`, closest first. */
function pairsUnder(labs: Lab[], floor: number): { i: number; j: number; d: number }[] {
    const out: { i: number; j: number; d: number }[] = [];
    for (let i = 0; i < labs.length; i++) {
        for (let j = i + 1; j < labs.length; j++) {
            const d = deltaE2000(labs[i], labs[j]);
            if (d < floor) out.push({ i, j, d });
        }
    }
    return out.sort((x, y) => x.d - y.d);
}

function closest(labs: Lab[]): { i: number; j: number; d: number } {
    let best = { i: 0, j: 1, d: Infinity };
    for (let i = 0; i < labs.length; i++) {
        for (let j = i + 1; j < labs.length; j++) {
            const d = deltaE2000(labs[i], labs[j]);
            if (d < best.d) best = { i, j, d };
        }
    }
    return best;
}

/** Colourspread's ramp test: every colour lies near the path joining the two farthest apart. */
function isRampShaped(labs: Lab[]): boolean {
    if (labs.length < MIN_RAMP_FILLS) return false;
    let span = 0, lo = 0, hi = 1;
    for (let i = 0; i < labs.length; i++) {
        for (let j = i + 1; j < labs.length; j++) {
            const v = deltaE2000(labs[i], labs[j]);
            if (v > span) { span = v; lo = i; hi = j; }
        }
    }
    if (span <= 0) return false;
    let slack = 0, interior = 0;
    for (let i = 0; i < labs.length; i++) {
        if (i === lo || i === hi) continue;
        slack += (deltaE2000(labs[lo], labs[i]) + deltaE2000(labs[i], labs[hi])) / span - 1;
        interior++;
    }
    return interior >= 2 && slack / interior <= RAMP_SLACK_MAX;
}

/** A lightness step smaller than this along the path is flat, not a turn. */
const LIGHTNESS_STEP_MIN = 1.5;

/**
 * A ramp's lightness follows its path: walked from one end, it rises or falls throughout (sequential) or turns once at the
 * centre (diverging). A categorical palette's lightness zigzags, even when the slack test above calls the set path-like:
 * ten Tableau colours measure a mean slack under RAMP_SLACK_MAX, because CIEDE2000 compresses large distances.
 */
function lightnessFollowsPath(labs: Lab[]): boolean {
    let span = -1, lo = 0;
    for (let i = 0; i < labs.length; i++) {
        for (let j = i + 1; j < labs.length; j++) {
            const v = deltaE2000(labs[i], labs[j]);
            if (v > span) { span = v; lo = i; }
        }
    }
    const order = labs.map(l => ({ L: l.L, d: deltaE2000(labs[lo], l) })).sort((a, b) => a.d - b.d);
    let turns = 0, dir = 0;
    for (let k = 1; k < order.length; k++) {
        const step = order[k].L - order[k - 1].L;
        if (Math.abs(step) < LIGHTNESS_STEP_MIN) continue;
        const sign = Math.sign(step);
        if (dir !== 0 && sign !== dir) turns++;
        dir = sign;
    }
    return turns <= 1;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * How close are the two closest category colours, as painted? Prefers the legend (one colour per swatch) and falls
 * back to the distinct colours of the marks. Never throws and never changes the chart: an environment that cannot
 * report a colour reports nothing.
 *
 * KNOWN LIMITS, stated rather than hidden: a selection's dimming is applied by a stylesheet rule, so "painted" is the
 * resting chart and the dimmed figure is computed from the dim level; colours set only by a stylesheet class are
 * read through computed style, which a headless DOM without layout may not resolve; six or more categorical colours
 * on one path (shades of one hue) are declined as a ramp; a binned diverging ramp, whose two arms do not lie on one
 * path, is measured as categories, so its neighbouring bins are reported under the floor.
 */
export function censusCategoryColours(container: any, doc?: any, options: CategoryColourCensusOptions = {}): CategoryColourCensus {
    const dimOpacity = typeof options.dimOpacity === "number" && options.dimOpacity >= 0 && options.dimOpacity <= 1
        ? options.dimOpacity : DIM_OPACITY_DEFAULT;
    if (!container || typeof container.querySelectorAll !== "function") return emptyCensus("none", dimOpacity);
    try {
        const ownerDoc = doc ?? container.ownerDocument;
        const legendEls = Array.from(container.querySelectorAll(`.${LEGEND_MARK_CLASS}`)) as any[];
        const markEls = (Array.from(container.querySelectorAll(`.${MARK_CLASS}, [${ROW_IDX_ATTR}]`)) as any[])
            .filter(el => !el.classList?.contains(LEGEND_MARK_CLASS));
        if (legendEls.length + markEls.length > ELEMENT_CAP) return emptyCensus("too-many", dimOpacity);

        const paintsOf = (els: any[]) => els.map(el => paintWithin(el, ownerDoc, container)).filter((p): p is Paint => p !== null);
        const legendSlots = slotsOf(paintsOf(legendEls));
        const markSlots = slotsOf(paintsOf(markEls));
        const useLegend = legendSlots.length >= 2;
        const slots = useLegend ? legendSlots : markSlots;
        const source = useLegend ? "legend" : markSlots.length ? "marks" : "";

        if (slots.length < 2) return emptyCensus("none", dimOpacity, slots.length, source);
        if (slots.length > MAX_CATEGORY_SLOTS) return emptyCensus("too-many", dimOpacity, slots.length, source);

        const labs = slots.map(s => hexToLab(hexOf(s.rgb))).filter((l): l is Lab => l !== null);
        if (labs.length !== slots.length) return emptyCensus("none", dimOpacity, slots.length, source);
        const rampLike = isRampShaped(labs);
        if (rampLike && slots.length >= RAMP_DECLINE_MIN_SLOTS && lightnessFollowsPath(labs)) return { ...emptyCensus("ramp", dimOpacity, slots.length, source), rampLike };

        const bgPaint = parsePaint(options.pageBg);
        const bg: RGB = bgPaint ? blend(bgPaint.rgb, bgPaint.alpha, [255, 255, 255]) : [255, 255, 255];
        const labsAt = (alphaOf: (s: { alpha: number }) => number) =>
            slots.map(s => hexToLab(hexOf(blend(s.rgb, alphaOf(s), bg)))!);

        const full = closest(labs);
        const paintedLabs = labsAt(s => s.alpha);
        const painted = closest(paintedLabs);
        const dimmed = closest(labsAt(s => s.alpha * dimOpacity));
        const under = pairsUnder(paintedLabs, CATEGORY_DELTA_E_FLOOR);
        const paintedRgb = slots.map(s => blend(s.rgb, s.alpha, bg));
        const deutan = closest(paintedRgb.map(c => simulatedLab(c, MACHADO_DEUTAN)));
        const protan = closest(paintedRgb.map(c => simulatedLab(c, MACHADO_PROTAN)));

        let legendMatchesMarks: boolean | null = null;
        if (useLegend && markSlots.length > 0) {
            const markColours = new Set(markSlots.map(s => s.rgb.join(",")));
            legendMatchesMarks = legendSlots.every(s => markColours.has(s.rgb.join(",")));
        }

        return {
            source,
            declined: "",
            slots: slots.length,
            closestPair: [hexOf(slots[full.i].rgb), hexOf(slots[full.j].rgb)],
            closestDeltaE: round1(full.d),
            closestDeltaEPainted: round1(painted.d),
            closestDeltaEDimmed: round1(dimmed.d),
            dimOpacity,
            rampLike,
            legendMatchesMarks,
            floor: CATEGORY_DELTA_E_FLOOR,
            belowFloor: painted.d < CATEGORY_DELTA_E_FLOOR,
            pairsBelowFloorCount: under.length,
            pairsBelowFloor: under.slice(0, MAX_LISTED_PAIRS).map(p => ({
                colours: [hexOf(slots[p.i].rgb), hexOf(slots[p.j].rgb)] as [string, string], deltaE: round1(p.d),
            })),
            closestPairPainted: [hexOf(slots[painted.i].rgb), hexOf(slots[painted.j].rgb)],
            closestDeltaEDeutan: round1(deutan.d),
            closestDeltaEProtan: round1(protan.d),
        };
    } catch {
        return emptyCensus("none", dimOpacity);
    }
}
