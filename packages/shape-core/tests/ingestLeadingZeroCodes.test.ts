import { describe, expect, it } from "vitest";
import { ingest } from "../src/ingest";

/**
 * A CODE WRITTEN WITH ITS LEADING ZERO KEEPS IT.
 *
 * `00123` read as a number is drawn as 123, and a ZIP `02134` as 2134: the zero the writer kept on purpose is gone
 * from every label. One value of three digits or more with a leading zero makes the column text, the way a ZIP column
 * a spreadsheet kept as text arrives - and the ZIP reader reads that form as it reads the number (both are `02134`
 * to it), so a ZIP column is still a ZIP column. Two-digit values (`01`-`12`, `00`-`23`) are months, days and hours
 * written to a fixed width and stay numbers.
 */
describe("leading-zero codes", () => {
    it("stay text, with their zeros", () => {
        const r = ingest({ kind: "csv", text: "Id,Qty\n00123,7\n00456,8\n10789,9\n" }, { dedup: false });
        expect(r.columns.find(c => c.name === "Id")!.dataType).toBe("String");
        expect(r.rows.map(x => x.Id)).toEqual(["00123", "00456", "10789"]);
        expect(r.columns.find(c => c.name === "Qty")!.dataType).toBe("Integer");
    });

    it("a ZIP column with a leading zero is text and still a ZIP column", () => {
        const r = ingest({ kind: "csv", text: "Zip,Orders\n02134,3\n10001,5\n94105,2\n60614,4\n" }, { dedup: false });
        const zip = r.columns.find(c => c.name === "Zip")!;
        expect(zip.dataType).toBe("String");
        expect(r.rows[0].Zip).toBe("02134");
        expect(zip.geoKind).toBe("us-zip5");
    });

    it("one past the type sample does the same", () => {
        const lines = ["Code,V"];
        for (let i = 1; i <= 510; i++) lines.push(`${i === 505 ? "00042" : String(1000 + i)},${i}`);
        const r = ingest({ kind: "csv", text: lines.join("\n") }, { dedup: false });
        expect(r.columns.find(c => c.name === "Code")!.dataType).toBe("String");
        expect(r.rows[504].Code).toBe("00042");
    });

    it("two-digit fixed-width numbers, and zero itself, stay numbers", () => {
        const r = ingest({ kind: "csv", text: "Month,Hour,V\n01,00,0\n02,07,0.5\n12,23,3\n" }, { dedup: false });
        expect(r.columns.map(c => c.dataType)).toEqual(["Integer", "Integer", "Decimal"]);
        expect(r.rows[0]).toEqual({ Month: 1, Hour: 0, V: 0 });
    });
});
