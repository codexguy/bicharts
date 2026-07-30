// ONE FRONT DOOR for turning a data source into a measured shape.
//
// The profiler engine (IndexedText) takes columns + positional rows. Getting a real data
// source into that form is a small, fiddly job that every consumer was solving privately:
// infer or accept types, decide measure vs dimension, carry the host's format strings and
// descriptions through, convert values, feed the engine, read the shape back. Written once
// per consumer, it drifts once per consumer.
//
// So: many decoders, ONE core.
//
//   ingest({ kind: "csv",     text })                       -> IngestResult
//   ingest({ kind: "grid",    header, rows })
//   ingest({ kind: "table",   columns, rows })
//   ingest({ kind: "objects", rows })
//   ingest({ kind: "sql",     schema, rows })
//
// THE DECODER CONTRACT, which is the whole point of the abstraction:
//
//   A decoder's only job is to translate what the source ALREADY KNOWS into
//   ColumnDescriptor[] + IngestOptions. It never measures, and the core never guesses
//   what the source already told it.
//
// A relational source knows its types, precision and nullability. A semantic model knows
// roles, format strings and descriptions. A bare CSV knows names and nothing else. Each is
// entitled to contribute exactly what it has; inference is the fallback, never the override.
// Re-sniffing a DECIMAL(18,2) column to decide whether it is a measure is both wasteful and
// lossier than reading the schema.
import Papa from "papaparse";
import { IndexedText, isIdentifierName } from "./indexedText";
import type { LLMColumnWithValue } from "./models";

/** Engine value types. Anything a decoder cannot map confidently becomes "String". */
export type EngineDataType = "String" | "Integer" | "Decimal" | "DateTime";

/**
 * One descriptor per column, as the shared core consumes it. Everything except `name` is
 * optional: a schema-aware caller supplies the known type, role, format and description; a
 * bare CSV supplies only names and the core infers the rest.
 */
export interface ColumnDescriptor {
    name: string;
    /** Omit to infer from a sample of values. */
    dataType?: EngineDataType | string;
    /** Explicit measure/dimension role. Omit to apply the numeric-non-identifier heuristic. */
    isMeasure?: boolean;
    /** Format string from the model, e.g. "$#,##0" or "0.0%". Surfaces as modelFormat. */
    format?: string;
    /** Human description from the model. Surfaces as modelDesc. */
    description?: string;
}

/** Column metadata as a relational catalogue reports it (INFORMATION_SCHEMA and friends). */
export interface SqlColumnMeta {
    name: string;
    /** The SQL type name — "int", "decimal", "nvarchar", "datetime2", … Case-insensitive. */
    dataType: string;
    numericPrecision?: number;
    numericScale?: number;
    isNullable?: boolean;
    /** Optional model-level extras, when the caller has them. */
    format?: string;
    description?: string;
    /** Explicit role, when the caller knows better than the type mapping. */
    isMeasure?: boolean;
}

export interface IngestOptions {
    /** Force these columns to MEASURE, by name (case-insensitive). */
    measures?: string[];
    /** Force these columns to DIMENSION, by name (case-insensitive). */
    dimensions?: string[];
    /** column -> format string. Overrides a descriptor's own `format`. */
    formats?: Record<string, string>;
    /** column -> description. Overrides a descriptor's own `description`. */
    descriptions?: Record<string, string>;
    /** Columns that are the primary series/breakdown. Surfaces as isGrouping. */
    groupBy?: string[];
    /** MEASURE columns that must not be summed across groups (a ratio, average or rate). */
    nonAdditive?: string[];
    /** "0" | "10" | "20" | "30" — how much detail the measured shape carries. Default "20". */
    privacyLevel?: string;
    /** Locale for temporal classification (month-name matching). Default "en". */
    locale?: string;
    /**
     * Collapse value-identical rows. DEFAULT TRUE, which preserves the engine's long-standing
     * behaviour and is usually what a chart wants — duplicate rows add no shape information
     * and inflate every distribution statistic.
     *
     * Set false when row identity matters to the caller: the returned `rows` must line up
     * one-to-one with the source rows for selection round-tripping, or duplicates are
     * themselves the signal (raw event streams, where "the same reading twice" is data).
     *
     * This changes `rows`, `totalRows` and every count-derived statistic, so it is a
     * measurement decision, not a formatting one.
     */
    dedup?: boolean;
    /**
     * For the `objects` decoder: how many rows to scan when discovering column names.
     * Default 500. Raise it for sparse payloads where late rows introduce new keys.
     */
    columnScanLimit?: number;
}

