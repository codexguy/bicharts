// TEMPORAL CADENCE — how a time column's values are SPACED, and where they stop (2026-09-12).
//
// WHY THIS EXISTS. A chart that connects points with a line interpolates between them, so a
// line drawn across a stretch of time that holds no observations states something the data
// never said. Chart-selection rules commonly forbid exactly that, and such a rule cannot fire
// on a shape summary alone, because nothing in one measures the spacing. A server sees a
// summary: a low value, a high value, a distinct count and (above the strictest privacy tier)
// five sample values. Sixteen readings taken on 1-8 September and 1-8 October look, through
// that window, exactly like sixteen consecutive days: same endpoints, same count, and the five
// samples are all from the first week. A production sensor chart drew one smooth monotone curve
// across a 23-day hole and fitted an OLS trend through it, obeying a prompt that had told it
// three separate times not to, because the prompt had also told it the data was daily.
//
// Only the client can answer this: it holds the actual cell values. Same reasoning that put
// classifyTemporal here rather than server-side, and the same contract — everything below is a
// COUNT, a RATIO or an inferred period NAME, never a value, so the whole descriptor ships at
// every privacy tier. The one exception is `runBounds`, which names calendar dates and
// therefore rides the pl>=20 gate that lowValue / highValue already ride; the structural half
// arrives without it and a consumer must degrade to "two runs" from "1-8 Sep and 1-8 Oct".
//
// WHAT IT IS NOT. It does not decide anything. Whether a hole is big enough to break a line is
// a POLICY question and lives server-side with every other threshold, exactly like eta2 and
// spreadRatio. This module reports the shape and stops.

/** One contiguous stretch of observations, and how many it holds. */
export type TemporalRun = { from: string; to: string; points: number };

export type TemporalCadence = {
    /**
     * The regular period the values are spaced on, inferred from the MEDIAN gap rather than
     * from the column's name — a column called "Month" may hold week-endings. "irregular" when
     * no calendar period fits the median gap, which is itself the answer to "can this be
     * treated as a series".
     */
    grain: "hour" | "day" | "weekday" | "week" | "month" | "quarter" | "year" | "irregular";
    /** Distinct parseable points. */
    points: number;
    /** How many periods of `grain` the span from first to last holds, endpoints included. */
    expectedPoints: number;
    /** points / expectedPoints as a percentage, 0..100. 100 = no period is missing. */
    coveragePct: number;
    /**
     * Contiguous runs. A gap wider than `gapFactor` periods ends a run, so scattered single
     * misses (which a line may honestly bridge) stay one run and a real hole does not.
     */
    runs: number;
    /** The widest gap between consecutive points, in periods. 1 = perfectly contiguous. */
    largestGapUnits: number;
    /** The factor a gap had to exceed to split a run — recorded so a consumer can re-derive. */
    gapFactor: number;
    /** Present only at privacy level >= 20; capped, see MAX_RUN_BOUNDS. */
    runBounds?: TemporalRun[];
};

/**
 * A gap must EXCEED this many inferred periods to end a run — so a boundary is a gap of six
 * periods or more.
 *
 * MEASURED AGAINST THE NULL CASE, not guessed (2026-09-12). The null here is a series with no
 * hole at all, only scattered single misses: a line across one absent day is honest, and
 * splitting on it would break every real series that has ever dropped a reading. Simulated with
 * mulberry32 over 400 seeds per cell, swept separately by series length and by miss rate
 * (`cadenceNoiseFloor.test.ts` pins the result, per the standing rule that a threshold on a
 * sample statistic needs its noise floor measured first):
 *
 *   miss rate | largest gap seen, worst over n = 16 / 30 / 90 / 365 and weekday / monthly
 *   0%        | 1
 *   2%        | 4
 *   5%        | 5
 *   10%       | 6
 *   20%       | 8
 *
 * The floor is FLAT in n — 4 at n=16 and 5 at n=365 for the same miss rate — because it is the
 * maximum of many small draws, so a CONSTANT is correctly specified here and a sqrt(n) term
 * would be wrong. At realistic miss rates (<= 5%) the noise ceiling is 5, which is where this
 * sits. Above it, a boundary means a real hole: the 23-day hole in the sensor series below reads 23.
 *
 * THE WEEKDAY REFINEMENT IS WHAT MAKES THIS POSSIBLE. Measured at the day grain a Monday-Friday
 * series reports a three-period gap every weekend, so the threshold would have had to clear 3
 * on the commonest shape in the corpus and would then have been blind to genuine three-period
 * holes. Measured in business days the same series has no gap at all.
 */
