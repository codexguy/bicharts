/*
    SPDX-License-Identifier: Apache-2.0
    Copyright 2026 CodeX Enterprises LLC.

    This file carried the closed-source header from the repository it was extracted
    from. That header is void here: this package is Apache-2.0 (see LICENSE), and a
    per-file reservation of rights inside an Apache-2.0 distribution would be a
    contradiction a reader is entitled to resolve against us.
*/

"use strict";

import { LLMColumnWithValue } from "./models";
import { detectOrdinalDomain, safeDistinctValuesToShip, isOrdinalFriendlyName } from "./ordinalDetector";
import { detectGeo } from "./geoDetector";
import { summarizeCountryRegionsWeighted, summarizeGeoExtent, countryRegion } from "./geoExtent";

import { detectFormatSignature } from "./formatDetector";
import { monthLookupFor, normalizeMonthKey } from "./monthNames";
import Papa from 'papaparse';
import { STR, GET_RANDOM, SIMPLE_STRING_HASH } from "./util";

// ============================================================================
// ValueNature classification (Continuous / Ordinal / Categorical)
// ----------------------------------------------------------------------------
// Ground-up rewrite (2026-06-01). The prior heuristic scored continuity
// from range-DENSITY (distinctCount / value-span) + a heavy isMeasure weight.
// Density measures CONSECUTIVENESS (are the integers packed together?), which
// is ORTHOGONAL to continuity: a wide-range measured quantity (AnnualIncome,
// $12K–$240K) is sparse → it was scored NON-continuous and fell to Categorical,
// so a density-contour request (needs 2 continuous axes) was silently
// disqualified even though income is the most continuous field in the data.
//
// New model — the standard "type → cardinality → semantics" ladder:
//   • CARDINALITY / UNIQUENESS is the backbone. A measured quantity has many,
//     mostly-unique values; a category is a small set of repeated labels.
//   • DENSITY is used ONLY to tell an ordered numeric AXIS (Hour 0-23) from a
//     gappy code in the discrete branch — never as a continuity signal.
//   • ROLE (isMeasure) is a strong signal when PRESENT (the user bound it as a
//     measured value), but its ABSENCE must NOT force categorical.
//   • Semantic NAME hints disambiguate the edges (identifiers → nominal;
//     Hour/Month/Year/Rank → ordinal).
// Ordinal counts as BOTH continuous- and categorical-like downstream
// (ChartFilter.IsContinuousLike / IsCategoricalLike), so an ordered numeric
// still serves line/scatter AND bar/heatmap axes.

// At/below this many distinct values a NON-measure numeric is a discrete set of
// levels/codes, never made continuous by the uniqueness rule (so a 3-value code
// in a tiny sample can't sneak in via a high distinct-ratio).
const DISCRETE_NUMERIC_MAX_DISTINCT = 12;
// A numeric with at least this many distinct values is a measured quantity at
// scale (income, price, score) → Continuous on absolute cardinality alone,
// regardless of how repeated or wide-ranged the values are.
const CONTINUOUS_ABS_DISTINCT = 100;
// …or Continuous when at least this fraction of non-blank rows are distinct
// (values are mostly unique → a measurement, not a repeating label).
const CONTINUOUS_DISTINCT_RATIO = 0.30;
// Consecutiveness (distinct / value-span) at/above this = densely consecutive
// integers → eligible to be an ORDINAL axis (Hour 0-23), vs a gappy code set.
const CONTIGUOUS_DENSITY = 0.9;
// An ordinal-NAMED numeric is treated as an ordered axis only up to this many
// distinct values (beyond it, it's a continuous measure, not an axis).
const ORDINAL_AXIS_MAX_DISTINCT = 120;
// Value-range tells for ordinal axes without a name hint: calendar years, and
// a small 0..N level scale.
const ORDINAL_YEAR_MIN = 1900;
const ORDINAL_YEAR_MAX = 2100;
const ORDINAL_SMALL_MIN = 0;
const ORDINAL_SMALL_MAX = 20;

// Identifier name tokens — a numeric whose name's LAST token is one of these is
// NOMINAL even when unique (LoanID, StoreId, Zip, ProductCode). Conservative on
// purpose: false-flagging a real measure as an identifier (→ Categorical) is
// worse than missing one, so only unambiguous identifier tokens are listed.
const IDENTIFIER_NAME_TOKENS: Set<string> = new Set([
    "id", "ids", "uuid", "guid", "key",
    "zip", "zipcode", "postal", "postalcode", "ssn",
    "code", "codes", "sku", "isbn", "msisdn", "imei",
]);

export function isIdentifierName(name: string): boolean {
    if (!name) return false;
    const tokens = name
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")   // camelCase → words
        .replace(/[_\-./]+/g, " ")                 // separators → space
        .toLowerCase()
        .split(/\s+/)
        .filter(t => t.length > 0);
    if (tokens.length === 0) return false;
    return IDENTIFIER_NAME_TOKENS.has(tokens[tokens.length - 1]);
}

export type ValueNature = "Continuous" | "Ordinal" | "Categorical";

// Temporal-axis detection (2026-06-05). Runs on the ACTUAL cell values, so
// it catches temporal axes the server's summary model can't see — a year-as-
// integer, or PERIOD STRINGS like "2024-Q1" / "2024-01" / "Jan 2024". Ships only
// a boolean (isTemporal); never the raw values. The server's ChartFilter temporal
// gates (HasDate / NeedsTimeProgression) trust this flag first. Conservative on
// the year-integer branch (real values in a plausible calendar range) so a
// non-time integer can't masquerade as a time axis.
const TEMPORAL_YEAR_NAME = /\b(year|yr|fy|fiscal\s*year|calendar\s*year)\b/i;
// 2024 | 2024-Q1 | 2024Q1 | Q1-2024 | 2024-01 | 2024-1 | 202401 | 2024-W12 |
// Jan 2024 | January-2024  (case-insensitive)
const TEMPORAL_PERIOD_RE =
    /^(?:(?:19|20)\d{2}(?:[-/ ]?(?:q[1-4]|w(?:0?[1-9]|[1-4]\d|5[0-3])|(?:0?[1-9]|1[0-2])))?|q[1-4][-/ ](?:19|20)\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-/ ]?(?:19|20)?\d{2})$/i;

// YYYYMM (202406) / YYYYMMDD (20260615) integer period keys — a time axis that evades
// every name-based signal (2026-07-17 — a production dataset whose period column held 202606..202608).
// Verified by VALUE PATTERN, name-agnostic; matches the server's own period-key test.
function isYyyymm(v: number): boolean {
    if (!Number.isInteger(v) || v < 190001 || v > 210012) return false;
    const mm = v % 100; return mm >= 1 && mm <= 12;
}
function isYyyymmdd(v: number): boolean {
    if (!Number.isInteger(v) || v < 19000101 || v > 21001231) return false;
    const mm = Math.floor(v / 100) % 100, dd = v % 100;
    return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
}

