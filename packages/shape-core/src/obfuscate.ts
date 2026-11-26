// THE STAND-IN MAKER. A table goes in; a STAND-IN comes out with the same shape and statistical nature - the same
// rows, columns, order, blanks, distinct counts, frequencies, hierarchies, ranks, correlations and date rhythm - whose
// labels, magnitudes and dates identify nothing. A chart chosen and written for the stand-in fits the real table, so
// a reader can share the stand-in (or its shape) and draw the code that comes back over the real rows.
//
// WHAT IT IS NOT. A stand-in keeps the PATTERN: someone who knows the real data can recognize a curve, a lone outlier
// or a group of one. It is a safe stand-in for sharing a shape, filing a bug report or prompting a model, not
// anonymization, and it carries no formal guarantee. The seed is the key: anyone holding it can rebuild the stand-in
// from a guessed table and compare.
//
// PER COLUMN, by what shape-core measured (`ingest`):
// - Text categories, codes and free text: each distinct WORD maps to one masked word (maskSampleText, keyed by the
//   seed and the word, lengths kept, redrawn on a collision), so each distinct value maps to one masked value, and
//   counts, frequencies, blanks, word frequencies and every hierarchy carry over. A sorted column's masks are dealt in
//   sorted order, so the column stays sorted. A masked word never carries four characters of a real label.
// - Ordered labels shape-core recognizes (months, weekdays, quarters, tiers): kept. They identify nothing and they
//   drive the shape.
// - Places (a geoKind): shuffled within the column's own places, a country only with countries of its own region, so
//   the map still draws and its region shares hold.
// - Measures: scaled by one seeded factor per column in 1.1-1.5 and rounded to the column's own precision (a factor
//   above 1 keeps every distinct value and its order; whole numbers stay whole; a share stays in 0-1 and a percent in
//   0-100), or, as the reader's option, shuffled between rows. A column whose reading scaling would change (a small
//   whole-number age reads as continuous off its unit step) is left as it is, and the key says so.
// - Dates and year numbers: one shift for the whole table, in multiples of 28 years, so weekdays, leap days and month
//   starts stay put (the calendar repeats every 28 years between 1901 and 2099). Time of day is kept.
// - Latitude and longitude: one offset for the whole table (clusters, distances and the extent class hold), or, as
//   the reader's option, rounded to a half-degree grid. One known point undoes a shift.
// - Column names: kept by default; masked as the reader's option, keeping the words shape-core's own detectors read
//   and the words the server reads for the shapes shape-core does not (a target, a rep, a retention role).
//
// THE KEY is a plain object the caller holds: it never leaves this module except as the caller's own file
// (serializeKey). It carries the real values, so it is as private as the table. The same seed on the same table
// rebuilds it.

import { ingest } from "./ingest";
import type { LLMColumnWithValue } from "./models";
import { maskSampleText } from "./sampleMask";
import { isOrdinalFriendlyName, detectOrdinalDomain } from "./ordinalDetector";
import {
    COUNTRY_NAME_TOKENS, STATE_NAME_TOKENS, ZIP_NAME_TOKENS, COUNTY_NAME_TOKENS, CITY_NAME_TOKENS,
} from "./geoDetector";
import { isIdentifierName, hasYearName, isOutcomeNameWord, LATITUDE_NAME_WORDS, LONGITUDE_NAME_WORDS } from "./indexedText";
import { isAttributeNameWord } from "./seriesCompleteness";
import { coordinateAxisOfWords } from "./vocab/coordinates";
import { dateLevelPart } from "./vocab/dateLevels";
import { isServerNameWord } from "./vocab/serverNameWords";
import {
    nameLooksIntensiveRate, nameLooksLevelNotSum, nameLooksPositional, stripHostAggPrefix,
} from "./aggregation";
import { nameLetterRuns } from "./nameReader";
import { countryRegion, inMiddleEast, summarizeGeoExtent } from "./geoExtent";

/** One cell, as a CSV or a grid holds it. */
export type ObfuscateCell = string | number | boolean | null | undefined;

/** A table: ingest's `grid` source (`{ kind: "grid", header, rows }` is accepted as is). */
export interface ObfuscateTable {
    header: string[];
    rows: ObfuscateCell[][];
}

export interface ObfuscateOptions {
    /** The reader's seed. The same seed on the same table gives the same stand-in and key. */
    seed: string;
    /** D1: keep the real column names (default), or mask them, keeping the words shape-core reads. */
    names?: "keep" | "mask";
    /** D2: scale each measure by one seeded factor in 1.1-1.5 (default), or shuffle its values between rows. */
    measures?: "scale" | "shuffle";
    /** D3b: shift latitude and longitude by one offset for the table (default), or round them to a half-degree grid. */
    latLon?: "shift" | "round";
    /** The locale ingest reads the table with. Default "en". */
    locale?: string;
}

/**
 * What happened to one column:
 * - `keep`: as it was (ordered labels, true/false, blanks, or a measure whose reading scaling would change - `reason`);
 * - `mask`: text mapped one to one; `place`: places shuffled within the column; `scale`: times `factor`;
 * - `date`: years shifted by the key's `dateShiftYears`; `coordShift`: plus `offset`; `coordRound`: to a 0.5 grid;
 * - `shuffle`: values moved between rows (`rowOrder`).
 */
export type StandInTransform = "keep" | "mask" | "place" | "scale" | "shuffle" | "date" | "coordShift" | "coordRound";

export interface StandInColumnKey {
    /** The real column name. */
    name: string;
    /** The stand-in's column name (the real one unless names were masked). */
    standInName: string;
    transform: StandInTransform;
    /** Why a column was kept, when it is not obvious. */
    reason?: string;
    /** One-to-one transforms: each [stand-in cell, real cell], for every distinct value. */
    pairs?: Array<[ObfuscateCell, ObfuscateCell]>;
    /** `shuffle`: stand-in row i holds real row rowOrder[i]'s value. */
    rowOrder?: number[];
    /** `coordRound`: the real cells, row by row (rounding is not reversible). */
    realCells?: ObfuscateCell[];
    /** `scale`: the factor. `coordShift`: the offset. */
    factor?: number;
    offset?: number;
    /** Transformed numbers: the stand-in column's lowest and highest value (rebindCode flags a literal equal to one). */
    rangeEnds?: [number, number];
}

export interface StandInKey {
    format: "bicharts-stand-in-key";
    version: 1;
    seed: string;
    options: { names: "keep" | "mask"; measures: "scale" | "shuffle"; latLon: "shift" | "round" };
    /** The one date shift, in years (a multiple of 28; 0 when the table has no dates or none can move). */
    dateShiftYears: number;
    columns: StandInColumnKey[];
}

