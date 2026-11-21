import { describe, expect, it } from "vitest";
import { ingest } from "../src/ingest";

/**
 * A VALUE PAST THE TYPE SAMPLE IS STILL DATA.
 *
 * A column with no declared type is typed from a bounded sample of its first rows, and every row is then converted
 * by that type. A later value the type cannot hold - a 0.15 discount after five hundred whole-number ones, a half
 * unit, a `Not shipped` label in a dated column - used to convert to null: the column kept its type and the value
 * was deleted, so a sum came out short with nothing to say why.
 *
 * The sample still decides; the rest of the column now confirms. The first value that does not fit widens the type,
 * read from the whole column the way the sample would have read it had that value been in it - Integer to Decimal to
 * String, DateTime to String - and the decimal separator is decided again over the whole column the same way.
 */

function lateValues(): string {
    const lines = ["OrderId,Discount,Qty,Shipped"];
    for (let i = 1; i <= 600; i++) {
        const disc = i <= 500 ? "0" : "0.15";
        const qty = i <= 500 ? "2" : "2.5";
        const shipped = i <= 500 ? `2024-01-${String(1 + (i % 28)).padStart(2, "0")}` : i === 600 ? "Not shipped" : "2024-02-01";
        lines.push(`${i},${disc},${qty},${shipped}`);
    }
    return lines.join("\n");
}

const col = (r: ReturnType<typeof ingest>, name: string) => r.columns.find(c => c.name === name)!;
const sumOf = (r: ReturnType<typeof ingest>, name: string) =>
    r.rows.reduce((s, x) => s + (typeof x[name] === "number" ? x[name] : 0), 0);
const nullsOf = (r: ReturnType<typeof ingest>, name: string) => r.rows.filter(x => x[name] === null).length;

describe("a value past the type sample widens the type instead of becoming a blank", () => {
    const r = ingest({ kind: "csv", text: lateValues() }, { dedup: false });

    it("a fractional value after whole numbers makes the column Decimal, and no value is lost", () => {
        expect(col(r, "Discount").dataType).toBe("Decimal");
        expect(nullsOf(r, "Discount")).toBe(0);
        expect(sumOf(r, "Discount")).toBeCloseTo(15, 9);
        expect(col(r, "Discount").blankCount ?? 0).toBe(0);
    });

    it("the same for a half unit", () => {
        expect(col(r, "Qty").dataType).toBe("Decimal");
        expect(sumOf(r, "Qty")).toBe(1250);
    });

    it("a label after dates makes the column text, and the label keeps its value", () => {
        expect(col(r, "Shipped").dataType).toBe("String");
        expect(nullsOf(r, "Shipped")).toBe(0);
        expect(r.rows[599].Shipped).toBe("Not shipped");
    });

    it("a column every value of which fits keeps its type", () => {
        expect(col(r, "OrderId").dataType).toBe("Integer");
    });

    it("a decimal comma first seen past the sample is read as one", () => {
        const lines = ["Name;Amount"];
        for (let i = 1; i <= 520; i++) lines.push(`R${i};${i <= 500 ? "3" : "1,5"}`);
        const t = ingest({ kind: "csv", text: lines.join("\n") }, { dedup: false });
        expect(col(t, "Amount").dataType).toBe("Decimal");
        expect(nullsOf(t, "Amount")).toBe(0);
        expect(sumOf(t, "Amount")).toBe(1530);
    });

    it("already-typed rows widen the same way", () => {
        const rows = Array.from({ length: 600 }, (_, i) => ({ Units: i < 500 ? 2 : 2.5 }));
        const t = ingest({ kind: "objects", rows }, { dedup: false });
        expect(col(t, "Units").dataType).toBe("Decimal");
        expect(sumOf(t, "Units")).toBe(1250);
    });

    it("a declared type is the caller's and is not widened", () => {
        const rows = Array.from({ length: 600 }, (_, i) => [i < 500 ? "2" : "2.5"]);
        const t = ingest({ kind: "table", columns: [{ name: "Units", dataType: "Integer" }], rows }, { dedup: false });
        expect(col(t, "Units").dataType).toBe("Integer");
    });
});
