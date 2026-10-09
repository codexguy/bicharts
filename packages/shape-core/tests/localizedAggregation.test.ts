// The intensive-measure vocabulary and the host aggregation prefixes, in the
// languages a Power BI model is actually authored in.
//
// Genesis: a Dutch model's `Sum of Temperatuur`, seen in production. The client measured `unknown`, the
// server's fallback name test found no English token in "Temperatuur", the column resolved
// ADDITIVE, and a temperature went onto a y axis as a total with nothing said about it.
import { describe, it, expect } from "vitest";
import {
    nameLooksIntensiveRate, stripHostAggPrefix, hasDefaultAggPrefix, foldAccents, localizedHostAggHint,
    INTENSIVE_WORD_TOKENS, INTENSIVE_SUFFIX_TOKENS, LOCALIZED_DEFAULT_AGG_PREFIXES, LOCALIZED_CHOICE_AGG_PREFIXES,
    LOCALIZED_DEFAULT_AGG_SUFFIXES, LOCALIZED_CHOICE_AGG_SUFFIXES, LOCALIZED_AGG_KINDS,
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
        for (const t of INTENSIVE_SUFFIX_TOKENS) {
            expect(/^[\x20-\x7e]+$/.test(t), `suffix token ${t} is not ASCII`).toBe(true);
        }
    });

    it("the host-label arrays may hold non-Latin text, but only text that is already folded and lower-case", () => {
        // THE GUARD ABOVE IS NARROWED TO THE WORD-BOUNDARY ARRAYS (ruled 2026-10-08). The reason it exists is
        // the word boundary, which .NET reads as Unicode and JavaScript as ASCII. The host-label regexes carry
        // none (they are anchored at an edge and use whitespace only), and both engines case-fold Cyrillic and
        // Greek under IgnoreCase, so a Russian, Greek, Persian or CJK label is sound there. What stays pinned
        // is what makes the two engines agree on a label: it is stored folded (so the folded name meets it)
        // and lower-case, with no character a regex or the generated C# would misread.
        const labels = [...LOCALIZED_DEFAULT_AGG_PREFIXES, ...LOCALIZED_CHOICE_AGG_PREFIXES,
                        ...LOCALIZED_DEFAULT_AGG_SUFFIXES, ...LOCALIZED_CHOICE_AGG_SUFFIXES];
        for (const t of labels) {
            expect(foldAccents(t), `label ${t} must be stored accent-folded`).toBe(t);
            expect(t, `label ${t} must be lower-case`).toBe(t.toLowerCase());
            expect(/["\\*+?^${}()|[\]]/.test(t), `label ${t} carries a regex metacharacter`).toBe(false);
            expect([...t].every(ch => (ch.codePointAt(0) ?? 0) >= 0x20), `label ${t} carries a control character`).toBe(true);
        }
        expect(new Set(labels).size, "a label is listed twice").toBe(labels.length);
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

describe("each host label carries its kind as data (LOCALIZED_AGG_KINDS)", () => {
    // The kind used to live in two regexes inside hostAggHint. This is the oracle: the regexes as they were,
    // run over every label that existed before the table, must give the answer the table gives.
    const OLD_PREFIXES = [
        "somme de", "suma de", "soma de", "summe von", "som van", "somma di", "summa av", "sum av", "sum af",
        "soucet z", "suma z", "totaal van", "total de", "toplam", "osszeg", "nombre de", "recuento de",
        "contagem de", "anzahl von", "aantal van", "conteggio di", "antal av", "lukumaara", "pocet z",
        "moyenne de", "promedio de", "media de", "media di", "durchschnitt von", "gemiddelde van",
        "medelvarde av", "genomsnitt av", "gennemsnit af", "keskiarvo", "atlag", "ortalama", "prumer z",
        "srednia z", "medie de", "minimum de", "minimo de", "minimo di", "minimum von", "maximum de",
        "maximo de", "massimo di", "maximum von",
    ];
    const DEFAULTS = new Set(LOCALIZED_DEFAULT_AGG_PREFIXES);
    const oldKind = (p: string): string => {
        const n = p + " x";
        if (!DEFAULTS.has(p)) {
            if (/^(minimum|minimo)\b/.test(n)) return "min";
            if (/^(maximum|maximo|massimo)\b/.test(n)) return "max";
            return "avg";
        }
        return /^(nombre|recuento|contagem|anzahl|aantal|conteggio|antal|lukumaara|pocet)\b/.test(n) ? "count" : "sum";
    };

    it("every label that existed before reads exactly as the old regexes read it", () => {
        for (const p of OLD_PREFIXES) {
            expect(localizedHostAggHint(`${p} Revenue`), p).toBe(oldKind(p));
        }
        // and a bare default label, which the old code read as the name itself (Finnish `lukumaara` is a count)
        for (const [p, kind] of [["toplam", "sum"], ["osszeg", "sum"], ["lukumaara", "count"]] as const) {
            expect(localizedHostAggHint(p), p).toBe(kind);
        }
    });

    it("lists only labels that exist, and only a kind that differs from the list's own", () => {
        const all = new Set([...LOCALIZED_DEFAULT_AGG_PREFIXES, ...LOCALIZED_CHOICE_AGG_PREFIXES,
            ...LOCALIZED_DEFAULT_AGG_SUFFIXES, ...LOCALIZED_CHOICE_AGG_SUFFIXES]);
        for (const [label, kind] of Object.entries(LOCALIZED_AGG_KINDS)) {
            expect(all.has(label), `kind listed for an unknown label ${label}`).toBe(true);
            const own = (LOCALIZED_DEFAULT_AGG_PREFIXES as readonly string[]).includes(label)
                || (LOCALIZED_DEFAULT_AGG_SUFFIXES as readonly string[]).includes(label) ? "sum" : "avg";
            expect(kind, `${label} is the list's own kind, so it needs no entry`).not.toBe(own);
        }
    });
});

describe("Russian, Ukrainian, Greek, Persian and Danish / Norwegian host labels", () => {
    it("a default label is read, stripped, and not conclusive", () => {
        for (const n of ["Сумма Оборот", "СУММА Оборот", "Сума доходу", "Количество заказов", "Кількість замовлень",
                         "Άθροισμα Εσόδων", "Αθροισμα Εσοδων", "Sum på Beløp", "Sum pa Belop"]) {
            expect(hasDefaultAggPrefix(n), n).toBe(true);
        }
        expect(stripHostAggPrefix("Сумма Оборот")).toBe("Оборот");
        expect(stripHostAggPrefix("Sum på RevenueAmount")).toBe("RevenueAmount");
        expect(localizedHostAggHint("Сумма Оборот")).toBe("sum");
        expect(localizedHostAggHint("Количество заказов")).toBe("count");
        expect(localizedHostAggHint("Кількість замовлень")).toBe("count");
        expect(localizedHostAggHint("Αθροισμα Εσοδων")).toBe("sum");
        expect(localizedHostAggHint("Πληθος Παραγγελιων")).toBe("count");
        expect(localizedHostAggHint("Sum på Beløp")).toBe("sum");
    });

    it("a choice label is an average, is not stripped, and is not a default", () => {
        for (const [n, kind] of [["Среднее значение температуры", "avg"], ["Среднее Оборот", "avg"], ["Середнє значення", "avg"],
                                 ["Μέσος όρος Εσόδων", "avg"], ["ΜΕΣΟΣ ΌΡΟΣ Εσόδων", "avg"], ["میانگین فروش", "avg"],
                                 ["Prom. Ocupación", "avg"]] as const) {
            expect(localizedHostAggHint(n), n).toBe(kind);
            expect(hasDefaultAggPrefix(n), n).toBe(false);
            expect(stripHostAggPrefix(n), n).toBe(n);
        }
    });

    it("an English name that merely starts with a lookalike word is left alone", () => {
        // `prom.` carries its dot, `sum pa` needs the space after it, and a Cyrillic word is not Latin.
        for (const n of ["Prom Night Sales", "Promo Spend", "Sum Pay", "Summary", "Summa", "Sum Parts"]) {
            expect(localizedHostAggHint(n), n).toBeNull();
        }
    });
});

describe("a host that writes its label AFTER the name (Hungarian, Slovak, Chinese, Japanese, Korean)", () => {
    it("a default label is stripped from the end and is not conclusive", () => {
        const cases: Array<[string, string, string]> = [
            ["Bevétel összege", "Bevétel", "sum"],
            ["Amount összege", "Amount", "sum"],
            ["Amount – súčet", "Amount", "sum"],
            ["Amount - sucet", "Amount", "sum"],
            ["Amount 的总和", "Amount", "sum"],
            ["Amount的总和", "Amount", "sum"],
            ["Amount 的计数", "Amount", "count"],
            ["売上 の合計", "売上", "sum"],
            ["매출 의 합계", "매출", "sum"],
        ];
        for (const [name, base, kind] of cases) {
            expect(hasDefaultAggPrefix(name), name).toBe(true);
            expect(stripHostAggPrefix(name), name).toBe(base);
            expect(localizedHostAggHint(name), name).toBe(kind);
        }
    });

    it("a choice label is an average and stays in the name", () => {
        for (const n of ["Ár átlaga", "Cena – priemer", "价格 的平均值", "売上 の平均", "매출 의 평균"]) {
            expect(localizedHostAggHint(n), n).toBe("avg");
            expect(hasDefaultAggPrefix(n), n).toBe(false);
            expect(stripHostAggPrefix(n), n).toBe(n);
        }
    });

    it("a label that is the whole name, or sits mid-name, or joins a word without a gap, is not a suffix form", () => {
        for (const n of ["összege", "súčet", "Összege total", "Celkovosucet", "Bevételösszege"]) {
            expect(hasDefaultAggPrefix(n), n).toBe(false);
            expect(localizedHostAggHint(n), n).toBeNull();
        }
    });
});

describe("occupancy and efficiency words read as rates", () => {
    it("the corpus' `Prom. Ocupación` and its sisters are intensive", () => {
        for (const n of ["Prom. Ocupación", "Ocupación", "Ocupacao media", "Taxa de Ocupacao", "Auslastung", "Bezetting",
                         "Doluluk Orani", "%Efficacité VM", "Eficiencia", "Effizienz", "Verimlilik", "Occupazione"]) {
            expect(nameLooksIntensiveRate(n), n).toBe(true);
        }
    });
    it("French `occupation` is a job in English and is deliberately NOT a rate", () => {
        expect(nameLooksIntensiveRate("Occupation")).toBe(false);
        expect(nameLooksIntensiveRate("Job Occupation Count")).toBe(false);
    });
});