export interface ObfuscateResult {
    standIn: ObfuscateTable;
    key: StandInKey;
}

// ---- seeded randomness: the same (seed, parts) always gives the same stream -------------------------------
function hash32(s: string): number {
    let h = 0x811C9DC5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    h ^= h >>> 16; h = Math.imul(h, 0x85EBCA6B); h ^= h >>> 13; h = Math.imul(h, 0xC2B2AE35); h ^= h >>> 16;
    return h >>> 0;
}
function streamFor(seed: string, ...parts: Array<string | number>): () => number {
    let a = hash32(seed + "\u0001" + parts.join("\u0001"));
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function shuffled<T>(xs: readonly T[], rand: () => number): T[] {
    const out = xs.slice();
    for (let k = out.length - 1; k > 0; k--) {
        const q = Math.floor(rand() * (k + 1));
        [out[k], out[q]] = [out[q], out[k]];
    }
    return out;
}

// ---- cells --------------------------------------------------------------------------------------------------
const isBlank = (v: ObfuscateCell) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
/** A cell's identity in a pair map: type and text, so 5 and "5" stay apart. */
const cellId = (v: ObfuscateCell) => (typeof v) + ":" + String(v);
const PLAIN_NUMBER = /^\s*[+-]?\d+(\.\d+)?\s*$/;
const decimalsOf = (s: string) => (s.trim().split(".")[1] ?? "").length;
// Loops, never a spread: `Math.min(...xs)` over a row-sized array overflows the call stack (about 120,000 rows).
function minMax(xs: readonly number[]): [number, number] {
    let lo = Infinity, hi = -Infinity;
    for (const x of xs) { if (x < lo) lo = x; if (x > hi) hi = x; }
    return [lo, hi];
}
/** A column's precision: the most decimals any of its cells is written with. */
function maxDecimals(vs: readonly ObfuscateCell[]): number {
    let p = 0;
    for (const v of vs) if (!isBlank(v)) { const d = decimalsOf(String(v)); if (d > p) p = d; }
    return p;
}
/** True/false written as text, as ingest's binary-flag reading takes it: the values are one boolean pair. */
const BOOLEAN_PAIRS = [["false", "true"], ["no", "yes"], ["n", "y"], ["f", "t"]];
function isBooleanText(vs: readonly ObfuscateCell[]): boolean {
    const seen = new Set<string>();
    for (const v of vs) {
        if (isBlank(v)) continue;
        if (typeof v !== "string") return false;
        seen.add(v.trim().toLowerCase());
        if (seen.size > 2) return false;
    }
    return seen.size > 0 && BOOLEAN_PAIRS.some(p => [...seen].every(s => p.includes(s)));
}

/** A number written at `prec` decimals, then trimmed of trailing zeros down to `keep` decimals. */
function formatAt(v: number, prec: number, keep: number): string {
    let s = v.toFixed(prec);
    if (prec > keep) {
        const dot = s.indexOf(".");
        while (s.length - dot - 1 > keep && s.endsWith("0")) s = s.slice(0, -1);
        if (s.endsWith(".")) s = s.slice(0, -1);
    }
    if (/^-0(\.0*)?$/.test(s)) s = s.slice(1);
    return s;
}

/** A numeric column's cells, read: the plain numbers, or null when a cell is written some other way. */
function numericCells(cells: ObfuscateCell[]): Array<number | null> | null {
    const out: Array<number | null> = [];
    for (const v of cells) {
        if (isBlank(v)) { out.push(null); continue; }
        if (typeof v === "number") { if (!Number.isFinite(v)) return null; out.push(v); continue; }
        if (typeof v === "string" && PLAIN_NUMBER.test(v)) { out.push(Number(v)); continue; }
        return null;
    }
    return out;
}

/** Map a numeric cell through `f`, keeping its type, its own decimals (at least) and the column's precision. */
function mapNumberCell(v: ObfuscateCell, f: (x: number) => number, prec: number): ObfuscateCell {
    if (isBlank(v)) return v;
    if (typeof v === "number") return Number(formatAt(f(v), prec, decimalsOf(String(v))));
    const s = String(v);
    const lead = s.match(/^\s*/)![0], trail = s.match(/\s*$/)![0];
    return lead + formatAt(f(Number(s)), prec, decimalsOf(s)) + trail;
}

// ---- the leak guard: no masked word carries four characters of a real label -----------------------------------
const LEAK_WINDOW = 4;
function windowsOf(s: string): string[] {
    const cps = Array.from(s.toLowerCase());
    const out: string[] = [];
    for (let i = 0; i + LEAK_WINDOW <= cps.length; i++) out.push(cps.slice(i, i + LEAK_WINDOW).join(""));
    return out;
}

// ---- the words shape-core's detectors read in a column name -----------------------------------------------
const GEO_NAME_SETS = [COUNTRY_NAME_TOKENS, STATE_NAME_TOKENS, ZIP_NAME_TOKENS, COUNTY_NAME_TOKENS, CITY_NAME_TOKENS];
function isDetectorWord(word: string): boolean {
    const w = word.toLowerCase();
    if (!w) return false;
    if (GEO_NAME_SETS.some(s => s.has(w))) return true;
    if (LATITUDE_NAME_WORDS.has(w) || LONGITUDE_NAME_WORDS.has(w) || coordinateAxisOfWords([w]) !== null) return true;
    if (isOrdinalFriendlyName(w) || isIdentifierName(w) || dateLevelPart(w, "en") !== null) return true;
    // The outcome words the binary-flag reading takes from a name (Churned, IsActive) and the attribute words the
    // series reading takes from its last word (Status, Segment).
    if (isOutcomeNameWord(w) || isAttributeNameWord(w)) return true;
    // The words the server reads for a shape shape-core does not: a target pair, a territory's rep, a retention role.
    if (isServerNameWord(w)) return true;
    return nameLooksIntensiveRate(w) || nameLooksLevelNotSum(w) || nameLooksPositional(w);
}
const WORD_RUN = /[\p{L}\p{M}\p{Nd}]+/gu;
const IS_WORD = /^[\p{L}\p{M}\p{Nd}]+$/u;
const HAS_WORD_CHAR = /[\p{L}\p{Nd}]/u;
/** Words split as nameWords splits them (camelCase too), with every separator kept in place. */
function nameParts(name: string): string[] {
    const parts: string[] = [];
    let last = 0;
    for (const m of name.matchAll(WORD_RUN)) {
        if (m.index! > last) parts.push(name.slice(last, m.index));
        // camelCase: `OrderMonth` -> `Order`, `Month`.
        for (const w of m[0].split(/(?<=[\p{Ll}\p{Nd}])(?=\p{Lu})/u)) parts.push(w);
        last = m.index! + m[0].length;
    }
    if (last < name.length) parts.push(name.slice(last));
    return parts;
}

// ---- readings: what a stand-in must keep (the guard that leaves a column unscaled) ------------------------------
const READING_KEYS = ["dataType", "isMeasure", "isTemporal", "valueNature", "ordinalPattern", "distinctCount",
    "blankCount", "formatSignature", "sortedDirection", "modelFormat", "numericPrecision"] as const;
function readingOf(c: LLMColumnWithValue): string {
    const o: Record<string, unknown> = {};
    for (const k of READING_KEYS) o[k] = (c as any)[k];
    for (const k of Object.keys(c).sort()) if (/geo/i.test(k)) o[k] = (c as any)[k];
    return JSON.stringify(o);
}

// ---- measures that share one factor -----------------------------------------------------------------------------
interface MeasureGroup { columns: number[]; fixedTotal: boolean }
/** The words of a name after any host prefix (`Sum of`), lower case. */
function nameWordsOf(name: string): string[] {
    return nameParts(stripHostAggPrefix(name)).filter(p => IS_WORD.test(p)).map(p => p.toLowerCase());
}
/** Two names that are the same word for word but at ONE place, with at least one word in common. */
function namesPair(a: string[], b: string[]): boolean {
    if (a.length < 2 || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length && diff < 2; i++) if (a[i] !== b[i]) diff++;
    return diff === 1;
}
/** Each scaled measure's group (singletons included), its columns in table order. */
function groupMeasures(scaled: boolean[], header: string[], profile: LLMColumnWithValue[]): MeasureGroup[] {
    const up = scaled.map((_, j) => j);
    const find = (j: number): number => { while (up[j] !== j) { up[j] = up[up[j]]; j = up[j]; } return j; };
    const join = (a: number, b: number) => { const x = find(a), y = find(b); if (x !== y) up[Math.max(x, y)] = Math.min(x, y); };
    const fixed = new Set<number>();
    const byName = new Map(header.map((h, j) => [h, j] as const));
    const js = scaled.map((s, j) => s ? j : -1).filter(j => j >= 0);
    for (const j of js) {
        const g = (profile[j] as any)?.constantSumGroup as { columns: string[]; total: number } | undefined;
        if (!g) continue;
        const members = g.columns.map(n => byName.get(n)).filter((m): m is number => m !== undefined && scaled[m]);
        for (const m of members) join(j, m);
        if (Math.abs(g.total - 100) <= 0.5 || Math.abs(g.total - 1) <= 0.005) for (const m of members) fixed.add(m);
    }
    const words = new Map(js.map(j => [j, nameWordsOf(header[j])] as const));
    for (const a of js) for (const b of js) if (a < b && namesPair(words.get(a)!, words.get(b)!)) join(a, b);
    const groups = new Map<number, number[]>();
    for (const j of js) { const r = find(j); if (!groups.has(r)) groups.set(r, []); groups.get(r)!.push(j); }
    return [...groups.values()].map(columns => ({ columns, fixedTotal: columns.some(j => fixed.has(j)) }));
}

// ---- dates ------------------------------------------------------------------------------------------------------
const CAL_MIN = 1901, CAL_MAX = 2099;
const YEAR_RUN = /(?<!\d)(\d{4})(?!\d)/g;
const yearLike = (y: number) => y >= 1800 && y <= 2199;
function yearsIn(v: ObfuscateCell): number[] {
    if (isBlank(v)) return [];
    if (typeof v === "number") return Number.isInteger(v) && yearLike(v) ? [v] : [];
    return [...String(v).matchAll(YEAR_RUN)].map(m => Number(m[1])).filter(yearLike);
}
function shiftCell(v: ObfuscateCell, years: number): ObfuscateCell {
    if (isBlank(v) || years === 0) return v;
    if (typeof v === "number") return Number.isInteger(v) && yearLike(v) ? v + years : v;
    if (typeof v !== "string") return v;
    return v.replace(YEAR_RUN, (y) => yearLike(Number(y)) ? String(Number(y) + years) : y);
}
/** The one shift: a multiple of 28 years that keeps every year inside 1901-2099, past the real span when it can. */
function chooseDateShift(years: number[], seed: string): number {
    if (years.length === 0) return 0;
    const [lo, hi] = minMax(years);
    if (lo < CAL_MIN || hi > CAL_MAX) return 0;
    const fits = [-6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6].map(k => 28 * k).filter(s => lo + s >= CAL_MIN && hi + s <= CAL_MAX);
    if (fits.length === 0) return 0;
    const clear = fits.filter(s => Math.abs(s) > hi - lo);
    const pool = (clear.length ? clear : fits).sort((a, b) => Math.abs(a) - Math.abs(b) || a - b).slice(0, 4);
    return pool[Math.floor(streamFor(seed, "dates")() * pool.length)];
}

// ---- coordinates ------------------------------------------------------------------------------------------------
function coordinateAxis(name: string, nums: Array<number | null>): "lat" | "lon" | null {
    const t = nameLetterRuns(name, { camel: true });
    const axis = t.some(x => LATITUDE_NAME_WORDS.has(x)) ? "lat"
        : t.some(x => LONGITUDE_NAME_WORDS.has(x)) ? "lon" : coordinateAxisOfWords(t);
    if (!axis) return null;
    const lim = axis === "lat" ? 90 : 180;
    const live = nums.filter((x): x is number => x !== null);
    return live.length > 0 && live.every(x => x >= -lim && x <= lim) ? axis : null;
}

/**
 * Make a stand-in for `table`. The input is not changed. The stand-in has the same header (unless names are masked),
 * rows, order and cell types; the key turns it back into the real table (restoreRows) and the stand-in's code back
 * onto the real rows (rebindCode, rebindRows).
 */
export function obfuscate(table: ObfuscateTable, options: ObfuscateOptions): ObfuscateResult {
    if (!table || !Array.isArray(table.header) || !Array.isArray(table.rows)) throw new Error("obfuscate: a table needs a header and rows.");
    if (!options || typeof options.seed !== "string" || options.seed === "") throw new Error("obfuscate: a seed is required.");
    const seed = options.seed;
    const opts = {
        names: options.names === "mask" ? "mask" as const : "keep" as const,
        measures: options.measures === "shuffle" ? "shuffle" as const : "scale" as const,
        latLon: options.latLon === "round" ? "round" as const : "shift" as const,
    };
    const locale = options.locale ?? "en";
    const header = table.header.slice();
    const n = header.length;
    const cells = (j: number) => table.rows.map(r => r[j]);
    const profile = ingest({ kind: "grid", header, rows: table.rows }, { dedup: false, locale }).columns;

    // ---- classify each column ----
    type Plan = { transform: StandInTransform; reason?: string; nums?: Array<number | null>; axis?: "lat" | "lon" };
    const plans: Plan[] = header.map((name, j) => {
        const c = profile[j];
        const vs = cells(j);
        if (vs.every(isBlank)) return { transform: "keep", reason: "blank" };
        if (vs.every(v => isBlank(v) || typeof v === "boolean")) return { transform: "keep", reason: "true/false" };
        // True/false as text (True/False, TRUE/FALSE, yes/no): a mask would turn the flag into two words.
        if (c?.formatSignature === "BOOLEAN" || (c?.dataType === "String" && isBooleanText(vs))) {
            return { transform: "keep", reason: "true/false" };
        }
        if (c?.ordinalPattern) return { transform: "keep", reason: "ordered labels" };
        const distinctText = [...new Set(vs.filter(v => !isBlank(v)).map(v => String(v)))];
        if (c?.dataType === "String" && distinctText.length <= 64 && detectOrdinalDomain(distinctText, locale)) {
            return { transform: "keep", reason: "ordered labels" };
        }
        // A year number is a date even when the table holds one year (ingest reads a single value as no axis).
        const yearColumn = hasYearName(name) && vs.every(v => isBlank(v) || yearsIn(v).length === 1 && String(v).trim() === String(yearsIn(v)[0]));
        if (c?.isTemporal || yearColumn) {
            return vs.some(v => yearsIn(v).length > 0) ? { transform: "date" } : { transform: "keep", reason: "no year to shift" };
        }
        if (c?.geoKind && !c.isMeasure) return { transform: "place" };
        if (c && (c.dataType === "Integer" || c.dataType === "Decimal")) {
            const nums = numericCells(vs);
            if (nums) {
                const axis = coordinateAxis(name, nums);
                if (axis) return { transform: opts.latLon === "round" ? "coordRound" : "coordShift", nums, axis };
                return { transform: opts.measures, nums };
            }
        }
        return { transform: "mask" };
    });

    // ---- the one date shift ----
    const allYears: number[] = [];
    plans.forEach((p, j) => { if (p.transform === "date") for (const v of cells(j)) for (const y of yearsIn(v)) allYears.push(y); });
    const dateShiftYears = chooseDateShift(allYears, seed);
    plans.forEach(p => { if (p.transform === "date" && dateShiftYears === 0) { p.transform = "keep"; p.reason = "dates outside 1901-2099"; } });

    // ---- the word map for masked text ----
    const leak = new Set<string>();
    // A window of pure format (`----`) identifies nothing and a mask keeps it, so only windows with a letter or digit.
    const addLeak = (s: string) => windowsOf(s).forEach(w => { if (HAS_WORD_CHAR.test(w)) leak.add(w); });
    plans.forEach((p, j) => { if (p.transform === "mask") for (const v of cells(j)) if (!isBlank(v)) addLeak(String(v)); });
    if (opts.names === "mask") for (const h of header) for (const part of nameParts(h)) if (!isDetectorWord(part)) addLeak(part);
    const wordMap = new Map<string, string>();
    const usedWords = new Set<string>();
    // Extra draws for a word whose mask, beside a separator, spelled four characters of a real label.
    const bump = new Map<string, number>();
    const leaks = (m: string) => windowsOf(m).some(x => leak.has(x));
    const maskWord = (w: string, salt: string, avoidDetector: boolean): string => {
        const hit = wordMap.get(salt + w);
        if (hit !== undefined) return hit;
        const base = bump.get(salt + w) ?? 0;
        let out: string | null = null;
        for (let k = 0; k < 256 && out === null; k++) {
            const m = maskSampleText(w, streamFor(seed, salt, w, base + k), { keepLength: true });
            if (usedWords.has(salt + m)) continue;
            // The first 64 draws must also differ from the word, carry no real label and read as no detector word;
            // past them only the one-to-one rule holds (a tiny pool: a one-character word identifies nothing).
            if (k < 64 && (m === w || leaks(m) || (avoidDetector && isDetectorWord(m)))) continue;
            out = m;
        }
        if (out === null) out = w;
        wordMap.set(salt + w, out);
        usedWords.add(salt + out);
        return out;
    };
    // Each distinct text value's mask, composed word by word, redrawn where a whole value spells a real label.
    const textValues: string[] = [];
    {
        const seen = new Set<string>();
        plans.forEach((p, j) => {
            if (p.transform !== "mask") return;
            for (const v of cells(j)) if (!isBlank(v) && !seen.has(String(v))) { seen.add(String(v)); textValues.push(String(v)); }
        });
    }
    const maskedText = new Map<string, string>();
    for (let round = 0; round < 12; round++) {
        wordMap.clear(); usedWords.clear(); maskedText.clear();
        const bad: string[] = [];
        for (const v of textValues) {
            const m = v.replace(WORD_RUN, w => maskWord(w, "v", false));
            maskedText.set(v, m);
            if (leaks(m)) bad.push(v);
        }
        if (bad.length === 0) break;
        for (const v of bad) for (const w of v.match(WORD_RUN) ?? []) bump.set("v" + w, (bump.get("v" + w) ?? 0) + 64);
    }
    const maskValue = (s: string) => maskedText.get(s) ?? s.replace(WORD_RUN, w => maskWord(w, "v", false));

    // ---- transform each column ----
    const out: ObfuscateCell[][] = table.rows.map(r => r.slice());
    const keys: StandInColumnKey[] = [];
    const pairsOf = (j: number, f: (v: ObfuscateCell) => ObfuscateCell): Array<[ObfuscateCell, ObfuscateCell]> => {
        const seen = new Map<string, ObfuscateCell>();
        table.rows.forEach((r, i) => {
            const v = r[j];
            if (isBlank(v)) return;
            const id = cellId(v);
            if (!seen.has(id)) seen.set(id, f(v));
            out[i][j] = seen.get(id);
        });
        const pairs: Array<[ObfuscateCell, ObfuscateCell]> = [];
        const firstReal = new Map<string, ObfuscateCell>();
        table.rows.forEach(r => { const v = r[j]; if (!isBlank(v) && !firstReal.has(cellId(v))) firstReal.set(cellId(v), v); });
        for (const [id, s] of seen) pairs.push([s, firstReal.get(id)]);
        return pairs;
    };
    const rangeOf = (j: number): [number, number] | undefined => {
        const nums = out.map(r => r[j]).filter(v => !isBlank(v)).map(Number).filter(Number.isFinite);
        return nums.length ? minMax(nums) : undefined;
    };

    // Coordinates: one offset per axis for the table, drawn until every share the engine reads from where the points
    // fall holds EXACTLY: each continent frame's share (so the dominant frame and its percent, which the latitude
    // column carries as dominantGeoRegionPct and admin1RollupPct), and the US and North America shares. A cloud near a
    // frame's edge takes a smaller offset; the draws shrink until one fits.
    const coordCols = plans.map((p, j) => ({ p, j })).filter(x => x.p.transform === "coordShift");
    let latOff = 0, lonOff = 0;
    if (coordCols.length) {
        const latJ = coordCols.find(x => x.p.axis === "lat")?.j, lonJ = coordCols.find(x => x.p.axis === "lon")?.j;
        const pts = (dLat: number, dLon: number) => table.rows.map(r => ({
            lat: latJ !== undefined && !isBlank(r[latJ]) ? Number(r[latJ]) + dLat : null,
            lon: lonJ !== undefined && !isBlank(r[lonJ]) ? Number(r[lonJ]) + dLon : null,
        }));
        const cls = (p: ReturnType<typeof pts>) => {
            const e = summarizeGeoExtent(p);
            return e ? JSON.stringify([e.dominantFrame, e.dominantFramePct, e.regionPct, e.pctUsa, e.pctNa, e.n]) : "none";
        };
        const inRange = (p: ReturnType<typeof pts>) => p.every(x => (x.lat === null || Math.abs(x.lat) <= 90) && (x.lon === null || Math.abs(x.lon) <= 180));
        const target = cls(pts(0, 0));
        const rand = streamFor(seed, "coordinates");
        const decimals = (j: number | undefined) => j === undefined ? 0 : maxDecimals(cells(j));
        const pLat = decimals(latJ), pLon = decimals(lonJ);
        for (let k = 0; k < 64; k++) {
            const scale = k < 16 ? 1 : k < 32 ? 0.5 : k < 48 ? 0.25 : 0.1;
            const dLat = Number(((rand() < 0.5 ? -1 : 1) * (1 + rand() * 3) * scale).toFixed(pLat));
            const dLon = Number(((rand() < 0.5 ? -1 : 1) * (1 + rand() * 7) * scale).toFixed(pLon));
            const p = pts(dLat, dLon);
            if (inRange(p) && cls(p) === target && (dLat !== 0 || dLon !== 0)) { latOff = dLat; lonOff = dLon; break; }
        }
    }

    // Measures that belong together share ONE factor (Joel: "Per column, but groups share one"), so what the engine
    // reads across them holds: the parts of a constant total (shape-core's constantSumGroup), and a same-unit pair named
    // as one (Revenue Budget / Revenue Actual, Sales 2024 / Sales 2025, Score Before / Score After: two names that are
    // the same word for word but at one place, the shape of the engine's own paired-measure reading). A split of a
    // fixed total (percents summing to 100, shares to 1) is left as it is: its total is a bound, not a magnitude, and a
    // shared factor followed by renormalising back onto that total is the identity, so there is nothing to scale.
    const scaleGroups = groupMeasures(plans.map(p => p.transform === "scale"), header, profile);
    const scaleFactor = new Map<number, number | { keep: string }>();
    for (const members of scaleGroups) {
        if (members.fixedTotal) { for (const j of members.columns) scaleFactor.set(j, { keep: "parts of a fixed total" }); continue; }
        let f = 1.1 + 0.4 * streamFor(seed, "scale", members.columns[0])();
        for (const j of members.columns) {
            const live = plans[j].nums!.filter((x): x is number => x !== null);
            const [lo, hi] = minMax(live);
            const pct = /%/.test(String((profile[j] as any)?.modelFormat ?? "")) || /pct|percent/i.test(header[j]);
            const bound = lo >= 0 && hi <= 1 ? 1 : (lo >= 0 && hi <= 100 && pct ? 100 : Infinity);
            if (hi * f > bound) f = bound / hi;
        }
        const keep = !(f > 1 + 1e-12);
        for (const j of members.columns) scaleFactor.set(j, keep ? { keep: "on its bound" } : Number(f.toFixed(6)));
    }

    // A place column's parents: the other place columns it determines (each of its values sits with one value there)
    // and that hold fewer values. Each map takes a place's cell id to its parent's cell.
    const placeParents = (j: number): Array<Map<string, ObfuscateCell>> => {
        const own = new Set(cells(j).filter(v => !isBlank(v)).map(cellId)).size;
        const found: Array<Map<string, ObfuscateCell>> = [];
        header.forEach((_, q) => {
            const c = profile[q];
            if (q === j || !c?.geoKind || c.isMeasure) return;
            const m = new Map<string, ObfuscateCell>();
            const values = new Set<string>();
            for (const r of table.rows) {
                if (isBlank(r[j])) continue;
                const id = cellId(r[j]), pv = isBlank(r[q]) ? "" : r[q];
                values.add(cellId(pv));
                if (!m.has(id)) m.set(id, pv);
                else if (cellId(m.get(id)) !== cellId(pv)) return;
            }
            if (values.size < own) found.push(m);
        });
        return found;
    };

    plans.forEach((p, j) => {
        const k: StandInColumnKey = { name: header[j], standInName: header[j], transform: p.transform };
        if (p.reason) k.reason = p.reason;
        const vs = cells(j);
        switch (p.transform) {
            case "mask": {
                const pairs = pairsOf(j, v => maskValue(String(v)));
                // A sorted column stays sorted: its masks are dealt in the order of its values.
                const dir = profile[j]?.sortedDirection;
                if (dir === "asc" || dir === "desc") {
                    const reals = pairs.map(x => String(x[1])).sort(jsCompare);
                    const masks = pairs.map(x => String(x[0])).sort(jsCompare);
                    const dealt = new Map(reals.map((r, i) => [r, masks[i]]));
                    table.rows.forEach((r, i) => { if (!isBlank(r[j])) out[i][j] = dealt.get(String(r[j])); });
                    for (const x of pairs) x[0] = dealt.get(String(x[1]));
                }
                k.pairs = pairs;
                break;
            }
            case "place": {
                const distinct: ObfuscateCell[] = [];
                const seen = new Set<string>();
                for (const v of vs) if (!isBlank(v) && !seen.has(cellId(v))) { seen.add(cellId(v)); distinct.push(v); }
                const kind = String(profile[j]?.geoKind ?? "");
                // Each place moves only among places of its own group, so every share the engine reads by region holds:
                // a country within its continent and in or out of the Middle East frame (an overlapping frame, read
                // as its own share); any place within its parent places (a city within its state, a state within its
                // country: the place columns this one determines, cell for cell).
                const parents = placeParents(j);
                const groups = new Map<string, ObfuscateCell[]>();
                for (const v of distinct) {
                    const own = kind.indexOf("country") === 0 ? (countryRegion(String(v)) ?? "?") + (inMiddleEast(String(v)) ? "+me" : "") : "all";
                    const g = own + (parents.length ? "\u0001" + parents.map(p => cellId(p.get(cellId(v)))).join("\u0001") : "");
                    if (!groups.has(g)) groups.set(g, []);
                    groups.get(g)!.push(v);
                }
                const to = new Map<string, ObfuscateCell>();
                for (const [g, members] of groups) {
                    const perm = shuffled(members, streamFor(seed, "places", j, g));
                    members.forEach((m, i) => to.set(cellId(m), perm[i]));
                }
                k.pairs = pairsOf(j, v => to.get(cellId(v)));
                break;
            }
            case "date": {
                k.pairs = pairsOf(j, v => shiftCell(v, dateShiftYears));
                const yrs = out.flatMap(r => yearsIn(r[j]));
                if (yrs.length && vs.every(v => isBlank(v) || typeof v === "number")) k.rangeEnds = minMax(yrs);
                break;
            }
            case "scale": {
                const prec = maxDecimals(vs);
                const f = scaleFactor.get(j)!;
                if (typeof f !== "number") { k.transform = "keep"; k.reason = f.keep; break; }
                k.pairs = pairsOf(j, v => mapNumberCell(v, x => x * f, prec));
                k.factor = f;
                k.rangeEnds = rangeOf(j);
                break;
            }
            case "shuffle": {
                const live = vs.map((v, i) => i).filter(i => !isBlank(vs[i]));
                const perm = shuffled(live, streamFor(seed, "shuffle", j));
                const rowOrder = vs.map((v, i) => i);
                live.forEach((i, q) => { rowOrder[i] = perm[q]; out[i][j] = vs[perm[q]]; });
                k.rowOrder = rowOrder;
                break;
            }
            case "coordShift": {
                const off = p.axis === "lat" ? latOff : lonOff;
                if (off === 0) { k.transform = "keep"; k.reason = "no offset keeps the extent"; break; }
                const prec = maxDecimals(vs);
                k.pairs = pairsOf(j, v => mapNumberCell(v, x => x + off, prec));
                k.offset = off;
                k.rangeEnds = rangeOf(j);
                break;
            }
            case "coordRound": {
                k.realCells = vs.slice();
                vs.forEach((v, i) => { out[i][j] = mapNumberCell(v, x => Math.round(x * 2) / 2, 1); });
                break;
            }
        }
        keys.push(k);
    });

    // ---- the guard: a measure whose reading scaling changed is left as it was ----
    const realReadings = profile.map(readingOf);
    const standInReadings = ingest({ kind: "grid", header, rows: out }, { dedup: false, locale }).columns.map(readingOf);
    // A group goes back whole, so its members never end up on different factors.
    const revert = new Set<number>();
    keys.forEach((k, j) => {
        if (k.transform !== "scale" || standInReadings[j] === realReadings[j]) return;
        const g = scaleGroups.find(x => x.columns.includes(j));
        for (const m of g ? g.columns : [j]) if (keys[m].transform === "scale") revert.add(m);
    });
    for (const j of revert) {
        const k = keys[j];
        table.rows.forEach((r, i) => { out[i][j] = r[j]; });
        keys[j] = { name: k.name, standInName: k.standInName, transform: "keep", reason: "scaling changes its reading" };
    }

    // ---- names ----
    const standInHeader = header.slice();
    if (opts.names === "mask") {
        const taken = new Set<string>();
        header.forEach((h, j) => {
            const body = stripHostAggPrefix(h);
            const prefix = h.slice(0, h.length - body.length);
            let name = "";
            for (let k = 0; k < 16; k++) {
                const salt = k === 0 ? "n" : "n" + k;
                name = prefix + nameParts(body).map(part => IS_WORD.test(part) && !isDetectorWord(part)
                    ? maskWord(part, salt, true) : part).join("");
                if (name !== h && !taken.has(name)) break;
            }
            taken.add(name);
            standInHeader[j] = name;
            keys[j].standInName = name;
        });
    }

    return {
        standIn: { header: standInHeader, rows: out },
        key: { format: "bicharts-stand-in-key", version: 1, seed, options: opts, dateShiftYears, columns: keys },
    };
}

/** The engine's own order for text (sortedDirection compares with `<`). */
function jsCompare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

/** The real table back from a stand-in and its key, byte for byte. */
export function restoreRows(standIn: ObfuscateTable, key: StandInKey): ObfuscateTable {
    checkKey(key);
    const back = key.columns.map(c => c.pairs ? new Map(c.pairs.map(([s, r]) => [cellId(s), r] as const)) : null);
    const rows = standIn.rows.map((row, i) => row.map((v, j) => {
        const c = key.columns[j];
        if (!c) return v;
        if (c.transform === "shuffle" && c.rowOrder) return v;
        if (c.transform === "coordRound" && c.realCells) return c.realCells[i];
        const m = back[j];
        if (!m || isBlank(v)) return v;
        const id = cellId(v);
        if (!m.has(id)) throw new Error(`restoreRows: row ${i} column "${c.standInName}" holds a value the key does not know.`);
        return m.get(id);
    }));
    // Shuffled columns: stand-in row i holds real row rowOrder[i]'s value.
    key.columns.forEach((c, j) => {
        if (c.transform !== "shuffle" || !c.rowOrder) return;
        c.rowOrder.forEach((src, i) => { rows[src][j] = standIn.rows[i][j]; });
    });
    return { header: key.columns.map(c => c.name), rows };
}

/**
 * The real rows as objects keyed by the STAND-IN's column names: code written for the stand-in runs over them with no
 * edit. Its titles show the stand-in's names. The ALTERNATIVE to rebindCode, never paired with it (rebindCode's code
 * reads the real names): rebind picks one and returns code and rows that agree.
 */
export function rebindRows(real: ObfuscateTable, key: StandInKey): Record<string, ObfuscateCell>[] {
    checkKey(key);
    return real.rows.map(r => {
        const o: Record<string, ObfuscateCell> = {};
        key.columns.forEach((c, j) => { o[c.standInName] = r[j]; });
        return o;
    });
}

// ---- rebinding code -------------------------------------------------------------------------------------------
export interface RebindFlag {
    /** The literal as written in the code (quotes included for a string). */
    literal: string;
    /** Its offset in the code passed in. */
    at: number;
    /** The real column the literal belongs to. */
    column: string;
    reason: "label" | "rangeEnd";
}
export interface RebindResult {
    code: string;
    /** Literals equal to a stand-in label or a transformed range end: that chart does not carry over to the real rows. */
    flagged: RebindFlag[];
}

type Seg = { kind: "code" | "string" | "template" | "comment" | "regex" | "number"; start: number; end: number };
const ID_CHAR = /[\p{L}\p{N}_$]/u;
const REGEX_BEFORE = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);
const REGEX_KEYWORDS = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "instanceof", "yield", "await"]);

