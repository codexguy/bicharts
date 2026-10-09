// TWO-SET PAIRING, LONG FORM (2026-10-09) - does this table hold the same records twice?
//
// A customer master taken in January and again in February, a ledger as budget and as actual: one
// COLUMN identifies the record (the key) and one column with exactly two values says which of the two
// sets a row belongs to (the discriminator). Whether the key is unique inside each set, how many keys
// appear in both, and how many of those are equal on every other field is arithmetic over the rows, and
// only the client holds the rows - a server sees a summary of each column, never a row. The existing
// pair statistics cannot see it: `categoricalPairStats` skips any column over 50 distinct values, and a
// key is routinely the widest column in the table.
//
// MEASUREMENT ONLY. What a chart does with a key that repeats inside a set is policy and lives with it;
// this reports the repeats, and reports them WITHOUT refusing, because a refusal needs the count.
//
// WHAT IS SEARCHED. Key candidates: a dimension (never a measure, a time column or a date part) with at
// least five distinct values, identifier-named columns first, then the widest, then column order, the
// first eight. Set candidates: a dimension with exactly two non-blank values, in column order, the first
// four. One row pass per (key, set) pair, over integer codes built once per candidate: a key becomes the
// index of its first appearance, a set cell becomes 0 (blank), 1 (A) or 2 (B), and a per-key bit mask
// records "seen in A", "seen in B" and "seen twice in A / in B".
//
// THE WINNER is the pair with the smallest SHARE of keys that repeat inside a set, (duplicateKeysA +
// duplicateKeysB) / (keysA + keysB), then the most keys in both sets, then the earlier key candidate, then
// the earlier set candidate. It is a share and not a count on purpose: a column with five values has only
// five keys that CAN repeat, so by raw count it beats the real record key of a table where a few hundred
// records repeat, and the chart's refusal ("X repeats inside Jan") would name the wrong column. Only pairs
// with at least one key in both sets compete: a pair that shares nothing is no pairing, and it must not
// hide one that shares something. Nothing is emitted above TWO_SET_PAIRING_MAX_ROWS rows, where a census
// reads the row count as "not computed".
//
// A repeated key is compared by its first row inside each set, and a row repeated byte for byte never
// reaches this pass in a host that collapses duplicates (the engine's default), so the duplicate counts
// see only keys repeated with some differing value.
//
// PRIVACY. Counts, an integer percentage, two column names and an enum: nothing here is a cell value,
// so the caller ships it at every tier.

import { parseTemporalPoint } from "./cadence";
import { isUsableLooseKey, looseNameKey } from "./knownNameKey";
import type { TwoSetPairing } from "./models";

/** Above this many rows nothing is computed or emitted. */
export const TWO_SET_PAIRING_MAX_ROWS = 500_000;
/** Key candidates examined, ranked as described above. */
export const TWO_SET_PAIRING_MAX_KEYS = 8;
/** Set candidates examined, in column order. */
export const TWO_SET_PAIRING_MAX_SETS = 4;
/** A key needs at least this many distinct non-blank values; fewer is a category. */
export const TWO_SET_PAIRING_MIN_KEY_DISTINCT = 5;

/** What the pass needs to know about one column. The caller builds these from its own column stats. */
export interface TwoSetColumn {
    name: string;
    /** The column's distinct NON-BLANK values as text, when the engine kept them (a dimension of at most
     *  2,000 distinct values); null otherwise. Exactly two entries is what makes a set candidate. */
    values: ReadonlySet<string> | null;
    /** Distinct non-blank values: `values.size` when kept, else the column's own count. */
    distinct: number;
    isMeasure: boolean;
    isTemporal: boolean;
    isDatePart: boolean;
    identifierNamed: boolean;
    /** The strptime pattern of a date stored as text, when the engine detected one. */
    temporalTextPattern?: string;
}

export interface TwoSetInput {
    rows: ReadonlyArray<ReadonlyArray<any>>;
    columns: ReadonlyArray<TwoSetColumn>;
    /** The engine's cell-to-text rule, so a cell reads here exactly as it did when the columns were measured. */
    text: (cell: any) => string;
    locale?: string;
}

export interface TwoSetResult {
    /** Index of the key column. */
    key: number;
    /** Index of the discriminator column. */
    discriminator: number;
    pairing: TwoSetPairing;
}

const BIT_A = 1, BIT_B = 2, DUP_A = 4, DUP_B = 8;