export interface IngestResult {
    /** The MEASURED shape — bind this straight to a renderer. */
    columns: LLMColumnWithValue[];
    /** Row objects keyed by column name — bind this straight to a renderer. */
    rows: Record<string, any>[];
    /**
     * Rows the engine actually holds. With dedup on this is the DISTINCT count, which is the
     * honest denominator for the statistics in `columns`.
     */
    totalRows: number;
    /** The live engine, for callers that need more than the shape (leaf cardinality, CSV…). */
    index: IndexedText;
}

/** Discriminated union of everything the front door accepts. */
export type DataSource =
    | { kind: "csv"; text: string }
    | { kind: "grid"; header: string[]; rows: any[][] }
    | { kind: "table"; columns: ColumnDescriptor[]; rows: Array<any[] | Record<string, any>> }
    | { kind: "objects"; rows: Record<string, any>[]; columns?: ColumnDescriptor[] }
    | { kind: "sql"; schema: SqlColumnMeta[]; rows: Array<any[] | Record<string, any>> };

// ---------------------------------------------------------------------------
// Type inference — used ONLY where a descriptor is silent.
// ---------------------------------------------------------------------------

const TYPE_SAMPLE_CAP = 500;
const INT_RE = /^[+-]?\d{1,15}$/;
const NUM_RE = /^[+-]?(\d{1,3}(,\d{3})*|\d+)(\.\d+)?([eE][+-]?\d+)?$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const SLASH_DATE_RE = /^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/;

function inferDataType(samples: any[]): EngineDataType {
    let ints = 0, nums = 0, dates = 0, nonblank = 0;

    for (const raw of samples) {
        if (raw === null || raw === undefined) continue;
        // Already-typed values classify by JS type — no string round-trip.
        if (typeof raw === "number") { nonblank++; nums++; if (Number.isInteger(raw)) ints++; continue; }
        if (raw instanceof Date) { nonblank++; dates++; continue; }
        if (typeof raw === "boolean") { nonblank++; continue; }   // -> String (true/false labels)
        const v = String(raw).trim();
        if (v === "") continue;
        nonblank++;
        if (INT_RE.test(v)) { ints++; nums++; continue; }
        if (NUM_RE.test(v)) { nums++; continue; }
        if ((ISO_DATE_RE.test(v) || SLASH_DATE_RE.test(v)) && !isNaN(Date.parse(v))) { dates++; continue; }
    }

    if (nonblank === 0) return "String";
    // Dates tolerate a few stragglers; numbers do not — one non-numeric value means the
    // column is not safely numeric, and coercing it would silently null real data.
    if (dates / nonblank > 0.9) return "DateTime";
    if (ints === nonblank) return "Integer";
    if (nums === nonblank) return "Decimal";
    return "String";
}

function convert(v: any, dataType: string): any {
    if (v === null || v === undefined) return null;
    if (typeof v === "number") return dataType === "String" ? String(v) : v;
    if (v instanceof Date) return dataType === "DateTime" ? v : v.toISOString();
    if (typeof v === "boolean") return String(v);
    const s = String(v).trim();
    if (s === "") return null;
    switch (dataType) {
        case "Integer": return INT_RE.test(s) ? parseInt(s, 10) : null;
        case "Decimal": return NUM_RE.test(s) ? parseFloat(s.replace(/,/g, "")) : null;
        case "DateTime": { const t = Date.parse(s); return isNaN(t) ? null : new Date(t); }
        default: return s;
    }
}

/**
 * Map a relational type name onto an engine type. Deliberately generous about vendor
 * spellings — the cost of a miss is a numeric column measured as text, which changes the
 * chart. Unknown types fall through to "String", which is always safe: a value that cannot
 * be parsed is better described as a label than silently nulled.
 */
