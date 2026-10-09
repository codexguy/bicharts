// SCORE SEPARATION (2026-10-09) - does this numeric column rank a yes/no outcome?
//
// A model score, a probability, a risk rating beside the outcome it was meant to predict is the shape
// behind a cutoff chart: where to draw the line, and what each line catches and misses. Whether a column
// is such a score is not a question its name answers (`Rating` is a nursing-home star count, `Score` is a
// test mark) and not one the existing group statistics can: eta squared against a two-level column is the
// squared point-biserial correlation, which the class imbalance caps, so a score that ranks the rare
// outcome well still reads as "nothing there" when the outcome is 2.5% of the rows. What a ranking chart
// consumes is the RANKING, so this reports the area under the ROC curve - the probability that a random
// case of the rare outcome scores above a random case of the other - which is blind to the imbalance.
//
// WHERE IT SITS. A score is any numeric column (a measure, or a dimension the host bound to a group-by:
// a score is routinely a group-by column) and an outcome is a column that reads as a yes/no flag, or any
// other column with exactly two values. The statistic is carried on the SCORE column, one entry per
// outcome. It is its own pass and not a part of the group-discrimination one, which pairs a measure with a
// dimension: here the score may be a dimension and the outcome a measure (a 0/1 total).
//
// ORIENTATION. `aucMinorityHigh` is the AUC with the rarer outcome value as the positive class and a
// HIGHER score as the positive direction. That is a fixed orientation, so no outcome value needs to ship;
// a consumer that knows which value it flags for reads `1 - aucMinorityHigh` when that is the other one,
// and `1 - auc` again when lower scores point at it. A tie of the two counts takes the alphabetically
// first value (UTF-16 order of the cell text) as the rare one, so the answer never depends on row order.
//
// TIES are scored as half a win, the standard treatment, and counted: `ties` is the number of rows that
// share their score with at least one other row, so a decile score (a handful of values over thousands of
// rows) is told apart from a continuous one.
//
// COST. The values are ordered once per score and every outcome reuses that order: one numeric sort per
// score and one linear pass per (score, outcome) pair. At most SCORE_SEPARATION_MAX_OUTCOMES outcomes against
// SCORE_SEPARATION_MAX_SCORES scores, nothing above SCORE_SEPARATION_MAX_ROWS rows, where a reader of the
// field takes its absence to mean "not computed".
//
// PRIVACY. Column names, two counts, a count of tied rows and a rounded probability: no cell value, so the
// caller ships it at every tier.

import type { ScoreSeparationEntry } from "./models";

/** Above this many rows nothing is computed or emitted. */
export const SCORE_SEPARATION_MAX_ROWS = 500_000;
/** Outcome candidates examined: the flagged ones first, then any other two-valued column, in column order. */
export const SCORE_SEPARATION_MAX_OUTCOMES = 6;
/** Score candidates examined, in column order. */
export const SCORE_SEPARATION_MAX_SCORES = 12;
/** A score needs this many distinct values; two make a second flag and not a ranking. */
export const SCORE_SEPARATION_MIN_DISTINCT = 3;

/** What the pass needs to know about one column. The caller builds these from its own column stats. */
export interface ScoreSeparationColumn {
    name: string;
    dataType: string;
    isMeasure: boolean;
    isTemporal: boolean;
    isDatePart: boolean;
    identifierNamed: boolean;
    /** The engine's yes/no flag test, including a numeric column whose values are exactly 0 and 1. */
    isBinaryFlag: boolean;
    /** Distinct non-blank values, as the engine counted them. */
    distinct: number;
    /** The column's two non-blank values as text when it has exactly two, else null. */
    twoValues: readonly [string, string] | null;
}

export interface ScoreSeparationInput {
    rows: ReadonlyArray<ReadonlyArray<any>>;
    columns: ReadonlyArray<ScoreSeparationColumn>;
    /** The engine's cell-to-text rule, so an outcome cell reads here exactly as it did when the columns were measured. */
    text: (cell: any) => string;
    /** Row ceiling; the default is SCORE_SEPARATION_MAX_ROWS. */
    maxRows?: number;
}

const isNumericType = (t: string) => t === "Integer" || t === "Decimal";

/** The outcome columns to examine, flagged first and then any other two-valued dimension, capped. */
function outcomeCandidates(columns: ReadonlyArray<ScoreSeparationColumn>): number[] {
    const flagged: number[] = [];
    const other: number[] = [];
    columns.forEach((c, i) => {
        if (!c.twoValues) return;
        if (c.isBinaryFlag) { flagged.push(i); return; }
        // A two-valued column that does not read as a flag is still a possible outcome when a reader
        // names it, but never a measure, a time column or a date part.
        if (c.isMeasure || c.isTemporal || c.isDatePart || c.identifierNamed) return;
        other.push(i);
    });
    return [...flagged, ...other].slice(0, SCORE_SEPARATION_MAX_OUTCOMES);
}