/** The two values of a set column in A, B order, and how that order was reached. */
function orderOfTwo(values: ReadonlySet<string>, col: TwoSetColumn, locale: string | undefined):
    { a: string; b: string; setOrder: TwoSetPairing["setOrder"] } {
    const [x, y] = [...values];
    if (col.isTemporal) {
        const px = parseTemporalPoint(x, col.temporalTextPattern, locale);
        const py = parseTemporalPoint(y, col.temporalTextPattern, locale);
        if (px && py && px.ms !== py.ms) {
            return px.ms < py.ms ? { a: x, b: y, setOrder: "temporal" } : { a: y, b: x, setOrder: "temporal" };
        }
    }
    return x < y ? { a: x, b: y, setOrder: "none" } : { a: y, b: x, setOrder: "none" };
}

/** A set column as 0 (blank) / 1 (set A) / 2 (set B) per row. */
function encodeSet(input: TwoSetInput, ci: number, col: TwoSetColumn) {
    const { rows, text, locale } = input;
    const order = orderOfTwo(col.values!, col, locale);
    const code = new Uint8Array(rows.length);
    let blankRows = 0;
    for (let r = 0; r < rows.length; r++) {
        const s = text(rows[r][ci]);
        if (s === order.a) code[r] = 1;
        else if (s === order.b) code[r] = 2;
        else blankRows++;
    }
    return { code, blankRows, setOrder: order.setOrder };
}

/** A key column as the index of each cell's first appearance (-1 for a blank), and the index's own dictionary. */
function encodeKeys(input: TwoSetInput, ci: number) {
    const { rows, text } = input;
    const ids = new Int32Array(rows.length);
    const dict = new Map<string, number>();
    for (let r = 0; r < rows.length; r++) {
        const s = text(rows[r][ci]);
        if (s === "") { ids[r] = -1; continue; }
        let id = dict.get(s);
        if (id === undefined) { id = dict.size; dict.set(s, id); }
        ids[r] = id;
    }
    return { ids, dict };
}

interface Tally { keysA: number; keysB: number; keysBoth: number; dupA: number; dupB: number }

function tally(ids: Int32Array, set: Uint8Array, keyCount: number): Tally {
    const mask = new Uint8Array(keyCount);
    for (let r = 0; r < ids.length; r++) {
        const s = set[r];
        if (s === 0) continue;
        const id = ids[r];
        if (id < 0) continue;
        const m = mask[id];
        mask[id] = (m & s) ? (m | (s << 2)) : (m | s);     // a second sighting inside the set raises its dup bit
    }
    const t: Tally = { keysA: 0, keysB: 0, keysBoth: 0, dupA: 0, dupB: 0 };
    for (let k = 0; k < keyCount; k++) {
        const m = mask[k];
        if (m & BIT_A) t.keysA++;
        if (m & BIT_B) t.keysB++;
        if ((m & (BIT_A | BIT_B)) === (BIT_A | BIT_B)) t.keysBoth++;
        if (m & DUP_A) t.dupA++;
        if (m & DUP_B) t.dupB++;
    }
    return t;
}

/**
 * Does pair `a` beat the current best `b`? A smaller SHARE of repeated keys, (dupA + dupB) / (keysA + keysB),
 * then more keys in both sets; an exact tie keeps the earlier candidate (the caller only replaces on a strict win).
 * Compared by cross-multiplication, so no division and no rounding decide it; both sides have keysBoth >= 1, so
 * both denominators are positive.
 */
function beats(a: Tally, b: Tally): boolean {
    const lhs = (a.dupA + a.dupB) * (b.keysA + b.keysB);
    const rhs = (b.dupA + b.dupB) * (a.keysA + a.keysB);
    return lhs < rhs || (lhs === rhs && a.keysBoth > b.keysBoth);
}

const isBlank = (v: any) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/** Cell equality for the comparison: blank equals blank only; numbers exactly; dates by instant; text on the trimmed cell. */
function sameCell(a: any, b: any, text: (cell: any) => string): boolean {
    if (a === b) return true;
    const ab = isBlank(a), bb = isBlank(b);
    if (ab || bb) return ab && bb;
    if (typeof a === "number" && typeof b === "number") return false;       // a === b was false: exact, no tolerance
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    return text(a).trim() === text(b).trim();
}

/**
 * The best (key, discriminator) pairing of a table's rows, or null when nothing qualifies. See the header
 * for the search, the winner rule and the ceiling.
 */
