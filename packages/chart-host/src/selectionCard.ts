// SELECTION CARD ARITHMETIC — what a click on a mark actually AMOUNTS to (2026-08-25).
//
// THE GAP. Clicking a mark already produces feedback in every host: marks carry
// `data-row-idx`, the host dims everything outside the selection, a second click clears it. In
// Power BI that click also cross-filters the rest of the report, so the dimming is the START of
// an answer. In Excel — and in the MCP and React hosts — there is no rest of the report, so the
// dimming IS the whole response. The UI promises interaction and then says nothing.
//
// WHY THIS LIVES HERE AND NOT IN GENERATED CODE. "Applies to ALL chart types" rules out asking
// the model for it: that would be a per-type, per-generation gamble across 80+ types, and every
// chart already cached would never get it. Built on `buildRenderPayload`'s {columns, rows} —
// which every consumer already holds at draw time — the capability is true by construction, it
// reaches cached charts retroactively, a chart type added next month inherits it by existing,
// and the exec gate and CQC never see it.
//
// PURE FUNCTION, NO DOM. The chrome is thin and per-host (the visual mounts it in its overlay
// layer, the add-in in its chart wrap); the arithmetic is identical everywhere, so it is here
// and it is testable without a browser.

import type { RenderPayload } from "./payload";
// ONE CLASSIFIER DECIDES WHAT MAY BE AGGREGATED (2026-09-01). Until then this file
// decided for itself — any numeric column got a line, at whatever aggregation the host had
// chosen — and the shipped 21-city sample table produced `Sum of Latitude: 84 (12.3% of total)`:
// a total of coordinates with a SHARE of that total beside it, in the one place the reader
// cannot check anything. The knowledge existed the whole time, in the server's own additivity
// resolver, on the wrong side of a wire this card must never cross. It now lives in
// shape-core, which is BUNDLED into this package rather than imported by consumers, so the card
// can simply ask.
import {
    classifyForAggregation, allowedAggregations, defaultAggregation, shareOfTotalIsHonest,
} from "@bicharts/shape-core";
// A DATE IS NOT A STRING (2026-09-09). `buildRenderPayload` coerces Date cells to `toISOString()`
// because that is the wire the prompt contract states, and this file then read those same cells
// with `String(raw)` - so a click on a weekly point answered `2025-08-31T00:00:00.000Z`. The
// header's own job is to say what was clicked "in their own data's words"; that string is the
// machine's. See sourceDateFormat.ts for why the SOURCE's format is what gets matched.
import { formatSourceDate, type SourceFormats } from "./sourceDateFormat";

/** Columns the payload appends for its own plumbing. Never a measure, never a dimension, never
 *  shown: `__rowIdx__` IS the row position, and the geo trio is host metadata. A card that
 *  offered "Sum of __geoLat__" would be arithmetic on a coordinate.
 *
 *  This guard was RIGHT and was never the whole rule: the synthetic twin of a coordinate was
 *  excluded while the user's own `Latitude` column, the same number under a different name, was
 *  not. The classifier above is the general form of the same sentence. */
const SYNTHETIC_PREFIX = "__";

/** dataType strings that carry a magnitude. Deliberately liberal: the string comes from
 *  whichever host measured the data (Power BI's model, shape-core's inference over a
 *  worksheet), and a measure missed here is a line silently absent from the card. */
const NUMERIC_DATATYPE = /int|double|decimal|single|float|number|currency|money/i;