// FULL CALENDAR DATES STORED AS TEXT (2026-08-19). A CSV import, a text-typed model column, a
// locale the host did not recognise - the date arrives as a String and every value-level
// temporal signal above misses it, because TEMPORAL_PERIOD_RE wants a PERIOD (a year, a
// quarter, a month) and these are DAYS. Genesis: a real user's project schedule with four
// date columns as text - nothing saw a date, every time chart was ineligible, and the user
// got a network diagram whose nodes were dates.
//
// Two questions are answered here, and they are different:
//   (1) IS it a date?  - a value is a full date when it has three numeric fields that fit
//       year / month / day in one of the shapes below, with a FOUR-digit year. Two-digit
//       years are not accepted: "12/05/24" has too many readings to call a date safely.
//   (2) HOW is it read? - ISO (year first) is unambiguous. For "a/b/yyyy" the ORDER is decided
//       by the values when any value can decide it (a first field over 12 is a day, a second
//       field over 12 is a month), and by the host locale otherwise - en-US reads month
//       first, the rest of the world day first. A column can be a date (answer 1) whose order
//       stays undecided by its values (answer 2); the locale breaks that tie, because that is
//       what a human reading the same column would do.
//
// The result is a strptime / d3.timeParse specifier ("%d/%m/%Y") rather than an enum, because
// that one vocabulary is read verbatim by d3.timeParse AND by Python's strptime and pandas
// to_datetime - one field, every renderer. A pattern is opaque to every source value, so it
// ships at every privacy tier.
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?Z?)?$/;
const YMD_SLASH_RE = /^(\d{4})([\/.])(\d{1,2})\2(\d{1,2})$/;
const DMY_OR_MDY_RE = /^(\d{1,2})([\/.\-])(\d{1,2})\2(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

function monthFirstLocale(locale?: string): boolean {
    // The month-first convention is, in practice, the United States (and a few of its
    // neighbours that follow its forms). Everything else - including en-GB, en-AU, en-IN,
    // every es-*, every de-*, fr-*, pt-* - reads day first. A missing locale is read as
    // day first because most of the world is.
    const l = (locale || "").toLowerCase();
    return l === "en-us" || l === "en" || l.startsWith("en-us-") || l === "en-ph" || l === "en-bz";
}

export interface TextDateDetection {
    /** strptime / d3.timeParse specifier, e.g. "%d/%m/%Y". */
    pattern: string;
    /** How the day/month order was settled: by a value that decided it, or by the locale. */
    orderFrom: "iso" | "values" | "locale";
}

// Examines the distinct values of one column. Returns null unless at least 80% of the
// sampled values are full dates that agree on ONE shape (the same separator, the same
// field order), mirroring the period branch's 80% floor so a stray "TBD" does not sink a
// real date column and a mostly-free-text column cannot sneak in on a few dates.
export function detectTextDatePattern(values: Iterable<string>, locale?: string): TextDateDetection | null {
    let n = 0;
    let iso = 0, isoWithTime = 0, isoWithSeconds = 0;
    let ymd = 0; let ymdSep = "";
    let dmyOrMdy = 0; let dmSep = ""; let dmWithTime = 0; let dmWithSeconds = 0;
    let firstOver12 = 0, secondOver12 = 0;   // evidence for the a/b/yyyy order
    let shapeConflict = false;

    for (const raw of values) {
        if (raw == null) continue;
        const s = String(raw).trim();
        if (s === "") continue;
        n++;
        let m: RegExpExecArray | null;
        if ((m = ISO_DATE_RE.exec(s))) {
            const mo = +m[2], d = +m[3];
            if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
                iso++;
                if (m[4] !== undefined) isoWithTime++;
                if (m[6] !== undefined) isoWithSeconds++;
            }
        } else if ((m = YMD_SLASH_RE.exec(s))) {
            const mo = +m[3], d = +m[4];
            if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
                if (ymdSep && ymdSep !== m[2]) shapeConflict = true;
                ymdSep = m[2];
                ymd++;
            }
        } else if ((m = DMY_OR_MDY_RE.exec(s))) {
            const a = +m[1], b = +m[3];
            // Both fields must be plausible as SOME day/month reading, or it is not a date.
            if (a >= 1 && a <= 31 && b >= 1 && b <= 31 && (a <= 12 || b <= 12)) {
                if (dmSep && dmSep !== m[2]) shapeConflict = true;
                dmSep = m[2];
                dmyOrMdy++;
                if (a > 12) firstOver12++;
                if (b > 12) secondOver12++;
                if (m[5] !== undefined) dmWithTime++;
                if (m[7] !== undefined) dmWithSeconds++;
            }
        }
        if (n >= 200) break;   // a long column has told us what it is well before this
    }
    if (n < 2) return null;
    const hits = iso + ymd + dmyOrMdy;
    if (hits / n < 0.8) return null;
    // The column must agree on ONE shape: mixed ISO and slash dates are two columns' worth
    // of formats in one, and a single pattern would misparse one of them silently.
    const shapes = (iso > 0 ? 1 : 0) + (ymd > 0 ? 1 : 0) + (dmyOrMdy > 0 ? 1 : 0);
    if (shapes !== 1 || shapeConflict) return null;

    if (iso > 0) {
        // Time-of-day is part of the pattern only when EVERY dated value carries it; a
        // mixed column is read to the day, which every value supports.
        if (isoWithTime === iso) {
            return { pattern: isoWithSeconds === iso ? "%Y-%m-%dT%H:%M:%S" : "%Y-%m-%dT%H:%M", orderFrom: "iso" };
        }
        return { pattern: "%Y-%m-%d", orderFrom: "iso" };
    }
    if (ymd > 0) {
        return { pattern: `%Y${ymdSep}%m${ymdSep}%d`, orderFrom: "iso" };
    }
    // a/b/yyyy - settle the order. Values decide when they can; both directions claiming
    // is a column that is not one consistent date shape at all.
    if (firstOver12 > 0 && secondOver12 > 0) return null;
    let dayFirst: boolean;
    let orderFrom: TextDateDetection["orderFrom"];
    if (firstOver12 > 0) { dayFirst = true; orderFrom = "values"; }
    else if (secondOver12 > 0) { dayFirst = false; orderFrom = "values"; }
    else { dayFirst = !monthFirstLocale(locale); orderFrom = "locale"; }
    const date = dayFirst ? `%d${dmSep}%m${dmSep}%Y` : `%m${dmSep}%d${dmSep}%Y`;
    if (dmWithTime === dmyOrMdy) {
        return { pattern: date + (dmWithSeconds === dmyOrMdy ? " %H:%M:%S" : " %H:%M"), orderFrom };
    }
    return { pattern: date, orderFrom };
}

// A localized "<month> <year>" / "<year> <month>" period, using the SAME Intl month
// lookup the unshredder uses (Spanish "Ene 2024", German "Januar-2024", Polish "Luty 2024").
// The numeric TEMPORAL_PERIOD_RE already covers English + all-numeric forms.
function looksLikeLocalizedMonthPeriod(s: string, monthMap: Record<string, number> | null): boolean {
    if (!monthMap) return false;
    if (!/\b(?:19|20)\d{2}\b/.test(s)) return false;            // must carry a plausible year
    const rest = s.replace(/\b(?:19|20)\d{2}\b/g, "").replace(/[-/.,]/g, " ").trim();
    if (!rest) return false;
    const key = normalizeMonthKey(rest);
    return key.length > 0 && monthMap[key] !== undefined;
}

export function classifyTemporal(args: {
    dataType: string; name: string; isMeasure: boolean; distinctCount: number;
    minNum?: number | null; maxNum?: number | null; sampleValues?: Iterable<string>;
    locale?: string;
}): boolean {
    const { dataType, name, isMeasure, distinctCount } = args;
    if (dataType === "DateTime") return true;
    if (isMeasure) return false;
    if (dataType === "Integer" || dataType === "Decimal") {
        const lo = args.minNum, hi = args.maxNum;
        const bothInt = lo != null && hi != null && Number.isFinite(lo) && Number.isFinite(hi)
            && Number.isInteger(lo) && Number.isInteger(hi) && hi >= lo;
        if (!bothInt) return false;

        // Year-as-integer within a plausible calendar window: a year-ish NAME (any language's
        // gate is weak, so ALSO...) OR a FULLY-CONSECUTIVE fill (distinct == span+1) which is a
        // year dimension whatever it's called — a real measure almost never occupies every
        // integer in its range. Name-independent path catches 'Jahr' / 'Año' / unnamed years.
        const inYearRange = lo >= 1900 && hi <= 2100;
        if (inYearRange && distinctCount >= 2 && TEMPORAL_YEAR_NAME.test(name)) return true;
        if (inYearRange && distinctCount >= 3 && distinctCount === (hi - lo + 1)) return true;

        // Integer PERIOD KEYS: endpoints fit YYYYMM or YYYYMMDD, and (when we have the actual
        // cells) EVERY sampled value fits the same pattern — so a plain integer range that merely
        // overlaps the key window can't masquerade as one.
        const endpointsYyyymm = isYyyymm(lo) && isYyyymm(hi);
        const endpointsYyyymmdd = isYyyymmdd(lo) && isYyyymmdd(hi);
        if (endpointsYyyymm || endpointsYyyymmdd) {
            if (!args.sampleValues) return true;   // no cells to verify → trust the endpoints (server parity)
            let n = 0, ok = 0;
            for (const v of args.sampleValues) {
                if (v == null || v === "") continue;
                n++;
                const num = Number(String(v).trim());
                if (Number.isFinite(num) && (endpointsYyyymm ? isYyyymm(num) : isYyyymmdd(num))) ok++;
                if (n >= 60) break;
            }
            if (n >= 2 && ok === n) return true;
        }
        return false;
    }
    // String / categorical: most distinct values look like calendar periods — numeric forms
    // (2024-Q1, 2024-01, 202401, Jan 2024) OR localized month-name periods for the report locale.
    if (args.sampleValues) {
        const monthMap = args.locale ? monthLookupFor(args.locale) : null;
        let n = 0, hit = 0;
        const seen: string[] = [];
        for (const v of args.sampleValues) {
            if (v == null || v === "") continue;
            n++;
            const s = String(v).trim();
            seen.push(s);
            if (TEMPORAL_PERIOD_RE.test(s) || looksLikeLocalizedMonthPeriod(s, monthMap)) hit++;
            if (n >= 60) break;
        }
        if (n >= 2 && hit / n >= 0.8) return true;
        // FULL DATES AS TEXT (2026-08-19) - "2024-03-15", "15/03/2024". The period regex is
        // for periods; a day-level date stored as a string is a time axis too, and the
        // commonest way a real date arrives untyped. Same 80% floor, same sample.
        if (detectTextDatePattern(seen, args.locale) !== null) return true;
    }
    return false;
}

export type Additivity = "additive" | "part_of_whole" | "intensive_rate" | "unknown";

