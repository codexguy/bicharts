// IS EACH DOT DRAWN AT ITS VALUE?
//
// A chart that draws one dot per row along a value axis - a beeswarm, a strip, a dot plot of
// observations - makes one promise: read a dot's height and you have read its value. A force layout
// breaks that promise quietly. forceCollide pushes dots along BOTH axes, so on a dense or skewed
// column they drift off their values, pile against the band edges and the axis floor, and the
// chart still looks like a beeswarm. Measured on a 1,824-dot Card swarm drawn that way: median
// error a third of the median trip, 16% of the dots clamped onto a band edge. Nothing in the code
// says so; the size of the drift depends on the data and the frame.
//
// WHAT THIS MEASURES. It never reads the chart's scales, which it cannot know. It reads each
// `circle` carrying a single data-row-idx back to its row and asks, for every numeric column and
// both screen axes, how well a straight line through the dots' positions predicts that column -
// a linear scale IS a straight line, whatever its range, offset or direction. The column and axis
// the line fits best is the value axis. The line is fitted ROBUSTLY (the median of pairwise slopes)
// so that the displaced dots cannot drag the line after themselves and hide their own error. Then:
// what share of the dots sits more than one radius away from where that line puts their value?
//
// It declines, reporting nothing, when there is no such axis to find: fewer than MIN_MARKS dots,
// marks shared by several rows, dots in separately translated panels (the line cannot fit), a
// non-linear value axis (a log axis is tried too), or no column the line explains.
//
// A BUCKET, NOT A VERDICT, and for the same reason as the colour-spread census: this is the
// instrument that measures how often charts misplace their dots at all. `place:d3:off0` says no dot
// is more than a radius from its value.

import { ROW_IDX_ATTR } from "./contract";

/** Below this many dots a share is too coarse to mean anything. */
const MIN_MARKS = 24;
/** Beyond this many dots the census is skipped, as the other censuses do. */
const ELEMENT_CAP = 5000;
/** Dots used to fit the line; pairwise slopes grow as the square, so the fit samples. */
const FIT_SAMPLE = 90;
/** A straight line must explain at least this share of the positions to call it the value axis. */
export const VALUE_AXIS_MIN_FIT = 0.8;
/** The value axis must span at least this many pixels, or a flat line would fit anything. */
const MIN_AXIS_SPAN_PX = 40;

export interface ValuePlacementCensus {
    /** Dots measured: circles carrying exactly one row index. 0 = the census declined. */
    marks: number;
    /** The screen axis the values run along, and the column they encode. */
    axis: "x" | "y" | "";
    column: string;
    /** How well the fitted line explains the positions (1 = every dot on its value). */
    fit: number;
    /** Share (0-100) of the dots more than one radius from their value. */
    offShare: number;
    /** Median distance, in radii, between a dot and its value. */
    medianOffRadii: number;
}

const EMPTY: ValuePlacementCensus = { marks: 0, axis: "", column: "", fit: 0, offShare: 0, medianOffRadii: 0 };

function num(el: any, name: string): number {
    const v = el.getAttribute?.(name);
    if (v === null || v === undefined || String(v).trim() === "") return NaN;
    return parseFloat(String(v));
}

