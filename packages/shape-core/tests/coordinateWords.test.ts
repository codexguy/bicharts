import { describe, it, expect } from "vitest";
import { IndexedText } from "../src/indexedText";
import { nameLetterRuns } from "../src/nameReader";
import { LATITUDE_WORDS, LONGITUDE_WORDS, coordinateAxisOfWords } from "../src/vocab/coordinates";
import { foldName } from "../src/nameReader";
import type { LLMColumnWithValue } from "../src/models";

// Another language's latitude / longitude words NOMINATE a column; the extent reader admits them only as a pair whose
// measured values fit their axes. The case that was missed: a Spanish table with `latitud (º)` / `longitud (º)` over Peru.

const col = (name: string, dataType: string, isMeasure = false): LLMColumnWithValue =>
    ({ name, dataType, isMeasure } as LLMColumnWithValue);

function scan(cols: LLMColumnWithValue[], rows: any[][], pl = "20") {
    const it = new IndexedText();
    it.setColumns(cols);
    for (const r of rows) it.addRow(r);
    return { it, stats: it.getColumnsWithStats(pl) };
}

// 12 epicentres around Cusco: latitude -11..-8, longitude -75..-73, and a magnitude measure.
function cusco(latName: string, lonName: string, lonAt: (i: number) => number = i => -75 + (i % 3)) {
    const rows: any[][] = [];
    for (let i = 0; i < 12; i++) rows.push([-11 + (i % 4), lonAt(i), 3 + i / 10]);
    return scan([col(latName, "Decimal"), col(lonName, "Decimal"), col("Magnitud", "Decimal", true)], rows);
}

describe("coordinateAxisOfWords", () => {
    it("reads each listed word, folded and case-free", () => {
        expect(coordinateAxisOfWords(["latitud"])).toBe("lat");
        expect(coordinateAxisOfWords(["longitud"])).toBe("lon");
        expect(coordinateAxisOfWords(["längengrad"])).toBe("lon");
        expect(coordinateAxisOfWords(["langengrad"])).toBe("lon");
        expect(coordinateAxisOfWords(["Breitengrad"])).toBe("lat");
        expect(coordinateAxisOfWords(["BREITENGRAD"])).toBe("lat");
        expect(coordinateAxisOfWords(["latitudine"])).toBe("lat");
        expect(coordinateAxisOfWords(["lengtegraad"])).toBe("lon");
        expect(coordinateAxisOfWords(["breedtegraad"])).toBe("lat");
    });
    it("leaves the bare German width / length and every compound alone", () => {
        expect(coordinateAxisOfWords(["breite"])).toBeNull();
        expect(coordinateAxisOfWords(["länge"])).toBeNull();
        expect(coordinateAxisOfWords(["gesamtlänge"])).toBeNull();
        expect(coordinateAxisOfWords(["kabellänge"])).toBeNull();
        expect(coordinateAxisOfWords(["gesamtlongitud"])).toBeNull();
    });
    it("is null for a name that carries both axes, or neither", () => {
        expect(coordinateAxisOfWords(["latitud", "longitud"])).toBeNull();
        expect(coordinateAxisOfWords(["magnitud"])).toBeNull();
        expect(coordinateAxisOfWords([])).toBeNull();
    });
    it("no word folds to both axes (collision test)", () => {
        const fold = (w: string) => foldName(w.normalize("NFC")).toLowerCase();
        const lat = new Set(Object.values(LATITUDE_WORDS).flatMap(ws => (ws ?? []).map(fold)));
        const lon = Object.values(LONGITUDE_WORDS).flatMap(ws => (ws ?? []).map(fold));
        expect(lon.filter(w => lat.has(w))).toEqual([]);
    });
    it("`latitud (º)` reads as one word through the name reader", () => {
        expect(coordinateAxisOfWords(nameLetterRuns("latitud (º)", { camel: true }))).toBe("lat");
        expect(coordinateAxisOfWords(nameLetterRuns("Longitud_x", { camel: true }))).toBe("lon");
    });
});

describe("getGeoExtent with a localized pair", () => {
    it("reads `latitud (º)` / `longitud (º)` over Cusco as a South America extent", () => {
        const { it: t, stats } = cusco("latitud (º)", "longitud (º)");
        const ext = t.getGeoExtent();
        expect(ext).not.toBeNull();
        expect(ext!.pctNa).toBe(0);
        expect(stats.find(c => c.name === "latitud (º)")!.dominantGeoRegion).toBe("south-america");
    });
    it("reads the German `-grad` pair", () => {
        const { it: t } = cusco("Breitengrad", "Längengrad");
        expect(t.getGeoExtent()).not.toBeNull();
    });
    it("a longitude that does not fit +-180 is a length, not a coordinate", () => {
        const { it: t } = cusco("Latitud", "Longitud (m)", i => i * 250);
        expect(t.getGeoExtent()).toBeNull();
    });
    it("a latitude that does not fit +-90 is not a coordinate", () => {
        const rows: any[][] = [];
        for (let i = 0; i < 12; i++) rows.push([i * 20, -75 + (i % 3)]);
        const { it: t } = scan([col("Latitud", "Decimal"), col("Longitud", "Decimal")], rows);
        expect(t.getGeoExtent()).toBeNull();
    });
    it("one localized axis alone is no pair", () => {
        const rows: any[][] = [];
        for (let i = 0; i < 12; i++) rows.push([-11 + (i % 4), 3 + i]);
        const { it: t } = scan([col("Latitud", "Decimal"), col("Magnitud", "Decimal", true)], rows);
        expect(t.getGeoExtent()).toBeNull();
    });
    it("the bare German `Breite` / `Länge` inside range is not read", () => {
        const rows: any[][] = [];
        for (let i = 0; i < 12; i++) rows.push([i * 6, i * 14]);
        const { it: t } = scan([col("Breite", "Decimal"), col("Länge", "Decimal")], rows);
        expect(t.getGeoExtent()).toBeNull();
    });
    it("a string-typed column is never a coordinate", () => {
        const rows: any[][] = [];
        for (let i = 0; i < 12; i++) rows.push(["-11", "-75"]);
        const { it: t } = scan([col("Latitud", "String"), col("Longitud", "String")], rows);
        expect(t.getGeoExtent()).toBeNull();
    });
    it("an English pair is read as before, English winning over a localized neighbour", () => {
        const rows: any[][] = [];
        for (let i = 0; i < 12; i++) rows.push([40 + (i % 3), -74 - (i % 2), 5]);
        const { it: t } = scan([col("Latitude", "Decimal"), col("Longitude", "Decimal"), col("Longitud", "Decimal")], rows);
        const ext = t.getGeoExtent();
        expect(ext).not.toBeNull();
        expect(ext!.pctNa).toBeGreaterThan(0);
    });
});
