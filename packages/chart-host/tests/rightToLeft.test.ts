import { describe, it, expect, beforeEach } from "vitest";
import { JSDOM } from "jsdom";
import { isRightToLeft, chartNumberCulture } from "../src/index";
import { hostText, renderText, catalogSource } from "../src/hostText";
import { chartHostStrings } from "../src/strings";
import { computeSelectionCard } from "../src/selectionCard";
import { resolveOptions } from "../src/defaults";
import { planTrivialChart } from "../src/trivial";
import { rowNameOf } from "../src/keyboardMarks";
import { resolveLanguage } from "@bicharts/shape-core";

// A RIGHT-TO-LEFT READER. Two things go wrong for an Arabic or Hebrew reader that a left-to-right one never sees: a
// Latin value inside a right-to-left sentence (a column name, a number) pulls the words around it out of order unless
// it is isolated, and an Arabic culture formats numbers in Arabic-Indic digits while every other number in the same
// chart is Latin. Values are isolated; chart numbers are Latin; the language is unchanged; English is untouched.

const FSI = "⁨";
const PDI = "⁩";
/** Arabic-Indic and Extended Arabic-Indic digits. */
const NATIVE_DIGITS = /[٠-٩۰-۹]/;

describe("isRightToLeft", () => {
    it("reads the tag the way resolveLanguage does", () => {
        for (const t of ["ar", "he", "iw", "ar-SA", "AR_sa", "ar-SA-u-nu-arab", "he-IL", " he ", "fa", "fa-IR"]) {
            expect(isRightToLeft(t), t).toBe(true);
        }
    });
    it("is false for a left-to-right language, an unknown one, and an absent or unparseable tag", () => {
        for (const t of ["en", "en-US", "de-DE", "zh-TW", "ja", "hi", "sw-KE", "", "   ", "not a tag!", null, undefined]) {
            expect(isRightToLeft(t as any), String(t)).toBe(false);
        }
    });
});

describe("chartNumberCulture", () => {
    it("the runtime really does write Arabic-Indic digits for ar-SA (else these tests prove nothing)", () => {
        expect(new Intl.NumberFormat("ar-SA").format(1234)).toMatch(NATIVE_DIGITS);
    });
    it("gives a right-to-left tag Latin digits", () => {
        expect(chartNumberCulture("ar-SA")).toBe("ar-SA-u-ca-gregory-nu-latn");
        expect(chartNumberCulture("ar")).toBe("ar-u-ca-gregory-nu-latn");
        expect(chartNumberCulture("he-IL")).toBe("he-IL-u-nu-latn");
        const out = new Intl.NumberFormat(chartNumberCulture("ar-SA")).format(1234567);
        expect(out).not.toMatch(NATIVE_DIGITS);
        expect(out).toMatch(/1.234.567/);
    });
    it("merges into an existing -u- extension and replaces an existing numbering system", () => {
        expect(chartNumberCulture("ar-SA-u-nu-arab")).toBe("ar-SA-u-ca-gregory-nu-latn");
        expect(chartNumberCulture("ar-SA-u-ca-islamic")).toBe("ar-SA-u-ca-islamic-nu-latn");
        expect(new Intl.NumberFormat(chartNumberCulture("ar-SA-u-nu-arab")).format(42)).toBe("42");
    });
    it("gives Arabic the Gregorian calendar unless the tag names one, so a chart's dates match its Gregorian data", () => {
        // Browsers default ar-SA to the Umm al-Qura calendar; some Node ICU builds already read Gregorian. Either way the
        // formatting tag states Gregorian, so the runtime's default never decides it.
        expect(chartNumberCulture("ar-SA")).toContain("-ca-gregory");
        expect(new Intl.DateTimeFormat(chartNumberCulture("ar-SA")).resolvedOptions().calendar).toBe("gregory");
        expect(new Intl.DateTimeFormat(chartNumberCulture("ar-SA-u-ca-islamic-umalqura")).resolvedOptions().calendar).toBe("islamic-umalqura");
        const d = new Date(Date.UTC(2026, 10, 23));
        const out = new Intl.DateTimeFormat(chartNumberCulture("ar-SA"), { year: "numeric", timeZone: "UTC" }).format(d);
        expect(out).toContain("2026");
        // A stated calendar is the reader's choice and stays; Hebrew is untouched by the calendar rule.
        expect(new Intl.DateTimeFormat(chartNumberCulture("ar-SA-u-ca-islamic")).resolvedOptions().calendar).toMatch(/^islamic/);
        expect(chartNumberCulture("he-IL")).not.toContain("-ca-");
    });
    it("leaves every other tag exactly as given, and empty stays empty", () => {
        for (const t of ["en", "en-US", "de-DE", "hi-IN", "th-TH", "zh-TW", "en_GB"]) expect(chartNumberCulture(t)).toBe(t);
        expect(chartNumberCulture("")).toBe("");
        expect(chartNumberCulture(undefined)).toBeUndefined();
        expect(chartNumberCulture(null)).toBeNull();
    });
    it("keeps the LANGUAGE: the formatting tag still resolves to the reader's language", () => {
        expect(resolveLanguage(chartNumberCulture("ar-SA")).code).toBe("ar");
        expect(resolveLanguage("ar-SA-u-nu-latn").code).toBe("ar");
        expect(resolveLanguage(chartNumberCulture("he-IL")).code).toBe("he");
        expect(chartHostStrings(chartNumberCulture("ar-SA"))?.lang).toBe("ar");
    });
});

