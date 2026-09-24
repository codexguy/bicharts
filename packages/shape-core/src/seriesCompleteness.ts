// SERIES COMPLETENESS - which SERIES of a time axis are short, where each starts and ends, and how
// much of the axis each one covers (2026-09-24).
//
// WHY THIS EXISTS. The cadence descriptor (cadence.ts) says whether a time COLUMN skips periods. A
// panel - eight states by twelve months, thirty routes by eight quarters - can have a perfectly
// contiguous date column in which half the series are missing half the months: one state reports
// from May, another has no March. Nothing at the column level can see that, and a chart that draws
// one line, lane or facet per series has to: a series that has not started yet is not a series
// that fell to zero, and a hole in the middle of one is not a trough. A generated horizon chart
// drew exactly those false troughs, because no fact it was given said which series were short.
// Only the client can measure it; a server sees a summary of each column, never a row.
//
// WHICH COLUMN IS THE SERIES. One key, chosen the same way every time, rather than every
// categorical: across real panels the answer depends on the key more often than not, and the
// ragged one is the ENTITY - the state, the route, the store, the country - not the attribute the
// entities are cut by (a service category, a channel, a status). So the key is the
// lowest-cardinality categorical that looks like an entity: never a measure, a time column, an
// identifier, a flag, an ordinal scale, or a column whose name says it classifies. Whatever key is
// chosen, the statement made about it is true; the choice decides only which true statement is
// made. See seriesKeyVerdict.
//
// WHEN IT IS SILENT. When no series is missing a period; when the (series x period) lattice is
// under half filled, which is an event log or an identifier and not a panel - one row per event
// scattered over a year leaves every series "incomplete" on every day it did not fire, a statement
// that is true and useless; and when no regular period grain resolved, because a hole needs a unit
// to be counted in.
//
// PRIVACY. Counts, ratios, a column name and a period-grain name ship at every privacy tier, like
// the rest of the cadence. Two parts are values and are gated by the caller:
//   - `first` / `last` name calendar periods, so they ride the same tier as the cadence's
//     runBounds and a date column's low/high value;
//   - `name` is a CATEGORY VALUE, so it ships only where the column's own values already would: a
//     non-text column at the detailed-stats tier (as its top values do), or a text column whose
//     values are the safe short codes that tier shares verbatim. Any other text value is withheld
//     at every tier, because that is what the privacy setting promises.
// Absent means withheld, never empty: a consumer phrases the fact without it.
//
// SO THE UNNAMED FACT CARRIES ITS OWN STRUCTURE. With the names withheld, and below the
// detailed-stats tier the dates too, a consumer still has to be able to say what is true: how many
// series start late and by how much, how many end early, how many have holes and how wide the widest
// is, which periods no series has, and how the least covered one looks. Every one of those is a
// COUNT of periods or of series, measured relative to the axis's own first and last period, so no
// calendar date and no category value can be read back from any of them - they ship at every tier,
// with the cadence's own counts (`points`, `runs`, `largestGapUnits`). A position relative to the
// axis turns into a date only against the axis's bounds, and those ship only at the tier where
// `first` / `last` already do. The maxima are over EVERY series, not only the listed ones, so a
// consumer's threshold is applied to the whole panel.
//
// MEASUREMENT ONLY. What a consumer says about a short series, and whether one missing month is
// worth saying, is policy and lives with it. `largestGap` is measured in the unit the column's
// cadence measures `largestGapUnits` in, so a consumer applies the SAME noise floor to one series
// that it applies to the column.

import { analyseCadence, parseTemporalPoint, unitsBetween, type Stamp } from "./cadence";
import { detectFormatSignature } from "./formatDetector";
import { detectOrdinalDomain } from "./ordinalDetector";
import { nameWords } from "./util";

/** One series that is missing at least one period of the axis. */
export type SeriesCoverage = {
    /** The series' value. Absent when the privacy tier withholds the column's values. */
    name?: string;
    /** ISO start of the first period the series is observed in. Absent below privacy tier 20. */
    first?: string;
    /** ISO start of the last period the series is observed in. Absent below privacy tier 20. */
    last?: string;
    /** Periods of the axis before the series' first observation: a late start when above 0. */
    missingBefore: number;
    /** Periods of the axis after the series' last observation: an early end when above 0. */
    missingAfter: number;
    /** Periods absent between its own first and last - holes, as distinct from a late start or an early end. */
    missingInterior: number;
    /**
     * The widest step between two consecutive observations of the series, in periods - the unit of
     * the cadence's `largestGapUnits`: 1 = no hole, one missing period reads 2.
     */
    largestGap: number;
    /** Share of the axis's periods the series is observed in, 0..1 to three places. */
    coverage: number;
};