export interface SelectionCardOptions {
    /** The chart's own aggregation, so the card AGREES with the picture it sits on. A card
     *  reading "Sum" beside a chart drawn from averages is two answers to one question.
     *
     *  BLANK MEANS AUTO, and Auto is now per COLUMN. The Excel settings panel has offered
     *  "Auto — sum amounts, average rates" since the control shipped; `normaliseAggregation("")`
     *  answered `sum` for every column alike, so the label described a rule the code did not
     *  implement. A blank now resolves through `defaultAggregation` per column: amounts sum,
     *  rates average, dimensions report their value. A NAMED aggregation is still honoured
     *  wherever it is honest, and substituted per column where it is not — the label carries
     *  the substitution, so "Average of ChurnRate" beside "Sum of Revenue" reads as the answer
     *  it is rather than a silent override. */
    aggregation?: string;
    cultureCode?: string;
    /** Cards are capped at roughly a third of the tile, so the measure list is capped too.
     *  `hiddenMeasures` reports what was dropped rather than truncating silently. */
    maxMeasures?: number;
    /** Past this many distinct dimension values the header becomes "N marks" — naming twelve
     *  cities in a header is not a header. */
    maxHeaderValues?: number;
    /** How many DIMENSION lines to add below the measures. Capped separately and small on
     *  purpose: dimensions must never crowd out the amounts, which is the failure the measure
     *  cap already had (on the sample table the two coordinate columns took two of the four
     *  measure slots and pushed the real measures under "+2 more"). Default 2. */
    maxDimensions?: number;
    /** THE SOURCE'S OWN DATE FORMATS, keyed by column name, plus the dialect they are written in
     *  — Excel's `range.numberFormat` for the add-in, a `.NET` format string for the visual.
     *
     *  Optional, and the fallback is deliberately good rather than minimal: a host that supplies
     *  nothing still gets a locale date instead of the ISO instant this replaced, so the MCP and
     *  React hosts (a CSV has no cell formatting to read) and every chart cached before today
     *  improve without anyone plumbing anything. What the map buys is AGREEMENT with the cells
     *  the card is floating over — a sheet that shows `31-Aug-25` gets a card that says
     *  `31-Aug-25`. */
    sourceFormats?: SourceFormats | null;
}

export interface SelectionCardLine {
    column: string;
    /** "Sum of Revenue" — the aggregation is named because it is not always sum. For a
     *  dimension resolving to ONE value it is just the column name, because "First of Segment:
     *  East" says nothing "Segment: East" does not. */
    label: string;
    /** Null for a dimension line, whose answer is text. `valueText` is what a host renders. */
    value: number | null;
    valueText: string;
    /** Share of the same aggregate over ALL rows. Null whenever a share would be a lie — it
     *  needs BOTH an additive aggregation and an additive COLUMN. The average of a subset is
     *  not a percentage of the average of the whole; neither is a total of latitudes. */
    sharePct: number | null;
    shareText: string;
    /** Which aggregation this line actually used, after any per-column substitution. */
    aggregation: string;
}

export interface SelectionCardModel {
    header: string;
    /** MEASURE lines. Kept measures-only so `maxMeasures` and `hiddenMeasures` keep meaning
     *  exactly what they meant; dimensions have their own list and their own cap. */
    lines: SelectionCardLine[];
    /** DIMENSION lines — the "First, Count, Distinct" half. Before 2026-09-01 the FIRST dimension
     *  supplied the header and every other one was discarded, so on the sample table `Segment`
     *  appeared nowhere at all. The header column is still excluded here: it is already on
     *  screen. */
    dimensionLines: SelectionCardLine[];
    /** "6 of 24 rows" — the one line that is true regardless of what the columns contain. */
    rowsText: string;
    selectedRows: number;
    totalRows: number;
    /** Measures the cap left out, so a host can say "+2 more" instead of implying there were none. */
    hiddenMeasures: number;
    /** Columns the CLASSIFIER withheld rather than the cap — coordinates today. Not for display:
     *  a reader does not need telling that a latitude was not totalled. It is here so a host can
     *  log it, because a column vanishing from a card with no trace is the kind of thing that
     *  costs an afternoon later. */
    suppressedColumns: string[];
    aggregation: string;
}

/** The set this file reduces over. `first` is shape-core's eighth kind and is handled on the
 *  dimension path only, which is why it is absent here — a `reduce` over numbers has nothing to
 *  do with it. */
type Agg = "sum" | "average" | "min" | "max" | "count" | "median" | "distinctcount";

/** Normalise the many spellings the hosts use into the set this file reduces over. Unknown
 *  spellings fall back to sum rather than throwing: a card is a courtesy, and refusing to draw
 *  one because a host wrote "Total" is a worse outcome than summing. */
export function normaliseAggregation(raw: string | undefined | null): Agg {
    const s = String(raw ?? "").trim().toLowerCase();
    if (!s) return "sum";
    if (/^(avg|average|mean)$/.test(s)) return "average";
    if (/^(min|minimum)$/.test(s)) return "min";
    if (/^(max|maximum)$/.test(s)) return "max";
    if (/^(count|countrows)$/.test(s)) return "count";
    if (/^(median|med)$/.test(s)) return "median";
    if (/^(distinctcount|dcount|countdistinct|uniques?)$/.test(s)) return "distinctcount";
    return "sum";
}

