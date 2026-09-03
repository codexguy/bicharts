// A HAIRLINE IS A MARK YOU CANNOT HIT.
//
// An SVG path with `fill:none` receives pointer events ONLY on its painted stroke. So a data
// mark drawn as a 1-3px line — an ECDF step, a slope segment, a parallel-coordinates polyline,
// a radar outline — is a hairline click target: a click a few pixels off it, or anywhere in the
// space between lines, reaches the bare `<svg>`, `closest('.d3-mark')` returns null, and the
// chart cross-filters nothing even though the path correctly carries the class and the row
// index. Tagging the visible line is necessary and NOT sufficient. The remedy generated code is
// asked for is a wide transparent companion sharing the same `d`.
//
// THIS MODULE ONLY COUNTS. It reads the rendered DOM and reports; it never mutates. That is
// deliberate: injecting a hit band is a change with a real failure mode — a band that is too
// generous steals clicks from the marks underneath, which is a worse outcome than the dead click
// it fixes — so the measurement ships first and on its own.
//
// WHY IT LIVES HERE, beside `ensureCrossfilterHitTargets`. It is the same question that pass
// asks ("can this declared mark receive a click?"), one step further out: that pass heals marks
// that cannot receive a click AT ALL, this one measures marks that can only receive a click if
// you aim perfectly. Every host renders the same generated code against the same contract, so a
// copy per host is one more chance to disagree about what "hittable" means.
//
// AND THE HALF A SERVER-SIDE CHECK STRUCTURALLY CANNOT DO. A code-QC regex reads LITERALS: it
// can see `.attr('stroke-width', 2)` and nothing else. `.attr('stroke-width', d => scale(d.v))`
// is a number only the browser knows. This reads the COMPUTED width off the rendered element,
// which is the actual hit band in pixels, so the two measurements answer different questions and
// neither can be inferred from the other.

import { MARK_CLASS, ROW_IDX_ATTR } from "./contract";

/**
 * Narrowest stroke, in CSS pixels, that counts as a real click target.
 *
 * The generated-code recipe asks for 10-14px. Eight is the floor rather than the target: it is
 * generous enough that a chart which made a deliberate effort is not counted as a defect, and it
 * is the same number the server-side rule uses, so the two halves cannot drift into disagreeing
 * about which strokes are thin.
 */
export const MIN_HIT_BAND_PX = 8;

/** Beyond this many tagged elements the census is skipped — see `censusHitBands`. */
const ELEMENT_CAP = 5000;

export interface HitBandCensus {
    /** Tagged marks that are OPEN strokes (`fill` none/transparent with a painted stroke). */
    openStrokes: number;
    /** Of those, the ones the chart has not opted out of with `pointer-events:none`. */
    interactive: number;
    /** Of the interactive ones, those whose own band is under `MIN_HIT_BAND_PX`. */
    hairline: number;
    /** Of the hairlines, those with no wider companion sharing their geometry. THE DEFECT. */
    uncovered: number;
    /** Widest band, rounded, seen on any interactive open stroke — for tuning the floor. */
    widestPx: number;
}

const EMPTY: HitBandCensus = {
    openStrokes: 0, interactive: 0, hairline: 0, uncovered: 0, widestPx: 0,
};

/** SVG geometry that can be painted as an open stroke. A `<rect>` or `<circle>` is a shape. */
const OPEN_TAGS = new Set(["path", "line", "polyline"]);

function styleOf(el: any, doc: any): any {
    try {
        const view = doc?.defaultView;
        return view?.getComputedStyle ? view.getComputedStyle(el) : null;
    } catch {
        return null;
    }
}

/**
 * `fill` and `stroke-width` are SVG PRESENTATION ATTRIBUTES as well as CSS properties, and the
 * attribute is what generated code almost always writes. Read the attribute first and fall back
 * to the computed value — so the answer is the same whether the chart wrote `fill="none"` or
 * styled it, and so there IS an answer in an environment whose CSS engine does not map SVG
 * presentation attributes (jsdom, and any headless gate).
 */
function attrOrComputed(el: any, name: string, cs: any): string {
    const a = el.getAttribute?.(name);
    if (a !== null && a !== undefined && String(a).trim() !== "") return String(a).trim();
    const c = cs?.[name === "stroke-width" ? "strokeWidth" : name];
    return c === null || c === undefined ? "" : String(c).trim();
}

