import { describe, it, expect } from "vitest";
import { normalizeMonthKey, monthLookupFor } from "../src/monthNames";
import { detectOrdinalDomain } from "../src/ordinalDetector";
import { SUPPORTED_LANGS } from "../src/geoCountryNames";

// MONTH AND WEEKDAY NAMES ARE KNOWN NAMES: a column exported without its accents ("Fevrier",
// "Aout", "Miercoles") is still that calendar, and matched as such.

describe("month keys fold accents", () => {
    it("février and fevrier are one key, and the French lookup reads both", () => {
        expect(normalizeMonthKey("fevrier")).toBe(normalizeMonthKey("février"));
        expect(normalizeMonthKey("AOÛT")).toBe(normalizeMonthKey("aout"));
        expect(monthLookupFor("fr")[normalizeMonthKey("Fevrier")]).toBe(1);
        expect(monthLookupFor("fr")[normalizeMonthKey("Decembre")]).toBe(11);
    });

    it("still strips dots, spaces and bidi marks, as before", () => {
        expect(normalizeMonthKey("Sept.")).toBe("sept");
        expect(normalizeMonthKey("‏jan‎")).toBe("jan");
    });

    it("folding merges no two months in any supported language (the measurement it rests on)", () => {
        const collisions: string[] = [];
        for (const lang of SUPPORTED_LANGS) {
            const seen = new Map<string, number>();
            for (const style of ["long", "short"] as const) {
                const f = new Intl.DateTimeFormat(lang, { month: style });
                for (let m = 0; m < 12; m++) {
                    const k = normalizeMonthKey(f.format(new Date(Date.UTC(2020, m, 15))));
                    const cur = seen.get(k);
                    if (cur !== undefined && cur !== m) collisions.push(`${lang} ${k}: ${cur}/${m}`);
                    seen.set(k, m);
                }
            }
        }
        expect(collisions).toEqual([]);
    });
});

describe("the ordinal detector reads calendar names without their accents", () => {
    it("an accent-stripped French month column is the month family", () => {
        const values = ["Janvier", "Fevrier", "Mars", "Avril", "Mai", "Juin", "Juillet", "Aout",
            "Septembre", "Octobre", "Novembre", "Decembre"];
        const r = detectOrdinalDomain([...values].reverse(), "fr-FR");
        expect(r?.pattern).toBe("month_jan_dec");
        expect(r?.orderedDomain).toEqual(values);
    });

    it("Mercredi, mercredi and MERCREDI read the same", () => {
        const week = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];
        for (const variant of [week, week.map(w => w.toLowerCase()), week.map(w => w.toUpperCase())]) {
            const r = detectOrdinalDomain(variant, "fr-FR");
            expect(r?.pattern).toBe("weekday_mon_sun");
            expect(r?.orderedDomain).toEqual(variant);
        }
    });

    it("an accent-stripped Spanish weekday column is the weekday family", () => {
        const values = ["Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado", "Domingo"];
        const r = detectOrdinalDomain(values, "es-ES");
        expect(r?.pattern).toBe("weekday_mon_sun");
        expect(r?.orderedDomain).toEqual(values);
    });

    it("the exact form answers first: Slovak 'st' stays Wednesday, 'št' stays Thursday", () => {
        // Folded, the two are one key - which is why folding is only ever a fallback, and a folded
        // key naming two days names neither.
        const r = detectOrdinalDomain(["po", "ut", "st", "št", "pi"], "sk");
        expect(r?.pattern).toBe("weekday_mon_sun");
        expect(r?.orderedDomain).toEqual(["po", "ut", "st", "št", "pi"]);
    });
});