export type SeriesCompleteness = {
    /** The categorical the series are read from. */
    seriesColumn: string;
    /** The period grain of the time column, as its cadence names it. */
    grain: string;
    /** Periods on the axis, first to last observed across every series, endpoints included. */
    periods: number;
    /** Series on the axis: the key's values that have at least one observed period. */
    seriesCount: number;
    /** Series missing at least one period. */
    incompleteSeries: number;
    /** Series whose first observation is after the axis's first period. */
    lateStarts: number;
    /** Series whose last observation is before the axis's last period. */
    earlyEnds: number;
    /** Series missing at least one period between their own first and last. */
    withHoles: number;
    /** Periods of the axis that no series is observed in - a gap in the whole panel, not in one series. */
    columnWideMissing: number;
    /** The latest start over every series: the most periods any one misses before its first observation. */
    maxMissingBefore: number;
    /** The earliest end over every series: the most periods any one misses after its last observation. */
    maxMissingAfter: number;
    /** The widest `largestGap` of any series, in the same unit. */
    largestGap: number;
    /** At most SERIES_COMPLETENESS_MAX_LISTED of them, least covered first. */
    series: SeriesCoverage[];
    /** Incomplete series not listed. */
    more: number;
};

/** Listed series; the rest are counted in `more`, so a 500-series panel does not write an essay. */
export const SERIES_COMPLETENESS_MAX_LISTED = 8;

/**
 * The share of the (series x period) lattice that must hold an observation before the columns are
 * treated as a panel at all. Below it the data is events or identifiers, and "incomplete" is the
 * normal state of every series rather than news about any of them.
 */
export const SERIES_COMPLETENESS_MIN_FILL = 0.5;

/** More distinct values than this and the column is not read as a set of series. */
export const SERIES_KEY_MAX_DISTINCT = 200;

/** What seriesKeyVerdict needs to know about one column. */
export type SeriesKeyCandidate = {
    name: string;
    dataType: string;
    isMeasure: boolean;
    isTemporal?: boolean;
    isDatePart?: boolean;
    isReassembledDate?: boolean;
    isBinaryFlag?: boolean;
    geoKind?: string;
    /** The engine's identifier-name test (isIdentifierName), passed in rather than re-derived. */
    identifierNamed: boolean;
    /** Distinct non-blank values. */
    values: ReadonlySet<string> | ReadonlyArray<string>;
    /** Rows in the table, for the row-identity test. */
    rows: number;
    locale?: string;
};

export type SeriesKeyVerdict =
    | "entity" | "measure" | "temporal" | "cardinality" | "row-identity"
    | "identifier" | "flag" | "ordinal" | "attribute";

// A column named for WHAT KIND a row is, rather than WHICH thing it is. Matched against the name's
// last word, as isIdentifierName matches its tokens. The longer tokens also match as a suffix, so
// a glued all-capitals name ("AQICategory", "SLASTATUS") still reads; the short ones do not, because
// "Resource" is not a source and "Frontier" is not a tier.
const ATTRIBUTE_NAME_TOKENS: ReadonlySet<string> = new Set([
    "category", "categories", "subcategory", "type", "types", "kind", "class", "classes", "classification",
    "segment", "segments", "tier", "status", "priority", "severity", "grade", "level", "band", "bucket",
    "group", "channel", "method", "mode", "stage", "phase", "period", "shift", "gender", "sex",
    "result", "outcome", "reason", "flag", "genre", "sector", "source",
]);
const ATTRIBUTE_NAME_SUFFIXES: ReadonlyArray<string> = [
    "category", "classification", "segment", "status", "priority", "severity", "channel",
];

// Value formats that identify a ROW or a record rather than a thing observed over time.
const IDENTIFIER_FORMATS: ReadonlySet<string> = new Set([
    "UUID", "EMAIL_LIKE", "URL_LIKE", "PHONE_LIKE", "NUMERIC_ID", "HEX_ID", "OPAQUE_ID_ALPHANUMERIC",
    "DATE_STR", "BOOLEAN",
]);