export function engineTypeForSqlType(sqlType: string): EngineDataType {
    const t = (sqlType || "").toLowerCase().replace(/\(.*$/, "").trim();

    if (/^(tinyint|smallint|int|integer|int2|int4|int8|bigint|serial|bigserial)$/.test(t)) return "Integer";
    if (/^(decimal|numeric|money|smallmoney|float|real|double|double precision|number)$/.test(t)) return "Decimal";
    if (/^(date|datetime|datetime2|smalldatetime|datetimeoffset|timestamp|timestamptz|time)$/.test(t)) return "DateTime";
    if (/^(bit|bool|boolean)$/.test(t)) return "String";        // true/false read as labels

    return "String";
}

// ---------------------------------------------------------------------------
// The shared core.
// ---------------------------------------------------------------------------

/**
 * PRECEDENCE, stated rather than implied:
 *
 *      caller override (opts.measures / opts.dimensions)     <- wins
 *              |
 *      host metadata (descriptor.isMeasure / .format / .description)
 *              |
 *      inference (numeric && !identifier-shaped name)        <- last resort
 *
 * An explicit argument from the caller beats what the source reported, because the caller is
 * the one who can see the chart. Inference only ever fills a gap; it never overrules either.
 */
function buildProfile(
    descriptors: ColumnDescriptor[],
    rows: any[][],
    opts: IngestOptions,
): IngestResult {
    if (descriptors.length === 0) {
        throw new Error("ingest: no columns were resolved from the source. Supply column descriptors, or use a source shape that carries them (grid/table/objects/sql).");
    }

    const n = descriptors.length;

    // 1. Types — the descriptor's own, else inferred from a bounded sample.
    const types: string[] = descriptors.map((d, c) =>
        d.dataType ?? inferDataType(rows.slice(0, TYPE_SAMPLE_CAP).map(r => r?.[c])));

    // 2. Roles, by the ladder above.
    const forceM = new Set((opts.measures ?? []).map(s => s.toLowerCase()));
    const forceD = new Set((opts.dimensions ?? []).map(s => s.toLowerCase()));
    const nonAdd = new Set((opts.nonAdditive ?? []).map(s => s.toLowerCase()));

    const cols: LLMColumnWithValue[] = descriptors.map((d, c) => {
        const lower = d.name.toLowerCase();
        let isMeasure = d.isMeasure ?? ((types[c] === "Integer" || types[c] === "Decimal") && !isIdentifierName(d.name));
        if (forceM.has(lower)) isMeasure = true;
        if (forceD.has(lower)) isMeasure = false;

        const col: LLMColumnWithValue = { name: d.name, dataType: types[c], isMeasure };
        // Feeds classification, so it must be set BEFORE the stats pass reads it.
        if (isMeasure && nonAdd.has(lower)) col.discourageAggregationAcrossGroups = true;
        return col;
    });

    // 3. Feed the engine.
    const index = new IndexedText();
    index.dedupRows = opts.dedup !== false;      // default true
    index.setColumns(cols);
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        index.addRow(Array.from({ length: n }, (_, c) => convert(r?.[c], types[c])), i);
    }

    // 4. Measure.
    const shape = index.getColumnsWithStats(opts.privacyLevel ?? "20", opts.locale ?? "en");

    // 5. Pass-through host metadata. Descriptor values first, then caller options override by
    //    name — the same ladder as roles, applied to the fields the engine does not compute.
    const byName = new Map(shape.map(c => [c.name, c]));
    descriptors.forEach(d => {
        const c = byName.get(d.name);
        if (!c) return;
        if (d.format) c.modelFormat = d.format;
        if (d.description) c.modelDesc = d.description;
    });
    for (const [nm, fmt] of Object.entries(opts.formats ?? {})) { const c = byName.get(nm); if (c) c.modelFormat = fmt; }
    for (const [nm, ds] of Object.entries(opts.descriptions ?? {})) { const c = byName.get(nm); if (c) c.modelDesc = ds; }
    for (const nm of opts.groupBy ?? []) { const c = byName.get(nm); if (c) c.isGrouping = true; }

    return {
        columns: shape,
        rows: index.toObjectArray(),
        totalRows: index.getRowCount(),
        index,
    };
}