// Parse the host's chosen aggregation out of the DELIVERED measure name. When a
// column is dropped into the Values well, Power BI applies a default summarize
// and prefixes the name ("Sum of Revenue", "Average of Margin", "Count of Id").
// That prefix is the author/host's aggregation DECISION surfaced in the name —
// a real signal, not a semantic guess. Explicit DAX measures arrive WITHOUT a
// prefix (already scalar) → returns null and the caller heuristic takes over.
export function hostAggHint(name: string): "sum" | "avg" | "count" | "min" | "max" | null {
    const n = (name || "").trim().toLowerCase();
    if (n.startsWith("sum ") || n.startsWith("total ")) return "sum";
    if (n.startsWith("average ") || n.startsWith("avg. ")) return "avg";
    if (n.startsWith("count ") || n.startsWith("distinct count ") || n.startsWith("count (distinct) ")) return "count";
    if (n.startsWith("min ") || n.startsWith("minimum ")) return "min";
    if (n.startsWith("max ") || n.startsWith("maximum ")) return "max";
    return null;
}

// Classify a MEASURE column's additivity from the REAL data + the host's
// aggregation hint. Pure (rows + indices in, enum out). The part_of_whole test
// is GROUND TRUTH: a share/% of total is exactly a measure whose parts sum to a
// CONSTANT whole (1 or 100) under grouping — additive measures sum to group
// totals that VARY with group size, independent rates sum to neither. The
// additive-vs-intensive split is best-effort (host agg hint primary, range
// fallback). Conservative on partial loads: the constant-whole test simply
// fails to confirm (→ falls to additive/intensive), it does not false-confirm,
// so no hard load-complete gate is needed here.
export function classifyAdditivity(args: {
    rows: any[];
    measureColIdx: number;
    measureName: string;
    // Non-measure columns (potential series / partition dimensions).
    candidateDims: { idx: number; distinct: number; name: string }[];
    minNum: number | null;
    maxNum: number | null;
    // Host metadata: DataViewMetadataColumn.discourageAggregationAcrossGroups —
    // the model marked this measure non-summable (a ratio / average / model
    // measure). Authoritative intensive signal; checked AFTER the part-of-whole
    // data test (a share is discourageAgg too but DOES stack to 100%), BEFORE the
    // name-prefix heuristic. Closes the explicit-DAX-measure gap that otherwise
    // ships as "unknown".
    discourageAgg?: boolean;
}): { additivity: Additivity; partOfWholeDim?: string } {
    const { rows, measureColIdx, measureName, candidateDims, minNum, maxNum, discourageAgg } = args;

    // --- part_of_whole test (ground truth) ---
    // For each candidate series dim C, group rows by ALL OTHER non-measure dims
    // and sum the measure across C within each group. If those per-group sums
    // cluster on a constant whole (100 or 1) across >=90% of multi-C-level
    // groups, the measure is a part-of-whole partitioned by C.
    const SERIES_CARD_CAP = 100;   // C must look like a series, not an ID
    const TOL_FRAC = 0.01;         // within 1% of the whole
    const SEP = "";
    for (const c of candidateDims) {
        if (c.distinct < 2 || c.distinct > SERIES_CARD_CAP) continue;
        const otherDims = candidateDims.filter(d => d.idx !== c.idx).map(d => d.idx);
        const groups = new Map<string, { sum: number; cset: Set<string> }>();
        for (const row of rows) {
            const mv = row[measureColIdx];
            if (typeof mv !== "number" || !Number.isFinite(mv)) continue;
            const key = otherDims.length ? otherDims.map(di => String(row[di])).join(SEP) : "";
            let g = groups.get(key);
            if (!g) { g = { sum: 0, cset: new Set<string>() }; groups.set(key, g); }
            g.sum += mv;
            g.cset.add(String(row[c.idx]));
        }
        let n100 = 0, n1 = 0, tot = 0;
        for (const g of groups.values()) {
            if (g.cset.size < 2) continue;   // need multiple C-levels to be a "whole"
            tot++;
            if (Math.abs(g.sum - 100) <= 100 * TOL_FRAC) n100++;
            else if (Math.abs(g.sum - 1) <= 1 * TOL_FRAC) n1++;
        }
        if (tot >= 2) {
            if (n100 / tot >= 0.9 || n1 / tot >= 0.9) {
                return { additivity: "part_of_whole", partOfWholeDim: c.name };
            }
        }
    }

    // Host metadata says don't aggregate this across groups (ratio / average /
    // non-summable model measure) AND it isn't a part-of-whole share → intensive.
    if (discourageAgg) return { additivity: "intensive_rate" };

    // --- additive vs intensive_rate (proxy) ---
    const agg = hostAggHint(measureName);
    // avg/min/max are a DELIBERATE aggregation choice → real evidence the quantity is
    // intensive. Assert it.
    if (agg === "avg" || agg === "min" || agg === "max") return { additivity: "intensive_rate" };
    // sum/count are NOT evidence: Power BI applies Sum BY DEFAULT to every numeric column
    // dropped in a measure well, so "Sum of LatencyMs" tells us what the host did, not what
    // the quantity is. Asserting "additive" here made a default outrank the one real signal
    // about the quantity — its NAME — because the server trusts a client flag over its own
    // name test (LLMLog 48991: latency stayed stackable, so Streamgraph ranked #1 on a
    // measure nobody would ever total). Return "unknown" and let the server decide: it owns
    // the intensive-name list, so there is no second copy here to drift out of sync, and its
    // fallback still lands on Additive for the ordinary "Sum of Revenue" case — identical
    // behaviour everywhere except where the name says otherwise. (2026-08-08)
    if (agg === "count") return { additivity: "additive" };   // COUNT of rows is additive by construction
    if (agg === "sum") return { additivity: "unknown" };
    // Bare DAX measure (no host prefix): a value range pinned to [0,1] is almost
    // certainly a rate/proportion → intensive. OTHERWISE we are NOT confident
    // additive-vs-intensive from data alone (a 0-100 column could be a count OR a
    // percentage), so return "unknown" and let the SERVER decide via its name
    // regex. That keeps the genesis backstop intact — e.g. a bare "UptimePct"
    // (0-100, no agg prefix) stays unknown here so the server's regex flags it
    // intensive, instead of us wrongly asserting "additive" and letting it be
    // summed/stacked.
    if (minNum != null && maxNum != null && Number.isFinite(minNum) && Number.isFinite(maxNum)
        && minNum >= 0 && maxNum <= 1.0001 && maxNum > 0) {
        return { additivity: "intensive_rate" };
    }
    return { additivity: "unknown" };
}

// Classify ONE numeric (Integer/Decimal) column. `distinct` is the count of
// distinct NON-BLANK values; `nonblank` the count of non-blank rows; `prec` the
// max decimal precision seen; `minval`/`maxval` the numeric extent. Pure.
export function classifyNumericValueNature(i: {
    dataType: string; isMeasure: boolean; name: string;
    distinct: number; nonblank: number; prec: number;
    maxval: number; minval: number;
}): ValueNature {
    const { dataType, isMeasure, name, distinct, nonblank, prec, maxval, minval } = i;
    const span = maxval - minval + 1;
    const density = span > 0 ? distinct / span : 1;        // consecutiveness (axis-vs-code only)
    const ratio = nonblank > 0 ? distinct / nonblank : 0;  // uniqueness (continuity backbone)
    const fractional = dataType === "Decimal" || prec > 0;

    // (a) Identifiers are NOMINAL regardless of cardinality or role.
    if (isIdentifierName(name)) return "Categorical";

    // (b) Ordered numeric AXIS: an ordinal-friendly name at axis scale, or a
    //     value range that reads as calendar years / a small 0..N level scale,
    //     when the integers are densely consecutive. Only ever yields Ordinal
    //     (continuous-like downstream), so it can't demote a real measure.
    if (density >= CONTIGUOUS_DENSITY) {
        if (isOrdinalFriendlyName(name) && distinct <= ORDINAL_AXIS_MAX_DISTINCT) return "Ordinal";
        if (minval >= ORDINAL_YEAR_MIN && maxval <= ORDINAL_YEAR_MAX) return "Ordinal";
        if (minval >= ORDINAL_SMALL_MIN && maxval <= ORDINAL_SMALL_MAX) return "Ordinal";
    }

    // (c) A bound MEASURE is a measured quantity → Continuous. Role is a strong
    //     signal when PRESENT; its absence must NOT force categorical.
    if (isMeasure) return "Continuous";

    // (d) NON-measure numeric → classify by DATA SHAPE (never range-density):
    //     more than a handful of distinct values AND (fractional, OR large in
    //     absolute count, OR mostly-unique) → a measured quantity.
    if (distinct > DISCRETE_NUMERIC_MAX_DISTINCT
        && (fractional || distinct >= CONTINUOUS_ABS_DISTINCT || ratio >= CONTINUOUS_DISTINCT_RATIO)) {
        return "Continuous";
    }
    // Otherwise a small / heavily-repeated set of numeric codes → discrete nominal.
    return "Categorical";
}

