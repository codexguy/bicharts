import { describe, expect, it } from "vitest";
import { ingest } from "../src/ingest";

/**
 * AN ALL-DIGIT CODE LONGER THAN 15 DIGITS IS TEXT.
 *
 * A double holds every whole number exactly only up to 2^53 (9,007,199,254,740,992, sixteen digits), and every
 * fifteen-digit number fits under it. Past fifteen digits parseFloat rounds, so order numbers 100000000000000001 to
 * ...004 all read as 100000000000000000: one value where there were four, drawn as one bar and summed as a measure.
 * Nobody counts or adds a sixteen-digit figure written without separators; it is an order, account, card or tracking
 * number, and the writer's digits are the value. One such value makes the column text, as one leading-zero code does
 * (ingestLeadingZeroCodes.test.ts), and a leading-zero code past fifteen digits is caught by the same rule.
 */
describe("all-digit codes longer than 15 digits", () => {
    const distinct = (vals: unknown[]) => new Set(vals).size;

    it("four 18-digit order numbers stay four distinct text values", () => {
        const r = ingest({ kind: "csv", text: "Order ID,Amount\n100000000000000001,10\n100000000000000002,20\n100000000000000003,30\n100000000000000004,40\n" }, { dedup: false });
        const id = r.columns.find(c => c.name === "Order ID")!;
        expect(id.dataType).toBe("String");
        expect(id.isMeasure).toBe(false);
        expect(r.rows.map(x => x["Order ID"])).toEqual(["100000000000000001", "100000000000000002", "100000000000000003", "100000000000000004"]);
        expect(distinct(r.rows.map(x => x["Order ID"]))).toBe(4);
        expect(r.columns.find(c => c.name === "Amount")!.dataType).toBe("Integer");
    });

    it("without an identifier-like name the column is still text, never a summed measure", () => {
        const r = ingest({ kind: "csv", text: "Ref,Qty\n4111111111111111,1\n4111111111111112,2\n4111111111111113,3\n" }, { dedup: false });
        const ref = r.columns.find(c => c.name === "Ref")!;
        expect(ref.dataType).toBe("String");
        expect(ref.isMeasure).toBe(false);
        expect(r.rows.map(x => x.Ref)).toEqual(["4111111111111111", "4111111111111112", "4111111111111113"]);
    });

    it("a 16-digit code with a leading zero keeps its zeros (the leading-zero rule, past 15 digits)", () => {
        const r = ingest({ kind: "csv", text: "Account,V\n0000000000000123,1\n0000000000000456,2\n1000000000000789,3\n" }, { dedup: false });
        expect(r.columns.find(c => c.name === "Account")!.dataType).toBe("String");
        expect(r.rows.map(x => x.Account)).toEqual(["0000000000000123", "0000000000000456", "1000000000000789"]);
    });

    it("one long code past the type sample makes the column text, exact", () => {
        const lines = ["Code,V"];
        for (let i = 1; i <= 510; i++) lines.push(`${i === 505 ? "123456789012345678" : String(1000 + i)},${i}`);
        const r = ingest({ kind: "csv", text: lines.join("\n") }, { dedup: false });
        expect(r.columns.find(c => c.name === "Code")!.dataType).toBe("String");
        expect(r.rows[504].Code).toBe("123456789012345678");
    });

    it("fifteen digits, decimals and grouped figures stay numbers", () => {
        const r = ingest({ kind: "csv", text: "Big,Precise,Grouped\n999999999999999,1234567890.1234567,\"1,234,567,890,123,456\"\n123456789012345,2.5,\"2,000\"\n" }, { dedup: false });
        expect(r.columns.map(c => c.dataType)).toEqual(["Integer", "Decimal", "Decimal"]);
        expect(r.rows[0].Big).toBe(999999999999999);
    });
});