describe("hostText isolates a filled value in a right-to-left sentence", () => {
    const ar = catalogSource("ar", { "card.measure.sum": "مجموع {column}", "card.rows": { one: "{selected} من {total} صف", other: "{selected} من {total} صف" } });
    const he = catalogSource("he-IL", { "card.measure.sum": "סכום של {column}" });
    const de = catalogSource("de", { "card.measure.sum": "Summe von {column}" });

    it("Arabic and Hebrew wrap each filled value in FSI ... PDI", () => {
        expect(hostText(ar, "card.measure.sum", "Sum of {column}", { column: "Revenue" })).toBe(`مجموع ${FSI}Revenue${PDI}`);
        expect(hostText(he, "card.measure.sum", "Sum of {column}", { column: "Revenue" })).toBe(`סכום של ${FSI}Revenue${PDI}`);
    });
    it("a plural form from the source is isolated too, every value in it", () => {
        expect(hostText(ar, "card.rows", "{selected} of {total} rows", { selected: 3, total: 10 }, 10))
            .toBe(`${FSI}3${PDI} من ${FSI}10${PDI} صف`);
    });
    it("English (no source, or the English fallback) and a left-to-right language are unchanged", () => {
        expect(hostText(null, "card.measure.sum", "Sum of {column}", { column: "Revenue" })).toBe("Sum of Revenue");
        expect(hostText(ar, "card.unknown", "Sum of {column}", { column: "Revenue" })).toBe("Sum of Revenue");
        expect(hostText(de, "card.measure.sum", "Sum of {column}", { column: "Revenue" })).toBe("Summe von Revenue");
    });
    it("a placeholder left unfilled is untouched", () => {
        expect(hostText(ar, "card.measure.sum", "Sum of {column}", { other: "x" })).toBe("مجموع {column}");
        expect(hostText(ar, "card.measure.sum", "Sum of {column}")).toBe("مجموع {column}");
    });
    it("renderText inherits it", () => {
        expect(renderText(ar)("card.measure.sum", "Sum of {column}", { column: "Revenue" })).toBe(`مجموع ${FSI}Revenue${PDI}`);
        expect(renderText(null)("card.measure.sum", "Sum of {column}", { column: "Revenue" })).toBe("Sum of Revenue");
    });
});

describe("chart-host's own numbers for an ar-SA reader are Latin", () => {
    function payload() {
        const columns: any[] = [
            { name: "City", dataType: "String", isMeasure: false },
            { name: "Revenue", dataType: "Double", isMeasure: true },
            { name: "__rowIdx__", dataType: "Int64", isMeasure: false },
        ];
        const rows = [["Denver", 12345], ["Miami", 20000], ["Boston", 3000]].map((r, i) => [...r, i]);
        return { columns, rows } as any;
    }

    it("the selection card", () => {
        const card = computeSelectionCard(payload(), [0, 1], { cultureCode: "ar-SA", strings: chartHostStrings("ar-SA") })!;
        const text = JSON.stringify(card);
        expect(text).not.toMatch(NATIVE_DIGITS);
        expect(text).toMatch(/32.345/);
        expect(text).toMatch(/[؀-ۿ]/);   // still Arabic words
    });

    it("the selection card in English is unchanged", () => {
        const card = computeSelectionCard(payload(), [0, 1], { cultureCode: "en-US" })!;
        expect(JSON.stringify(card)).toContain("32,345");
    });

    it("a screen reader's name for a row", () => {
        const name = rowNameOf(payload().columns, ["Denver", 12345.5, 0], "ar-SA");
        expect(name).not.toMatch(NATIVE_DIGITS);
        expect(name).toMatch(/12.345/);
    });

    it("resolveOptions hands a chart's code a Latin-digit culture for ar-SA, and English untouched", () => {
        expect(resolveOptions({ cultureCode: "ar-SA" } as any).cultureCode).toBe("ar-SA-u-ca-gregory-nu-latn");
        expect(resolveOptions({ cultureCode: "en-GB" } as any).cultureCode).toBe("en-GB");
        expect(resolveOptions({} as any).cultureCode).toBeUndefined();
    });

    describe("the trivial card, rendered through resolveOptions", () => {
        let container: HTMLElement;
        beforeEach(() => {
            const dom = new JSDOM("<!doctype html><body><div id='c'></div>");
            (globalThis as any).document = dom.window.document;
            container = dom.window.document.getElementById("c") as unknown as HTMLElement;
        });
        const base: any = { width: 640, height: 400, palette: ["#3182bd"], themeFg: "#333333", backgroundColor: "#ffffff", allowTooltips: true };
        const data = { columns: [{ name: "Invoiced Qty", isMeasure: true, dataType: "Double" }], rows: [[186778062]] };

        it("ar-SA prints Latin digits", () => {
            planTrivialChart(data)!.render(container, data, resolveOptions({ ...base, cultureCode: "ar-SA" }));
            const text = container.textContent || "";
            expect(text).not.toMatch(NATIVE_DIGITS);
            expect(text).toMatch(/186.778.062/);
        });
        it("en-US is unchanged", () => {
            planTrivialChart(data)!.render(container, data, resolveOptions({ ...base, cultureCode: "en-US" }));
            expect(container.textContent).toContain("186,778,062");
        });
    });
});