export interface IValueCollection {
    addRow(colvals: any[], originalIdx?: number): boolean;
    setColumns(cols: LLMColumnWithValue[]): void;
    reset(): void;
    getRowCount(): number;
    getLeafCardinality(): number;
    getGeoExtent(): { pctUsa: number, pctNa: number, latP5: number, latP95: number,
                      lonP5: number, lonP95: number, n: number } | null;
    getCSVAsync(forSample: boolean): Promise<string>;
    getCSVHeaderLine(): string;
    getColumnsWithStats(privacyLevel: string, locale?: string): LLMColumnWithValue[];
    getColumns(): LLMColumnWithValue[];
    toObjectArray(): Record<string, any>[];
    // Returns the original dataView.table row index for the i-th accumulated row,
    // or -1 if no original index was supplied. Used to build per-row Power BI
    // SelectionIds for cross-filter / drill-through on interactive renderers.
    getOriginalRowIndex(i: number): number;
}

export class IndexedText implements IValueCollection {
    private _computedStatsForLevel: string = null;
    private _cols: LLMColumnWithValue[] = [];
    private _rows: any[][] = [];
    private _origIndices: number[] = [];
    private _rowHashes: Set<number> = new Set<number>();

    /**
     * Collapse value-identical rows on addRow. DEFAULT TRUE — the long-standing behaviour,
     * and the right one for shape measurement. See addRow for when to turn it off.
     *
     * A public field rather than a constructor argument so it stays additive: existing
     * callers construct IndexedText with no arguments and are unaffected.
     */
    public dedupRows: boolean = true;

    private STR(v: any): string {
        if (v === null || v === undefined) {
            return "";
        }
        return v.toString();
    }

    private getPrecision(value: number): number {
        if (!isFinite(value)) return 0;
        const valueStr = value.toString();
        const decimalPart = valueStr.split('.')[1];
        return decimalPart ? decimalPart.length : 0;
    }

    public getColumns(): LLMColumnWithValue[] {
        return this._cols;
    }

    private hasTimeComponent(date: any): boolean {
        if (!(date instanceof Date) || isNaN(date.getTime())) {
            return false;
        }
        return (
            date.getHours() !== 0 ||
            date.getMinutes() !== 0 ||
            date.getSeconds() !== 0 ||
            date.getMilliseconds() !== 0
        );
    }

