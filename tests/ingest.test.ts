import { describe, it, expect } from "vitest";
import { ingest, engineTypeForSqlType } from "../packages/shape-core/src/ingest";
import { IndexedText } from "../packages/shape-core/src/indexedText";

// The ingest front door. These tests pin the two things that are easy to break silently:
// the PRECEDENCE ladder (caller override > host metadata > inference) and the equivalence
// of the decoders — the same logical table expressed four ways must measure identically.

const HEADER = ["City", "Segment", "Revenue", "Ratio", "AsOf"];
const ROWS: any[][] = [
    ["Springfield", "North", "1200", "0.25", "2024-01-15"],
    ["Shelbyville", "South", "980", "0.5", "2024-02-20"],
    ["Ogdenville", "North", "1450", "0.75", "2024-03-05"],
];
const CSV = [HEADER.join(","), ...ROWS.map(r => r.join(","))].join("\n");

const OBJECTS = ROWS.map(r => Object.fromEntries(HEADER.map((h, i) => [h, r[i]])));

function byName(res: { columns: Array<{ name: string }> }, name: string): any {
    return res.columns.find(c => c.name === name);
}

describe("decoders agree", () => {
    it("csv, grid, table and objects measure the same table identically", () => {
        const csv = ingest({ kind: "csv", text: CSV });
        const grid = ingest({ kind: "grid", header: HEADER, rows: ROWS });
        const table = ingest({ kind: "table", columns: HEADER.map(name => ({ name })), rows: ROWS });
        const objects = ingest({ kind: "objects", rows: OBJECTS });

        const signature = (r: typeof csv) =>
            r.columns.map(c => `${c.name}:${c.dataType}:${c.isMeasure}`).join("|");

        expect(signature(grid)).toBe(signature(csv));
        expect(signature(table)).toBe(signature(csv));
        expect(signature(objects)).toBe(signature(csv));
        expect(objects.totalRows).toBe(csv.totalRows);
    });

    it("derives columns from row-object keys when none are supplied", () => {
        const res = ingest({ kind: "objects", rows: OBJECTS });
        expect(res.columns.map(c => c.name)).toEqual(HEADER);
    });

    it("discovers a key that only appears in a later row", () => {
        // Sparse payloads are the reason the scan is windowed rather than first-row-only.
        const rows = [{ a: 1 }, { a: 2 }, { a: 3, b: "late" }];
        const res = ingest({ kind: "objects", rows });
        expect(res.columns.map(c => c.name)).toEqual(["a", "b"]);
    });

    it("returns rows that are directly bindable, keyed by column name", () => {
        const { rows, columns } = ingest({ kind: "csv", text: CSV });
        expect(columns.length).toBe(HEADER.length);
        expect(rows).toHaveLength(3);
        expect(Object.keys(rows[0])).toEqual(expect.arrayContaining(HEADER));
    });
});

describe("type inference fills gaps only", () => {
    it("infers integer, decimal, date and string from values", () => {
        const res = ingest({ kind: "csv", text: CSV });
        expect(byName(res, "City").dataType).toBe("String");
        expect(byName(res, "Revenue").dataType).toBe("Integer");
        expect(byName(res, "Ratio").dataType).toBe("Decimal");
        expect(byName(res, "AsOf").dataType).toBe("DateTime");
    });

    it("a declared dataType is never re-sniffed", () => {
        // Revenue would infer as Integer; the descriptor says otherwise and must win.
        const res = ingest({
            kind: "table",
            columns: [{ name: "Revenue", dataType: "String" }],
            rows: [["1200"], ["980"]],
        });
        expect(byName(res, "Revenue").dataType).toBe("String");
    });

    it("one non-numeric value keeps a column textual rather than nulling data", () => {
        const res = ingest({ kind: "grid", header: ["Mixed"], rows: [["1"], ["2"], ["n/a"]] });
        expect(byName(res, "Mixed").dataType).toBe("String");
    });
});