export function measureTwoSetPairing(input: TwoSetInput): TwoSetResult | null {
    const { rows, columns } = input;
    const n = rows.length;
    if (n < 2 || n > TWO_SET_PAIRING_MAX_ROWS) return null;

    const keyCands = columns
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => !c.isMeasure && !c.isTemporal && !c.isDatePart && c.distinct >= TWO_SET_PAIRING_MIN_KEY_DISTINCT)
        .sort((p, q) => (q.c.identifierNamed ? 1 : 0) - (p.c.identifierNamed ? 1 : 0) || q.c.distinct - p.c.distinct || p.i - q.i)
        .slice(0, TWO_SET_PAIRING_MAX_KEYS);
    const setCands = columns
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => !c.isMeasure && c.values !== null && c.values.size === 2)
        .slice(0, TWO_SET_PAIRING_MAX_SETS);
    if (keyCands.length === 0 || setCands.length === 0) return null;

    const sets = setCands.map(({ c, i }) => encodeSet(input, i, c));

    let best: {
        tally: Tally; keyIdx: number; setNo: number; ids: Int32Array; dict: Map<string, number>;
    } | null = null;
    for (const { i: keyIdx } of keyCands) {
        const enc = encodeKeys(input, keyIdx);
        for (let s = 0; s < setCands.length; s++) {
            if (setCands[s].i === keyIdx) continue;
            const t = tally(enc.ids, sets[s].code, enc.dict.size);
            if (t.keysBoth < 1) continue;
            if (!best || beats(t, best.tally)) {
                best = { tally: t, keyIdx, setNo: s, ids: enc.ids, dict: enc.dict };
            }
        }
    }
    if (!best) return null;

    // The winner, in detail: the first row of each key in each set, then the comparison and the loose keys.
    const { ids, dict, tally: t } = best;
    const set = sets[best.setNo];
    const setIdx = setCands[best.setNo].i;
    const keyCount = dict.size;
    const firstA = new Int32Array(keyCount).fill(-1), firstB = new Int32Array(keyCount).fill(-1);
    for (let r = 0; r < n; r++) {
        const s = set.code[r], id = ids[r];
        if (s === 0 || id < 0) continue;
        if (s === 1) { if (firstA[id] < 0) firstA[id] = r; }
        else if (firstB[id] < 0) firstB[id] = r;
    }

    const compared: number[] = [];
    for (let c = 0; c < columns.length; c++) if (c !== best.keyIdx && c !== setIdx) compared.push(c);
    let identical = 0;
    for (let k = 0; k < keyCount; k++) {
        const ra = firstA[k], rb = firstB[k];
        if (ra < 0 || rb < 0) continue;
        const a = rows[ra], b = rows[rb];
        let same = true;
        for (const c of compared) if (!sameCell(a[c], b[c], input.text)) { same = false; break; }
        if (same) identical++;
    }
    // 100 means every key in both sets is identical and 0 means none is: a rounded share must not say so.
    const identicalPct = identical === t.keysBoth ? 100
        : identical === 0 ? 0
        : Math.min(99, Math.max(1, Math.round((identical / t.keysBoth) * 100)));

    const inA = new Map<string, number>(), inB = new Map<string, number>();
    for (const [key, id] of dict) {
        const a = firstA[id] >= 0, b = firstB[id] >= 0;
        if (!a && !b) continue;
        const loose = looseNameKey(key);
        if (!isUsableLooseKey(loose)) continue;
        if (a) inA.set(loose, (inA.get(loose) ?? 0) + 1);
        if (b) inB.set(loose, (inB.get(loose) ?? 0) + 1);
    }
    const involved = (m: Map<string, number>) => { let sum = 0; for (const c of m.values()) if (c >= 2) sum += c; return sum; };

    return {
        key: best.keyIdx,
        discriminator: setIdx,
        pairing: {
            form: "long",
            key: columns[best.keyIdx].name,
            discriminator: columns[setIdx].name,
            keysA: t.keysA, keysB: t.keysB, keysBoth: t.keysBoth,
            duplicateKeysA: t.dupA, duplicateKeysB: t.dupB,
            identicalPct,
            discriminatorBlankRows: set.blankRows,
            looseCollisionsA: involved(inA), looseCollisionsB: involved(inB),
            setOrder: set.setOrder,
        },
    };
}