    public getColumnsWithStats(privacyLevel: string, locale?: string): LLMColumnWithValue[] {
        if (this._computedStatsForLevel == privacyLevel) {
            return this._cols;
        }
        // `locale` (host.locale) is stable per session, so it isn't part of the cache key —
        // it only steers classifyTemporal's localized month-name matching below.

        // Compute stats based on the privacy level
        let cidx = 0;
        const pl = parseInt(privacyLevel);
        // Per-column distinct value-sets, captured during the loop for the
        // cross-column overlap pass below (null for measures / high-cardinality).
        const colValueSets: (Set<string> | null)[] = [];
        for (const col of this._cols) {
            const vals = new Map<string, number>();
            const arr: any[] = [];
            let datalen = 0;
            let nonblank = 0;
            let prec = 0;
            let minval: any = null;
            let maxval: any = null;
            let sumval: number = null;
            let hastime = false;
            // Sorted-direction tracking (Tier 1 shape signal, 2026-05-21).
            // Walk consecutive non-blank values across raw row order. Both
            // monoAsc and monoDesc start true; the first counter-evidence
            // for each flips it false. After the scan: both true (all
            // equal) → "none"; only monoAsc → "asc"; only monoDesc → "desc";
            // both false → "none". String comparisons use < / > naturally.
            let monoAsc = true;
            let monoDesc = true;
            let prevForOrder: any = null;
            let sawPrev = false;
            for (const row of this._rows) {
                const val = row[cidx];
                const strVal = this.STR(val);
                if (strVal != "") {
                    datalen += strVal.length;
                    vals.set(strVal, (vals.get(strVal) || 0) + 1);
                    nonblank++;
                    if (col.dataType == "Integer" || col.dataType == "Decimal" || col.dataType == "DateTime") {
                        if (minval === null || val < minval) {
                            minval = val;
                        }
                        if (maxval === null || val > maxval) {
                            maxval = val;
                        }
                        if (col.dataType == "Integer" || col.dataType == "Decimal") {
                            if (sumval === null) {
                                sumval = val;
                            } else {
                                sumval += val;
                            }
                            if (col.dataType == "Decimal") {
                                const dp = this.getPrecision(val);
                                if (dp > prec) {
                                    prec = dp;
                                }
                            }
                            arr.push(val);
                        } else {
                            hastime = hastime || this.hasTimeComponent(val);
                        }
                    }
                    // Order tracking — uses raw `val` comparison (works for
                    // numbers, strings, and DateTime). Equal-to-prev is
                    // neutral (keeps both flags alive).
                    if (sawPrev) {
                        if (val < prevForOrder) monoAsc = false;
                        else if (val > prevForOrder) monoDesc = false;
                    }
                    prevForOrder = val;
                    sawPrev = true;
                }
            }
            // Resolve sortedDirection. Skip the assignment when fewer than
            // 3 non-blank rows — the signal is too weak to be meaningful.
            if (nonblank >= 3) {
                if (monoAsc && !monoDesc) col.sortedDirection = "asc";
                else if (monoDesc && !monoAsc) col.sortedDirection = "desc";
                else col.sortedDirection = "none";
            }
            // Modal share — fraction of non-blank rows in the most-common
            // categorical value. Detects dominance patterns. Only meaningful
            // when there ARE categories (non-measure, distinct < total).
            if (nonblank > 0 && vals.size > 0 && !col.isMeasure) {
                let topCount = 0; let minCount = Number.MAX_SAFE_INTEGER;
                for (const v of vals.values()) {
                    if (v > topCount) topCount = v;
                    if (v < minCount) minCount = v;
                }
                col.modalShare = topCount / nonblank;
                // smallest value's row count: the sparsest group a single-categorical
                // box/violin split would draw (pairs use minCellCount). 2026-06-20
                col.minGroupCount = minCount === Number.MAX_SAFE_INTEGER ? null : minCount;
                // BINARY-OUTCOME FLAG (2026-06-20): a 2-value boolean-ish categorical
                // (true/false, yes/no, 0/1) — or a 2-value column with an outcome NAME.
                // Lets the server KNOW the column is a binary OUTCOME so it can refuse
                // the circular pattern (split/facet by it AND colour by a rate OF it →
                // within-cell rate is 100%/0%; the 1978/2012 default-rate heatmap bug).
                if (vals.size === 2) {
                    const ks = [...vals.keys()].map(k => STR(k).trim().toLowerCase()).sort();
                    const boolPairs = [["false", "true"], ["no", "yes"], ["n", "y"], ["0", "1"], ["f", "t"]];
                    const valuesBoolean = boolPairs.some(p => ks[0] === p[0] && ks[1] === p[1]);
                    const nameOutcome = /^(is|has)[_a-z0-9]|(?:default|churn|fraud|approv|convert|active|cancel|delinquen|flag|paid|win|pass|fail)/i.test(col.name);
                    if (valuesBoolean || nameOutcome) col.isBinaryFlag = true;
                }
            }
            if (col.dataType == "DateTime") {
                col.dateWithTime = hastime;
            }
            // Temporal-axis flag from the ACTUAL values (year-int / period strings /
            // DateTime). Ships a boolean only; vals holds the distinct value labels.
            col.isTemporal = classifyTemporal({
                dataType: col.dataType, name: col.name, isMeasure: col.isMeasure,
                distinctCount: vals.size,
                minNum: typeof minval === "number" ? minval : null,
                maxNum: typeof maxval === "number" ? maxval : null,
                sampleValues: vals.keys(),
                locale,
            });
            // A DATE STORED AS TEXT carries its reading (2026-08-19): the flag says "time
            // axis", the pattern says how to parse it. String columns only - a DateTime needs
            // no pattern, and a measure is never a date. UNGATED: a strptime specifier is
            // opaque to every source value, so it ships at every privacy tier - which is the
            // whole point, because the generation that motivated this ran at the strictest
            // one, where not a single value reaches the server. See models.ts.
            if (col.isTemporal && col.dataType === "String" && !col.isMeasure) {
                const det = detectTextDatePattern(vals.keys(), locale);
                if (det) col.temporalTextPattern = det.pattern;
            }
            this.updateColumnStats10(pl, col, nonblank, vals, prec, maxval, minval);
            this.updateColumnStats20(pl, arr, nonblank, sumval, col, datalen, hastime, minval, maxval, prec, vals, locale);

            // MEASURE INFERENCE (2026-06-27). Users don't always bind numeric quantities
            // to a measures well — they often drag the whole table into one well, so a real
            // measure (Sum of CaloriesBurned) arrives isMeasure=false and the measure-aware
            // passes below (additivity, η², dispersion) — and the server's measure logic —
            // silently skip it (seen in production). Promote a numeric column the classifier
            // calls CONTINUOUS to a measure. Conservative by construction: classifyNumericValueNature
            // returns Ordinal for Year/Day/small level-scales and Categorical for id-like, so only
            // genuine quantities flip. isMeasure is NOT part of the schema hash (name+dataType only),
            // so existing cached charts are undisturbed — this only sharpens NEW generations.
            if (!col.isMeasure && (col.dataType === "Integer" || col.dataType === "Decimal")) {
                const nature = classifyNumericValueNature({
                    dataType: col.dataType, isMeasure: false, name: col.name,
                    distinct: vals.size, nonblank, prec, maxval: typeof maxval === "number" ? maxval : 0, minval: typeof minval === "number" ? minval : 0,
                });
                if (nature === "Continuous") col.isMeasure = true;
            }

            // Capture distinct value-set for the overlap pass (skip measures and
            // very high-cardinality / id-like columns — those never share usefully
            // and the intersection cost is not worth it).
            colValueSets[cidx] = (col.isMeasure || vals.size > 2000) ? null : new Set(vals.keys());

            cidx++;
        }

        // Relational ADDITIVITY pass (2026-06-05). Runs AFTER the per-column loop
        // so every column's isMeasure / distinctCount / numeric extent is known.
        // For each MEASURE column, classify how it aggregates (additive /
        // part_of_whole / intensive_rate) from the REAL rows + the host
        // aggregation hint, and ship the enum (never raw values). Lets the server
        // stop guessing additivity from column NAMES. Bounded, one-time cost:
        // O(measures x dims x rows); skipped when there are no dims to partition by.
        const dimCols: { idx: number; distinct: number; name: string }[] = [];
        this._cols.forEach((c, i) => {
            if (!c.isMeasure) dimCols.push({ idx: i, distinct: c.distinctCount ?? 0, name: c.name });
        });
        this._cols.forEach((c, i) => {
            if (!c.isMeasure) return;
            const lo = typeof c.lowValue === "number" ? c.lowValue : null;
            const hi = typeof c.highValue === "number" ? c.highValue : null;
            const r = classifyAdditivity({
                rows: this._rows,
                measureColIdx: i,
                measureName: c.name,
                candidateDims: dimCols,
                minNum: lo,
                maxNum: hi,
                discourageAgg: !!c.discourageAggregationAcrossGroups,
            });
            c.additivity = r.additivity;
            if (r.partOfWholeDim) c.partOfWholeDim = r.partOfWholeDim;
        });

        // GROUP-DISCRIMINATION pass (2026-06-19). For each MEASURE, ship two pure
        // statistics so the server KNOWS — not guesses — whether a measure carries
        // chartable signal across the available dimensions:
        //   • relativeDispersion = (p90-p10)/|median| over the raw rows. Near 0 ⇒
        //     the measure is effectively CONSTANT (a literal flat column).
        //   • groupDiscrimination[dim].eta2 = SS_between / SS_total (0..1) — the
        //     fraction of the measure's variance EXPLAINED by each low-cardinality
        //     categorical. Near 0 ⇒ that dimension does NOT differentiate the
        //     measure (all group means ~equal), so colouring/faceting/grouping the
        //     measure by it shows no signal (e.g. tip% is identical across meal
        //     periods). The thresholds that turn these numbers into prompt guidance
        //     live SERVER-side (SystemParameter-tunable); the client only emits the
        //     raw ratios. Privacy-safe: ratios + a column name the server already
        //     has, never raw values. Bounded: O(measures × dims × rows), low-card
        //     dims only.
        const DISCRIM_DIM_CAP = 50;   // only dims a viewer could read as groups
        const discrimDims = dimCols.filter(d => d.distinct >= 2 && d.distinct <= DISCRIM_DIM_CAP);
        this._cols.forEach((c, mi) => {
            if (!c.isMeasure) return;
            const xs: number[] = [];
            for (const row of this._rows) {
                const v = row[mi];
                if (v === null || v === undefined || v === "") continue;
                const n = typeof v === "number" ? v : parseFloat(v);
                if (!isNaN(n)) xs.push(n);
            }
            if (xs.length === 0) return;
            const sorted = [...xs].sort((a, b) => a - b);
            const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
            const median = q(0.5), p10 = q(0.10), p90 = q(0.90);
            const denom = Math.abs(median) > 1e-9 ? Math.abs(median)
                : (Math.abs(sorted[sorted.length - 1]) > 1e-9 ? Math.abs(sorted[sorted.length - 1]) : 1);
            c.relativeDispersion = Math.round(((p90 - p10) / denom) * 1000) / 1000;

            let grand = 0; for (const x of xs) grand += x; grand /= xs.length;
            let ssTotal = 0; for (const x of xs) ssTotal += (x - grand) * (x - grand);
            if (ssTotal <= 1e-12) return;   // constant measure: eta² undefined
            const out: { otherColumn: string; eta2: number }[] = [];
            for (const d of discrimDims) {
                const groups = new Map<string, { s: number; n: number }>();
                for (const row of this._rows) {
                    const mv = row[mi];
                    if (mv === null || mv === undefined || mv === "") continue;
                    const n = typeof mv === "number" ? mv : parseFloat(mv);
                    if (isNaN(n)) continue;
                    const key = this.STR(row[d.idx]) + "";
                    const g = groups.get(key);
                    if (g) { g.s += n; g.n++; } else groups.set(key, { s: n, n: 1 });
                }
                let ssBetween = 0;
                for (const g of groups.values()) { const gm = g.s / g.n; ssBetween += g.n * (gm - grand) * (gm - grand); }
                out.push({ otherColumn: d.name, eta2: Math.round((ssBetween / ssTotal) * 10000) / 10000 });
            }
            if (out.length > 0) c.groupDiscrimination = out;
        });

        // MEASURE-INDEPENDENCE pass (Layer C, 2026-06-20). For each PAIR of measures,
        // compute Pearson |r| over the rows where BOTH are present; a pair at/above
        // COLLINEAR_R encodes the SAME axis (Views and 2×Views, a value and its running
        // total). collinearWithMeasures[m] then lists the other measures m is ~collinear
        // with, so the server KNOWS whether two INDEPENDENT continuous axes exist — a
        // correlation chart (scatter/regression/bubble) on collinear-only measures is a
        // trivial diagonal. A STATISTIC (a column name the server already has), never raw
        // values. Bounded O(measures² × rows); measures are few.
        const COLLINEAR_R = 0.97;
        const MIN_CORR_ROWS = 5;
        const measureIdx = this._cols.map((c, i) => ({ c, i })).filter(x => x.c.isMeasure);
        for (let a = 0; a < measureIdx.length; a++) {
            for (let b = a + 1; b < measureIdx.length; b++) {
                const ia = measureIdx[a].i, ib = measureIdx[b].i;
                let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
                for (const row of this._rows) {
                    const va = row[ia], vb = row[ib];
                    if (va === null || va === undefined || va === "" || vb === null || vb === undefined || vb === "") continue;
                    const x = typeof va === "number" ? va : parseFloat(va);
                    const y = typeof vb === "number" ? vb : parseFloat(vb);
                    if (isNaN(x) || isNaN(y)) continue;
                    n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
                }
                if (n < MIN_CORR_ROWS) continue;
                const vx = n * sxx - sx * sx, vy = n * syy - sy * sy;
                if (vx <= 1e-12 || vy <= 1e-12) continue;   // a constant measure — R1 (flat) handles it
                const r = (n * sxy - sx * sy) / Math.sqrt(vx * vy);
                if (Math.abs(r) >= COLLINEAR_R) {
                    const ca = measureIdx[a].c, cb = measureIdx[b].c;
                    if (!ca.collinearWithMeasures) ca.collinearWithMeasures = [];
                    if (!cb.collinearWithMeasures) cb.collinearWithMeasures = [];
                    ca.collinearWithMeasures.push(cb.name);
                    cb.collinearWithMeasures.push(ca.name);
                }
            }
        }

        // VALUE-SET OVERLAP pass (2026-06-07). For each non-measure column, compute —
        // for every OTHER non-measure column — the PERCENT of THIS column's distinct
        // values that ALSO appear in that column. A STATISTIC about values (a percent +
        // the other column's NAME, which the server already has), NEVER the values
        // themselves. Lets the server KNOW, not guess, whether two categorical dims share
        // members (a node that is both a source and a target → bidirectional flow → don't
        // colour nodes by role) or are disjoint (bipartite). Bounded O(dims² × distinct);
        // measures / high-cardinality columns are null in colValueSets and skipped.
        for (let a = 0; a < this._cols.length; a++) {
            const setA = colValueSets[a];
            if (!setA || setA.size === 0) continue;
            const ratios: { otherColumn: string; percentShared: number }[] = [];
            for (let b = 0; b < this._cols.length; b++) {
                if (b === a) continue;
                const setB = colValueSets[b];
                if (!setB || setB.size === 0) continue;
                let shared = 0;
                for (const v of setA) if (setB.has(v)) shared++;
                const pct = Math.round((shared / setA.size) * 100);
                if (pct > 0) ratios.push({ otherColumn: this._cols[b].name, percentShared: pct });
            }
            if (ratios.length > 0) this._cols[a].sharedValueRatioWithOthers = ratios;
        }

        // CATEGORICAL-PAIR FILL pass (2026-06-13). For each pair of LOW-cardinality
        // non-measure columns, count the DISTINCT co-occurring (a,b) value pairs and
        // derive fillPct = distinctPairs / (cardA*cardB) — how densely they fill their
        // value grid — plus a functional-dependency flag (distinctPairs == cardX ⇒ X
        // 1:1-determines the other → the pair collapses to a diagonal). Lets the server
        // steer heatmap/matrix axis selection to an INDEPENDENT dense pair instead of
        // two functionally-dependent categoricals. Privacy-safe: counts + a ratio + a
        // column name the server already has. Bounded: only columns with a value set
        // (non-measure, distinct <= PAIR_CAP), single row-pass over all candidate pairs.
        const PAIR_CAP = 50;   // heatmap-axis readability ceiling; also bounds the grid
        const candIdx: number[] = [];
        for (let i = 0; i < this._cols.length; i++) {
            const s = colValueSets[i];
            if (s && s.size >= 2 && s.size <= PAIR_CAP) candIdx.push(i);
        }
        if (candIdx.length >= 2) {
            // pairKeySets[a][b] (a<b in candIdx order) -> Set of "valA|valB"
            // pairCounts: counting map (was a Set) so we also get per-cell occupancy →
            // minCellCount, the sparsest drawn group when a distribution chart splits by
            // this pair (box/violin on n=4 overstates quartile precision). 2026-06-20
            const pairCounts = new Map<string, Map<string, number>>();
            const pk = (a: number, b: number) => a + ":" + b;
            for (let x = 0; x < candIdx.length; x++)
                for (let y = x + 1; y < candIdx.length; y++)
                    pairCounts.set(pk(candIdx[x], candIdx[y]), new Map<string, number>());
            for (const row of this._rows) {
                for (let x = 0; x < candIdx.length; x++) {
                    const va = this.STR(row[candIdx[x]]) + "";  // sep: guards ("ab","c") vs ("a","bc")
                    for (let y = x + 1; y < candIdx.length; y++) {
                        const vb = String.fromCharCode(1) + this.STR(row[candIdx[y]]);
                        const cm = pairCounts.get(pk(candIdx[x], candIdx[y]))!; const ck = va + "" + vb; cm.set(ck, (cm.get(ck) ?? 0) + 1);
                    }
                }
            }
            // NESTING DIRECTION (2026-06-18): determinesOther is bidirectional and loses
            // direction. When A 1:1-determines a STRICTLY coarser B (cardA > cardB), A is
            // NESTED UNDER B — B is A's parent (Team→Dept: Team child, Dept parent). Record
            // the COARSEST such parent per column so the server can deterministically detect a
            // parent-nested stack / partition (a series that is the parent of the x dimension
            // has no overlap to stack) instead of asking the LLM to spot the 1:1 relationship.
            const parentCand = new Map<number, { name: string; card: number; ratio: number }>();
            for (let x = 0; x < candIdx.length; x++) {
                for (let y = x + 1; y < candIdx.length; y++) {
                    const a = candIdx[x], b = candIdx[y];
                    const cardA = colValueSets[a]!.size, cardB = colValueSets[b]!.size;
                    const cellMap = pairCounts.get(pk(a, b))!; const distinctPairs = cellMap.size; let minCellCount = 0; for (const cval of cellMap.values()) { if (minCellCount === 0 || cval < minCellCount) minCellCount = cval; }
                    const fillPct = Math.round((distinctPairs / (cardA * cardB)) * 100);
                    const aDet = distinctPairs === cardA;   // A 1:1-determines B
                    const bDet = distinctPairs === cardB;   // B 1:1-determines A
                    (this._cols[a].categoricalPairStats ||= []).push(
                        { otherColumn: this._cols[b].name, fillPct, determinesOther: aDet, minCellCount, distinctCombinations: distinctPairs });
                    (this._cols[b].categoricalPairStats ||= []).push(
                        { otherColumn: this._cols[a].name, fillPct, determinesOther: bDet, minCellCount, distinctCombinations: distinctPairs });
                    if (aDet && cardA > cardB) {           // A nested under (strictly coarser) B
                        const cur = parentCand.get(a);
                        if (!cur || cardB < cur.card)
                            parentCand.set(a, { name: this._cols[b].name, card: cardB, ratio: cardB / cardA });
                    }
                    if (bDet && cardB > cardA) {           // B nested under (strictly coarser) A
                        const cur = parentCand.get(b);
                        if (!cur || cardA < cur.card)
                            parentCand.set(b, { name: this._cols[a].name, card: cardA, ratio: cardA / cardB });
                    }
                }
            }
            for (const [i, p] of parentCand) {
                this._cols[i].primaryParentColumn = p.name;
                this._cols[i].nestingRatio = Math.round(p.ratio * 100) / 100;
            }
        }

        this._computedStatsForLevel = privacyLevel;
        return this._cols;
    }

