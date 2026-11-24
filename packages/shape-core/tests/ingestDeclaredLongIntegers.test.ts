import { describe, expect, it } from "vitest";
import { ingest } from "../src/ingest";

/**
 * A DECLARED WHOLE-NUMBER COLUMN NEVER BLANKS A LONG VALUE.
 *
 * A 64-bit key (a database bigint, a snowflake id) runs to nineteen digits, and a double holds every whole number
 * exactly only up to 2^53 (sixteen digits). A driver that knows this hands such a value over as text (node-postgres
 * returns int8 as a string) or as a BigInt, and the integer reader, which reads at most fifteen digits, turned it into
 * null: every key in the column gone. Read as a number instead, the keys would round onto each other. A key is a code -
 * nobody adds two ids - so the column is text and each key keeps its digits. A column the host or the caller declares
 * a measure is a quantity, and keeps its number, rounded to what a double can hold, but never blank.
 */
describe("declared whole-number columns with values longer than 15 digits", () => {
    const ids = ["100000000000000001", "100000000000000002", "100000000000000003"];

    it("a bigint id arriving as text is a text column with every key exact", () => {
        const r = ingest({ kind: "sql", schema: [{ name: "Id", dataType: "bigint" }, { name: "Amount", dataType: "int" }],
            rows: ids.map((id, i) => [id, (i + 1) * 10]) }, { dedup: false });
        const id = r.columns.find(c => c.name === "Id")!;
        expect(id.dataType).toBe("String");
        expect(id.isMeasure).toBe(false);
        expect(r.rows.map(x => x.Id)).toEqual(ids);
        expect(new Set(r.rows.map(x => x.Id)).size).toBe(3);
        expect(r.columns.find(c => c.name === "Amount")!.dataType).toBe("Integer");
    });

    it("a short key in the same column is kept as its text too", () => {
        const r = ingest({ kind: "sql", schema: [{ name: "Id", dataType: "bigint" }], rows: [["42"], [ids[0]]] }, { dedup: false });
        expect(r.rows.map(x => x.Id)).toEqual(["42", ids[0]]);
    });

    it("a BigInt value is read the same way", () => {
        const r = ingest({ kind: "table", columns: [{ name: "Id", dataType: "Integer" }], rows: ids.map(id => [BigInt(id)]) }, { dedup: false });
        expect(r.columns[0].dataType).toBe("String");
        expect(r.rows.map(x => x.Id)).toEqual(ids);
    });

    it("a numeric(20,0) key is text as well", () => {
        const r = ingest({ kind: "sql", schema: [{ name: "AccountNo", dataType: "numeric" }],
            rows: [["12345678901234567890"], ["12345678901234567891"]] }, { dedup: false });
        expect(r.columns[0].dataType).toBe("String");
        expect(r.rows.map(x => x.AccountNo)).toEqual(["12345678901234567890", "12345678901234567891"]);
    });

    it("a column declared a measure stays a number and is never blank", () => {
        const r = ingest({ kind: "sql", schema: [{ name: "Region", dataType: "varchar" }, { name: "TotalBytes", dataType: "bigint" }],
            rows: [["North", "12345678901234567"], ["South", "22345678901234567"]] }, { dedup: false, measures: ["TotalBytes"] });
        const tb = r.columns.find(c => c.name === "TotalBytes")!;
        expect(tb.dataType).toBe("Integer");
        expect(tb.isMeasure).toBe(true);
        expect(r.rows.map(x => x.TotalBytes)).toEqual([12345678901234567, 22345678901234567]);
    });

    it("ids of 15 digits or fewer are numbers as before", () => {
        const r = ingest({ kind: "sql", schema: [{ name: "Id", dataType: "bigint" }], rows: [["123456789012345"], ["7"]] }, { dedup: false });
        expect(r.columns[0].dataType).toBe("Integer");
        expect(r.rows.map(x => x.Id)).toEqual([123456789012345, 7]);
    });
});