function isAttributeName(name: string): boolean {
    const words = nameWords(name);
    if (words.length === 0) return false;
    const last = words[words.length - 1];
    if (ATTRIBUTE_NAME_TOKENS.has(last)) return true;
    return ATTRIBUTE_NAME_SUFFIXES.some(t => last.length > t.length && last.endsWith(t));
}

/**
 * Whether a column can be the series key, and if not, why not. "entity" is the only yes.
 *
 * Every test is on the column's structure or its name, never on how ragged it is: choosing the key
 * that makes the fact fire would be choosing the answer.
 */
export function seriesKeyVerdict(c: SeriesKeyCandidate): SeriesKeyVerdict {
    if (c.isMeasure) return "measure";
    if (c.isTemporal || c.isDatePart || c.isReassembledDate) return "temporal";
    const values = Array.from(c.values).filter(v => v !== "" && v !== null && v !== undefined);
    if (values.length < 2 || values.length > SERIES_KEY_MAX_DISTINCT) return "cardinality";
    // A value on every row is a row's identity, and every row would be its own one-point series.
    if (c.rows > 0 && values.length >= c.rows) return "row-identity";
    if (c.isBinaryFlag) return "flag";
    // Before the format test: "P0-Critical" is shaped like an opaque code and is a severity scale.
    if (detectOrdinalDomain(values, c.locale) !== null) return "ordinal";
    if (c.identifierNamed) return "identifier";
    if (c.dataType === "String" && IDENTIFIER_FORMATS.has(detectFormatSignature(values))) return "identifier";
    // A recognised place is an entity whatever its column is called ("Region Type" of US states).
    if (!c.geoKind && isAttributeName(c.name)) return "attribute";
    return "entity";
}

/**
 * The series key: the entity-like column with the fewest distinct values; a recognised place wins
 * a tie, then the earlier column. Returns its index in `candidates`, or -1 when none qualifies.
 */
export function pickSeriesColumn(candidates: ReadonlyArray<SeriesKeyCandidate>): number {
    let best = -1;
    let bestN = Infinity;
    let bestGeo = false;
    candidates.forEach((c, i) => {
        if (seriesKeyVerdict(c) !== "entity") return;
        const n = new Set(Array.from(c.values).filter(v => v !== "")).size;
        const geo = !!c.geoKind;
        if (n < bestN || (n === bestN && geo && !bestGeo)) {
            best = i; bestN = n; bestGeo = geo;
        }
    });
    return best;
}

const p2 = (n: number) => (n < 10 ? "0" + n : String(n));

/** The ISO start of the period a point falls in, at the axis's grain. */
function periodStart(s: Stamp, grain: string): string {
    switch (grain) {
        case "year": return `${s.y}-01-01`;
        case "quarter": return `${s.y}-${p2(Math.floor((s.m - 1) / 3) * 3 + 1)}-01`;
        case "month": return `${s.y}-${p2(s.m)}-01`;
        // Any sub-day step is "hour" grain, so the period is named by the instant observed.
        case "hour": return new Date(s.ms).toISOString().replace(/\.\d{3}Z$/, "Z");
        default: return s.iso;   // day, weekday, week: the observed day is the period's name
    }
}

/**
 * Measure per-series completeness over one time column and one series column.
 *
 * `periods[i]` and `series[i]` are row i's two labels, as the engine keys values (a whole-day date
 * as "YYYY-MM-DD"); "" is a blank. The time axis is measured by the same analysis as the column's
 * own cadence, from the same distinct labels, so `grain` and `periods` here always agree with it.
 *
 * `includeDates` and `includeNames` default to FALSE - the safe reading of a missing argument is
 * the strictest tier.
 */
