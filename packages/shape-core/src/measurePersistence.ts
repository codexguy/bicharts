// MEASURE PERSISTENCE - how a measure's value moves from one point of a time axis to the next.
//
// WHY THIS EXISTS. A consumer that buckets a time series has to decide what a bucket's value is,
// and the answer depends on a property of the measure that no name list recovers reliably. An
// amount that ACCRUES (revenue, units, tickets closed) is independent from one period to the next:
// the period's value is its total. A LEVEL read at a point in time (a closing price, a reservoir
// gauge, a balance on hand) is carried over: today's value is yesterday's plus a small step, and
// summing it across the rows of a period counts the same units again on every row. The two look
// the same in a column's summary statistics. They differ in the series itself, and only the
// client holds the rows, so the client measures it and the consumer decides.
//
// WHICH COLUMN. The first temporal column that is not a measure or a date part (IndexedText picks
// it), and the same series key seriesCompleteness reads, so both descriptors describe the same
// series. A panel (many stores, one price per store per day) is measured per series and the
// medians are reported; a table with no usable key is one series.
//
// THE TWO NUMBERS. Both are scale-free ratios of a series in date order, one value per point after
// the rows that share a point are summed:
//   - `relStep`: the median absolute step between consecutive points, over the median absolute
//     value. A level moves by a small share of itself per step; an accruing amount swings by a
//     large one.
//   - `vnDetrended`: the von Neumann ratio of the residuals of a straight-line fit, i.e. the mean
//     squared step of the residuals over their variance. About 2 when the points are independent
//     around a trend, near 0 when each point carries the last one over. Detrending first is what
//     keeps a steadily growing flow from reading as persistent.
// The number of points matters as much as the ratios: at a couple of dozen monthly points a
// level's steps look as independent as a flow's, so a consumer applies its own floor to `points`.
//
// WHEN IT IS SILENT. When no series has at least MIN_POINTS points and some variation, when the
// measure is all zeros, and when the times do not parse. A temporal column's cadence is NOT
// required: trading days skip weekends and are still a series.
//
// PRIVACY. Two ratios and two counts and the name of a column. Every privacy tier, like the
// cadence's counts.
//
// MEASUREMENT ONLY. What counts as "persistent enough", and what a consumer then does with a level,
// is policy and lives with the consumer.

import { parseTemporalPoint } from "./cadence";

/** How a measure's value moves from one point of a time axis to the next. Ratios and counts only: every privacy tier. */
export type MeasurePersistence = {
    /** The temporal column the series run along. */
    timeColumn: string;
    /** The series key (pickSeriesColumn's choice); absent when the measure was read as one series. */
    seriesColumn?: string;
    /** Series measured: those with at least 6 points and some variation. */
    series: number;
    /** Median points per measured series. */
    points: number;
    /** Median over series of the von Neumann ratio of the straight-line residuals, 3 places: ~2 independent, ~0 carried over. */
    vnDetrended: number;
    /** Median over series of median abs(step) / median abs(value), 4 places. */
    relStep: number;
};

/** A series shorter than this has no steps worth a ratio. */
export const MEASURE_PERSISTENCE_MIN_POINTS = 6;

type Measured = Omit<MeasurePersistence, "timeColumn" | "seriesColumn">;

