// The readers that take a quarter or a week label, given another language's labels (vocab/periodCodes.ts).
// Every "before" below is what the reader answered before the table existed; the English verdicts are
// pinned separately (periodCodesEnglishUnchanged.test.ts).
import { describe, it, expect } from "vitest";
import { detectOrdinalDomain } from "../src/ordinalDetector";
import { classifyTemporal } from "../src/indexedText";
import { parseTemporalPoint, measureCadence } from "../src/cadence";

const temporal = (values: string[]) =>
    classifyTemporal({ dataType: "String", name: "Periodo", isMeasure: false, distinctCount: values.length, sampleValues: values });

describe("a quarter column in words is an ordered, cyclical quarter axis in any language", () => {
    it.each([
        [["Trimestre 3", "Trimestre 1", "Trimestre 2", "Trimestre 4"], ["Trimestre 1", "Trimestre 2", "Trimestre 3", "Trimestre 4"]],
        [["2e trimestre", "1er trimestre", "4e trimestre"], ["1er trimestre", "2e trimestre", "4e trimestre"]],
        [["Primer trimestre", "Segundo trimestre", "Tercer trimestre", "Cuarto trimestre"], ["Primer trimestre", "Segundo trimestre", "Tercer trimestre", "Cuarto trimestre"]],
        [["2. Quartal", "1. Quartal", "3. Quartal"], ["1. Quartal", "2. Quartal", "3. Quartal"]],
        [["Kwartaal 1", "Kwartaal 2", "Kwartaal 3"], ["Kwartaal 1", "Kwartaal 2", "Kwartaal 3"]],
        [["I kwartał", "II kwartał", "IV kwartał"], ["I kwartał", "II kwartał", "IV kwartał"]],
        [["第3四半期", "第1四半期", "第2四半期"], ["第1四半期", "第2四半期", "第3四半期"]],
        [["一季度", "二季度", "三季度", "四季度"], ["一季度", "二季度", "三季度", "四季度"]],
        [["4분기", "1분기", "2분기", "3분기"], ["1분기", "2분기", "3분기", "4분기"]],
        [["Квартал 1", "Квартал 2", "Квартал 3"], ["Квартал 1", "Квартал 2", "Квартал 3"]],
        [["الربع الثاني", "الربع الأول", "الربع الثالث"], ["الربع الأول", "الربع الثاني", "الربع الثالث"]],
        [["ไตรมาส 1", "ไตรมาส 2", "ไตรมาส 3"], ["ไตรมาส 1", "ไตรมาส 2", "ไตรมาส 3"]],
        [["Trimestre 1", "Q2", "Trimestre 3"], ["Trimestre 1", "Q2", "Trimestre 3"]],
    ])("%j", (values, ordered) => {
        // before: null - the quarter family knew Q, Qtr and Quarter only
        expect(detectOrdinalDomain(values)).toEqual({ pattern: "quarter_q1_q4", orderedDomain: ordered });
    });

    it("never from a bare letter code, from two members, or across two languages", () => {
        expect(detectOrdinalDomain(["T1", "T2", "T3", "T4"])).toBeNull();
        expect(detectOrdinalDomain(["K1", "K2", "K3"])).toBeNull();
        expect(detectOrdinalDomain(["2T", "3T", "4T"])).toBeNull();
        expect(detectOrdinalDomain(["Trim 1", "Trim 2", "Trim 3"])).toBeNull();
        expect(detectOrdinalDomain(["Trimestre 1", "Trimestre 2"])).toBeNull();
        expect(detectOrdinalDomain(["Kwartaal 1", "Quartal 2", "Kwartaal 3"])).toBeNull();
        expect(detectOrdinalDomain(["Trimestre 1", "Trimestre 2", "Paris"])).toBeNull();
    });
});

describe("a period column of another language's quarters or weeks is a time axis", () => {
    it.each([
        [["T1 2024", "T2 2024", "T3 2024", "T4 2024"]],
        [["2024-T1", "2024-T2", "2024-T3"]],
        [["K1 2024", "K2 2024", "K3 2024"]],
        [["1er trimestre 2024", "2e trimestre 2024", "3e trimestre 2024"]],
        [["I kw. 2024", "II kw. 2024", "III kw. 2024"]],
        [["2024年第1四半期", "2024年第2四半期"]],
        [["2024년 1분기", "2024년 2분기", "2024년 3분기"]],
        [["3 кв. 2023", "4 кв. 2023", "1 кв. 2024"]],
        [["KW 1/2024", "KW 2/2024", "KW 3/2024"]],
        [["S12 2024", "S13 2024", "S14 2024"]],
        [["T1 2024", "T2 2024", "Qtr 3 2024", "T4 2024"]],
    ])("%j", (values) => {
        // before: false - the period pattern read Q and W codes only
        expect(temporal(values)).toBe(true);
    });

    it("not a bare code, not two languages mixed, not a year-less word label", () => {
        expect(temporal(["T1", "T2", "T3"])).toBe(false);
        expect(temporal(["T1 2024", "K2 2024", "T3 2024", "K4 2024"])).toBe(false);
        expect(temporal(["Trimestre 1", "Trimestre 2"])).toBe(false);
        expect(temporal(["Tier 1 2024", "Tier 2 2024"])).toBe(false);
    });
});

describe("the cadence reader places another language's quarter on the calendar", () => {
    it.each([
        ["T1 2024", "2024-01-01"], ["2024-T2", "2024-04-01"], ["3e trimestre 2024", "2024-07-01"],
        ["K4 2023", "2023-10-01"], ["2024年第3四半期", "2024-07-01"], ["2024년 4분기", "2024-10-01"],
        ["IV kw. 2024", "2024-10-01"], ["ไตรมาส 2 2567", null], ["S1 2024", null], ["T1 24", null], ["T1", null],
    ])("%s", (value, iso) => {
        expect(parseTemporalPoint(value)?.iso ?? null).toBe(iso);
    });

    it("a French quarterly series reads as quarterly, and a missing quarter as a gap", () => {
        const c = measureCadence(["T1 2023", "T2 2023", "T3 2023", "T4 2023", "T1 2024", "T3 2024"]);
        expect(c?.grain).toBe("quarter");
        expect(c?.points).toBe(6);
        expect(c?.expectedPoints).toBe(7);
    });
});