// ---------------------------------------------------------------------------
// Decoders.
// ---------------------------------------------------------------------------

/** Normalise mixed positional/object rows to positional arrays aligned to `names`. */
function toPositional(rows: Array<any[] | Record<string, any>>, names: string[]): any[][] {
    return rows.map(r => Array.isArray(r) ? r : names.map(nm => (r as Record<string, any>)[nm]));
}

/**
 * Column names from row objects. Scans a window rather than only the first row: a sparse
 * payload (JSON APIs especially) can introduce a key late, and a column discovered on row
 * 400 is still a column. First-seen order is preserved so output is stable and readable.
 */
function namesFromObjects(rows: Record<string, any>[], scanLimit: number): string[] {
    const seen: string[] = [];
    const have = new Set<string>();
    const cap = Math.min(rows.length, Math.max(1, scanLimit));
    for (let i = 0; i < cap; i++) {
        const r = rows[i];
        if (!r || typeof r !== "object") continue;
        for (const k of Object.keys(r)) {
            if (!have.has(k)) { have.add(k); seen.push(k); }
        }
    }
    return seen;
}

/**
 * Turn a data source into a measured shape plus directly bindable rows.
 *
 * The result is meant to be destructured and handed straight to a renderer:
 *
 *     const { rows, columns } = ingest({ kind: "csv", text });
 *
 * `index` is there for callers that need the engine itself; nothing routine should.
 */
export function ingest(source: DataSource, opts: IngestOptions = {}): IngestResult {
    switch (source.kind) {
        case "csv": {
            const parsed = Papa.parse<string[]>(source.text, { skipEmptyLines: true });
            if (parsed.errors?.length && parsed.data.length === 0) {
                throw new Error(`ingest: CSV parse failed - ${parsed.errors[0].message}`);
            }
            const grid = parsed.data as string[][];
            if (grid.length < 2) {
                throw new Error("ingest: CSV needs a header line plus at least one data row.");
            }
            const header = grid[0].map(h => (h ?? "").trim());
            return buildProfile(header.map(name => ({ name })), grid.slice(1), opts);
        }

        case "grid": {
            if (!source.header?.length) throw new Error("ingest: 'grid' needs a non-empty header.");
            return buildProfile(source.header.map(name => ({ name: (name ?? "").trim() })), source.rows ?? [], opts);
        }

        case "table": {
            if (!source.columns?.length) throw new Error("ingest: 'table' needs at least one column descriptor.");
            const names = source.columns.map(c => c.name);
            return buildProfile(source.columns, toPositional(source.rows ?? [], names), opts);
        }

        case "objects": {
            const rows = source.rows ?? [];
            // Explicit descriptors win when given — a caller that knows its schema should not
            // have it re-derived from keys. Otherwise discover names from the rows themselves,
            // which is the case that had no front door at all: query results, ORM output, JSON.
            const descriptors = source.columns?.length
                ? source.columns
                : namesFromObjects(rows, opts.columnScanLimit ?? TYPE_SAMPLE_CAP).map(name => ({ name }));
            if (!descriptors.length) {
                throw new Error("ingest: 'objects' produced no columns - the rows array is empty or holds no object keys.");
            }
            return buildProfile(descriptors, toPositional(rows, descriptors.map(d => d.name)), opts);
        }

        case "sql": {
            if (!source.schema?.length) throw new Error("ingest: 'sql' needs at least one schema column.");
            const descriptors: ColumnDescriptor[] = source.schema.map(m => {
                const dataType = engineTypeForSqlType(m.dataType);
                return {
                    name: m.name,
                    dataType,
                    // The catalogue settles the TYPE; the role still follows the shared ladder
                    // unless the caller stated it. A numeric key column is a dimension, and
                    // only the name carries that signal.
                    isMeasure: m.isMeasure,
                    format: m.format,
                    description: m.description,
                };
            });
            return buildProfile(descriptors, toPositional(source.rows ?? [], descriptors.map(d => d.name)), opts);
        }

        default: {
            const bad = source as { kind?: string };
            throw new Error(`ingest: unknown source kind '${bad?.kind}'. Expected one of: csv, grid, table, objects, sql.`);
        }
    }
}