function median(a: ReadonlyArray<number>): number {
    const s = a.slice().sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** One series in time order, or null when it has no variation to measure. */
function seriesSignals(x: ReadonlyArray<number>): { vnDetrended: number, relStep: number } | null {
    const n = x.length;
    if (n < MEASURE_PERSISTENCE_MIN_POINTS) return null;
    let lo = x[0], hi = x[0], sum = 0;
    for (const v of x) { if (v < lo) lo = v; if (v > hi) hi = v; sum += v; }
    if (lo === hi) return null;
    const medAbs = median(x.map(Math.abs));
    if (medAbs === 0) return null;
    const steps: number[] = [];
    for (let i = 1; i < n; i++) steps.push(x[i] - x[i - 1]);
    const relStep = median(steps.map(Math.abs)) / medAbs;

    // Least-squares line x = a + b*t over t = 0..n-1, then the residuals' von Neumann ratio.
    const tm = (n - 1) / 2, xm = sum / n;
    let sxy = 0, sxx = 0, varX = 0;
    for (let i = 0; i < n; i++) { sxy += (i - tm) * (x[i] - xm); sxx += (i - tm) * (i - tm); varX += (x[i] - xm) * (x[i] - xm); }
    varX /= n;
    const b = sxy / sxx, a = xm - b * tm;
    const r = x.map((v, i) => v - (a + b * i));
    const rm = r.reduce((s, v) => s + v, 0) / n;
    let varR = 0, ss = 0;
    for (let i = 0; i < n; i++) { varR += (r[i] - rm) * (r[i] - rm); if (i > 0) ss += (r[i] - r[i - 1]) * (r[i] - r[i - 1]); }
    varR /= n;
    ss /= (n - 1);
    // A series that IS a straight line leaves residuals of pure rounding noise; reading that noise as
    // a ratio would be arbitrary, and a line is no evidence of anything carried over. Call it independent.
    const vnDetrended = varR <= varX * 1e-12 ? 2 : ss / varR;
    return { vnDetrended, relStep };
}

/**
 * The persistence of one measure from the stamps of its time column (epoch ms, null where the cell did not
 * parse) - the part IndexedText runs once per measure, so the time column is parsed once per table and
 * not once per measure. `series` is the key column's cell text row by row, or absent for one series.
 */
export function measurePersistenceFromStamps(input: {
    stamps: ReadonlyArray<number | null>;
    series?: ReadonlyArray<string>;
    values: ReadonlyArray<number | null>;
}): Measured | null {
    const { stamps, series, values } = input;
    const n = Math.min(stamps.length, values.length);
    // Rows sharing a (series, point) are summed first: a host aggregates a measure to its grain, and a
    // measure read at a finer grain than the axis is a flow of that finer grain.
    const bySeries = new Map<string, Map<number, number>>();
    for (let i = 0; i < n; i++) {
        const ms = stamps[i], v = values[i];
        if (ms === null || v === null || !Number.isFinite(v)) continue;
        let key = "";
        if (series) {
            key = series[i] ?? "";
            if (key === "") continue;                 // a row with no key belongs to no series
        }
        let cells = bySeries.get(key);
        if (!cells) bySeries.set(key, cells = new Map<number, number>());
        cells.set(ms, (cells.get(ms) ?? 0) + v);
    }
    const vns: number[] = [], rels: number[] = [], pts: number[] = [];
    for (const cells of bySeries.values()) {
        const x = [...cells.entries()].sort((p, q) => p[0] - q[0]).map(e => e[1]);
        const sig = seriesSignals(x);
        if (!sig) continue;
        vns.push(sig.vnDetrended);
        rels.push(sig.relStep);
        pts.push(x.length);
    }
    if (vns.length === 0) return null;
    return {
        series: vns.length,
        points: Math.round(median(pts)),
        vnDetrended: Math.round(median(vns) * 1000) / 1000,
        relStep: Math.round(median(rels) * 10000) / 10000,
    };
}

export function measurePersistence(input: {
    times: ReadonlyArray<string>;            // the temporal column's cell text, row by row
    series?: ReadonlyArray<string>;          // the key column's cell text, row by row; absent = one series
    values: ReadonlyArray<number | null>;    // the measure, row by row
    pattern?: string; locale?: string;
}): Omit<MeasurePersistence, "timeColumn" | "seriesColumn"> | null {
    const stamps = input.times.map(t => parseTemporalPoint(t, input.pattern, input.locale)?.ms ?? null);
    return measurePersistenceFromStamps({ stamps, series: input.series, values: input.values });
}