    private updateColumnStats20(pl: number, arr: any[], nonblank: number, sumval: number, col: LLMColumnWithValue, datalen: number, hastime: boolean, minval: any, maxval: any, prec: number, vals: Map<string, number>, locale?: string) {
        if (pl >= 20) {
            const sorted = [...arr].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            if (nonblank > 0 && sumval != null) {
                col.avgValue = col.dataType == "Integer" ? Math.round(sumval / nonblank) : sumval / nonblank;
            } else {
                col.avgValue = null;
            }
            if (nonblank > 0) {
                col.avgLength = datalen / nonblank;
            }
            if (this._rows.length > 0) {
                if (col.dataType != "DateTime" || hastime || !minval) {
                    col.lowValue = minval;
                } else {
                    col.lowValue = new Date(minval).toISOString().slice(0, 10) + "T00:00:00.000Z";
                }
                if (col.dataType != "DateTime" || hastime || !maxval) {
                    col.highValue = maxval;
                } else {
                    col.highValue = new Date(maxval).toISOString().slice(0, 10) + "T00:00:00.000Z";
                }
                col.medianValue = sorted.length === 0 ? null : sorted.length % 2 === 0 ? (col.dataType == "Integer" ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : (sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
                col.numericPrecision = prec;
            }
            if (sorted.length > 0) {
                const mean = col.avgValue ?? 0;
                const n = sorted.length;
                let m2 = 0, m3 = 0;
                for (const v of sorted) {
                    const d = v - mean;
                    m2 += d * d;
                    m3 += d * d * d;
                }
                const variance = m2 / n;
                col.skewness = variance === 0 ? 0 : (m3 / n) / Math.pow(Math.sqrt(variance), 3);
                // Tier 1: surface population stdDev directly so the server
                // can compute σ/μ (coefficient of variation) without
                // re-deriving from min/max/median. R7b narrow-range
                // detection uses this — CV < 0.10 is the cleanest "this
                // measure is essentially flat" signal.
                col.stdDev = Math.sqrt(variance);
            }
            // Tier 1: surface raw sum so the server can pre-compute Top-N
            // share for rule (e) before codegen. Only set when sumval was
            // accumulated (Integer / Decimal columns); ratio/rate columns
            // are still summed here but the server's R8 detector handles
            // the "this sum isn't semantically meaningful" gate.
            if (sumval !== null) {
                col.sum = sumval;
            }
            // Sort by descending count so topCategories (counts) and
            // topCategoryValues (labels) are paired by index for the first
            // K entries. topCategories stays at 10 (DataShapeAdvisor walks
            // up to .Count for its cumulative-share recommendedN compute);
            // topCategoryValues at 5 is enough for semantic-type detection
            // and keeps the wire small.
            const topcatEntries = Array.from(vals.entries()).sort((a, b) => b[1] - a[1]);
            col.topCategories = topcatEntries.slice(0, 10).map(e => e[1]);
            if (!col.isMeasure && topcatEntries.length > 0) {
                // String dataType: derive a format-signature from the raw
                // top values (pre-obfuscation) and ship THAT instead of the
                // values themselves. Replaces the old class-preserving
                // obfuscation approach — the LLM gets the format-class
                // signal (ID-like / Title Case / email / etc.) explicitly
                // named, can't hardcode an obfuscated literal as a runtime
                // filter (image-bug 2026-05-26 closed by construction), and
                // the wire is smaller. See formatDetector.ts for the
                // catalog and threshold.
                //
                // Non-String dataTypes (Boolean / Integer / Decimal /
                // DateTime) ship raw top values — those carry true
                // semantic value (true/false, 0/1, ISO dates) that the
                // LLM needs verbatim and that aren't private.
                if (col.dataType === "String") {
                    // Use ALL distinct values (not just top-5) for the
                    // classifier — a longer sample makes the dominant-
                    // signature decision more robust against stragglers.
                    const allDistinct = topcatEntries.map(e => e[0]);
                    col.formatSignature = detectFormatSignature(allDistinct);
                    // isFreeText (Layer C): the values are WORDS — a word-like format
                    // signature (outside the id/machine/date/boolean set) with a
                    // non-trivial average length (>= 3 chars filters 1-2 char codes a
                    // short-label classifier may label OTHER). Word clouds need words.
                    const nonWordFmt = /^(UUID|EMAIL_LIKE|URL_LIKE|PHONE_LIKE|NUMERIC_ID|HEX_ID|OPAQUE_ID_ALPHANUMERIC|DATE_STR|BOOLEAN)$/;
                    if (col.formatSignature && !nonWordFmt.test(col.formatSignature)
                        && (col.avgLength === undefined || col.avgLength >= 3))
                        col.isFreeText = true;
                    // topCategoryValues intentionally NOT set for Strings.
                } else {
                    col.topCategoryValues = topcatEntries.slice(0, 5).map(e => e[0]);
                }

                // ACTUAL-VALUE shipping is gated to privacy level >= 20
                // ("+Include Column Detailed Stats"). Below that the user has
                // opted out of sharing column data, so we ship NO actual
                // values — only names + counts (2026-05-31). This covers
                // BOTH the ordinal order-signal (Tier A) and the safe
                // short-code values (Tier B); both run BEFORE obfuscation so
                // they see the RAW strings.
                if (pl >= 20) {
                    const allDistinctRaw = topcatEntries.map(e => e[0]);
                    // Tier A — recognized ordinal scale (Likert / satisfaction /
                    // frequency / severity / weekday / month / quarter / ...).
                    // Ship `ordinalPattern` + `orderedDomain` (the user's own
                    // value strings in canonical order) so the server emits a
                    // pinned-axis-order directive instead of the LLM defaulting
                    // to alphabetical / count-desc and breaking the analytical
                    // story. Pulls from ALL distinct values so a 5-pt Likert
                    // isn't missed when "Neutral" is the 6th most-common entry.
                    const detection = detectOrdinalDomain(allDistinctRaw, locale);
                    if (detection !== null) {
                        col.ordinalPattern = detection.pattern;
                        col.orderedDomain = detection.orderedDomain;
                    } else if (col.dataType === "String") {
                        // Tier B — not a recognized ordinal, but clearly non-PII
                        // short codes (≤2 alpha chars each, ≤15 distinct). Ship
                        // the ACTUAL distinct values (NO order claim) so the LLM
                        // derives the axis domain from real data rather than
                        // guessing labels it can't see (the freemium empty-filter
                        // bug, a production incident). Only for String columns — other
                        // dtypes already ship raw topCategoryValues above.
                        const safe = safeDistinctValuesToShip(allDistinctRaw);
                        if (safe !== null) {
                            col.safeDistinctValues = safe;
                        }
                    }
                }
            }
            if (sorted.length >= 8 && (col.dataType === "Integer" || col.dataType === "Decimal")) {
                const pick = (p: number) => sorted[Math.floor((sorted.length - 1) * p)];
                col.quantiles = {
                    p05: pick(0.05),
                    p25: pick(0.25),
                    p75: pick(0.75),
                    p95: pick(0.95)
                };
            }
        }

        // GEO detection — UNCONDITIONAL, outside the pl>=20 gate above, and the history of
        // this placement is worth its length. The block was WRITTEN as unconditional (its
        // original comment said so) but LIVED inside the gate, so at privacy levels 0 and 10
        // no geoKind was emitted, the server's geo gates never fired, and no map was ever
        // offered — silently, because nothing reports a signal that was never computed.
        //
        // The standing rule that resolves it (2026-08-16): the client does everything it can
        // to establish the exact, needed data SHAPE and ships that — a signal is
        // privacy-friendly when it is opaque to every single source value, regardless of the
        // privacy tier. Everything emitted here passes that test: geoKind is an enum,
        // geoMatchPct and dominantGeoRegionPct are percentages, geoAmbiguous is a bool, the
        // region fields are an enum and two small integers. No source value survives into any
        // of them. The tier keeps gating what it always gated — actual values, samples,
        // per-column stats a value could be read from.
        if (!col.isMeasure && vals.size > 0) {
            const geoEntries = Array.from(vals.entries()).sort((a, b) => b[1] - a[1]);
            const geo = detectGeo(geoEntries.map(e => e[0]), col.name, locale);
            if (geo !== null) {
                col.geoKind = geo.geoKind;
                col.geoMatchPct = geo.geoMatchPct;
                if (geo.geoAmbiguous) col.geoAmbiguous = true;
                // WHICH MAP FITS, for a country column. Computed here because this is the
                // only place that already holds every distinct value WITH its row count, and
                // the weighting is the point: forty US rows and one Japanese row is a US
                // dataset, and counting distinct values alone would call it 50/50 global and
                // frame it as a world map.
                if (geo.geoKind.indexOf("country") === 0) {
                    const reg = summarizeCountryRegionsWeighted(
                        geoEntries as ReadonlyArray<readonly [string, number]>);
                    if (reg) {
                        col.dominantGeoRegion = reg.dominantGeoRegion;
                        col.dominantGeoRegionPct = reg.dominantGeoRegionPct;
                        col.geoRegionCount = reg.regionCount;
                    }
                }
            }
        }
    }

    private updateColumnStats10(pl: number, col: LLMColumnWithValue, nonblank: number, vals: Map<string, number>, prec: number, maxval: any, minval: any) {
        if (pl >= 10) {
            col.blankCount = this._rows.length - nonblank;
            col.distinctCount = vals.size + (col.blankCount != 0 ? 1 : 0);
            col.valueNature = "Categorical";

            if (nonblank > 0) {
                if (col.dataType === "Integer" || col.dataType === "Decimal") {
                    // Type → cardinality → semantics ladder. `vals.size` is the
                    // distinct count of NON-BLANK values (col.distinctCount adds
                    // 1 for the blank bucket, which must not count toward
                    // uniqueness). See classifyNumericValueNature for the model.
                    col.valueNature = classifyNumericValueNature({
                        dataType: col.dataType,
                        isMeasure: !!col.isMeasure,
                        name: col.name,
                        distinct: vals.size,
                        nonblank,
                        prec,
                        maxval,
                        minval,
                    });
                } else if (col.dataType === "DateTime") {
                    col.valueNature = col.dateWithTime ? "Continuous" : "Ordinal";
                }
            }
        }
    }

    public getRowCount(): number {
        return this._rows.length;
    }

    // LEAF CARDINALITY (2026-07-13) — distinct count of the tuple of NON-MEASURE
    // (grouping) columns: the finest grain at which the data would be counted. The
    // server only has per-column marginals, never this JOINT distinctness — so the
    // client measures it here and ships it, letting AggregationAnalyzer decide whether
    // an implicit row COUNT is meaningful (rows repeat -> RowCount > leaf) or degenerate
    // (each row a unique tuple -> leaf ~ RowCount, a count is all-1s). One pass over the
    // accumulated rows; cached until reset().
    public getLeafCardinality(): number {
        if (this._leafCardinality !== null) return this._leafCardinality;
        const dimIdx: number[] = [];
        this._cols.forEach((c, i) => { if (!c.isMeasure) dimIdx.push(i); });
        if (dimIdx.length === 0) { this._leafCardinality = this._rows.length; return this._leafCardinality; }
        const seen = new Set<string>();
        for (const row of this._rows) {
            // JSON.stringify of the dimension tuple delimits fields unambiguously (no key collision).
            seen.add(JSON.stringify(dimIdx.map(di => row[di])));
        }
        this._leafCardinality = seen.size;
        return this._leafCardinality;
    }
    private _leafCardinality: number | null = null;

    // GEO EXTENT — WHERE the coordinates sit, which is a different question from whether the
    // data is geographic, and the one nothing answered. The lat/lon eligibility gate is a NAME
    // heuristic with no idea where the points land, so a table of European cities WITH
    // coordinates satisfies it and is then offered a North America basemap: every point off the
    // map or piled against its edge.
    //
    // Cross-column by nature (a latitude means nothing without its longitude), so it lives here
    // beside leaf cardinality rather than on any one column, and ships on the hints bag.
    //
    // The COUNTRY column is passed through when there is one, because a bounding box cannot
    // resolve the US/Canada border — southern Ontario sits below Boston, so Toronto and
    // Montreal fall inside any rectangle drawn around the contiguous US. Coordinates alone
    // answer the coarse question; the country makes the fine one right.
    //
    // Null when the data carries no coordinate pair, which is the common case and costs nothing:
    // the scan below is over column NAMES until a pair is actually found.
    public getGeoExtent(): { pctUsa: number, pctNa: number, latP5: number, latP95: number,
                             lonP5: number, lonP95: number, n: number } | null {
        if (this._geoExtentComputed) return this._geoExtent;
        this._geoExtentComputed = true;
        this._geoExtent = null;

        const tok = (n: string) => String(n || "")
            .replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z]+/);
        let latIdx = -1, lonIdx = -1, countryIdx = -1;
        this._cols.forEach((c, i) => {
            const t = tok(c.name);
            // Coordinates may arrive as a measure or a dimension, so IsMeasure is not filtered;
            // a string-typed column is never a coordinate.
            const numericish = c.dataType === "Integer" || c.dataType === "Decimal";
            if (numericish && latIdx < 0 && t.some(x => x === "lat" || x === "latitude")) latIdx = i;
            else if (numericish && lonIdx < 0 && t.some(x => x === "lon" || x === "lng" || x === "long" || x === "longitude")) lonIdx = i;
            if (countryIdx < 0 && !c.isMeasure && typeof c.geoKind === "string"
                && c.geoKind.indexOf("country") === 0) countryIdx = i;
        });
        if (latIdx < 0 || lonIdx < 0) return null;

        const pts: Array<{ lat: number | null, lon: number | null, country?: string | null }> = [];
        for (const row of this._rows) {
            const la = row[latIdx], lo = row[lonIdx];
            // Null/blank BEFORE coercion: +null is 0, and a phantom (0,0) would be counted as a
            // real point in the open Atlantic and drag the envelope toward the equator.
            const lat = (la === null || la === undefined || la === "") ? null : Number(la);
            const lon = (lo === null || lo === undefined || lo === "") ? null : Number(lo);
            pts.push({
                lat, lon,
                country: countryIdx >= 0 && countryRegion(this.STR(row[countryIdx])) ? this.STR(row[countryIdx]) : null,
            });
        }
        this._geoExtent = summarizeGeoExtent(pts);
        return this._geoExtent;
    }
    private _geoExtent: { pctUsa: number, pctNa: number, latP5: number, latP95: number,
                          lonP5: number, lonP95: number, n: number } | null = null;
    private _geoExtentComputed: boolean = false;

