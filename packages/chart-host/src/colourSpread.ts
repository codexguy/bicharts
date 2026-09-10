// TWO-THIRDS OF THE MAP IS ONE SHADE, AND THE ARITHMETIC IS PERFECT.
//
// A right-skewed measure on a linear colour ramp is the failure that survives every check we
// have, because nothing about it is wrong. The geography joins, the aggregate is correct, the
// scale's domain is the true min and max — and the handful of outliers at the top eat the whole
// ramp, so the dense bulk of the data lands in one indistinguishable tint. The chart is accurate
// and unreadable, which is far harder to notice than a chart that is simply wrong.
//
// WHAT THIS MEASURES, AND WHY IT IS NOT "IS THE SCALE LINEAR".
// It never looks at the scale. It reads the colours actually painted on the marks and asks the
// only question a reader asks: HOW MUCH OF THIS CHART IS ONE COLOUR? That framing is worth more
// than it looks:
//   - it is blind to how the ramp was built, so `interpolateBlues`, `scaleSequential`, a hand
//     rolled `interpolateRgb`, a viridis curve and a quantile scale are all measured the same way;
//   - it needs no model of the ramp's shape, so a curved multi-hue ramp is not a special case;
//   - a well-spread scale of ANY kind reports well, which is what makes this an audit of the
//     OUTCOME rather than a style opinion about the mechanism. A quantile scale spreads its marks
//     across its bins by construction and reports a low crowd share; that is the point.
//
// AND THE HALF THE SERVER STRUCTURALLY CANNOT SEE. A code-QC rule reads literals. It can see
// `scaleLinear()` and it can see a domain built from `d3.max`, but whether THAT produces a washed
// out picture depends on the data, which is not in the source. Worse, the shape's own `Skewness`
// is measured on the RAW column while the ramp encodes an AGGREGATE, and aggregating by a
// high-cardinality key amplifies skew — 2.04 raw against 5.00 rendered on the chart that raised
// this. Only the browser knows what was painted.
//
// NO VERDICT, DELIBERATELY. This reports the crowd share in twenty-point buckets and stops there.
// A threshold needs a noise floor and the floor does not exist yet: nobody has measured what a
// healthy chart's crowd share looks like across the corpus, so any cut chosen today would be a
// guess wearing a number. These buckets ARE the instrument that produces the floor; a cut can be
// argued once the distribution is on the table, and until then the audit says what it saw.

import { MARK_CLASS, ROW_IDX_ATTR } from "./contract";
import colorsea from "colorsea";

/**
 * CIE2000 distance at which two fills stop being separable at a glance, side by side on a chart.
 *
 * Not a tuned parameter — a perceptual constant. 1.0 is the textbook just-noticeable difference
 * under laboratory conditions with the two patches touching; 5 is the conventional "clearly
 * different to an ordinary observer in ordinary conditions", which is what a reader scanning a
 * choropleth is. Erring high is the safe direction: it makes the census UNDERstate crowding.
 */
export const SAME_SHADE_DELTA_E = 5;

/**
 * Fewer distinct fills than this and there is nothing to characterise.
 *
 * Four is the floor for the collinearity test below, not a judgement: the two extremes anchor the
 * line, so a fourth fill is the second interior point and the first one that can disagree.
 */
export const MIN_RAMP_FILLS = 4;

/**
 * How far off a straight line a set of fills may sit and still be a RAMP.
 *
 * THIS IS WHAT SEPARATES A VALUE-ENCODED COLOUR CHANNEL FROM A CATEGORICAL ONE, and counting
 * fills cannot do it. The obvious "at least six distinct colours" rule fails at exactly the
 * wrong moment: a five-bin quantile scale — the recommended REMEDY for the washout this census
 * exists to find — has five fills, so a count floor would have excluded the charts that did the
 * right thing and biased the prevalence it was built to measure.
 *
 * A sequential ramp is, by construction, a path between two colours: every fill lies close to the
 * segment joining its extremes, so `d(lo,x) + d(x,hi)` barely exceeds `d(lo,hi)`. A categorical
 * scheme is chosen for mutual separation and its members sit well off that line. Measured in
 * CIE2000 over the standard schemes, the two populations do not overlap:
 *
 * ```text
 *   interpolateBlues (5, 8 and 40 stops)  mean slack  -0.05        SEQUENTIAL
 *   interpolateReds (8)                   mean slack  +0.06        SEQUENTIAL
 *   viridis (8)                           mean slack  +0.02        SEQUENTIAL
 *   schemeTableau10 (5 and 8)             mean slack  +0.24        categorical
 *   RdBu diverging (7)                    mean slack  +0.35        two arms, not one line
 * ```
 *
 * 0.15 sits in the four-fold gap. A DIVERGING ramp landing outside is correct rather than a miss:
 * it is genuinely two paths from a neutral middle, and measuring it as one would report the arm
 * that happened to be longer. It is excluded and said so, not mismeasured.
 */
