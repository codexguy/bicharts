// A PAGE FILTER INTO A DAX QUERY (2026-10-02). Published as "@bicharts/chart-host/dax".
//
// Every agent-built Fabric App passed a selection into a query by hand - a second .dax template, a
// string spliced in, a regex guard on the value or none (one app interpolated a clicked value
// unescaped). Microsoft's own data app skills build the same thing as CALCULATETABLE + TREATAS,
// so this does exactly that, with the escaping done once:
//
//   const q = calculateTable(BASE, treatAs(region, "'Geography'[RegionCode]"));
//   // nothing picked -> BASE unchanged; picked -> CALCULATETABLE(BASE, TREATAS({"JPN"}, 'Geography'[RegionCode]))
//
// A filter keyed by several columns names a column reference for each, in the filter's order. Fewer references map
// the key's first columns only (treatAs(cell, "Accounts[Region]") on a Region x Stage pick takes the region), so the
// chart over that query names the same columns in its scopedBy entry: { filter: cell, takes: ["Region"] }.

import type { Filter, FilterKey } from "./filterScope";
import { isAnyValue } from "./filterScope";

/** A DAX column reference: Table[Column] or 'Table name'[Column]. */
const COLUMN_REF = /^(?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_]*)\[[^\]]+\]$/;

/** One value as a DAX literal: text quoted with "" doubled, numbers, TRUE()/FALSE(), dates, BLANK(). */
export function daxLiteral(v: unknown): string {
    if (v == null) return "BLANK()";
    if (typeof v === "boolean") return v ? "TRUE()" : "FALSE()";
    if (typeof v === "number") {
        if (!Number.isFinite(v)) throw new Error(`daxLiteral: ${v} has no DAX literal`);
        return String(v);
    }
    if (typeof v === "bigint") return v.toString();
    if (v instanceof Date) {
        if (Number.isNaN(v.getTime())) throw new Error("daxLiteral: an invalid Date");
        return `DATE(${v.getFullYear()}, ${v.getMonth() + 1}, ${v.getDate()})`
            + (v.getHours() || v.getMinutes() || v.getSeconds()
                ? ` + TIME(${v.getHours()}, ${v.getMinutes()}, ${v.getSeconds()})` : "");
    }
    return `"${String(v).replace(/"/g, "\"\"")}"`;
}

/**
 * TREATAS over a filter's selected keys (or keys given directly), onto the named model columns -
 * or null when nothing is selected, so `calculateTable` leaves the query unfiltered.
 */
export function treatAs(selection: Filter | readonly (FilterKey | unknown)[] | null | undefined,
                        ...columnRefs: string[]): string | null {
    if (!columnRefs.length) throw new Error("treatAs: name the model column, e.g. treatAs(region, \"'Geography'[RegionCode]\")");
    for (const c of columnRefs) {
        if (!COLUMN_REF.test(c.trim())) throw new Error(`treatAs: "${c}" isn't a column reference like 'Table'[Column]`);
    }
    const keys: FilterKey[] = !selection ? [] : isFilter(selection)
        ? selection.keys.slice()
        : (selection as readonly unknown[]).map(k => (Array.isArray(k) ? k : [k]));
    if (!keys.length) return null;
    const width = columnRefs.length;
    for (const k of keys) {
        if (k.length < width) throw new Error(`treatAs: a key has ${k.length} value(s) for ${width} column(s)`);
    }
    // A LABEL'S PICK LEAVES SOME COLUMNS FREE (a region in any stage): the query is filtered by the columns it names only.
    // Keys that all free the same columns go into one TREATAS over the rest; keys that free different ones (a region picked
    // whole beside one region-and-stage) can't share a TREATAS, so they go in as one FILTER over the columns' values.
    const refs = columnRefs.map(c => c.trim());
    const pattern = (k: FilterKey) => k.slice(0, width).map(v => (isAnyValue(v) ? "*" : "=")).join("");
    const patterns = new Set(keys.map(pattern));
    if (patterns.size === 1) {
        const fixed = [...patterns][0].split("").map((p, i) => (p === "=" ? i : -1)).filter(i => i >= 0);
        if (!fixed.length) return null;                                  // every column free: nothing to filter by
        const rows = keys.map(k => (fixed.length === 1 ? daxLiteral(k[fixed[0]]) : `(${fixed.map(i => daxLiteral(k[i])).join(", ")})`));
        return `TREATAS({${rows.join(", ")}}, ${fixed.map(i => refs[i]).join(", ")})`;
    }
    const preds = keys.map(k => `(${k.slice(0, width).map((v, i) => (isAnyValue(v) ? null : `${refs[i]} = ${daxLiteral(v)}`))
        .filter(Boolean).join(" && ") || "TRUE()"})`);
    return `FILTER(CROSSJOIN(${refs.map(r => `VALUES(${r})`).join(", ")}), ${preds.join(" || ")})`;
}

