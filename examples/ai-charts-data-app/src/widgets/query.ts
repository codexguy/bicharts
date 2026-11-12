// From the field map to a widget's DAX query, and from a query result to the column names the widget's code reads.
// Pure functions: no React, no network.

import type { FieldBinding, FieldMap } from "@/fieldMap";
import registry from "./widgets.json";

export interface WidgetColumn {
    /** The column name the widget's code reads (it was generated on this name). */
    name: string;
    /** The role in src/fieldMap.ts that fills it. */
    role: string;
}

export interface WidgetDef {
    id: string;
    kind: "chart" | "mini-app";
    renderer: "d3";
    chartType: string;
    title: string;
    subtitle: string;
    /** The role a click (or a lasso) on this widget filters the page by. */
    selects: string | null;
    /** A mini-app's control: knobs it draws (sliders, steppers) or the selection it explains (a lasso or a click). */
    control?: "knobs" | "selection";
    /** Defects in the generated code that no app-side change fixes, with why and what fixes them (npm run check:render). */
    knownDefects?: { check: string; what: string; why: string; fix: string }[];
    columns: WidgetColumn[];
    binding?: { geo?: { column: string; kind: string } | null };
    /** Where the code came from: a bicharts example, or a saved generation named by an opaque ref (never its id). */
    source: { kind: "saved-generation"; ref: string } | { kind: "file"; path: string };
}

export const WIDGET_DEFS = registry.widgets as WidgetDef[];

/** A page filter as the query sees it: the role it narrows and the values picked. */
export interface ActiveFilter {
    role: string;
    values: unknown[];
}

export const rolesOf = (def: WidgetDef): string[] => def.columns.map((c) => c.role);

/** Role -> the code's column name: the `rename` a generated component's rowsFromTable takes. */
export const renameOf = (def: WidgetDef): Record<string, string> =>
    Object.fromEntries(def.columns.map((c) => [c.role, c.name]));

/** The roles this widget reads that the map leaves unbound, in the widget's column order. */
export function missingRoles(def: WidgetDef, map: FieldMap): string[] {
    return rolesOf(def).filter((r) => !isBound(map.roles[r]));
}

function isBound(b: FieldBinding | null | undefined): b is FieldBinding {
    if (!b) return false;
    if ("column" in b) return !!b.table && !!b.column;
    if ("measure" in b) return !!b.measure;
    return !!b.expression;
}

export const isColumn = (b: FieldBinding): b is { table: string; column: string } => "column" in b;

const quoteTable = (t: string) => `'${t.replace(/'/g, "''")}'`;
const bracket = (n: string) => `[${n.replace(/]/g, "]]")}]`;

/** 'Table'[Column] */
export const columnRef = (b: { table: string; column: string }) => quoteTable(b.table) + bracket(b.column);

function measureExpr(b: FieldBinding): string {
    if ("measure" in b) return bracket(b.measure);
    if ("expression" in b) return `( ${b.expression} )`;
    return columnRef(b);
}

const DATE_ISO = /^(\d{4})-(\d{2})-(\d{2})/;

/** One DAX literal for a filter value: text quoted, numbers as they are, a date as DATE(y, m, d). */
export function daxLiteral(v: unknown): string {
    if (v instanceof Date) return `DATE ( ${v.getUTCFullYear()}, ${v.getUTCMonth() + 1}, ${v.getUTCDate()} )`;
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    if (typeof v === "boolean") return v ? "TRUE ()" : "FALSE ()";
    const s = String(v ?? "");
    const d = DATE_ISO.exec(s);
    if (d && /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(s)) return `DATE ( ${Number(d[1])}, ${Number(d[2])}, ${Number(d[3])} )`;
    return `"${s.replace(/"/g, '""')}"`;
}

/**
 * The widget's query: its column-bound roles group the rows, its measure-bound roles are computed per row, and every
 * result column is named after its role. A page filter on a role bound to a column narrows it (TREATAS), except the
 * filter this widget sets itself: its own marks stay, and the host dims the ones not picked.
 */
export function buildDax(def: WidgetDef, map: FieldMap, filters: readonly ActiveFilter[] = []): string {
    const missing = missingRoles(def, map);
    if (missing.length) throw new Error(`Map a field to ${missing[0]} in src/fieldMap.ts`);
    const roles = [...new Set(rolesOf(def))];
    const groups = roles.filter((r) => isColumn(map.roles[r]!));
    const measures = roles.filter((r) => !isColumn(map.roles[r]!));
    const treat = filters
        .filter((f) => f.role !== def.selects && f.values.length > 0)
        .flatMap((f) => {
            const b = map.roles[f.role];
            return b && isColumn(b) ? [`TREATAS ( { ${f.values.map(daxLiteral).join(", ")} }, ${columnRef(b)} )`] : [];
        });
    const inner = [
        ...groups.map((r) => columnRef(map.roles[r] as { table: string; column: string })),
        ...treat,
        ...measures.map((r) => `"__${r}", ${measureExpr(map.roles[r]!)}`),
    ];
    const outer = roles.map((r) =>
        isColumn(map.roles[r]!) ? `"${r}", ${columnRef(map.roles[r] as { table: string; column: string })}` : `"${r}", [__${r}]`);
    const order = groups.length ? `\nORDER BY ${groups.map((r) => `[${r}]`).join(", ")}` : "";
    return `EVALUATE\nSELECTCOLUMNS (\n    SUMMARIZECOLUMNS (\n        ${inner.join(",\n        ")}\n    ),\n    ${outer.join(",\n    ")}\n)${order}\n`;
}