/** Cut JavaScript into strings, template text, comments, regexes, numbers and the rest. Template `${...}` parts are code. */
function segments(src: string): Seg[] {
    const segs: Seg[] = [];
    const stack: number[] = []; // brace depth at each open template expression
    let depth = 0, i = 0, codeStart = 0, prev = "";
    const n = src.length;
    const flush = (end: number) => { if (end > codeStart) segs.push({ kind: "code", start: codeStart, end }); };
    const templateText = (from: number): number => {
        // from is just after ` or }; reads to the closing ` or a ${
        let k = from;
        while (k < n) {
            if (src[k] === "\\") { k += 2; continue; }
            if (src[k] === "`") { segs.push({ kind: "template", start: from, end: k }); return k + 1; }
            if (src[k] === "$" && src[k + 1] === "{") { segs.push({ kind: "template", start: from, end: k }); stack.push(depth); depth++; return k + 2; }
            k++;
        }
        segs.push({ kind: "template", start: from, end: n });
        return n;
    };
    while (i < n) {
        const c = src[i], d = src[i + 1];
        if (c === "/" && d === "/") {
            flush(i); let k = src.indexOf("\n", i); if (k < 0) k = n;
            segs.push({ kind: "comment", start: i, end: k }); i = codeStart = k; continue;
        }
        if (c === "/" && d === "*") {
            flush(i); let k = src.indexOf("*/", i + 2); k = k < 0 ? n : k + 2;
            segs.push({ kind: "comment", start: i, end: k }); i = codeStart = k; continue;
        }
        if (c === "'" || c === "\"") {
            flush(i); let k = i + 1;
            while (k < n && src[k] !== c && src[k] !== "\n") k += src[k] === "\\" ? 2 : 1;
            segs.push({ kind: "string", start: i + 1, end: Math.min(k, n) }); i = codeStart = Math.min(k + 1, n); prev = "x"; continue;
        }
        if (c === "`") { flush(i); i = codeStart = templateText(i + 1); prev = "x"; continue; }
        if (c === "{") { depth++; prev = c; i++; continue; }
        if (c === "}") {
            if (stack.length && stack[stack.length - 1] === depth - 1) {
                flush(i); depth--; stack.pop(); i = codeStart = templateText(i + 1); prev = "x"; continue;
            }
            depth--; prev = c; i++; continue;
        }
        if (c === "/" && (REGEX_BEFORE.has(prev) || REGEX_KEYWORDS.has(prev))) {
            flush(i); let k = i + 1, cls = false;
            while (k < n && src[k] !== "\n") {
                if (src[k] === "\\") { k += 2; continue; }
                if (src[k] === "[") cls = true; else if (src[k] === "]") cls = false; else if (src[k] === "/" && !cls) break;
                k++;
            }
            k++; while (k < n && /[a-z]/i.test(src[k])) k++;
            segs.push({ kind: "regex", start: i, end: k }); i = codeStart = k; prev = "x"; continue;
        }
        if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(d ?? ""))) {
            flush(i); let k = i;
            const m = /^(0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(\d[\d_]*)?\.?\d[\d_]*([eE][+-]?\d+)?n?)/.exec(src.slice(i));
            k = i + (m ? m[0].length : 1);
            segs.push({ kind: "number", start: i, end: k }); i = codeStart = k; prev = "x"; continue;
        }
        if (ID_CHAR.test(c)) {
            let k = i; while (k < n && ID_CHAR.test(src[k])) k++;
            prev = src.slice(i, k); i = k; continue;
        }
        if (!/\s/.test(c)) prev = c;
        i++;
    }
    flush(n);
    return segs;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Turn code written for a stand-in back onto the real table. Inside string literals and template text only, each
 * stand-in column NAME (a whole token, never part of a longer word) becomes the real name, so the code runs over the
 * real rows keyed by their real names and its titles read right. Identifiers, comments and expressions are never
 * touched. Draw it over the real rows, never over rebindRows' (see rebind). A literal equal to a masked label or a
 * shifted date, or a data-like number equal to a transformed column's range end (see dataLikeLiteral), is FLAGGED: the
 * chart hard-codes the stand-in and does not carry over.
 */
