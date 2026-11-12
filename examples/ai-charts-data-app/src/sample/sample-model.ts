// THE BUNDLED SAMPLE: what the page draws before `connection` in src/fieldMap.ts names a connector, so the app runs
// with no tenant and no network call. It answers each widget's query from global-revenue.json (country by month
// totals built from the Global Revenue v2 sample model's data-v3 tables), computing every role the way the shipped
// field map binds it: a role here mirrors the measure or column the map names. Once you rebind the map to your own
// model, the live query answers instead; this file is only the preview.

import data from "./global-revenue.json";
import type { ActiveFilter, WidgetDef } from "@/widgets/query";
import { rolesOf } from "@/widgets/query";

export interface SampleTable {
    columns: { name: string }[];
    rows: unknown[][];
}

interface Country { code: string; name: string; region: string }
type Fact = "revenue" | "orders" | "customers" | "returns" | "spend" | "survey" | "satisfied" | "target";

const countries = data.countries as Country[];
const months = data.months as string[];
const facts = data.facts as Record<Fact, number[][]>;

/** A cell of the sample: one country in one month. */
interface Cell { c: number; m: number }

// A date as the plain ISO day ("2024-03-01"): what the chart parses, and what the filter chip shows.
const iso = (m: number) => months[m];

// Roles that group the rows, by what they read from a cell.
const DIMS: Record<string, (cell: Cell) => string | number> = {
    Category: ({ c }) => countries[c].name,
    CountryCode: ({ c }) => countries[c].code,
    Group: ({ c }) => countries[c].region,
    Date: ({ m }) => iso(m),
    Period: ({ m }) => months[m].slice(0, 7),
    Year: ({ m }) => Number(months[m].slice(0, 4)),
};

const sum = (f: Fact, cells: Cell[]) => cells.reduce((t, { c, m }) => t + facts[f][c][m], 0);
const ratio = (a: number, b: number) => (b ? a / b : null);

// Roles computed per row, mirroring the model's measures.
const MEASURES: Record<string, (cells: Cell[]) => number | null> = {
    Value: (x) => sum("revenue", x),
    Baseline: (x) => sum("revenue", x),
    Response: (x) => sum("revenue", x),
    Target: (x) => sum("target", x),
    Goal: (x) => sum("target", x),
    Spend: (x) => sum("spend", x),
    Attainment: (x) => ratio(sum("revenue", x), sum("target", x)),
    ReturnRate: (x) => ratio(sum("returns", x), sum("orders", x)),
    Satisfaction: (x) => ratio(sum("satisfied", x), sum("survey", x)),
    // Revenue YoY %: against the same months a year earlier, blank where there is no earlier year.
    Growth: (x) => {
        const prior = x.filter(({ m }) => m >= 12).map(({ c, m }) => ({ c, m: m - 12 }));
        const py = prior.length ? sum("revenue", prior) : 0;
        return py ? (sum("revenue", x) - py) / py : null;
    },
};

/** Which roles the sample can answer. */
export const SAMPLE_ROLES = new Set([...Object.keys(DIMS), ...Object.keys(MEASURES)]);

function keep(cell: Cell, filters: readonly ActiveFilter[], self: string | null): boolean {
    return filters.every((f) => {
        if (f.role === self || !f.values.length || !DIMS[f.role]) return true;
        const v = DIMS[f.role](cell);
        return f.values.some((x) => String(x) === String(v) || (f.role === "Date" && String(x).slice(0, 10) === String(v).slice(0, 10)));
    });
}

/** The widget's rows from the sample, one column per role, narrowed by the page's filters like the live query. */
export function sampleTable(def: WidgetDef, filters: readonly ActiveFilter[] = []): SampleTable {
    const roles = [...new Set(rolesOf(def))];
    const unknown = roles.filter((r) => !SAMPLE_ROLES.has(r));
    if (unknown.length) throw new Error(`The bundled sample has no ${unknown.join(", ")}: connect your model to draw this widget`);
    const groups = roles.filter((r) => DIMS[r]);
    const buckets = new Map<string, Cell[]>();
    for (let c = 0; c < countries.length; c++) {
        for (let m = 0; m < months.length; m++) {
            const cell = { c, m };
            if (!keep(cell, filters, def.selects)) continue;
            const k = groups.map((r) => DIMS[r](cell)).join("\u0001");
            const b = buckets.get(k);
            if (b) b.push(cell); else buckets.set(k, [cell]);
        }
    }
    const rows = [...buckets.values()].map((cells) =>
        roles.map((r) => (DIMS[r] ? DIMS[r](cells[0]) : MEASURES[r](cells))));
    rows.sort((a, b) => {
        for (let i = 0; i < groups.length; i++) {
            const k = roles.indexOf(groups[i]);
            const x = a[k] as string | number, y = b[k] as string | number;
            if (x < y) return -1;
            if (x > y) return 1;
        }
        return 0;
    });
    return { columns: roles.map((name) => ({ name })), rows };
}