/** The score columns to examine, in column order, capped. */
function scoreCandidates(columns: ReadonlyArray<ScoreSeparationColumn>, outcomes: ReadonlySet<number>): number[] {
    const out: number[] = [];
    for (let i = 0; i < columns.length && out.length < SCORE_SEPARATION_MAX_SCORES; i++) {
        const c = columns[i];
        if (outcomes.has(i) || !isNumericType(c.dataType)) continue;
        if (c.isTemporal || c.isDatePart || c.identifierNamed) continue;
        if (c.distinct < SCORE_SEPARATION_MIN_DISTINCT) continue;
        out.push(i);
    }
    return out;
}

/**
 * The separation entries per score column: a map from the score's column index to one entry per outcome it
 * could be measured against. A column with no measurable outcome has no key. Empty above the row ceiling.
 */
export function measureScoreSeparation(input: ScoreSeparationInput): Map<number, ScoreSeparationEntry[]> {
    const result = new Map<number, ScoreSeparationEntry[]>();
    const { rows, columns, text } = input;
    if (rows.length === 0 || rows.length > (input.maxRows ?? SCORE_SEPARATION_MAX_ROWS)) return result;

    const outcomeIdx = outcomeCandidates(columns);
    if (outcomeIdx.length === 0) return result;
    const scoreIdx = scoreCandidates(columns, new Set(outcomeIdx));
    if (scoreIdx.length === 0) return result;

    // Each outcome as 0 (blank or neither value) / 1 (its first value, alphabetically) / 2 (the other).
    const codes = outcomeIdx.map(oi => {
        const [first, second] = columns[oi].twoValues!;
        const code = new Uint8Array(rows.length);
        for (let r = 0; r < rows.length; r++) {
            const s = text(rows[r][oi]);
            code[r] = s === first ? 1 : s === second ? 2 : 0;
        }
        return code;
    });

    for (const si of scoreIdx) {
        // The usable scores, ordered once by the engine's own numeric sort, then reduced to the distinct
        // values: a tie block is one entry of `uniq`, and every row learns its block by bisection.
        const score = new Float64Array(rows.length);
        let usable = 0;
        for (let r = 0; r < rows.length; r++) {
            const v = rows[r][si];
            const n = v === null || v === undefined || v === "" ? NaN : typeof v === "number" ? v : parseFloat(v);
            score[r] = n;
            if (n === n && n !== Infinity && n !== -Infinity) usable++;
        }
        if (usable < 2) continue;
        const ordered = new Float64Array(usable);
        for (let r = 0, k = 0; r < rows.length; r++) {
            const n = score[r];
            if (n === n && n !== Infinity && n !== -Infinity) ordered[k++] = n;
        }
        ordered.sort();
        const uniq = new Float64Array(usable);
        let blocks = 0;
        for (let k = 0; k < usable; k++) if (k === 0 || ordered[k] !== ordered[k - 1]) uniq[blocks++] = ordered[k];
        const blockOf = new Int32Array(rows.length).fill(-1);
        for (let r = 0; r < rows.length; r++) {
            const n = score[r];
            if (!(n === n && n !== Infinity && n !== -Infinity)) continue;
            let lo = 0, hi = blocks - 1;
            while (lo < hi) { const mid = (lo + hi) >>> 1; if (uniq[mid] < n) lo = mid + 1; else hi = mid; }
            blockOf[r] = lo;
        }

        const entries: ScoreSeparationEntry[] = [];
        const inFirst = new Int32Array(blocks), inSecond = new Int32Array(blocks);
        for (let k = 0; k < outcomeIdx.length; k++) {
            const code = codes[k];
            inFirst.fill(0); inSecond.fill(0);
            let n1 = 0, n2 = 0;
            for (let r = 0; r < rows.length; r++) {
                const b = blockOf[r];
                if (b < 0) continue;
                if (code[r] === 1) { inFirst[b]++; n1++; } else if (code[r] === 2) { inSecond[b]++; n2++; }
            }
            if (n1 === 0 || n2 === 0) continue;
            // The rarer value is the positive class; an exact tie goes to the alphabetically first value.
            const minorityIsFirst = n1 <= n2;
            const nMinority = minorityIsFirst ? n1 : n2;
            const nMajority = minorityIsFirst ? n2 : n1;
            const minority = minorityIsFirst ? inFirst : inSecond;
            const majority = minorityIsFirst ? inSecond : inFirst;

            // Walk the tie blocks upward. A minority case beats every majority case below its block and
            // draws with the majority cases inside it.
            let wins = 0, majorityBelow = 0, tied = 0;
            for (let b = 0; b < blocks; b++) {
                const minHere = minority[b], majHere = majority[b];
                wins += minHere * (majorityBelow + 0.5 * majHere);
                majorityBelow += majHere;
                if (minHere + majHere >= 2) tied += minHere + majHere;
            }
            entries.push({
                outcome: columns[outcomeIdx[k]].name,
                aucMinorityHigh: Math.round((wins / (nMinority * nMajority)) * 10000) / 10000,
                nMinority,
                nMajority,
                ties: tied,
            });
        }
        if (entries.length > 0) result.set(si, entries);
    }
    return result;
}
