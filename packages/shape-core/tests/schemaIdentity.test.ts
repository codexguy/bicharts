import { describe, it, expect } from "vitest";
import { schemaIdentity, schemaIdentityKey, schemaTypeFamily, SIMPLE_STRING_HASH } from "../src/index";
import type { SchemaIdentityColumn } from "../src/index";

const col = (name: string, isMeasure: boolean, dataType: string): SchemaIdentityColumn => ({ name, isMeasure, dataType });
const REGION = col("Region", false, "String");
const SALES = col("Sales", true, "Decimal");

describe("schemaTypeFamily", () => {
    it("reads the type names the hosts send as four families, ignoring case", () => {
        for (const t of ["Integer", "Decimal", "Double", "integer", "DECIMAL"]) expect(schemaTypeFamily(t)).toBe("number");
        for (const t of ["DateTime", "Date", "datetime"]) expect(schemaTypeFamily(t)).toBe("date");
        expect(schemaTypeFamily("Boolean")).toBe("boolean");
        expect(schemaTypeFamily("String")).toBe("text");
    });

    it("keeps any other name as its own family, and no name as empty", () => {
        expect(schemaTypeFamily("Duration")).toBe("duration");
        expect(schemaTypeFamily("Binary")).toBe("binary");
        expect(schemaTypeFamily(" Geography ")).toBe("geography");
        expect(schemaTypeFamily("")).toBe("");
        expect(schemaTypeFamily(null)).toBe("");
        expect(schemaTypeFamily(undefined)).toBe("");
    });
});

describe("schemaIdentity", () => {
    it("is one token per column - name, role, family - in order", () => {
        expect(schemaIdentity([REGION, SALES])).toBe('["Region","D","text"]["Sales","M","number"]');
    });

    it("is empty for no columns, and the key is then 0", () => {
        expect(schemaIdentity([])).toBe("");
        expect(schemaIdentityKey([])).toBe(0);
    });

    it("the key is the string hash of the identity", () => {
        const cols = [REGION, SALES];
        expect(schemaIdentityKey(cols)).toBe(SIMPLE_STRING_HASH(schemaIdentity(cols)));
        expect(schemaIdentityKey(cols)).toBe(schemaIdentityKey([{ ...REGION }, { ...SALES }]));
    });

    it("a type change inside one family is the same fields", () => {
        expect(schemaIdentityKey([REGION, col("Sales", true, "Integer")])).toBe(schemaIdentityKey([REGION, SALES]));
        expect(schemaIdentityKey([col("Day", false, "Date"), SALES])).toBe(schemaIdentityKey([col("Day", false, "DateTime"), SALES]));
    });

    it("a rename, a role change, a family change, an added or removed column, and a reorder are different fields", () => {
        const base = schemaIdentityKey([REGION, SALES]);
        expect(schemaIdentityKey([col("Territory", false, "String"), SALES])).not.toBe(base);
        expect(schemaIdentityKey([REGION, col("Sales", false, "Decimal")])).not.toBe(base);
        expect(schemaIdentityKey([REGION, col("Sales", true, "String")])).not.toBe(base);
        expect(schemaIdentityKey([REGION, SALES, col("Units", true, "Integer")])).not.toBe(base);
        expect(schemaIdentityKey([SALES])).not.toBe(base);
        expect(schemaIdentityKey([SALES, REGION])).not.toBe(base);
    });

    it("no name can make two different lists read alike", () => {
        // A separator inside a name must not let one column pass for two, or two for one.
        const glued = schemaIdentity([col('Region","D","text"]["Sales', true, "Decimal")]);
        expect(glued).not.toBe(schemaIdentity([REGION, SALES]));
        expect(schemaIdentity([col("A|B", false, "String")])).not.toBe(schemaIdentity([col("A", false, "String"), col("B", false, "String")]));
        expect(schemaIdentity([col("A\nB", false, "String")])).not.toBe(schemaIdentity([col("A", false, "String"), col("B", false, "String")]));
    });

    it("an unfamiliar type never merges into a known family", () => {
        expect(schemaIdentityKey([col("Span", true, "Duration")])).not.toBe(schemaIdentityKey([col("Span", true, "Decimal")]));
        expect(schemaIdentityKey([col("Span", true, "Duration")])).not.toBe(schemaIdentityKey([col("Span", true, "Binary")]));
    });
});
