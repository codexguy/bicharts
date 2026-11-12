import { describe, expect, it } from "vitest";
import { fieldMap, type FieldMap } from "@/fieldMap";
import { sampleTable } from "@/sample/sample-model";
import { filterKeys, WIDGETS } from "./registry";
import { buildDax, daxLiteral, missingRoles, rolesOf, WIDGET_DEFS } from "./query";
import registry from "./widgets.json";

describe("the field map", () => {
    it("binds every role a widget reads", () => {
        for (const def of WIDGET_DEFS) expect(missingRoles(def, fieldMap), def.id).toEqual([]);
    });

    it("names the role a widget misses, in the widget's column order", () => {
        const map: FieldMap = { ...fieldMap, roles: { ...fieldMap.roles, Value: null, Group: undefined } };
        const ranking = WIDGET_DEFS.find((d) => d.id === "ranking")!;
        expect(missingRoles(ranking, map)).toEqual(["Group", "Value"]);
        expect(() => buildDax(ranking, map)).toThrow("Map a field to Group in src/fieldMap.ts");
    });
});

describe("a widget's query", () => {
    const trend = WIDGET_DEFS.find((d) => d.id === "trend")!;

    it("groups by the column roles, computes the measure roles, and names every column after its role", () => {
        const dax = buildDax(trend, fieldMap);
        expect(dax).toContain("SUMMARIZECOLUMNS");
        expect(dax).toContain("'DimDate'[MonthStart]");
        expect(dax).toContain(`"__Value", [Revenue]`);
        expect(dax).toContain(`"Date", 'DimDate'[MonthStart]`);
        expect(dax).toContain(`"Value", [__Value]`);
        expect(dax).toContain(`"Target", [__Target]`);
        expect(dax).toMatch(/ORDER BY \[Date\], \[Period\]/);
    });

    it("is narrowed by the other widgets' filters, never by its own", () => {
        const dax = buildDax(trend, fieldMap, [
            { role: "Category", values: ["Japan", "O'Brien \"Ltd\""] },
            { role: "Date", values: ["2024-03-01"] },
        ]);
        expect(dax).toContain(`TREATAS ( { "Japan", "O'Brien ""Ltd""" }, 'DimCountry'[Country] )`);
        expect(dax).not.toContain("DATE ( 2024, 3, 1 )");
    });

    it("quotes table names and escapes brackets", () => {
        const map: FieldMap = { connection: "x", roles: { ...fieldMap.roles, Date: { table: "Dim Date's", column: "Month [start]" } } };
        expect(buildDax(trend, map)).toContain("'Dim Date''s'[Month [start]]]");
    });

    it("writes dates, numbers and text as DAX literals", () => {
        expect(daxLiteral("2024-03-01T00:00:00")).toBe("DATE ( 2024, 3, 1 )");
        expect(daxLiteral(42)).toBe("42");
        expect(daxLiteral("North")).toBe(`"North"`);
    });
});

describe("the registry", () => {
    it("has a component for every widget in widgets.json", () => {
        expect(WIDGETS.map((w) => w.def.id)).toEqual(registry.widgets.map((w) => w.id));
    });

    it("keys each page filter by one column name, shared by every widget that sets it", () => {
        const keys = filterKeys();
        for (const def of WIDGET_DEFS) {
            if (!def.selects) continue;
            expect(def.columns.find((c) => c.role === def.selects)?.name, def.id).toBe(keys[def.selects]);
        }
    });

    it("records where each widget's code came from, and its hash", () => {
        for (const w of registry.widgets as Array<Record<string, unknown>>) {
            expect(w.source, String(w.id)).toBeTruthy();
            expect(String(w.codeSha256 ?? ""), String(w.id)).toMatch(/^[0-9a-f]{64}$/);
            expect(String(w.chartHost ?? ""), String(w.id)).toMatch(/^\d+\.\d+\.\d+$/);
        }
    });
});

describe("the bundled sample", () => {
    it("answers every widget with one column per role", () => {
        for (const def of WIDGET_DEFS) {
            const t = sampleTable(def);
            expect(t.columns.map((c) => c.name), def.id).toEqual([...new Set(rolesOf(def))]);
            expect(t.rows.length, def.id).toBeGreaterThan(0);
        }
    });

    it("narrows by a page filter like the live query", () => {
        const trend = WIDGET_DEFS.find((d) => d.id === "trend")!;
        const all = sampleTable(trend);
        const japan = sampleTable(trend, [{ role: "Category", values: ["Japan"] }]);
        expect(japan.rows.length).toBe(all.rows.length);
        const v = all.columns.findIndex((c) => c.name === "Value");
        expect(japan.rows[0][v]).toBeLessThan(all.rows[0][v] as number);
    });
});
