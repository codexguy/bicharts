// The intensive-measure vocabulary and the host aggregation prefixes, in the
// languages a Power BI model is actually authored in.
//
// Genesis: a Dutch model's `Sum of Temperatuur`, seen in production. The client measured `unknown`, the
// server's fallback name test found no English token in "Temperatuur", the column resolved
// ADDITIVE, and a temperature went onto a y axis as a total with nothing said about it.
import { describe, it, expect } from "vitest";
import {
    nameLooksIntensiveRate, stripHostAggPrefix, hasDefaultAggPrefix, foldAccents,
    INTENSIVE_WORD_TOKENS, LOCALIZED_DEFAULT_AGG_PREFIXES, LOCALIZED_CHOICE_AGG_PREFIXES,
} from "../src/aggregation";
import { hostAggHint } from "../src/indexedText";

describe("foldAccents", () => {
    it("folds Latin diacritics to their base letter", () => {
        expect(foldAccents("Température")).toBe("Temperature");
        expect(foldAccents("Média")).toBe("Media");
        expect(foldAccents("Año")).toBe("Ano");
        expect(foldAccents("Průměr")).toBe("Prumer");
        expect(foldAccents("Matrícula")).toBe("Matricula");
    });
    it("PRESERVES LENGTH — stripHostAggPrefix slices the original at a folded offset", () => {
        // The obvious normalize("NFD").replace() shortens the string and would make that slice
        // cut into the base name. Every character in and every character out.
        for (const s of ["Température", "Média de X", "Año", "Průměrná cena", "plain ascii", "日本語", "😀 x"]) {
            expect(foldAccents(s).length, s).toBe(s.length);
        }
    });
    it("leaves non-Latin scripts alone rather than mangling them", () => {
        expect(foldAccents("温度")).toBe("温度");
        expect(foldAccents("доля")).toBe("доля");
    });
});

describe("the localized intensive vocabulary", () => {
    it("reads a temperature in the languages the level-name table already covers", () => {
        for (const n of ["Sum of Temperatuur", "Summe von Temperatur", "Suma de Temperatura",
                         "Somme de Température", "Teplota", "Lämpötila"]) {
            expect(nameLooksIntensiveRate(n), n).toBe(true);
        }
    });
    it("reads an average, a rate and an age", () => {
        for (const n of ["Moyenne de energy_usage_kwh", "Promedio de Cantidad",
                         "Durchschnitt von X", "Gemiddelde omzet", "Átlag ár",
                         "Tasa de involucramiento", "Taux de conversion", "Percentual de perda",
                         "Leeftijd", "Edad del cliente", "Idade média"]) {
            expect(nameLooksIntensiveRate(n), n).toBe(true);
        }
    });

    it("does NOT fire on the English additive words the collisions were pruned for", () => {
        // Each of these is why a token was deliberately left OUT: Spanish/Italian `media`,
        // French `part`, Italian `quota`, German `alter`. A false positive here forbids a
        // legitimate stack, which is the expensive direction.
        for (const n of ["Media Spend", "Sum of Media Cost", "Part Number", "Parts Sold",
                         "Sales Quota", "Quota Attainment Amount", "Altered Rows",
                         "Sum of Revenue", "Order Count", "Units Sold", "Total Storage",
                         "Coverage Units", "Usage"]) {
            const intensive = nameLooksIntensiveRate(n);
            // `Coverage`/`Rating`/`Score` etc. were ALREADY intensive before this item; the
            // assertion is only that the LOCALIZED tokens did not add anything here.
            if (["Media Spend", "Sum of Media Cost", "Part Number", "Parts Sold", "Sales Quota",
                 "Altered Rows", "Sum of Revenue", "Order Count", "Units Sold", "Total Storage"].includes(n)) {
                expect(intensive, n).toBe(false);
            }
        }
    });

    it("every localized token is plain ASCII, because the two regex engines disagree above it", () => {
        // .NET's \w is Unicode-aware and JavaScript's is ASCII-only, so a token with a leading
        // accent — or in Cyrillic, Greek or CJK — matches server-side and never client-side.
        // Storing the tokens folded is what keeps the two honest; this is the guard on that.
        for (const t of INTENSIVE_WORD_TOKENS) {
            expect(/^[\x20-\x7e]+$/.test(t), `token ${t} is not ASCII`).toBe(true);
        }
        for (const t of [...LOCALIZED_DEFAULT_AGG_PREFIXES, ...LOCALIZED_CHOICE_AGG_PREFIXES]) {
            expect(/^[\x20-\x7e]+$/.test(t), `prefix ${t} is not ASCII`).toBe(true);
            expect(t, `prefix ${t} must be lower-case`).toBe(t.toLowerCase());
        }
    });
});

