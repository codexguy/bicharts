import { describe, it, expect } from "vitest";
import { classifyNumericValueNature, IndexedText } from "../src/indexedText";
import type { LLMColumnWithValue } from "../src/models";

// A column the host AGGREGATED into a measure is a quantity, whatever its name ends in. Stamped
// Categorical, the server counted a "Count of ...ID" measure as no number at all and let a Year column
// stand in for it (seen in production, 2026-10-04).
describe("an id-named MEASURE is never stamped Categorical", () => {
    const measure = (name: string, distinct: number, nonblank: number, minval: number, maxval: number) =>
        classifyNumericValueNature({ dataType: "Integer", isMeasure: true, name, distinct, nonblank, prec: 0, minval, maxval });

    it("a counted identifier is Continuous", () => {
        expect(measure("Count of OrderID", 11, 14, 8, 47)).toBe("Continuous");
        expect(measure("Count of session_id", 85, 11404, 1, 431)).toBe("Continuous");
        expect(measure("Count of StoreCode", 9, 11, 1, 29)).toBe("Continuous");
        expect(measure("Contagem de ID do Pedido", 5, 6, 2, 22)).toBe("Continuous");
        expect(measure("Kundennummer", 40, 60, 100, 9000)).toBe("Continuous");
    });

    it("a summed id is never Categorical: a wide range reads Continuous, a dense small range Ordinal", () => {
        expect(measure("ORDER_ID", 10, 98, 1001, 98765)).toBe("Continuous");
        expect(measure("ORDER_ID", 10, 98, 1, 10)).toBe("Ordinal");
    });

    it("the same names as plain columns (not measures) stay identifiers", () => {
        const base = { dataType: "Integer", isMeasure: false, distinct: 900, nonblank: 1000, prec: 0, minval: 10000, maxval: 99999 };
        expect(classifyNumericValueNature({ ...base, name: "CustomerID" })).toBe("Categorical");
        expect(classifyNumericValueNature({ ...base, name: "Kundennummer" })).toBe("Categorical");
        expect(classifyNumericValueNature({ ...base, name: "Count of OrderID" })).toBe("Categorical");
    });
});

describe("through IndexedText at privacy level 10", () => {
    const col = (name: string, dataType: string, isMeasure = false): LLMColumnWithValue => ({ name, dataType, isMeasure });

    it("a bound 'Count of OrderID' measure comes out Continuous", () => {
        const t = new IndexedText();
        t.setColumns([col("Category", "String"), col("Count of OrderID", "Integer", true)]);
        const counts = [8, 12, 15, 19, 22, 25, 29, 33, 38, 41, 44, 47, 12, 19];
        counts.forEach((n, i) => t.addRow([`C${i}`, n]));
        const c = t.getColumnsWithStats("10").find(x => x.name === "Count of OrderID")!;
        expect(c.valueNature).toBe("Continuous");
    });

    // The all-blank default stays Categorical on purpose: an empty nature would reach the server's
    // tier-blind fallback and count as a number, and Continuous would count toward MinContinuous. The
    // server's own guard (a Categorical measure counts only when the client saw a value) handles it.
    it("an all-blank bound measure still comes out Categorical", () => {
        const t = new IndexedText();
        t.setColumns([col("Category", "String"), col("Count of OrderID", "Integer", true)]);
        for (let i = 0; i < 6; i++) t.addRow([`C${i}`, null]);
        const c = t.getColumnsWithStats("10").find(x => x.name === "Count of OrderID")!;
        expect(c.valueNature).toBe("Categorical");
    });
});