    private obfuscateString(input: string): string {
        const lowers = 'abcdefghijklmnopqrstuvwxyz';
        const getRandomLower = (): string => lowers[Math.floor(GET_RANDOM() * lowers.length)];
        const getRandomUpper = (): string => getRandomLower().toUpperCase();
        const getRandomDigit = (): string => Math.floor(GET_RANDOM() * 10).toString();

        // Class-preserving substitution:
        //   uppercase letter → random uppercase letter
        //   lowercase letter → random lowercase letter
        //   digit            → random digit
        //   anything else    → unchanged (whitespace, dashes, underscores,
        //                      parens, punctuation, currency symbols, etc.)
        // Preserves the shape signal — acronyms stay uppercase, Title Case
        // stays Title Case, "USD-12345" stays "<UPPER>-<DIGITS>". Loses the
        // exact value but keeps the format pattern the LLM needs for
        // semantic-type / id-likeness recognition.
        const substituteSameClass = (origChar: string): string => {
            if (/[A-Z]/.test(origChar)) return getRandomUpper();
            if (/[a-z]/.test(origChar)) return getRandomLower();
            if (/[0-9]/.test(origChar)) return getRandomDigit();
            return origChar;
        };

        const isEmail = input.includes('@') && input.includes('.');
        const emailParts = isEmail ? input.split('@') : [input];
        const domain = isEmail ? emailParts[1] : '';

        const preserveSuffix = domain.endsWith('.com');
        const suffix = preserveSuffix ? '.com' : '';
        const domainName = preserveSuffix ? domain.slice(0, -4) : domain;

        const obfuscatePart = (str: string): string => {
            let result = '';
            for (const char of str) {
                result += substituteSameClass(char);

                // Random length jitter (~20%). Insert ONLY after letters or
                // digits — NEVER after whitespace (breaks word boundaries)
                // AND NEVER after punctuation (would duplicate dashes /
                // underscores / colons / etc., changing the format pattern
                // — e.g. 'flight-1234' must not become 'flight--1234').
                // The inserted char matches the just-processed char's
                // class so a letters-only input never gains a digit and a
                // digits-only input never gains a letter (per the strict
                // class-preservation invariant required here).
                if (/[a-zA-Z0-9]/.test(char) && GET_RANDOM() < 0.2) {
                    result += substituteSameClass(char);
                }
            }

            // Random length jitter (down): remove up to 2 chars. NEVER
            // remove a whitespace character (changes word count) and
            // never remove structural separators ('.', '@', ',', '-', '_').
            // Only letters and digits are removable.
            if (result.length > 6) {
                const numToRemove = Math.floor(GET_RANDOM() * Math.min(3, result.length - 6));
                for (let i = 0; i < numToRemove; i++) {
                    let attempts = 0;
                    while (attempts < 5) {
                        const removeIndex = Math.floor(GET_RANDOM() * result.length);
                        if (/[a-zA-Z0-9]/.test(result[removeIndex])) {
                            result = result.slice(0, removeIndex) + result.slice(removeIndex + 1);
                            break;
                        }
                        attempts++;
                    }
                }
            }

            return result;
        };

        if (isEmail) {
            const localPart = obfuscatePart(emailParts[0]);
            const obfuscatedDomain = obfuscatePart(domainName);
            return `${localPart}@${obfuscatedDomain}${suffix}`;
        } else {
            return obfuscatePart(input);
        }
    }

