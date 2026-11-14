import { describe, it, expect } from "vitest";
import { IndexedText } from "../src/indexedText";

// A DATE REBOUND AS A DATE HIERARCHY STILL ANSWERS TO ITS FIELD'S NAME FOR A SAVED CHART THAT READS IT.
//
// A chart saved on a plain date (`StartDate`) reads that name. Bind the same field the way Power BI binds a date by default
// (auto date/time on: Year, Quarter, Month, Day) and the host rebuilds ONE date column from the levels - named `Date`, because
// charts generated on a hierarchy read that name - with the field it came from beside it (sourceField). The saved chart then
// stopped with `column "StartDate" not found` and asked for a paid regeneration though the data had not changed (measured live in
// Power BI Desktop, item 1365's retention check, 2026-11-14). The rebuilt date now answers to its field's name, for code that reads
// that name only, and only when exactly one rebuilt date came from that field.

const LEVELS = ["Year", "Quarter", "Month", "Day"];
function hierarchyIndex(opts: { second?: boolean; queryNames?: boolean } = {}): IndexedText {
    const idx = new IndexedText();
    const cols: any[] = LEVELS.map(n => ({ name: n, dataType: n === "Year" || n === "Day" ? "Integer" : "String", isMeasure: false, isDatePart: true, dateGroupId: "dg0" }));
    cols.push({ name: "CustomerKey", dataType: "String", isMeasure: false });
    cols.push({ name: "Date", dataType: "DateTime", isMeasure: false, isReassembledDate: true, dateGroupId: "dg0", sourceField: "StartDate" });
    if (opts.second) cols.push({ name: "Date 2", dataType: "DateTime", isMeasure: false, isReassembledDate: true, dateGroupId: "dg1", sourceField: "StartDate" });
    idx.setColumns(cols);
    if (opts.queryNames !== false) {
        idx.setHostQueryNames([...LEVELS.map(l => `customer_retention.StartDate.Variation.Date Hierarchy.${l}`), "customer_retention.CustomerKey",
            "customer_retention.StartDate.Variation.Date Hierarchy", ...(opts.second ? ["other.StartDate.Variation.Date Hierarchy"] : [])]);
    }
    const row: any[] = [2023, "Qtr 2", "April", 3, "1", "2023-04-03"];
    if (opts.second) row.push("2023-04-03");
    idx.addRow(row, 0);
    return idx;
}

const SAVED_CODE = "const start = data.columns.findIndex(c => c.name === 'StartDate'); col('StartDate');";

describe("a rebuilt date answers to its source field's name for code that reads it", () => {
    it("the saved chart's StartDate finds the rebuilt Date", () => {
        const idx = hierarchyIndex();
        expect(idx.armAliasesForCode(SAVED_CODE)).toEqual([{ name: "Date", alias: "StartDate", reason: "reassembled-date-source-field" }]);
        expect(Object.keys(idx.toObjectArray()[0])).toContain("StartDate");
    });

    it("also without host query names", () => {
        const idx = hierarchyIndex({ queryNames: false });
        expect(idx.armAliasesForCode(SAVED_CODE).map(a => a.alias)).toEqual(["StartDate"]);
    });

    it("code that reads Date (generated on the hierarchy) arms nothing", () => {
        expect(hierarchyIndex().armAliasesForCode("col('Date'); col('Year');")).toEqual([]);
    });

    it("two rebuilt dates from fields of the same name: neither answers - a guess would swap dates", () => {
        expect(hierarchyIndex({ second: true }).armAliasesForCode(SAVED_CODE)).toEqual([]);
    });

    it("a live column already called StartDate keeps the name", () => {
        const idx = new IndexedText();
        idx.setColumns([{ name: "StartDate", dataType: "DateTime", isMeasure: false } as any,
            { name: "Date", dataType: "DateTime", isMeasure: false, isReassembledDate: true, sourceField: "StartDate" } as any]);
        idx.addRow(["2023-04-03", "2023-04-03"], 0);
        expect(idx.armAliasesForCode(SAVED_CODE)).toEqual([]);
    });
});
