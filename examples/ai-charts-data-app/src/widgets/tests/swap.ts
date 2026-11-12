// THE SWAP: a stand-in for a rebound model. Same roles, new values, three times the rows and labels over 60 characters,
// built from the bundled sample so every widget gets rows of its own shape. A widget that only works on the rows it
// was generated on fails here.

import type { SampleTable } from "@/sample/sample-model";
import type { FieldMap } from "@/fieldMap";

// 120 ISO 3166 alpha-3 codes the world map knows: three new countries for each of the sample's forty.
export const ISO3 = (
    "USA CAN MEX BRA ARG CHL COL PER GBR FRA DEU ITA ESP NLD SWE NOR POL CHE IRL JPN CHN IND KOR AUS NZL SGP IDN MYS "
    + "THA VNM PHL ZAF NGA KEN EGY MAR ARE SAU ISR TUR PRT BEL AUT DNK FIN GRC CZE HUN ROU BGR HRV SRB SVK SVN UKR BLR "
    + "LTU LVA EST ISL LUX ALB MKD BIH MNE MDA GEO ARM AZE KAZ UZB TKM KGZ TJK MNG PAK BGD LKA NPL MMR KHM LAO IRN IRQ "
    + "SYR JOR LBN OMN YEM QAT KWT BHR AFG DZA TUN LBY SDN ETH SOM TZA UGA RWA COD COG CMR GHA CIV SEN MLI NER TCD AGO "
    + "ZMB ZWE MOZ MDG NAM BWA VEN ECU BOL PRY URY CUB"
).split(" ");

const LONG = " - a deliberately long label that a rebound model might carry";

/** A value from the old one: scaled by a factor that varies by row, so the numbers are new but of the same kind. */
const reshape = (v: unknown, i: number) =>
    typeof v === "number" ? v * (0.55 + ((i * 37) % 90) / 100) : v;

function addMonths(iso: string, n: number): string {
    const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + n);
    return d.toISOString().slice(0, 10);
}

/** Three times the rows, new values, labels over 60 characters; the columns (the roles) are the same. */
export function swapTable(base: SampleTable): SampleTable {
    const names = base.columns.map((c) => c.name);
    const at = (n: string) => names.indexOf(n);
    const date = at("Date");
    if (date >= 0) {
        // A time grain: three times the months, ending where the sample ends.
        const sorted = [...base.rows].sort((a, b) => String(a[date]).localeCompare(String(b[date])));
        const n = sorted.length;
        const last = String(sorted[n - 1][date]);
        const rows: unknown[][] = [];
        for (let k = 0; k < 3 * n; k++) {
            const src = sorted[k % n];
            const iso = addMonths(last, k - 3 * n + 1);
            rows.push(names.map((col, j) =>
                col === "Date" ? iso : col === "Period" ? iso.slice(0, 7) : reshape(src[j], k + j)));
        }
        return { columns: base.columns, rows };
    }
    // A category grain: each category becomes three, with long names and their own country codes.
    const cat = at("Category");
    const cats = [...new Set(base.rows.map((r) => String(r[cat])))];
    const rows: unknown[][] = [];
    base.rows.forEach((src, i) => {
        const c = cats.indexOf(String(src[cat]));
        for (let k = 0; k < 3; k++) {
            const slot = c * 3 + k;
            rows.push(names.map((col, j) => {
                if (col === "Category") return `${src[j]} ${k + 1}${LONG}`;
                if (col === "CountryCode") return ISO3[slot % ISO3.length];
                if (col === "Group") return `${src[j]}${LONG}`;
                return reshape(src[j], i * 3 + k + j);
            }));
        }
    });
    return { columns: base.columns, rows };
}

/** A field map for a different model: every role on renamed tables, columns and measures. */
export function renamedMap(map: FieldMap): FieldMap {
    const roles: FieldMap["roles"] = {};
    for (const [role, b] of Object.entries(map.roles)) {
        if (!b) continue;
        roles[role] = "column" in b ? { table: `Sales ${b.table}`, column: `${b.column} Name` }
            : "measure" in b ? { measure: `Total ${b.measure}` }
                : { expression: `CALCULATE ( ${b.expression} )` };
    }
    return { connection: "salesModel", roles };
}
