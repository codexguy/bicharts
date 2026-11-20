import { describe, it, expect } from "vitest";
import { tellApartRepeatedNames } from "../src/aggregation";
import { IndexedText } from "../src/indexedText";
import { ingest } from "../src/ingest";

// Two columns that arrive under ONE name: a row keyed by name keeps only the last of them, and a lookup by name in the
// column list finds only the first, so the chart and the prompt disagree about which column a name means - and the first
// column's data is unreachable. The first keeps its name; later ones become `Name (2)`, `Name (3)`.

describe("tellApartRepeatedNames", () => {
    it("tells two repeated pairs apart, first keeps the name", () => {
        expect(tellApartRepeatedNames(["Latitude", "Make Center", "Longitude", "Country", "Latitude", "Longitude", "Total Sales"]))
            .toEqual(["Latitude", "Make Center", "Longitude", "Country", "Latitude (2)", "Longitude (2)", "Total Sales"]);
    });

    it("numbers further repeats and steps over a name already taken", () => {
        expect(tellApartRepeatedNames(["0", "1", "x", "0", "1"])).toEqual(["0", "1", "x", "0 (2)", "1 (2)"]);
        expect(tellApartRepeatedNames(["a", "a", "a"])).toEqual(["a", "a (2)", "a (3)"]);
        expect(tellApartRepeatedNames(["Sales", "Sales (2)", "Sales"])).toEqual(["Sales", "Sales (2)", "Sales (3)"]);
    });

    it("leaves a list with no repeat as it is", () => {
        const names = ["Region", "Sales", "Profit"];
        expect(tellApartRepeatedNames(names)).toEqual(names);
    });
});

function engineWith(names: string[], measures: boolean[]) {
    const idx = new IndexedText();
    idx.setColumns(names.map((n, i) => ({ name: n, dataType: measures[i] ? "Decimal" : "String", isMeasure: measures[i] })));
    return idx;
}

describe("the engine keys every column", () => {
    const NAMES = ["Latitude", "Make Center", "Longitude", "Country", "Latitude", "Longitude", "Total Sales"];
    const MEAS = [false, false, false, false, true, true, true];

    it("a row holds both columns of a repeated name", () => {
        const idx = engineWith(NAMES, MEAS);
        idx.addRow([10, "A", 20, "FR", 46, 2, 500], 0);
        const row = idx.toObjectArray()[0];
        expect(Object.keys(row)).toHaveLength(7);
        expect(row["Latitude"]).toBe(10);
        expect(row["Latitude (2)"]).toBe(46);
        expect(row["Longitude"]).toBe(20);
        expect(row["Longitude (2)"]).toBe(2);
        expect(idx.getRenamedRepeats()).toEqual([
            { index: 4, from: "Latitude", to: "Latitude (2)" },
            { index: 5, from: "Longitude", to: "Longitude (2)" },
        ]);
    });

    it("reaches the ingest front door", () => {
        const r = ingest({ kind: "grid", header: ["a", "b", "a"], rows: [[1, 2, 3]] });
        expect(r.columns.map(c => c.name)).toEqual(["a", "b", "a (2)"]);
        expect(Object.keys(r.rows[0])).toHaveLength(3);
        expect(r.rows[0]["a (2)"]).toBe(3);
    });

    it("ingest can keep repeated names for a source whose repeats are its own layout", () => {
        const r = ingest({ kind: "grid", header: ["a", "b", "a"], rows: [[1, 2, 3]] }, { tellApartNames: false });
        expect(r.columns.map(c => c.name)).toEqual(["a", "b", "a"]);
        expect(r.index.getRenamedRepeats()).toEqual([]);
    });

    it("a host can keep repeated names", () => {
        const idx = new IndexedText();
        idx.tellApartNames = false;
        const cols = [{ name: "a", dataType: "String" }, { name: "a", dataType: "String" }];
        idx.setColumns(cols);
        expect(cols.map(c => c.name)).toEqual(["a", "a"]);
        expect(idx.getRenamedRepeats()).toEqual([]);
    });

    it("moves nothing when no name repeats, and setting the columns again changes nothing", () => {
        const make = () => [{ name: "Region", dataType: "String" }, { name: "Sales", dataType: "Decimal", isMeasure: true }];
        const plain = make();
        const idx = new IndexedText();
        idx.setColumns(plain);
        expect(JSON.stringify(plain)).toBe(JSON.stringify(make()));
        const repeated = [{ name: "a", dataType: "String" }, { name: "a", dataType: "String" }];
        idx.setColumns(repeated); idx.setColumns(repeated);
        expect(repeated.map(c => c.name)).toEqual(["a", "a (2)"]);
    });

    it("the doubled-prefix rule still runs first, and its collision rule still holds", () => {
        const cols = [{ name: "Sum of Revenue", dataType: "Integer", isMeasure: true }, { name: "Sum of Sum of Revenue", dataType: "Integer", isMeasure: true }];
        new IndexedText().setColumns(cols);
        expect(cols.map(c => c.name)).toEqual(["Sum of Revenue", "Sum of Sum of Revenue"]);
    });
});