export function rebindCode(code: string, key: StandInKey): RebindResult {
    checkKey(key);
    const renames = key.columns.filter(c => c.standInName !== c.name).sort((a, b) => b.standInName.length - a.standInName.length);
    const swap = renames.length
        ? new RegExp(`(?<![\\p{L}\\p{N}_$])(${renames.map(c => escapeRe(c.standInName)).join("|")})(?![\\p{L}\\p{N}_$])`, "gu")
        : null;
    const realOf = new Map(renames.map(c => [c.standInName, c.name]));
    // A shuffled place is a real place on both sides (a map's code may name one), so only masked labels and shifted
    // dates are stand-in labels.
    const labels = new Map<string, string>();
    for (const c of key.columns) {
        if (!c.pairs || !(c.transform === "mask" || c.transform === "date")) continue;
        for (const [s, r] of c.pairs) if (typeof s === "string" && s !== r && !labels.has(s)) labels.set(s, c.name);
    }
    const ends = new Map<number, string>();
    for (const c of key.columns) if (c.rangeEnds) for (const e of c.rangeEnds) if (e !== 0 && !ends.has(e)) ends.set(e, c.name);

    const flagged: RebindFlag[] = [];
    let out = "";
    let last = 0;
    for (const s of segments(code)) {
        if (s.kind === "number") {
            const text = code.slice(s.start, s.end);
            const v = Number(text.replace(/_/g, "").replace(/n$/, ""));
            if (ends.has(v) && dataLikeLiteral(code, s, v)) flagged.push({ literal: text, at: s.start, column: ends.get(v)!, reason: "rangeEnd" });
            continue;
        }
        if (s.kind !== "string" && s.kind !== "template") continue;
        const raw = code.slice(s.start, s.end);
        if (s.kind === "string" && labels.has(raw)) {
            flagged.push({ literal: code.slice(s.start - 1, s.end + 1), at: s.start - 1, column: labels.get(raw)!, reason: "label" });
        }
        if (!swap) continue;
        const quote = s.kind === "template" ? "`" : code[s.start - 1];
        const swapped = raw.replace(swap, (m: string) => escapeFor(realOf.get(m)!, quote));
        if (swapped !== raw) { out += code.slice(last, s.start) + swapped; last = s.end; }
    }
    out += code.slice(last);
    flagged.sort((a, b) => a.at - b.at);
    return { code: out, flagged };
}

