import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    readPeriodCode, periodCodeSeries, PERIOD_CODE_FORMS, PERIOD_ORDINALS, PERIOD_CODE_MEMBERS,
    type PeriodCodeReading, type PeriodCodeGrain,
} from "../src/vocab/periodCodes";
import { VOCABULARY_LANGUAGE_CODES, SUPPORTED_LANGUAGE_CODES } from "../src/languages";

interface Fixture {
    readings: { value: string; expect: string[] }[];
    series: { values: string[]; expect: string | null }[];
}
const fixture: Fixture = JSON.parse(readFileSync(join(__dirname, "fixtures", "period-codes.json"), "utf-8"));

const show = (r: PeriodCodeReading) => `${r.lang} ${r.grain} ${r.n} ${r.year ?? "-"} ${r.form}`;

describe("period codes - the shared fixture", () => {
    it.each(fixture.readings.map(c => [c.value, c.expect] as const))("%s", (value, expected) => {
        expect(readPeriodCode(value).map(show)).toEqual(expected);
    });

    it.each(fixture.series.map(c => [c.values.join(" | "), c.values, c.expect] as const))("series %s", (_, values, expected) => {
        const s = periodCodeSeries(values);
        expect(s ? `${s.lang} ${s.grain}` : null).toEqual(expected);
    });
});

describe("period codes - the table", () => {
    it("every language in it is a vocabulary language, and every Tier 1 language labels a quarter", () => {
        for (const grain of Object.keys(PERIOD_CODE_FORMS) as PeriodCodeGrain[]) {
            for (const lang of Object.keys(PERIOD_CODE_FORMS[grain])) expect(VOCABULARY_LANGUAGE_CODES).toContain(lang);
        }
        for (const lang of SUPPORTED_LANGUAGE_CODES) expect(Object.keys(PERIOD_CODE_FORMS.quarter)).toContain(lang);
        expect(Object.keys(PERIOD_CODE_FORMS.quarter)[0]).toBe("en");
    });

    it("every template names its member exactly once, and ordinals exist wherever a template asks for one", () => {
        for (const grain of Object.keys(PERIOD_CODE_FORMS) as PeriodCodeGrain[]) {
            for (const [lang, set] of Object.entries(PERIOD_CODE_FORMS[grain])) {
                for (const t of [...(set?.words ?? []), ...(set?.codes ?? [])]) {
                    const holes = (t.match(/[#%@]/g) ?? []).length + (/=[0-9]+$/.test(t) ? 1 : 0);
                    expect(holes, `${lang} ${grain} "${t}"`).toBe(1);
                    if (t.includes("@")) expect(PERIOD_ORDINALS[lang as keyof typeof PERIOD_ORDINALS], `${lang} ordinals`).toBeDefined();
                }
            }
        }
        for (const ords of Object.values(PERIOD_ORDINALS)) expect(ords!.length).toBe(4);
    });

    it("a member outside its grain is no reading: quarter 5, half-year 3, week 54", () => {
        expect(readPeriodCode("Quartal 5")).toEqual([]);
        expect(readPeriodCode("Halbjahr 3")).toEqual([]);
        expect(readPeriodCode("KW 54")).toEqual([]);
        expect(PERIOD_CODE_MEMBERS).toEqual({ quarter: 4, half: 2, week: 53 });
    });

    it("a year touches the label's digits only across a letter", () => {
        expect(readPeriodCode("T12024")).toEqual([]);
        expect(readPeriodCode("2024T1").map(show)[0]).toBe("fr quarter 1 2024 code");
        expect(readPeriodCode("1T2024").map(show)[0]).toBe("fr quarter 1 2024 code");
        expect(readPeriodCode("20241T")).toEqual([]);
    });
});

describe("period codes - the one-language rule", () => {
    it("a series is one grain in one language; English labels join it", () => {
        expect(periodCodeSeries(["Trimestre 1", "Q2", "Trimestre 3"])?.lang).toBe("fr");
        expect(periodCodeSeries(["1er trimestre", "2e trimestre"])?.lang).toBe("fr");
        expect(periodCodeSeries(["Primer trimestre", "2º trimestre"])?.lang).toBe("es");
        expect(periodCodeSeries(["Kwartaal 1", "Quartal 2"])).toBeNull();
    });

    it("a series only English reads is English's", () => {
        const s = periodCodeSeries(["Qtr 1", "Qtr 2", "Qtr 3"]);
        expect(s?.lang).toBe("en");
        expect(s?.readings.map(r => r.n)).toEqual([1, 2, 3]);
    });

    it("the caller chooses which readings count", () => {
        const withYear = (r: PeriodCodeReading) => r.year !== null;
        expect(periodCodeSeries(["T1", "T2", "T3"], withYear)).toBeNull();
        expect(periodCodeSeries(["T1 2024", "T2 2024"], withYear)?.lang).toBe("fr");
    });
});