/**
 * CALCULATETABLE(table, filters...) with the null filters dropped - the table expression unchanged
 * when none is left. `table` is a table expression (SUMMARIZECOLUMNS(...)), not a whole query with
 * EVALUATE.
 */
export function calculateTable(table: string, ...filters: Array<string | null | undefined | false>): string {
    const live = filters.filter((f): f is string => typeof f === "string" && f.trim().length > 0);
    return live.length ? `CALCULATETABLE(\n${table},\n${live.join(",\n")}\n)` : table;
}

/**
 * A whole query (`[DEFINE ...] EVALUATE <table> [ORDER BY ...]`, as a .dax file holds it) with its table filtered:
 * the table expression goes inside CALCULATETABLE with the filters, DEFINE and ORDER BY stay where they are. With no
 * live filter the query comes back unchanged. One EVALUATE only (throws on more).
 *
 *   filterQuery(FORECAST_DAX, treatAs(region, "Geography[RegionCode]"))
 */
export function filterQuery(query: string, ...filters: Array<string | null | undefined | false>): string {
    const live = filters.filter((f): f is string => typeof f === "string" && f.trim().length > 0);
    if (!live.length) return query;
    const evals = query.match(/\bEVALUATE\b/gi) ?? [];
    if (evals.length !== 1) throw new Error(`filterQuery: expected one EVALUATE, found ${evals.length}`);
    const m = /^([\s\S]*?\bEVALUATE\b)([\s\S]*?)(\bORDER\s+BY\b[\s\S]*)?$/i.exec(query)!;
    const head = m[1], table = m[2].trim(), tail = m[3] ?? "";
    return `${head}\n${calculateTable(table, ...live)}\n${tail}`.replace(/\n$/, "");
}

function isFilter(x: unknown): x is Filter {
    return !!x && typeof x === "object" && Array.isArray((x as Filter).keys) && typeof (x as Filter).has === "function";
}

// ── a query's rows by column name ───────────────────────────────────────────

/** A DAX query's result as the semantic-model query hooks return it: headers, then rows of values in header order. */
export interface QueryTable {
    columns: readonly { name: string }[];
    rows: readonly (readonly unknown[])[];
}

/** A header's table (quoted or not, absent for a measure) and its bracketed name, `]]` standing for `]`. */
const HEADER = /^(?:'(?:[^']|'')*'|[^[\]']*)\[((?:[^\]]|\]\])+)\]$/;

/**
 * A result header's bare name: "Accounts[Account Number]" and "'Sales Owners'[Owner]" give the column's name,
 * "[Total Revenue]" the measure's; a header that isn't a reference comes back as it is.
 */
export function columnName(header: string): string {
    const m = HEADER.exec(String(header ?? "").trim());
    return m ? m[1].replace(/\]\]/g, "]") : String(header ?? "");
}

/**
 * A QUERY'S ROWS BY COLUMN NAME, for a query that feeds no chart: a form's choice list, a lookup, a count beside a
 * chart. A DAX result names its columns "Table[Column]" and its measures "[Measure]"; each row comes back as an object
 * keyed by the bare name, so `row["Account Number"]` reads Accounts[Account Number]. Two headers with one bare name
 * (Accounts[Name] beside Owners[Name]) keep their whole headers, so neither hides the other. Takes the table or the
 * query hook's `data` (a failed or pending result gives no rows):
 *
 *   const owners = queryRows(useSemanticModelQuery({ connection, query: OWNERS_DAX }).data);
 *   owners.map(r => r["Sales owner"])
 */
export function queryRows(result: QueryTable | { status?: string; table?: QueryTable } | null | undefined): Record<string, unknown>[] {
    const table = result && "columns" in result ? result : result && "table" in result ? result.table : undefined;
    if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) return [];
    const bare = table.columns.map(c => columnName(c?.name ?? ""));
    const count = new Map<string, number>();
    for (const b of bare) count.set(b, (count.get(b) ?? 0) + 1);
    const names = bare.map((b, i) => ((count.get(b) ?? 0) > 1 ? String(table.columns[i]?.name ?? b) : b));
    return table.rows.map(r => {
        const o: Record<string, unknown> = {};
        names.forEach((n, k) => { o[n] = r?.[k]; });
        return o;
    });
}