describe("precedence ladder: caller override > host metadata > inference", () => {
    it("inference decides when nothing else speaks", () => {
        const res = ingest({ kind: "csv", text: CSV });
        expect(byName(res, "Revenue").isMeasure).toBe(true);
        expect(byName(res, "City").isMeasure).toBe(false);
    });

    it("host metadata beats inference", () => {
        const res = ingest({
            kind: "table",
            columns: [{ name: "Revenue", isMeasure: false }],
            rows: [["1200"], ["980"]],
        });
        expect(byName(res, "Revenue").isMeasure).toBe(false);
    });

    it("caller override beats host metadata, in BOTH directions", () => {
        const asDimension = ingest(
            { kind: "table", columns: [{ name: "Revenue", isMeasure: true }], rows: [["1200"]] },
            { dimensions: ["revenue"] },                       // case-insensitive by design
        );
        expect(byName(asDimension, "Revenue").isMeasure).toBe(false);

        const asMeasure = ingest(
            { kind: "table", columns: [{ name: "Revenue", isMeasure: false }], rows: [["1200"]] },
            { measures: ["Revenue"] },
        );
        expect(byName(asMeasure, "Revenue").isMeasure).toBe(true);
    });

    it("format and description follow the same ladder", () => {
        const res = ingest(
            {
                kind: "table",
                columns: [
                    { name: "Revenue", format: "from-model", description: "model text" },
                    { name: "Ratio", format: "from-model" },
                ],
                rows: [["1200", "0.25"]],
            },
            { formats: { Revenue: "from-caller" }, descriptions: { Revenue: "caller text" } },
        );
        expect(byName(res, "Revenue").modelFormat).toBe("from-caller");
        expect(byName(res, "Revenue").modelDesc).toBe("caller text");
        // Untouched by the caller, so the model's own value survives.
        expect(byName(res, "Ratio").modelFormat).toBe("from-model");
    });

    it("carries groupBy and nonAdditive through to the measured shape", () => {
        const res = ingest(
            { kind: "csv", text: CSV },
            { groupBy: ["Segment"], nonAdditive: ["Ratio"] },
        );
        expect(byName(res, "Segment").isGrouping).toBe(true);
        expect(byName(res, "Ratio").discourageAggregationAcrossGroups).toBe(true);
    });
});

// A shipping-lanes table: every lane names both ends by country, code and coordinates, and
// carries one quantity. 12 origins and 40 destinations, so the destination coordinates take
// 40 distinct values each - enough for the engine's numeric classifier to call them
// Continuous - while the origin coordinates, at 12, are not.
function lanes(): { header: string[]; rows: any[][] } {
    const header = [
        "OriginCountry", "OriginCountryCode", "OriginLatitude", "OriginLongitude",
        "DestinationCountry", "DestinationCountryCode", "DestinationLatitude", "DestinationLongitude",
        "UnitsShipped",
    ];
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const rows: any[][] = [];
    for (let o = 0; o < 12; o++) {
        for (let d = 0; d < 40; d++) {
            if ((o * 7 + d) % 5 === 0) continue;                  // not every pair trades
            rows.push([
                `Origin ${o}`, `O${o}`, r2(-35 + o * 6.41), r2(-110 + o * 19.3),
                `Destination ${d}`, `D${d}`, r2(-40 + d * 2.137), r2(-120 + d * 6.113),
                1000 + ((o * 40 + d) * 7919) % 900000,
            ]);
        }
    }
    return { header, rows };
}

describe("a caller-declared dimension is never promoted to a measure", () => {
    const DIMS = [
        "OriginCountry", "OriginCountryCode", "OriginLatitude", "OriginLongitude",
        "DestinationCountry", "DestinationCountryCode", "DestinationLatitude", "DestinationLongitude",
    ];

    it("every column named in `dimensions` comes back a dimension, however continuous its values", () => {
        // The engine's measure inference runs AFTER the role ladder and used to overrule it:
        // the destination coordinates (40 distinct values) came back measures while the origin
        // ones (12) stayed dimensions, and a flow chart downstream sized its arcs by a latitude.
        const { header, rows } = lanes();
        const res = ingest({ kind: "grid", header, rows }, { dimensions: DIMS });
        for (const name of DIMS) {
            expect(byName(res, name).isMeasure, `${name} was declared a dimension`).toBe(false);
        }
        expect(byName(res, "UnitsShipped").isMeasure).toBe(true);
    });

    it("the engine still promotes the same continuous numeric when nobody declared its role", () => {
        // The inference exists for a host that hands every column over in one non-measure
        // binding. Nothing declared, so the classifier's Continuous still makes it a measure -
        // and this is what proves the case above is a real one: the same values ARE promoted.
        const { header, rows } = lanes();
        const idx = new IndexedText();
        const types = ["String", "String", "Decimal", "Decimal", "String", "String", "Decimal", "Decimal", "Integer"];
        idx.setColumns(header.map((name, c) => ({ name, dataType: types[c], isMeasure: false })));
        rows.forEach((r, i) => idx.addRow(r, i));
        const shape = idx.getColumnsWithStats("20");
        const col = (n: string) => shape.find(c => c.name === n)!;
        expect(col("DestinationLatitude").isMeasure).toBe(true);
        expect(col("DestinationLongitude").isMeasure).toBe(true);
        expect(col("UnitsShipped").isMeasure).toBe(true);
        // Too few distinct values to read as a quantity: left alone, declared or not.
        expect(col("OriginLatitude").isMeasure).toBe(false);
    });
});