export const RAMP_SLACK_MAX = 0.15;

/** Below this many marks the share is too coarse to mean anything (one mark = 10% at n=10). */
const MIN_MARKS = 24;

/** Beyond this many tagged elements the census is skipped, as the other censuses do. */
const ELEMENT_CAP = 5000;

/**
 * Distinct fills compared pairwise. CIE2000 is not cheap and a continuous ramp can produce one
 * fill per mark, so the fills are quantised into a coarse cube first and only the most populous
 * cells are compared. 48 cells is far more than any ramp needs to be characterised and bounds the
 * work at ~2.3k distance calls, which is noise beside a render.
 */
const MAX_CELLS = 48;

/** Quantisation step per channel when bucketing fills. 8 levels is well under a JND at 8-bit. */
const CELL_STEP = 32;

export interface ColourSpreadCensus {
    /** Marks carrying a resolvable, non-transparent fill. */
    marks: number;
    /** Distinct fills among them, before quantisation. */
    distinctFills: number;
    /** Share (0-100) of marks whose fill is within SAME_SHADE_DELTA_E of the most crowded fill. */
    crowdShare: number;
    /** Largest CIE2000 distance between any two sampled fills — the ramp's perceptual reach. */
    spanDeltaE: number;
}

const EMPTY: ColourSpreadCensus = { marks: 0, distinctFills: 0, crowdShare: 0, spanDeltaE: 0 };

function styleOf(el: any, doc: any): any {
    try {
        const view = doc?.defaultView;
        return view?.getComputedStyle ? view.getComputedStyle(el) : null;
    } catch {
        return null;
    }
}

/**
 * `fill` is an SVG presentation ATTRIBUTE as well as a CSS property and generated code writes
 * the attribute far more often, so read the attribute first — and so there IS an answer under
 * jsdom, whose CSS engine does not map SVG presentation attributes.
 */
function fillOf(el: any, cs: any): string {
    const a = el.getAttribute?.("fill");
    if (a !== null && a !== undefined && String(a).trim() !== "") return String(a).trim();
    const c = cs?.fill;
    return c === null || c === undefined ? "" : String(c).trim();
}

/** `#rgb`, `#rrggbb`, `rgb()` and `rgba()` — everything a browser or jsdom hands back. */
function toRgb(raw: string): [number, number, number] | null {
    const s = raw.trim().toLowerCase();
    if (!s || s === "none" || s === "transparent") return null;
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
    if (hex) {
        const h = hex[1];
        const full = h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h;
        return [parseInt(full.slice(0, 2), 16),
                parseInt(full.slice(2, 4), 16),
                parseInt(full.slice(4, 6), 16)];
    }
    const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+)\s*)?\)$/.exec(s);
    if (!m) return null;
    // A fully transparent mark paints nothing and must not join the census; a partly transparent
    // one still shows its hue, and its blend with the background is not knowable from here.
    if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
    return [Math.round(parseFloat(m[1])), Math.round(parseFloat(m[2])), Math.round(parseFloat(m[3]))];
}

function cellKey(rgb: [number, number, number]): string {
    return [Math.round(rgb[0] / CELL_STEP), Math.round(rgb[1] / CELL_STEP),
            Math.round(rgb[2] / CELL_STEP)].join(",");
}

function hex(rgb: [number, number, number]): string {
    return "#" + rgb.map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");
}

/**
 * How much of this chart is one shade?
 *
 * Never throws. Telemetry must not be the reason a delivered render fails, and an environment
 * that cannot report a fill reports nothing rather than a number that describes the environment.
 *
 * KNOWN LIMIT, stated rather than hidden: a DIVERGING ramp is measured the same way as any
 * other, so a chart whose two arms are each well spread but which crowds around its neutral
 * midpoint reports honestly, while one that crowds at BOTH ends reports the larger arm only. That
 * understates rather than overstates, which is the direction an audit should err.
 */