function isUnfilled(fill: string): boolean {
    const f = fill.toLowerCase();
    return f === "none" || f === "transparent" || f === "rgba(0, 0, 0, 0)" || f === "rgba(0,0,0,0)";
}

/** Parse a CSS length to px. Unitless and `px` only — a stroke in `em` is vanishingly rare. */
function widthPx(raw: string): number {
    const m = /^(-?\d+(?:\.\d+)?)\s*(px)?$/i.exec(raw);
    if (!m) return NaN;
    const n = parseFloat(m[1]);
    return isFinite(n) ? n : NaN;
}

/**
 * Count the declared marks that are open strokes, and how many of them are too thin to hit.
 *
 * A companion is any OTHER tagged element sharing this one's geometry (the same `d`, or the same
 * row index when there is no `d`) whose band clears the floor. That is exactly the recipe's
 * shape, and it means a chart which drew its hit band correctly reports `uncovered: 0` however it
 * spelled the transparency — the width is what makes a band a band.
 *
 * A mark whose own visible stroke is already wide is its OWN hit band and is never counted as a
 * hairline. A Sankey link is the case that matters: its thickness is its value, routinely 10-40px,
 * and asking it for a companion would be asking for a second hit area on top of a good one.
 *
 * Never throws — telemetry must not be the reason a delivered render fails. An unreadable width
 * counts as WIDE (`NaN` fails the `< MIN_HIT_BAND_PX` test), because a census that guesses
 * "defect" when it cannot measure would report the environment rather than the chart.
 */
export function censusHitBands(container: any, doc?: any): HitBandCensus {
    if (!container || typeof container.querySelectorAll !== "function") return EMPTY;
    try {
        const els = Array.from(
            container.querySelectorAll(`.${MARK_CLASS}, [${ROW_IDX_ATTR}]`)) as any[];
        if (els.length === 0 || els.length > ELEMENT_CAP) return EMPTY;
        const ownerDoc = doc ?? container.ownerDocument;

        // Widest band per geometry key, over EVERY tagged element — built first so a companion
        // appended before or after the visible line is found either way.
        const widestByGeom = new Map<string, number>();
        const rows: { el: any; geom: string; w: number; open: boolean; inert: boolean }[] = [];

        for (const el of els) {
            const tag = String(el.tagName || "").toLowerCase();
            if (!OPEN_TAGS.has(tag)) continue;
            const cs = styleOf(el, ownerDoc);
            const open = isUnfilled(attrOrComputed(el, "fill", cs));
            const w = widthPx(attrOrComputed(el, "stroke-width", cs) || "1");
            const geom = String(el.getAttribute?.("d") ?? "")
                || `${tag}#${String(el.getAttribute?.(ROW_IDX_ATTR) ?? "")}`;
            const inert = String(cs?.pointerEvents ?? el.style?.pointerEvents ?? "") === "none";
            rows.push({ el, geom, w, open, inert });
            if (isFinite(w)) {
                const prev = widestByGeom.get(geom);
                if (prev === undefined || w > prev) widestByGeom.set(geom, w);
            }
        }

        const out: HitBandCensus = { ...EMPTY };
        for (const r of rows) {
            if (!r.open) continue;
            out.openStrokes++;
            if (r.inert) continue;                       // the chart declared it decoration
            out.interactive++;
            if (isFinite(r.w) && r.w > out.widestPx) out.widestPx = Math.round(r.w);
            if (!(r.w < MIN_HIT_BAND_PX)) continue;      // NaN lands here too, and should
            out.hairline++;
            const best = widestByGeom.get(r.geom);
            if (best === undefined || best < MIN_HIT_BAND_PX) out.uncovered++;
        }
        return out;
    } catch {
        return EMPTY;
    }
}

/**
 * The always-on behaviour tag for this census, or "" when there is nothing to say.
 *
 * One tag per render in the `hitband:` namespace, so the rate is a `LIKE` away and the three
 * states sum to every render that drew an open stroke — a rate needs a denominator, and
 * `hitband:d3:ok` is it. Charts with no open-stroke marks at all emit nothing rather than a
 * third value nobody will remember to exclude.
 */
export function hitBandFlag(c: HitBandCensus): string {
    if (c.interactive === 0) return "";
    return c.uncovered > 0 ? "hitband:d3:thin" : "hitband:d3:ok";
}