    public toObjectArray(): Record<string, any>[] {
        return this._rows.map(row => {
            const obj: Record<string, any> = {};
            this._cols.forEach((col, index) => {
                obj[col.name] = row[index];
            });
            return obj;
        });
    }

    public async getCSVAsync(forSample: boolean): Promise<string> {
        const rows = [];
        let cnt = forSample ? 25 : 10000000;
        let len = forSample ? 4000 : 10000000;
        const strMap: Map<string, string> = new Map<string, string>();

        for (const r of this._rows) {
            const obj = {};
            for (let c = 0; c < this._cols.length; c++) {
                const col = this._cols[c];
                let v = r[c];
                if (this.STR(v) != "") {
                    if (forSample && col.dataType == "String") {
                        if (strMap.has(v)) {
                            v = strMap.get(v);
                        } else {
                            const nv = this.obfuscateString(v);
                            strMap.set(v, nv);
                            v = nv;
                        }
                    } else {
                        if (col.dataType == "DateTime" && !col.dateWithTime) {
                            v = new Date(v).toISOString().slice(0, 10) + "T00:00:00.000Z";
                        }
                    }
                    len -= this.STR(v).length;
                } else {
                    v = null;
                }
                obj[c] = v;
                --len;
            }
            rows.push(obj);
            --cnt;
            if (cnt <= 0 || len <= 0) {
                break;
            }
        }

        const csv = await Papa.unparse(rows, { header: false });
        return csv;
    }

    // Column-name header line matching getCSVAsync's column ORDER (this._cols, by index).
    // getCSVAsync emits a HEADERLESS body; legacy cached code reads CSV_STRING with a bare
    // pd.read_csv (no names), so the host prepends this line at injection time — otherwise
    // pandas uses row 0 as the header and every column reference KeyErrors (v1->v2 upgrade
    // running cached v1 Python code). Built via Papa so escaping matches the data rows.
    public getCSVHeaderLine(): string {
        return Papa.unparse([this._cols.map(c => this.STR(c.name))]);
    }

    public addRow(colvals: any[], originalIdx?: number) {
        // Value-identical rows are collapsed by DEFAULT: duplicates carry no shape
        // information and inflate every distribution statistic derived from counts.
        //
        // Set `dedupRows = false` when row identity matters more than shape fidelity —
        // the accumulated rows must line up one-to-one with the source for selection
        // round-tripping, or repetition is itself the signal (raw event streams, where
        // the same reading twice is data rather than noise). The hashing is skipped
        // entirely in that mode, so it costs nothing to turn off.
        if (this.dedupRows) {
            let str = "";
            for (const v of colvals) {
                str += this.STR(v) + "~";
            }
            const hash = SIMPLE_STRING_HASH(str);

            if (this._rowHashes.has(hash)) {
                return false;
            }
            this._rowHashes.add(hash);
        }

        this._rows.push(colvals);
        this._origIndices.push(originalIdx === undefined || originalIdx === null ? -1 : originalIdx);
        return true;
    }

    public getOriginalRowIndex(i: number): number {
        if (i < 0 || i >= this._origIndices.length) return -1;
        return this._origIndices[i];
    }

    public reset(): void {
        this._cols = [];
        this._rows = [];
        this._origIndices = [];
        this._rowHashes = new Set<number>();
        this._leafCardinality = null;
    }

    public setColumns(cols: LLMColumnWithValue[]): void {
        this._cols = cols;
    }
}