export interface RebindAllResult {
    /** The code to draw. */
    code: string;
    /** The real rows to draw it over, keyed by the names the code reads. */
    rows: Record<string, ObfuscateCell>[];
    /** Which names the rows are keyed by: `real` (the code's string literals were swapped back) or `standIn`. */
    names: "real" | "standIn";
    flagged: RebindFlag[];
}

/**
 * Code written for a stand-in, and the real rows to draw it over, in ONE call, so the two always agree.
 *
 * rebindCode and rebindRows are ALTERNATIVES, never a pair: rebindCode's code reads the REAL names (draw it over the
 * real rows as they are), and rebindRows' rows carry the STAND-IN's names (draw the unedited code over them). Their
 * combination reads names neither side has once names are masked. This picks one:
 * - `names: "real"` (the default, so titles read right): rebindCode's code over the real rows under their real names.
 *   When the code reads a renamed column through an identifier (`d.Name`), which a swap inside string literals cannot
 *   reach, it falls back to the stand-in's names, and `names` says so.
 * - `names: "standIn"`: the code unedited, over rebindRows' rows.
 * With names kept (the default), both are the same: the code is not edited and the rows are the real ones.
 */
export function rebind(code: string, real: ObfuscateTable, key: StandInKey, options?: { names?: "real" | "standIn" }): RebindAllResult {
    checkKey(key);
    const swapped = rebindCode(code, key);
    const renamed = key.columns.filter(c => c.standInName !== c.name).map(c => c.standInName);
    let names: "real" | "standIn" = options?.names === "standIn" && renamed.length ? "standIn" : "real";
    if (names === "real" && renamed.length) {
        const ids = new Set<string>();
        for (const s of segments(code)) {
            if (s.kind !== "code") continue;
            for (const m of code.slice(s.start, s.end).matchAll(/[\p{L}\p{N}_$]+/gu)) ids.add(m[0]);
        }
        if (renamed.some(n => ids.has(n))) names = "standIn";
    }
    if (names === "standIn") return { code, rows: rebindRows(real, key), names, flagged: swapped.flagged };
    const rows = real.rows.map(r => {
        const o: Record<string, ObfuscateCell> = {};
        key.columns.forEach((c, j) => { o[c.name] = r[j]; });
        return o;
    });
    return { code: swapped.code, rows, names, flagged: swapped.flagged };
}