function median(xs: number[]): number {
    if (!xs.length) return NaN;
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Robust straight line pos = a + b * v: the median pairwise slope over a deterministic sample. */
function robustLine(v: number[], pos: number[]): { a: number; b: number } | null {
    const n = v.length;
    const step = Math.max(1, Math.floor(n / FIT_SAMPLE));
    const idx: number[] = [];
    for (let i = 0; i < n; i += step) idx.push(i);
    const slopes: number[] = [];
    for (let p = 0; p < idx.length; p++) {
        for (let q = p + 1; q < idx.length; q++) {
            const dv = v[idx[q]] - v[idx[p]];
            if (Math.abs(dv) < 1e-12) continue;
            slopes.push((pos[idx[q]] - pos[idx[p]]) / dv);
        }
    }
    if (slopes.length < 3) return null;
    const b = median(slopes);
    if (!Number.isFinite(b) || Math.abs(b) < 1e-12) return null;
    const a = median(pos.map((y, i) => y - b * v[i]));
    return Number.isFinite(a) ? { a, b } : null;
}

/**
 * Where do the dots sit against their values? Never throws; declines with `marks: 0`.
 * `rows` are the rows the chart was handed, indexed exactly as data-row-idx indexes them.
 */
export function censusValuePlacement(container: any, data: { columns?: { name: string }[]; rows?: any[][] } | null | undefined): ValuePlacementCensus {
    try {
        if (!container || typeof container.querySelectorAll !== "function") return EMPTY;
        const rows = data?.rows;
        const columns = data?.columns ?? [];
        if (!Array.isArray(rows) || !rows.length || !columns.length) return EMPTY;
        const els = Array.from(container.querySelectorAll(`circle[${ROW_IDX_ATTR}]`)) as any[];
        if (els.length < MIN_MARKS || els.length > ELEMENT_CAP) return EMPTY;

        const dots: { row: any[]; x: number; y: number; r: number }[] = [];
        const seen = new Set<number>();
        for (const el of els) {
            const raw = String(el.getAttribute(ROW_IDX_ATTR) ?? "").trim();
            if (!/^\d+$/.test(raw)) continue;                    // a mark shared by several rows is not a dot of one
            const i = +raw;
            const row = rows[i];
            const x = num(el, "cx"), y = num(el, "cy"), r = num(el, "r");
            if (!row || !Number.isFinite(x) || !Number.isFinite(y) || !(r > 0)) continue;
            seen.add(i);
            dots.push({ row, x, y, r });
        }
        // One dot per row: an animated chart that keeps several frames' dots, or marks reused
        // across panels, is not the shape this measures.
        if (dots.length < MIN_MARKS || seen.size < dots.length * 0.9) return EMPTY;

        let best: { col: number; axis: "x" | "y"; fit: number; res: number[]; log: boolean } | null = null;
        for (let c = 0; c < columns.length; c++) {
            // Host-injected bookkeeping columns (__rowIdx__, __geoIso__) are not values a chart plots.
            if (/^__.*__$/.test(String(columns[c]?.name ?? ""))) continue;
            const vals = dots.map(d => {
                const v = d.row[c];
                return v === null || v === undefined || v === "" ? NaN : typeof v === "number" ? v : Number(v);
            });
            const finite = vals.filter(Number.isFinite);
            if (finite.length < dots.length * 0.9 || new Set(finite).size < 8) continue;
            const logs = finite.every(v => v > 0) ? [false, true] : [false];
            for (const log of logs) {
                for (const axis of ["x", "y"] as const) {
                    const keep: number[] = [];
                    const v: number[] = [], pos: number[] = [];
                    dots.forEach((d, k) => {
                        if (!Number.isFinite(vals[k])) return;
                        keep.push(k);
                        v.push(log ? Math.log10(vals[k]) : vals[k]);
                        pos.push(axis === "x" ? d.x : d.y);
                    });
                    const line = robustLine(v, pos);
                    if (!line) continue;
                    const lo = Math.min(...pos), hi = Math.max(...pos);
                    if (hi - lo < MIN_AXIS_SPAN_PX) continue;
                    const mean = pos.reduce((s, p) => s + p, 0) / pos.length;
                    let ssRes = 0, ssTot = 0;
                    const res = pos.map((p, k) => { const e = p - (line.a + line.b * v[k]); ssRes += e * e; ssTot += (p - mean) ** 2; return e; });
                    if (ssTot <= 0) continue;
                    const fit = 1 - ssRes / ssTot;
                    if (fit >= VALUE_AXIS_MIN_FIT && (!best || fit > best.fit)) {
                        const full = new Array(dots.length).fill(NaN);
                        keep.forEach((k, j) => { full[k] = res[j]; });
                        best = { col: c, axis, fit, res: full, log };
                    }
                }
            }
        }
        if (!best) return EMPTY;

        let off = 0, measured = 0;
        const radii: number[] = [];
        dots.forEach((d, k) => {
            const e = best!.res[k];
            if (!Number.isFinite(e)) return;
            measured++;
            const inRadii = Math.abs(e) / Math.max(d.r, 1);
            radii.push(inRadii);
            if (inRadii > 1) off++;
        });
        if (measured < MIN_MARKS) return EMPTY;
        return {
            marks: measured,
            axis: best.axis,
            column: String(columns[best.col]?.name ?? ""),
            fit: Math.round(best.fit * 1000) / 1000,
            offShare: Math.round((off / measured) * 1000) / 10,
            medianOffRadii: Math.round(median(radii) * 100) / 100,
        };
    } catch {
        return EMPTY;
    }
}

/**
 * The always-on behaviour tag, or "" when the census declined.
 *
 * `place:d3:off0` no dot more than a radius from its value; `off1` some, under 5%; `off5` 5-20%;
 * `off20` 20-50%; `off50` half or more. Finer at the bottom than the colour census's twenty-point
 * buckets on purpose: a correct layout reports exactly zero, so the first few percent are the
 * interesting ones.
 */
export function valuePlacementFlag(c: ValuePlacementCensus): string {
    if (c.marks === 0) return "";
    const s = c.offShare;
    const bucket = s <= 0 ? 0 : s < 5 ? 1 : s < 20 ? 5 : s < 50 ? 20 : 50;
    return "place:d3:off" + bucket;
}