export const DEFAULT_GAP_FACTOR = 5;

/** Run bounds are for a sentence, not a dataset; a series in 40 pieces needs no more than this. */
export const MAX_RUN_BOUNDS = 6;

/** Fewer than this and "spacing" is not a thing the values have. */
const MIN_POINTS = 3;

const MS_DAY = 86400000;

type Stamp = {
    /** Epoch ms at the point's start. */
    ms: number;
    /** Calendar parts, for the month/quarter/year arithmetic that epoch ms cannot do. */
    y: number; m: number; d: number;
    /** Day-level ISO ("YYYY-MM-DD") for run bounds. */
    iso: string;
};

const ISO_LIKE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?Z?)?$/;
const YEAR_MONTH = /^(\d{4})[-/](\d{1,2})$/;
const YEAR_QUARTER = /^(\d{4})[-\s]?Q([1-4])$/i;
const QUARTER_YEAR = /^Q([1-4])[-\s](\d{4})$/i;
const YEAR_ONLY = /^(\d{4})$/;
const YYYYMM = /^(\d{4})(0[1-9]|1[0-2])$/;
const YYYYMMDD = /^(\d{4})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/;

function stamp(y: number, m: number, d: number, hh = 0, mi = 0, ss = 0): Stamp | null {
    if (!(y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    const ms = Date.UTC(y, m - 1, d, hh, mi, ss);
    if (!Number.isFinite(ms)) return null;
    const p2 = (n: number) => (n < 10 ? "0" + n : String(n));
    return { ms, y, m, d, iso: `${y}-${p2(m)}-${p2(d)}` };
}

/**
 * Read one value with a strptime / d3.timeParse specifier — the vocabulary `temporalTextPattern`
 * already speaks. Only the field codes that appear in a DATE pattern are honoured (%Y %m %d, and
 * a trailing time is consumed and ignored, since cadence is a day-or-coarser question).
 */
function parseByPattern(s: string, pattern: string): Stamp | null {
    const fields: string[] = [];
    let re = "";
    for (let i = 0; i < pattern.length; i++) {
        if (pattern[i] !== "%") { re += pattern[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); continue; }
        const code = pattern[++i];
        switch (code) {
            case "Y": fields.push("Y"); re += "(\\d{4})"; break;
            case "m": fields.push("m"); re += "(\\d{1,2})"; break;
            case "d": fields.push("d"); re += "(\\d{1,2})"; break;
            case "H": case "M": case "S": re += "\\d{1,2}"; break;
            case "%": re += "%"; break;
            default: return null;          // an unknown code means we do not understand it
        }
    }
    const m = new RegExp("^" + re + "$").exec(s);
    if (!m) return null;
    let y = 0, mo = 1, d = 1;
    fields.forEach((f, i) => {
        const v = +m[i + 1];
        if (f === "Y") y = v; else if (f === "m") mo = v; else d = v;
    });
    return y ? stamp(y, mo, d) : null;
}

/**
 * One distinct value -> a point on the calendar, or null when it is not one.
 *
 * Deliberately narrow. It reads the forms this engine itself produces for a temporal column —
 * IndexedText keys a whole-day Date as "YYYY-MM-DD" and anything else by its ISO instant — plus
 * the period and integer-key forms classifyTemporal already recognises as time axes. A value it
 * cannot read is DROPPED, never guessed at, and a column where most values drop yields no
 * cadence at all (see the parse floor in measureCadence).
 */
export function parseTemporalPoint(raw: string, pattern?: string): Stamp | null {
    const s = (raw ?? "").trim();
    if (s === "") return null;

    // A DATE STORED AS TEXT reads by its detected pattern and by nothing else. "15/03/2024" and
    // "03/15/2024" are the same eight characters in a different order, and guessing between them
    // silently moves half a year's points; `temporalTextPattern` is exactly the field that
    // already resolved it (see models.ts), so it is the only authority used here.
    if (pattern) {
        const p = parseByPattern(s, pattern);
        if (p) return p;
        return null;
    }

    let m = ISO_LIKE.exec(s);
    if (m) return stamp(+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));

    m = YEAR_QUARTER.exec(s);
    if (m) return stamp(+m[1], (+m[2] - 1) * 3 + 1, 1);
    m = QUARTER_YEAR.exec(s);
    if (m) return stamp(+m[2], (+m[1] - 1) * 3 + 1, 1);

    m = YEAR_MONTH.exec(s);
    if (m && +m[2] >= 1 && +m[2] <= 12) return stamp(+m[1], +m[2], 1);

    // Integer period KEYS and bare years. Order matters: YYYYMMDD before YYYYMM before YYYY,
    // longest first, or "202401" reads as the year 2024 with a stray suffix.
    m = YYYYMMDD.exec(s);
    if (m) return stamp(+m[1], +m[2], +m[3]);
    m = YYYYMM.exec(s);
    if (m) return stamp(+m[1], +m[2], 1);
    m = YEAR_ONLY.exec(s);
    if (m) {
        const y = +m[1];
        // Same window classifyTemporal uses for a year-as-integer; outside it this is a number.
        if (y >= 1900 && y <= 2100) return stamp(y, 1, 1);
        return null;
    }
    return null;
}

function isWeekday(ms: number): boolean {
    const wd = new Date(ms).getUTCDay();
    return wd >= 1 && wd <= 5;
}

/** Weekdays from a to b inclusive of a, exclusive of b — the "distance in business days". */
function weekdaysBetween(aMs: number, bMs: number): number {
    if (bMs <= aMs) return 0;
    const days = Math.round((bMs - aMs) / MS_DAY);
    // Whole weeks contribute 5 each; walk the remainder, which is at most 6 iterations.
    const weeks = Math.floor(days / 7);
    let n = weeks * 5;
    let cur = aMs + weeks * 7 * MS_DAY;
    while (cur < bMs) {
        if (isWeekday(cur)) n++;
        cur += MS_DAY;
    }
    return n;
}

function median(xs: number[]): number {
    if (xs.length === 0) return 0;
    const s = [...xs].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

type GrainName = TemporalCadence["grain"];

/** The median gap in days -> the calendar period it is, or "irregular". */
function snapGrain(medianDays: number): GrainName {
    if (!(medianDays > 0)) return "irregular";
    if (medianDays < 0.95) return "hour";              // any sub-day cadence
    if (medianDays <= 1.05) return "day";
    if (medianDays >= 6.5 && medianDays <= 7.5) return "week";
    if (medianDays >= 27 && medianDays <= 31.5) return "month";
    if (medianDays >= 88 && medianDays <= 93) return "quarter";
    if (medianDays >= 362 && medianDays <= 368) return "year";
    return "irregular";
}

/** Distance between two stamps measured in whole periods of `grain`. */
function unitsBetween(a: Stamp, b: Stamp, grain: GrainName, stepMs: number): number {
    switch (grain) {
        case "year": return b.y - a.y;
        case "quarter": return (b.y * 4 + Math.floor((b.m - 1) / 3)) - (a.y * 4 + Math.floor((a.m - 1) / 3));
        case "month": return (b.y * 12 + b.m) - (a.y * 12 + a.m);
        case "week": return Math.round((b.ms - a.ms) / (7 * MS_DAY));
        case "weekday": return weekdaysBetween(a.ms, b.ms);
        case "day": return Math.round((b.ms - a.ms) / MS_DAY);
        case "hour":
        default:
            return stepMs > 0 ? Math.round((b.ms - a.ms) / stepMs) : 0;
    }
}

/**
 * Measure how a temporal column's distinct values are spaced.
 *
 * `values` are the distinct value LABELS as IndexedText keys them (see parseTemporalPoint for
 * the forms read). Returns null — meaning "no cadence claim" — for fewer than three parseable
 * points, a zero-width span, or a column where under 80% of the distinct values parse, because
 * a cadence measured over a minority of a column describes something other than the column.
 * Failing closed is deliberate: the consumer's fallback is today's behaviour.
 */
export function measureCadence(
    values: Iterable<string>,
    opts?: { gapFactor?: number; includeBounds?: boolean; pattern?: string },
): TemporalCadence | null {
    const gapFactor = opts?.gapFactor ?? DEFAULT_GAP_FACTOR;

    // `seen` / `parsed` count VALUES, while `byMs` holds distinct POINTS — the parse floor
    // below asks what fraction of the column was readable, and a repeated date is readable.
    // Counting distinct points against total values instead would refuse any column whose
    // values repeat, which every column fed row-by-row rather than as a distinct set does.
    let seen = 0;
    let parsed = 0;
    const byMs = new Map<number, Stamp>();
    for (const v of values) {
        if (v === null || v === undefined || v === "") continue;
        seen++;
        const p = parseTemporalPoint(String(v), opts?.pattern);
        if (p) { parsed++; byMs.set(p.ms, p); }
    }
    const pts = [...byMs.values()].sort((a, b) => a.ms - b.ms);
    if (pts.length < MIN_POINTS) return null;
    if (seen > 0 && parsed / seen < 0.8) return null;
    const spanMs = pts[pts.length - 1].ms - pts[0].ms;
    if (spanMs <= 0) return null;

    const diffs: number[] = [];
    for (let i = 1; i < pts.length; i++) diffs.push(pts[i].ms - pts[i - 1].ms);
    const stepMs = median(diffs);
    if (!(stepMs > 0)) return null;

    let grain = snapGrain(stepMs / MS_DAY);

    // WEEKDAY REFINEMENT, and it is the difference between a signal and noise. A Monday-Friday
    // series has a median gap of one day and a Friday-to-Monday gap of three, so measured at the
    // DAY grain it reports ~71% coverage and a 3-period hole every single week — the commonest
    // shape in the corpus would be the loudest false positive. When every point is a weekday and
    // the span actually contains a weekend, the period IS the business day: measured that way
    // the same series is 100% covered with no gap at all, and a genuine hole in it still shows.
    if (grain === "day" && spanMs >= 7 * MS_DAY && pts.every(p => isWeekday(p.ms))) {
        const weekdaysInSpan = weekdaysBetween(pts[0].ms, pts[pts.length - 1].ms) + 1;
        if (weekdaysInSpan > pts.length * 0.5) grain = "weekday";
    }

    const expectedPoints = grain === "irregular"
        ? pts.length
        : unitsBetween(pts[0], pts[pts.length - 1], grain, stepMs) + 1;

    let largestGapUnits = 1;
    let runs = 1;
    const bounds: TemporalRun[] = [];
    let runStart = pts[0];
    let runPoints = 1;
    for (let i = 1; i < pts.length; i++) {
        const g = unitsBetween(pts[i - 1], pts[i], grain, stepMs);
        if (g > largestGapUnits) largestGapUnits = g;
        if (grain !== "irregular" && g > gapFactor) {
            runs++;
            bounds.push({ from: runStart.iso, to: pts[i - 1].iso, points: runPoints });
            runStart = pts[i];
            runPoints = 1;
        } else {
            runPoints++;
        }
    }
    bounds.push({ from: runStart.iso, to: pts[pts.length - 1].iso, points: runPoints });

    const out: TemporalCadence = {
        grain,
        points: pts.length,
        expectedPoints: Math.max(expectedPoints, pts.length),
        coveragePct: Math.round((pts.length / Math.max(expectedPoints, pts.length)) * 1000) / 10,
        runs,
        largestGapUnits,
        gapFactor,
    };
    if (opts?.includeBounds && bounds.length <= MAX_RUN_BOUNDS) out.runBounds = bounds;
    return out;
}