describe("localized host aggregation prefixes", () => {
    it("strips a localized prefix to reach the BASE name — accents included", () => {
        expect(stripHostAggPrefix("Soma de Volume")).toBe("Volume");
        expect(stripHostAggPrefix("Summe von Umsatz")).toBe("Umsatz");
        expect(stripHostAggPrefix("Somme de RevenueAmount")).toBe("RevenueAmount");
        expect(stripHostAggPrefix("Toplam Volume")).toBe("Volume");
        expect(stripHostAggPrefix("Anzahl von Aktivierungscode")).toBe("Aktivierungscode");
        // THE ACCENTED ONE, and the reason foldAccents preserves length: the prefix is matched
        // on "Contagem de Matricula" and sliced off "Contagem de Matrícula".
        expect(stripHostAggPrefix("Contagem de Matrícula")).toBe("Matrícula");
    });
    it("keeps the English behaviour exactly as it was", () => {
        expect(stripHostAggPrefix("Sum of Revenue")).toBe("Revenue");
        expect(stripHostAggPrefix("Count of Id")).toBe("Id");
        expect(stripHostAggPrefix("Revenue")).toBe("Revenue");
        expect(stripHostAggPrefix("")).toBe("");
        expect(stripHostAggPrefix(null)).toBe("");
    });
    it("a DELIBERATE prefix survives the strip, because it is the evidence", () => {
        // Stripping these would delete the word the intensive test is looking for. English
        // never stripped them and the localized ones must not either — a regression this
        // caught during the build, when `Moyenne de X` briefly stopped reading as intensive.
        expect(stripHostAggPrefix("Average of Margin")).toBe("Average of Margin");
        expect(stripHostAggPrefix("Moyenne de energy_usage_kwh")).toBe("Moyenne de energy_usage_kwh");
        expect(stripHostAggPrefix("Média de energy_usage_kwh")).toBe("Média de energy_usage_kwh");
        expect(nameLooksIntensiveRate("Average of Margin")).toBe(true);
        expect(nameLooksIntensiveRate("Average of Units")).toBe(true);
    });
    it("a localized SUM is a default; a localized AVERAGE is a choice", () => {
        // The same asymmetry the English matcher has, and for the same reason: Power BI sums by
        // default, so a sum says what the host did; an average says what someone decided.
        for (const n of ["Soma de Volume", "Suma de Ingresos", "Summe von Umsatz", "Toplam Volume",
                         "Recuento de Año", "Anzahl von Aktivierungscode"]) {
            expect(hasDefaultAggPrefix(n), n).toBe(true);
        }
        for (const n of ["Média de X", "Promedio de Cantidad", "Moyenne de X", "Durchschnitt von X",
                         "Average of Margin", "Minimum de X"]) {
            expect(hasDefaultAggPrefix(n), n).toBe(false);
        }
    });
    it("hostAggHint reads the localized label", () => {
        expect(hostAggHint("Média de energy_usage_kwh")).toBe("avg");
        expect(hostAggHint("Promedio de Cantidad")).toBe("avg");
        expect(hostAggHint("Moyenne de X")).toBe("avg");
        expect(hostAggHint("Durchschnitt von X")).toBe("avg");
        expect(hostAggHint("Gemiddelde van X")).toBe("avg");
        expect(hostAggHint("Soma de Volume")).toBe("sum");
        expect(hostAggHint("Toplam Volume")).toBe("sum");
        expect(hostAggHint("Recuento de Año")).toBe("count");
        expect(hostAggHint("Contagem de Matrícula")).toBe("count");
        expect(hostAggHint("Minimo de X")).toBe("min");
        expect(hostAggHint("Massimo di X")).toBe("max");
        // unchanged
        expect(hostAggHint("Sum of Revenue")).toBe("sum");
        expect(hostAggHint("Average of Margin")).toBe("avg");
        expect(hostAggHint("Revenue")).toBeNull();
    });
    it("a bare localized word that is NOT a prefix is left alone", () => {
        // "media" appears only WITH a connector, so an English "Media Spend" is untouched.
        expect(hostAggHint("Media Spend")).toBeNull();
        expect(stripHostAggPrefix("Media Spend")).toBe("Media Spend");
    });
});
