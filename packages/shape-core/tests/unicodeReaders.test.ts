// The three client readers that were still ASCII-only: the coordinate name tokens (a point map's
// frame), the binary-outcome name test, and the value format signature. Each now reads letters in
// any script, and each reads every all-ASCII input exactly as before - that half is pinned against
// the old expressions over a seeded fuzz set, the other half by the names that used to break.
import { describe, it, expect } from "vitest";
import { nameLetterRuns } from "../src/nameReader";
import { detectFormatSignature } from "../src/formatDetector";
import { ingest } from "../src/ingest";

// The expressions these readers used before, as the characterization of the ASCII behaviour.
const OLD_TOKENS = (n: string) => String(n || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase()
    .split(/[^a-z]+/).filter(t => t.length > 0);
const OLD_OUTCOME = (n: string) =>
    /^(is|has)[_a-z0-9]|(?:default|churn|fraud|approv|convert|active|cancel|delinquen|flag|paid|win|pass|fail)/i.test(n);
const NEW_OUTCOME = (n: string) =>
    /^(is|has)[_\p{L}\p{N}]|(?:default|churn|fraud|approv|convert|active|cancel|delinquen|flag|paid|win|pass|fail)/iu.test(n);

/** Seeded ASCII strings shaped like names and labels. */
function asciiFuzz(count: number): string[] {
    let seed = 543;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const alph = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _-.,:;!?@/()'";
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
        let s = "";
        const len = 1 + Math.floor(rnd() * 20);
        for (let j = 0; j < len; j++) s += alph[Math.floor(rnd() * alph.length)];
        if (i % 3 === 0) s = s.replace(/[^A-Za-z ]/g, "");
        if (s) out.push(s);
    }
    return out;
}

describe("the coordinate name tokens read letters in any script", () => {
    it("an all-ASCII name reads exactly as the ASCII split read it", () => {
        for (const n of ["Latitude", "store_lat", "LatDeg", "lon2", "Lng (deg)", "GPS-Long", "XMLLat", "lat.lon"])
            expect(nameLetterRuns(n, { camel: true }), n).toEqual(OLD_TOKENS(n));
        for (const s of asciiFuzz(20000)) expect(nameLetterRuns(s, { camel: true })).toEqual(OLD_TOKENS(s));
    });

    it("a non-ASCII name is read whole, not cut at every accented letter", () => {
        expect(OLD_TOKENS("Längengrad")).toEqual(["l", "ngengrad"]);
        expect(nameLetterRuns("Längengrad", { camel: true })).toEqual(["längengrad"]);
        expect(OLD_TOKENS("Широта")).toEqual([]);
        expect(nameLetterRuns("Широта", { camel: true })).toEqual(["широта"]);
        expect(nameLetterRuns("GeoBreiteÖst", { camel: true })).toEqual(["geo", "breite", "öst"]);
        expect(nameLetterRuns("緯度_2024", { camel: true })).toEqual(["緯度"]);
    });

    it("the frame still finds an English coordinate pair", () => {
        const r = ingest({ kind: "csv", text: "City,Latitude,Longitude,Sales\nA,40.7,-74.0,1\nB,34.0,-118.2,2\nC,41.9,-87.6,3\n" },
            { measures: ["Sales"] });
        expect(r.index.getGeoExtent()).not.toBeNull();
    });
});

describe("the binary-outcome name test reads letters in any script", () => {
    it("every all-ASCII name reads exactly as before", () => {
        for (const n of ["isActive", "is_paid", "Island", "HasChurned", "has", "Default Flag", "Region"])
            expect(NEW_OUTCOME(n), n).toBe(OLD_OUTCOME(n));
        for (const s of asciiFuzz(20000)) expect(NEW_OUTCOME(s)).toBe(OLD_OUTCOME(s));
    });

    it("a name that continues past is/has in another script is read, as its ASCII twin is", () => {
        expect(OLD_OUTCOME("hasÄnderung")).toBe(false);
        expect(NEW_OUTCOME("hasÄnderung")).toBe(true);
        expect(NEW_OUTCOME("hasAnderung")).toBe(true);
    });

    it("the shape carries the flag for such a two-valued column", () => {
        const r = ingest({ kind: "csv", text: "hasÄnderung,Wert\nja,1\nnein,2\nja,3\nnein,4\n" }, { measures: ["Wert"] });
        expect(r.columns.find(c => c.name === "hasÄnderung")!.isBinaryFlag).toBe(true);
    });
});

describe("the format signature reads casing in any cased script", () => {
    it("an all-ASCII value classifies exactly as before", () => {
        const pinned: Array<[string[], string]> = [
            [["Delta Air Lines", "United Airlines"], "TITLE_CASE_WORDS"],
            [["Boston", "Denver", "Austin"], "TITLE_CASE_WORDS"],
            [["red", "blue", "green"], "LOWER_WORDS"],
            [["the quick brown", "a slow red"], "LOWER_WORDS"],
            [["iPhone Case", "eBay Store"], "SENTENCE_TEXT"],
            [["CA", "NY", "TX"], "ALL_UPPER_FIXED_2"],
            [["A1", "Q2"], "ALL_UPPER_FIXED_2"],
            [["x1", "y2"], "OTHER"],
        ];
        for (const [vals, sig] of pinned) expect(detectFormatSignature(vals), vals.join("|")).toBe(sig);
    });

    it("a Latin name with a diacritic, and a Cyrillic or Greek name, is a name", () => {
        expect(detectFormatSignature(["Zürich", "Genève", "Neuchâtel"])).toBe("TITLE_CASE_WORDS");
        expect(detectFormatSignature(["Москва", "Казань", "Самара"])).toBe("TITLE_CASE_WORDS");
        expect(detectFormatSignature(["Москва Сити", "Нижний Новгород"])).toBe("TITLE_CASE_WORDS");
        expect(detectFormatSignature(["Αθήνα", "Πάτρα"])).toBe("TITLE_CASE_WORDS");
        expect(detectFormatSignature(["привет", "мир"])).toBe("LOWER_WORDS");
        // Decomposed (a mark after its base letter) reads the same as composed.
        expect(detectFormatSignature(["Zürich"])).toBe("TITLE_CASE_WORDS");
    });

    it("upper-case codes in another script stay out of ALL_UPPER - identifier evidence is ASCII only", () => {
        expect(detectFormatSignature(["МСК", "СПБ", "НСК"])).toBe("OTHER");
    });

    it("an uncased script has no casing to describe", () => {
        expect(detectFormatSignature(["東京", "大阪"])).toBe("OTHER");
        expect(detectFormatSignature(["القاهرة", "دبي"])).toBe("OTHER");
    });
});