export function censusColourSpread(container: any, doc?: any): ColourSpreadCensus {
    if (!container || typeof container.querySelectorAll !== "function") return EMPTY;
    try {
        const els = Array.from(
            container.querySelectorAll(`.${MARK_CLASS}, [${ROW_IDX_ATTR}]`)) as any[];
        if (els.length === 0 || els.length > ELEMENT_CAP) return EMPTY;
        const ownerDoc = doc ?? container.ownerDocument;

        const distinct = new Set<string>();
        const cells = new Map<string, { rgb: [number, number, number]; n: number }>();
        let marks = 0;

        for (const el of els) {
            const rgb = toRgb(fillOf(el, styleOf(el, ownerDoc)));
            if (!rgb) continue;
            marks++;
            distinct.add(rgb.join(","));
            const k = cellKey(rgb);
            const cur = cells.get(k);
            if (cur) cur.n++;
            else cells.set(k, { rgb, n: 1 });
        }

        if (marks < MIN_MARKS || distinct.size < MIN_RAMP_FILLS) return EMPTY;

        // Most populous cells first: a ramp's crowd is by definition among them, and the tail is
        // what the cap drops. Counts from dropped cells stay in `marks`, so a mark the census
        // could not place still counts against the share rather than quietly leaving the
        // denominator - the share can only come out lower for having capped.
        const top = [...cells.values()].sort((a, b) => b.n - a.n).slice(0, MAX_CELLS);
        const cs = top.map(c => colorsea(hex(c.rgb)));
        if (cs.length < MIN_RAMP_FILLS) return EMPTY;

        // Every pairwise distance once - the span, the ramp test and the crowd all read it.
        const d: number[][] = cs.map(() => new Array(cs.length).fill(0));
        let span = 0, lo = 0, hi = 1;
        for (let i = 0; i < cs.length; i++) {
            for (let j = i + 1; j < cs.length; j++) {
                const v = cs[i].deltaE(cs[j], "CIE2000");
                d[i][j] = v;
                d[j][i] = v;
                if (v > span) { span = v; lo = i; hi = j; }
            }
        }

        // IS THIS A RAMP AT ALL? Everything between the two extremes must lie near the line
        // joining them. A categorical scheme is chosen for mutual separation and fails; so does
        // a diverging ramp, which is two paths rather than one. Both are declined rather than
        // reported, because on either the sentence "most marks are one shade" means something
        // different from what this census is for.
        if (span <= 0) return EMPTY;
        let slack = 0, interior = 0;
        for (let i = 0; i < cs.length; i++) {
            if (i === lo || i === hi) continue;
            slack += (d[lo][i] + d[i][hi]) / span - 1;
            interior++;
        }
        if (interior < 2 || slack / interior > RAMP_SLACK_MAX) return EMPTY;

        // The crowd is measured around EVERY candidate centre, not just the most populous cell:
        // a ramp's dense end is usually spread over several neighbouring cells, and anchoring on
        // one of them would report a fraction of the shade a reader actually sees as uniform.
        let crowd = 0;
        for (let i = 0; i < cs.length; i++) {
            let n = 0;
            for (let j = 0; j < cs.length; j++) {
                if (i === j || d[i][j] <= SAME_SHADE_DELTA_E) n += top[j].n;
            }
            if (n > crowd) crowd = n;
        }

        return {
            marks,
            distinctFills: distinct.size,
            crowdShare: Math.round((crowd / marks) * 100),
            spanDeltaE: Math.round(span),
        };
    } catch {
        return EMPTY;
    }
}

/**
 * The always-on behaviour tag, or "" when the census had nothing to say.
 *
 * A BUCKETED MEASUREMENT, NOT A VERDICT. `ramp:d3:crowd60` says three in five marks are one
 * shade; it does not say that is wrong. Twenty-point buckets are coarse enough to read as a
 * distribution off a few hundred renders and fine enough to separate "a bit clustered" from the
 * failure this exists for, and the whole family is one `LIKE 'ramp:d3:crowd%'` away — which is
 * the denominator any rate needs. When the distribution is in, a cut can be argued from it.
 */
export function colourSpreadFlag(c: ColourSpreadCensus): string {
    if (c.marks === 0) return "";
    return "ramp:d3:crowd" + Math.min(80, Math.floor(c.crowdShare / 20) * 20);
}
