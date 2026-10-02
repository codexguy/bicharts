// A PAGE FILTER INTO A DAX QUERY (2026-10-02). Published as "@bicharts/chart-host/dax".
//
// Every agent-built Fabric App passed a selection into a query by hand - a second .dax template, a
// string spliced in, a regex guard on the value or none (one app interpolated a clicked value
// unescaped). Microsoft's own data app skills build the same thing as CALCULATETABLE + TREATAS,
// so this does exactly that, with the escaping done once:
//
//   const q = calculateTable(BASE, treatAs(country, "'DimCountry'[CountryCode]"));
//   // no country picked -> BASE unchanged; picked -> CALCULATETABLE(BASE, TREATAS({"AUS"}, 'DimCountry'[CountryCode]))
//
// A filter keyed by several columns names a column reference for each, in the filter's order.

import type { Filter, FilterKey } from "./filterScope";

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
    if (!columnRefs.length) throw new Error("treatAs: name the model column, e.g. treatAs(country, \"'DimCountry'[CountryCode]\")");
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
    const rows = keys.map(k => (width === 1 ? daxLiteral(k[0]) : `(${k.slice(0, width).map(daxLiteral).join(", ")})`));
    return `TREATAS({${rows.join(", ")}}, ${columnRefs.map(c => c.trim()).join(", ")})`;
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
 *   filterQuery(PROJECTION_DAX, treatAs(country, "DimCountry[CountryCode]"))
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