describe("dedup", () => {
    const DUPES: any[][] = [["a", "1"], ["a", "1"], ["b", "2"]];

    it("collapses value-identical rows by default", () => {
        const res = ingest({ kind: "grid", header: ["K", "V"], rows: DUPES });
        expect(res.totalRows).toBe(2);
        expect(res.rows).toHaveLength(2);
    });

    it("keeps every row when dedup is disabled", () => {
        const res = ingest({ kind: "grid", header: ["K", "V"], rows: DUPES }, { dedup: false });
        expect(res.totalRows).toBe(3);
        expect(res.rows).toHaveLength(3);
    });

    it("dedup:false preserves one-to-one alignment with the source rows", () => {
        // The reason the switch exists: selection round-tripping needs row i of the result
        // to be row i of the source.
        const res = ingest({ kind: "grid", header: ["K", "V"], rows: DUPES }, { dedup: false });
        expect(res.rows.map(r => r.K)).toEqual(["a", "a", "b"]);
        for (let i = 0; i < DUPES.length; i++) {
            expect(res.index.getOriginalRowIndex(i)).toBe(i);
        }
    });

    it("the engine still defaults to dedup for direct callers", () => {
        // The option is additive: constructing IndexedText directly is unchanged.
        const idx = new IndexedText();
        expect(idx.dedupRows).toBe(true);
        idx.setColumns([{ name: "K", dataType: "String", isMeasure: false }]);
        expect(idx.addRow(["a"], 0)).toBe(true);
        expect(idx.addRow(["a"], 1)).toBe(false);
        expect(idx.getRowCount()).toBe(1);
    });
});

describe("sql decoder", () => {
    it("maps catalogue type names onto engine types", () => {
        expect(engineTypeForSqlType("int")).toBe("Integer");
        expect(engineTypeForSqlType("BIGINT")).toBe("Integer");
        expect(engineTypeForSqlType("decimal(18,2)")).toBe("Decimal");
        expect(engineTypeForSqlType("float")).toBe("Decimal");
        expect(engineTypeForSqlType("datetime2")).toBe("DateTime");
        expect(engineTypeForSqlType("nvarchar(50)")).toBe("String");
        expect(engineTypeForSqlType("bit")).toBe("String");
        // Unknown vendor types stay textual — safer than nulling values that will not parse.
        expect(engineTypeForSqlType("geography")).toBe("String");
    });

    it("takes types from the schema rather than sniffing values", () => {
        const res = ingest({
            kind: "sql",
            schema: [
                { name: "Id", dataType: "int" },
                { name: "Amount", dataType: "decimal(18,2)" },
                { name: "Label", dataType: "nvarchar(50)" },
            ],
            rows: [{ Id: 1, Amount: 10.5, Label: "x" }, { Id: 2, Amount: 20, Label: "y" }],
        });
        expect(byName(res, "Id").dataType).toBe("Integer");
        // Whole numbers in the data; the CATALOGUE says decimal, and it wins.
        expect(byName(res, "Amount").dataType).toBe("Decimal");
        expect(byName(res, "Label").dataType).toBe("String");
    });

    it("treats an identifier-shaped numeric column as a dimension", () => {
        const res = ingest({
            kind: "sql",
            schema: [{ name: "CustomerId", dataType: "int" }, { name: "Amount", dataType: "money" }],
            rows: [{ CustomerId: 7, Amount: 10 }, { CustomerId: 8, Amount: 20 }],
        });
        expect(byName(res, "CustomerId").isMeasure).toBe(false);
        expect(byName(res, "Amount").isMeasure).toBe(true);
    });
});

describe("failure messages name the cause and the way forward", () => {
    it("rejects a headers-only CSV", () => {
        expect(() => ingest({ kind: "csv", text: "A,B" })).toThrow(/header line plus at least one data row/i);
    });

    it("rejects an empty objects array with an actionable message", () => {
        expect(() => ingest({ kind: "objects", rows: [] })).toThrow(/no columns/i);
    });

    it("rejects an unknown source kind by listing the valid ones", () => {
        expect(() => ingest({ kind: "parquet" } as any)).toThrow(/csv, grid, table, objects, sql/);
    });
});
