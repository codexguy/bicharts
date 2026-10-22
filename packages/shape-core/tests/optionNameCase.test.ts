import { describe, expect, it } from "vitest";
import { ingest } from "../src/ingest";

/**
 * A CALLER'S COLUMN NAME MATCHES IGNORING CASE, FOR EVERY OPTION THAT NAMES A COLUMN.
 *
 * `measures`, `dimensions` and `nonAdditive` always matched ignoring case; `groupBy` and the keys of
 * `formats` and `descriptions` matched exactly. So `groupBy: ["region"]` on a column named Region
 * was dropped without a word, and the chart lost its breakdown. All six now match the same way. An
 * exact name still wins, so two columns that differ only by case can be told apart.
 */
const SOURCE = {
    kind: "table" as const,
    columns: [{ name: "Region" }, { name: "Revenue" }],
    rows: [["North", 10], ["South", 20], ["East", 30]],
};

describe("option names match columns ignoring case", () => {
    it("groupBy: a lower-case name marks the column as grouping", () => {
        const r = ingest(SOURCE, { groupBy: ["region"] });
        expect(r.columns.filter(c => c.isGrouping).map(c => c.name)).toEqual(["Region"]);
    });

    it("formats and descriptions: a key in another case reaches the column", () => {
        const r = ingest(SOURCE, { formats: { REVENUE: "$#,##0" }, descriptions: { region: "Sales region" } });
        expect(r.columns.find(c => c.name === "Revenue")!.modelFormat).toBe("$#,##0");
        expect(r.columns.find(c => c.name === "Region")!.modelDesc).toBe("Sales region");
    });

    it("an exact name wins over a column that differs only by case", () => {
        const twins = {
            kind: "table" as const,
            columns: [{ name: "Code" }, { name: "CODE" }, { name: "Revenue" }],
            rows: [["a", "x", 1], ["b", "y", 2]],
        };
        const r = ingest(twins, { groupBy: ["CODE"], descriptions: { code: "both" } });
        expect(r.columns.filter(c => c.isGrouping).map(c => c.name)).toEqual(["CODE"]);
        expect(r.columns.filter(c => c.modelDesc === "both").map(c => c.name)).toEqual(["Code", "CODE"]);
    });

    it("a name no column has still changes nothing", () => {
        const r = ingest(SOURCE, { groupBy: ["Country"], formats: { Margin: "0%" } });
        expect(r.columns.some(c => c.isGrouping)).toBe(false);
        expect(r.columns.some(c => c.modelFormat)).toBe(false);
    });
});