/**
 * Is a number literal equal to a range end there because of the data? Layout numbers (a padding of 12, three columns,
 * an opacity of 0.4) equal a small range end by chance, so: never a small integer (a whole number up to 100); always a
 * number with three or more significant digits; and a shorter one only where it bounds the data, inside a `domain(`
 * call or beside a comparison.
 */
function dataLikeLiteral(code: string, s: Seg, v: number): boolean {
    if (Number.isInteger(v) && Math.abs(v) <= 100) return false;
    const digits = code.slice(s.start, s.end).replace(/_/g, "").replace(/n$/, "").replace(/[eE][+-]?\d+$/, "");
    let sig = digits.replace(".", "").replace(/^0+/, "");
    if (!digits.includes(".")) sig = sig.replace(/0+$/, "");
    if (sig.length >= 3) return true;
    const before = code.slice(Math.max(0, s.start - 4), s.start).replace(/[\s-]+$/, "");
    const after = code.slice(s.end, s.end + 4).replace(/^\s+/, "");
    const COMPARE_END = /(?:[<>]=?|[=!]==?)$/, COMPARE_START = /^(?:[<>]=?|[=!]==?)/;
    if ((COMPARE_END.test(before) && !/=>$/.test(before)) || (COMPARE_START.test(after) && !/^=>/.test(after))) return true;
    // Inside an open `domain(`: the nearest one before the literal whose parenthesis is still open.
    const from = code.lastIndexOf("domain(", s.start);
    if (from >= 0 && s.start - from < 400) {
        // Open until its own parenthesis closes (`y.domain()[0]; if (...` closed at once).
        let depth = 0, open = true;
        for (let i = from + "domain".length; i < s.start && open; i++) {
            if (code[i] === "(") depth++;
            else if (code[i] === ")" && --depth === 0) open = false;
        }
        if (open) return true;
    }
    return false;
}

function escapeFor(s: string, quote: string): string {
    let e = s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
    if (quote === "`") e = e.replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
    else e = e.split(quote).join("\\" + quote);
    return e;
}

// ---- the key file -----------------------------------------------------------------------------------------------
function checkKey(key: StandInKey): void {
    if (!key || key.format !== "bicharts-stand-in-key" || key.version !== 1 || !Array.isArray(key.columns)) {
        throw new Error("Not a stand-in key.");
    }
}

/** The key as a file's text (JSON). Blank cells survive it: `undefined` is written as a marker. */
export function serializeKey(key: StandInKey): string {
    checkKey(key);
    return JSON.stringify(key, (_k, v) => v === undefined ? { "$undefined": true } : v);
}

/** A key read back from serializeKey's text. Throws on anything that is not one. */
export function parseKey(text: string): StandInKey {
    let parsed: any;
    try {
        parsed = JSON.parse(text, (_k, v) => v && typeof v === "object" && !Array.isArray(v) && v.$undefined === true && Object.keys(v).length === 1 ? undefined : v);
    } catch {
        throw new Error("Not a stand-in key.");
    }
    checkKey(parsed);
    return parsed as StandInKey;
}