/** SHARE-OF-TOTAL IS ONLY HONEST FOR AN ADDITIVE AGGREGATE **OF AN ADDITIVE COLUMN**.
 *
 *  "23% of total" means the part over the whole, and that only holds when the parts sum to the
 *  whole. Sum does. Count does. An AVERAGE does not — the mean of six rows is not a percentage
 *  of the mean of twenty-four, and printing one would be a confidently wrong number in the one
 *  place the reader has no way to check it. Min/max/median likewise.
 *
 *  That was the whole rule until 2026-09-01, and it was only half of it: it reasoned about the
 *  AGGREGATION and never about the COLUMN, so a sum of latitudes — additive aggregation, and
 *  not a quantity at all — printed "12.3% of total". Both halves now live in
 *  `shareOfTotalIsHonest`, one predicate rather than two that can disagree. */

function aggLabel(agg: Agg): string {
    switch (agg) {
        case "average": return "Average";
        case "min": return "Min";
        case "max": return "Max";
        case "count": return "Count";
        case "median": return "Median";
        case "distinctcount": return "Distinct";
        default: return "Sum";
    }
}

function isSynthetic(name: string): boolean {
    return String(name ?? "").startsWith(SYNTHETIC_PREFIX);
}

function isMeasureColumn(col: any): boolean {
    if (!col || isSynthetic(col.name)) return false;
    // ROLE FIRST, TYPE AS THE FALLBACK. In Power BI the user BOUND the field to a measure well
    // and `isMeasure` says so outright. Excel has no binding UI at all, so shape-core infers it
    // — and where inference declined to commit, a numeric column is still the only thing a
    // magnitude line can be about. Trusting only `isMeasure` would give the add-in an empty
    // card on perfectly ordinary data, which is the host this item exists for.
    if (col.isMeasure === true) return true;
    return NUMERIC_DATATYPE.test(String(col.dataType ?? ""));
}

/** A real column the reader bound or typed, as opposed to payload plumbing. */
function isRealColumn(col: any): boolean {
    return !!col && !isSynthetic(col.name);
}

/**
 * IS THIS COLUMN A DATE THE PAYLOAD SERIALISED, as opposed to a date the reader TYPED?
 *
 * `dataType`, deliberately, and NOT `isTemporal`. The two disagree on exactly the case that
 * matters: a full calendar date stored as TEXT is `isTemporal: true` with `dataType: "String"`,
 * it keeps its own characters all the way through the payload, and those characters ARE the
 * source's formatting — `15/03/2024` is what the cell says and what the card should say. Only a
 * DateTime column went through `toISOString()` on the way to the wire, so only a DateTime column
 * has something to undo.
 */
function isSerialisedDateColumn(col: any): boolean {
    return /^datetime/i.test(String(col?.dataType ?? ""));
}

/** What a reader sees for one raw cell. Dates route through the source formatter; everything
 *  else is the string it always was, blanks included. */
function displayText(col: any, raw: any, opts: SelectionCardOptions): string {
    if (raw == null || raw === "") return "(blank)";
    if (isSerialisedDateColumn(col)) {
        const shown = formatSourceDate(raw, {
            format: opts.sourceFormats?.byColumn?.[String(col?.name ?? "")] ?? null,
            dialect: opts.sourceFormats?.dialect,
            culture: opts.cultureCode,
        });
        if (shown) return shown;
    }
    return String(raw);
}

/** Does the classifier withhold this column from arithmetic entirely? Coordinates today. */
function isSuppressed(col: any): boolean {
    return classifyForAggregation(col).suppressed;
}

/**
 * WHICH aggregation this column actually gets.
 *
 * `auto` (a blank from the host) asks the classifier for the column's own best answer — the rule
 * the Excel settings panel has been promising in words. A NAMED aggregation is honoured wherever
 * it is honest and substituted where it is not: a user who picks Sum globally gets Sum on
 * Revenue and Average on ChurnRate, and the label says which, because summing the rate to agree
 * with a dropdown would be a wrong number rather than a consistent one.
 */
function resolveAgg(col: any, requested: Agg, auto: boolean): Agg {
    const fallback = () => {
        const d = defaultAggregation(col);
        // `first` has no numeric reduction; a measure that somehow lands there counts instead.
        return (d === "first" ? "count" : d) as Agg;
    };
    if (auto) return fallback();
    return allowedAggregations(col).indexOf(requested) >= 0 ? requested : fallback();
}