export function measureSeriesCompleteness(input: {
    periods: ReadonlyArray<string>;
    series: ReadonlyArray<string>;
    seriesColumn: string;
    pattern?: string;
    locale?: string;
    includeDates?: boolean;
    includeNames?: boolean;
    maxListed?: number;
    minFill?: number;
}): SeriesCompleteness | null {
    const { periods, series } = input;
    const n = Math.min(periods.length, series.length);

    const distinct = new Set<string>();
    for (let i = 0; i < n; i++) if (periods[i]) distinct.add(periods[i]);
    const a = analyseCadence(distinct, { pattern: input.pattern, locale: input.locale });
    if (!a) return null;
    const grain = a.cadence.grain;
    if (grain === "irregular") return null;

    const origin = a.points[0];
    const span = unitsBetween(origin, a.points[a.points.length - 1], grain, a.stepMs) + 1;
    // Two distinct points in one period means the grain does not fit every value; the lattice
    // would have fewer cells than the cadence says the axis holds, so no claim is made.
    if (span !== a.cadence.expectedPoints) return null;

    const idxOf = new Map<string, { idx: number; stamp: Stamp }>();
    for (const label of distinct) {
        const p = parseTemporalPoint(label, input.pattern, input.locale);
        if (!p) continue;
        const idx = unitsBetween(origin, p, grain, a.stepMs);
        if (idx >= 0 && idx < span) idxOf.set(label, { idx, stamp: p });
    }

    type Acc = { seen: Set<number>; lo: number; hi: number; loStamp: Stamp; hiStamp: Stamp; order: number };
    const bySeries = new Map<string, Acc>();
    for (let i = 0; i < n; i++) {
        const key = series[i];
        if (!key) continue;
        const pt = idxOf.get(periods[i]);
        if (!pt) continue;
        let acc = bySeries.get(key);
        if (!acc) {
            acc = { seen: new Set(), lo: pt.idx, hi: pt.idx, loStamp: pt.stamp, hiStamp: pt.stamp, order: bySeries.size };
            bySeries.set(key, acc);
        }
        acc.seen.add(pt.idx);
        if (pt.idx < acc.lo) { acc.lo = pt.idx; acc.loStamp = pt.stamp; }
        if (pt.idx > acc.hi) { acc.hi = pt.idx; acc.hiStamp = pt.stamp; }
    }
    // One series is the column itself, which the column's cadence already describes.
    if (bySeries.size < 2) return null;

    let cells = 0;
    for (const acc of bySeries.values()) cells += acc.seen.size;
    if (cells / (bySeries.size * span) < (input.minFill ?? SERIES_COMPLETENESS_MIN_FILL)) return null;

    type Shape = { key: string; acc: Acc; coverage: number; before: number; after: number; interior: number; gap: number };
    const incomplete: Shape[] = [];
    const union = new Set<number>();
    let lateStarts = 0, earlyEnds = 0, withHoles = 0, maxBefore = 0, maxAfter = 0, widest = 1;
    for (const [key, acc] of bySeries) {
        for (const i of acc.seen) union.add(i);
        if (acc.seen.size >= span) continue;
        // The widest step between consecutive observations, as the cadence measures its own.
        const idx = [...acc.seen].sort((x, y) => x - y);
        let gap = 1;
        for (let k = 1; k < idx.length; k++) gap = Math.max(gap, idx[k] - idx[k - 1]);
        const s: Shape = {
            key, acc, coverage: acc.seen.size / span,
            before: acc.lo, after: span - 1 - acc.hi, interior: (acc.hi - acc.lo + 1) - acc.seen.size, gap,
        };
        incomplete.push(s);
        if (s.before > 0) lateStarts++;
        if (s.after > 0) earlyEnds++;
        if (s.interior > 0) withHoles++;
        maxBefore = Math.max(maxBefore, s.before);
        maxAfter = Math.max(maxAfter, s.after);
        widest = Math.max(widest, gap);
    }
    if (incomplete.length === 0) return null;

    // Least covered first; a tie keeps the order the series first appear in the rows, which is
    // deterministic and says nothing about any value.
    incomplete.sort((x, y) => x.coverage - y.coverage || x.acc.order - y.acc.order);
    const listed = incomplete.slice(0, input.maxListed ?? SERIES_COMPLETENESS_MAX_LISTED);

    return {
        seriesColumn: input.seriesColumn,
        grain,
        periods: span,
        seriesCount: bySeries.size,
        incompleteSeries: incomplete.length,
        lateStarts,
        earlyEnds,
        withHoles,
        columnWideMissing: span - union.size,
        maxMissingBefore: maxBefore,
        maxMissingAfter: maxAfter,
        largestGap: widest,
        series: listed.map(s => {
            // Built in wire order: name, first, last, then the counts. A withheld part is left
            // off entirely rather than sent empty.
            const out = {} as SeriesCoverage;
            if (input.includeNames) out.name = s.key;
            if (input.includeDates) {
                out.first = periodStart(s.acc.loStamp, grain);
                out.last = periodStart(s.acc.hiStamp, grain);
            }
            out.missingBefore = s.before;
            out.missingAfter = s.after;
            out.missingInterior = s.interior;
            out.largestGap = s.gap;
            out.coverage = Math.round(s.coverage * 1000) / 1000;
            return out;
        }),
        more: incomplete.length - listed.length,
    };
}
