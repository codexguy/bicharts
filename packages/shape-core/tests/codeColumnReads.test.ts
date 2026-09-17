import { describe, it, expect } from "vitest";
import { codeReadsColumn, codeReadsColumnsByRoleOrPosition, columnsTheCodeReads } from "../src/index";

// A box plot that looks both of its columns up by name and never mentions a third bound measure -
// the shape of a production chart whose reader removed the unused measure and was told the chart
// would draw blank.
const BOX_PLOT_BY_NAME = `
const { columns, rows } = data;
const catIdx = columns.findIndex(c => c.name === 'segment@code');
const valIdx = columns.findIndex(c => c.name === 'Amount');
// the third measure is not encoded
const groups = d3.group(rows, r => r[catIdx]);
`;

describe("codeReadsColumn", () => {
    it("reads a column named in a single-, double- or back-quoted literal", () => {
        expect(codeReadsColumn("columns.findIndex(c => c.name === 'Region')", "Region")).toBe(true);
        expect(codeReadsColumn('fig = px.bar(df, x="Region", y="Sales")', "Region")).toBe(true);
        expect(codeReadsColumn("const k = `Region`;", "Region")).toBe(true);
    });

    it("reads a column the way each renderer names it", () => {
        expect(codeReadsColumn("df['Sales'].sum()", "Sales")).toBe(true);                    // Python
        expect(codeReadsColumn('{"field": "Sales", "type": "quantitative"}', "Sales")).toBe(true); // Vega-Lite
        expect(codeReadsColumn('row["Sum of Sales"]', "Sum of Sales")).toBe(true);           // keyed row
    });

    it("reads an identifier-shaped column through a member access, as a Vega expression does", () => {
        expect(codeReadsColumn('{"calculate": "datum.Revenue / datum.Cost", "as": "Ratio"}', "Cost")).toBe(true);
        expect(codeReadsColumn("rows.map(d => d.Revenue)", "Revenue")).toBe(true);
    });

    it("does not read a longer member that merely starts with the name", () => {
        expect(codeReadsColumn("rows.map(d => d.RevenueTotal)", "Revenue")).toBe(false);
    });

    it("does not treat a name with spaces or punctuation as a member access", () => {
        expect(codeReadsColumn("d.Part", "Count of Part No/Serial No")).toBe(false);
    });

    it("escapes regex metacharacters in the name", () => {
        expect(codeReadsColumn("c.name === 'Count of Part No/Serial No'", "Count of Part No/Serial No")).toBe(true);
        expect(codeReadsColumn("c.name === 'segment@code'", "segment@code")).toBe(true);
        expect(codeReadsColumn("c.name === 'Share (%)'", "Share (%)")).toBe(true);
        // `.` in the name must not match any character
        expect(codeReadsColumn("c.name === 'AxB'", "A.B")).toBe(false);
        expect(codeReadsColumn("c.name === 'A+B'", "A+B")).toBe(true);
    });

    it("does not read a name that appears only unquoted in a comment", () => {
        expect(codeReadsColumn("// Budget_YTD is not encoded\nconst x = 1;", "Budget_YTD")).toBe(false);
        expect(codeReadsColumn(BOX_PLOT_BY_NAME, "Budget_YTD")).toBe(false);
    });

    it("reads nothing from null or empty code", () => {
        expect(codeReadsColumn(null, "Region")).toBe(false);
        expect(codeReadsColumn(undefined, "Region")).toBe(false);
        expect(codeReadsColumn("", "Region")).toBe(false);
    });
});

describe("codeReadsColumnsByRoleOrPosition", () => {
    it("recognises columns picked by role, type or position", () => {
        expect(codeReadsColumnsByRoleOrPosition("const mIdx = columns.findIndex(c => c.isMeasure);")).toBe(true);
        expect(codeReadsColumnsByRoleOrPosition("columns.find(c => c.dataType === 'DateTime')")).toBe(true);
        expect(codeReadsColumnsByRoleOrPosition("const first = data.columns[0].name;")).toBe(true);
        expect(codeReadsColumnsByRoleOrPosition("y = df.iloc[:, 1]")).toBe(true);
        expect(codeReadsColumnsByRoleOrPosition("nums = df.select_dtypes('number')")).toBe(true);
        expect(codeReadsColumnsByRoleOrPosition("for c in df.columns:\n    pass")).toBe(true);
        expect(codeReadsColumnsByRoleOrPosition("const keys = Object.keys(rows[0]);")).toBe(true);
    });

    it("does not treat a name check or a row lookup as a role read", () => {
        expect(codeReadsColumnsByRoleOrPosition(BOX_PLOT_BY_NAME)).toBe(false);
        expect(codeReadsColumnsByRoleOrPosition("if 'Sales' in df.columns:\n    y = df['Sales']")).toBe(false);
        expect(codeReadsColumnsByRoleOrPosition("first = df.iloc[0]")).toBe(false);
    });

    it("is false for null or empty code", () => {
        expect(codeReadsColumnsByRoleOrPosition(null)).toBe(false);
        expect(codeReadsColumnsByRoleOrPosition("")).toBe(false);
    });
});

describe("columnsTheCodeReads", () => {
    it("keeps only the names a by-name chart reads, in their original order", () => {
        const writtenFor = ["segment@code", "Amount", "Budget_YTD"];
        expect(columnsTheCodeReads(BOX_PLOT_BY_NAME, ["Budget_YTD"], writtenFor)).toEqual([]);
        expect(columnsTheCodeReads(BOX_PLOT_BY_NAME, ["Amount"], writtenFor)).toEqual(["Amount"]);
        expect(columnsTheCodeReads(BOX_PLOT_BY_NAME, ["Amount", "Budget_YTD", "segment@code"], writtenFor)).toEqual(["Amount", "segment@code"]);
    });

    it("keeps every name when the code picks columns by role, because no name test can see that use", () => {
        const byRole = "const mIdx = columns.findIndex(c => c.isMeasure);\nconst v = rows.map(r => r[mIdx]);";
        expect(columnsTheCodeReads(byRole, ["Sum of Sales", "Region"], ["Sum of Sales", "Region"])).toEqual(["Sum of Sales", "Region"]);
    });

    it("keeps every name when the code names NONE of the columns it was written for", () => {
        // A name matched by pattern, a walk over every column, or a stub: the use is invisible.
        const byPattern = "const lat = columns.find(c => /lat/i.test(c.name));";
        expect(columnsTheCodeReads(byPattern, ["Latitude"], ["City", "Latitude", "Longitude"])).toEqual(["Latitude"]);
        expect(columnsTheCodeReads("function render(){}", ["Revenue"], ["Region", "Revenue"])).toEqual(["Revenue"]);
    });

    it("still withholds an unread name when the code names a column it was written for", () => {
        expect(columnsTheCodeReads("px.bar(df, x='Region')", ["Revenue"], ["Region", "Revenue"])).toEqual([]);
        // ...even when the gone list is not part of writtenFor.
        expect(columnsTheCodeReads("px.bar(df, x='Region')", ["Revenue"], ["Region"])).toEqual([]);
    });

    it("gives none for empty code - nothing is on screen to be wrong", () => {
        expect(columnsTheCodeReads(null, ["Region"], ["Region"])).toEqual([]);
        expect(columnsTheCodeReads("", ["Region"], ["Region"])).toEqual([]);
    });
});
