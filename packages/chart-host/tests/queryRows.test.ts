import { describe, it, expect } from "vitest";
import { columnName, queryRows } from "../src/dax";

// A QUERY THAT FEEDS NO CHART (a form's choice list, a lookup) comes back with "Table[Column]" and "[Measure]" headers.
// Nothing shipped read such rows by name, so app code parsed the headers itself, and a pattern that lost its escapes on
// the way to disk left every header unmatched: every option blank, while the app's tests and type check passed.
// The tables here are synthesized.

describe("columnName", () => {
    it("gives a column's or a measure's bare name, and leaves a plain header as it is", () => {
        expect(columnName("Accounts[Account Number]")).toBe("Account Number");
        expect(columnName("'Sales Owners'[Sales owner]")).toBe("Sales owner");
        expect(columnName("'It''s'[Name]")).toBe("Name");
        expect(columnName("[Total Revenue]")).toBe("Total Revenue");
        expect(columnName("Odd[A]]B]")).toBe("A]B");
        expect(columnName("Region")).toBe("Region");
        expect(columnName("Sales Owners[Owner]")).toBe("Owner");
    });
});

describe("queryRows", () => {
    const lookup = {
        columns: [{ name: "Accounts[Account Number]" }, { name: "Accounts[Account]" }, { name: "Owners[Sales owner]" }, { name: "[Open Value]" }],
        rows: [["A-1", "Contoso", "Ana", 1200], ["A-2", "Fabrikam", null, 0]],
    };

    it("keys every row by the bare column name, so a lookup's options are never blank", () => {
        const rows = queryRows(lookup);
        expect(rows).toEqual([
            { "Account Number": "A-1", Account: "Contoso", "Sales owner": "Ana", "Open Value": 1200 },
            { "Account Number": "A-2", Account: "Fabrikam", "Sales owner": null, "Open Value": 0 },
        ]);
        expect(rows.map(r => r["Account Number"]).every(v => typeof v === "string" && v.length > 0)).toBe(true);
    });

    it("takes the query hook's data: a success gives its rows, a failure or nothing gives none", () => {
        expect(queryRows({ status: "success", table: lookup })).toHaveLength(2);
        expect(queryRows({ status: "error" } as never)).toEqual([]);
        expect(queryRows(undefined)).toEqual([]);
        expect(queryRows(null)).toEqual([]);
    });

    it("keeps whole headers where two columns share a bare name, so neither hides the other", () => {
        const rows = queryRows({ columns: [{ name: "Accounts[Name]" }, { name: "Owners[Name]" }, { name: "Owners[Email]" }],
                                 rows: [["Contoso", "Ana", "ana@example.com"]] });
        expect(rows).toEqual([{ "Accounts[Name]": "Contoso", "Owners[Name]": "Ana", Email: "ana@example.com" }]);
    });
});