function toNumber(v: any): number | null {
    if (v == null || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
}

function reduce(values: number[], agg: Agg, distinctRaw: any[]): number | null {
    if (agg === "count") return values.length;
    if (agg === "distinctcount") return new Set(distinctRaw.map(v => (v == null ? " " : String(v)))).size;
    if (!values.length) return null;
    switch (agg) {
        case "average": return values.reduce((a, b) => a + b, 0) / values.length;
        case "min": return Math.min(...values);
        case "max": return Math.max(...values);
        case "median": {
            const s = [...values].sort((a, b) => a - b);
            const m = s.length >> 1;
            return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
        }
        default: return values.reduce((a, b) => a + b, 0);
    }
}

function fmtNumber(v: number, culture?: string): string {
    // Compact past six figures: the card is a small floating surface and "1,204,388,201" is a
    // width problem, not a precision win, at the size this is read.
    try {
        const abs = Math.abs(v);
        const opts: Intl.NumberFormatOptions = abs >= 1_000_000
            ? { notation: "compact", maximumFractionDigits: 1 }
            : { maximumFractionDigits: abs < 10 ? 2 : 0 };
        return new Intl.NumberFormat(culture || undefined, opts).format(v);
    } catch {
        // A bad culture code must not cost the reader the number.
        return String(Math.round(v * 100) / 100);
    }
}

/**
 * The card for a selection, or NULL when there is nothing to say.
 *
 * `selectedRowIdxs` are the values a mark carries in `data-row-idx` — which ARE row positions,
 * because `buildRenderPayload` writes `__rowIdx__` as the row's own index. The mapping is
 * resolved through that column when it is present rather than assumed, so a payload that ever
 * reorders rows keeps working.
 *
 * Null (rather than an empty model) when the selection is empty, because "no selection" and "a
 * selection that sums to nothing" are different states and only the first should dismiss the card.
 */
export function computeSelectionCard(
    payload: RenderPayload | null | undefined,
    selectedRowIdxs: number[] | null | undefined,
    opts: SelectionCardOptions = {},
): SelectionCardModel | null {
    const columns: any[] = (payload?.columns as any[]) ?? [];
    const rows: any[][] = (payload?.rows as any[][]) ?? [];
    if (!columns.length || !rows.length) return null;

    const wanted = Array.from(new Set((selectedRowIdxs ?? []).filter(n => Number.isInteger(n))));
    if (!wanted.length) return null;

    // Resolve row-idx -> position. `__rowIdx__` is authoritative where it exists; positional is
    // the fallback for a payload built without it.
    const rowIdxCol = columns.findIndex(c => c?.name === "__rowIdx__");
    let byIdx: Map<number, number> | null = null;
    if (rowIdxCol >= 0) {
        byIdx = new Map();
        for (let r = 0; r < rows.length; r++) {
            const v = toNumber(rows[r]?.[rowIdxCol]);
            if (v != null) byIdx.set(v, r);
        }
    }
    const positions: number[] = [];
    for (const idx of wanted) {
        const pos = byIdx ? byIdx.get(idx) : idx;
        if (pos != null && pos >= 0 && pos < rows.length) positions.push(pos);
    }
    if (!positions.length) return null;

    // A BLANK aggregation is AUTO, and Auto is per column. `normaliseAggregation` still answers
    // `sum` for a blank and is deliberately left alone — it is exported, and a host that asks
    // "what does this string mean" should keep getting the same answer.
    const auto = String(opts.aggregation ?? "").trim().length === 0;
    const agg = normaliseAggregation(opts.aggregation);
    const maxMeasures = opts.maxMeasures ?? 4;
    const maxHeaderValues = opts.maxHeaderValues ?? 3;
    const maxDimensions = opts.maxDimensions ?? 2;

    // ---- header: what the reader just clicked, in their own data's words -------------------
    const dimIdx = columns.findIndex(c => c && !isSynthetic(c.name) && !isMeasureColumn(c));
    let header: string;
    if (dimIdx >= 0) {
        const seen: string[] = [];
        const set = new Set<string>();
        for (const p of positions) {
            const s = displayText(columns[dimIdx], rows[p]?.[dimIdx], opts);
            if (!set.has(s)) { set.add(s); seen.push(s); }
            if (seen.length > maxHeaderValues) break;
        }
        header = seen.length > maxHeaderValues
            ? `${positions.length} marks`
            : seen.join(", ");
    } else {
        header = `${positions.length} mark${positions.length === 1 ? "" : "s"}`;
    }

    // ---- one line per measure --------------------------------------------------------------
    // SUPPRESSED COLUMNS ARE REMOVED BEFORE THE CAP, not after, and that ordering is the whole
    // point on real data: on the sample table Latitude and Longitude are the first two numeric
    // columns, so with maxMeasures at its default of 4 they took half the card and pushed Stores
    // and Satisfaction under "+2 more". The two lines nobody could use were crowding out the two
    // they came for.
    const measureCols: number[] = [];
    const suppressedColumns: string[] = [];
    for (let c = 0; c < columns.length; c++) {
        if (!isMeasureColumn(columns[c])) continue;
        if (isSuppressed(columns[c])) { suppressedColumns.push(String(columns[c]?.name ?? "")); continue; }
        measureCols.push(c);
    }
    const shown = measureCols.slice(0, maxMeasures);

    const lines: SelectionCardLine[] = [];
    for (const c of shown) {
        const col = columns[c];
        const colAgg = resolveAgg(col, agg, auto);
        const selVals: number[] = [];
        const selRaw: any[] = [];
        for (const p of positions) {
            const n = toNumber(rows[p]?.[c]);
            selRaw.push(rows[p]?.[c]);
            if (n != null) selVals.push(n);
        }
        const value = reduce(selVals, colAgg, selRaw);

        let sharePct: number | null = null;
        if (shareOfTotalIsHonest(col, colAgg as any) && value != null) {
            const allVals: number[] = [];
            const allRaw: any[] = [];
            for (let r = 0; r < rows.length; r++) {
                const n = toNumber(rows[r]?.[c]);
                allRaw.push(rows[r]?.[c]);
                if (n != null) allVals.push(n);
            }
            const total = reduce(allVals, colAgg, allRaw);
            // A zero or negative total makes a percentage meaningless (or infinite). Omit it —
            // the value line still stands on its own.
            if (total != null && total > 0) sharePct = (value / total) * 100;
        }

        lines.push({
            column: String(col?.name ?? ""),
            label: `${aggLabel(colAgg)} of ${col?.name ?? ""}`,
            value,
            valueText: value == null ? "—" : fmtNumber(value, opts.cultureCode),
            sharePct,
            shareText: sharePct == null ? "" : `${sharePct < 0.1 ? "<0.1" : sharePct.toFixed(1)}% of total`,
            aggregation: colAgg,
        });
    }

    // ---- and the dimensions the header does not already carry -------------------------------
    // A dimension has no arithmetic, which is why it had no line at all before that change — but it
    // has the two answers a click actually wants: WHICH value is this, and HOW MANY are there.
    // One distinct value gets its own name as the label, because "First of Segment: East" says
    // nothing that "Segment: East" does not.
    const dimensionLines: SelectionCardLine[] = [];
    for (let c = 0; c < columns.length && dimensionLines.length < maxDimensions; c++) {
        if (c === dimIdx) continue;                       // already the header
        if (!isRealColumn(columns[c]) || isMeasureColumn(columns[c])) continue;
        const name = String(columns[c]?.name ?? "");
        // COUNTED ON THE RAW VALUE, RENDERED FROM THE FORMATTED ONE, and the split is deliberate.
        // A date-only source format collapses three distinct timestamps to one string, so
        // counting what is DISPLAYED would quietly turn "Distinct Order Date: 3" into a single
        // value the moment dates started being formatted. The card's arithmetic is unchanged by
        // this file's presentation; only the characters moved.
        const distinct = new Set<string>();
        let firstText = "";
        for (const p of positions) {
            const raw = rows[p]?.[c];
            const key = raw == null || raw === "" ? "(blank)" : String(raw);
            if (!distinct.size) firstText = displayText(columns[c], raw, opts);
            distinct.add(key);
        }
        if (!distinct.size) continue;
        const single = distinct.size === 1;
        dimensionLines.push({
            column: name,
            label: single ? name : `Distinct ${name}`,
            value: single ? null : distinct.size,
            valueText: single ? firstText : fmtNumber(distinct.size, opts.cultureCode),
            sharePct: null,
            shareText: "",
            aggregation: single ? "first" : "distinctcount",
        });
    }

    return {
        header,
        lines,
        dimensionLines,
        suppressedColumns,
        rowsText: `${positions.length} of ${rows.length} rows`,
        selectedRows: positions.length,
        totalRows: rows.length,
        hiddenMeasures: Math.max(0, measureCols.length - shown.length),
        aggregation: agg,
    };
}
