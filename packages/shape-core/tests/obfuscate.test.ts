import { describe, it, expect } from "vitest";
import {
    obfuscate, restoreRows, rebindRows, rebindCode, rebind, serializeKey, parseKey,
    ingest, detectOrdinalDomain, detectGeo, summarizeGeoExtent,
} from "../src/index";
import type { ObfuscateTable, StandInKey } from "../src/index";

// THE STAND-IN, PROVED AGAINST ITS SHAPE. A stand-in is a table with the same shape and statistical nature as
// the reader's, whose labels, magnitudes and dates identify nothing. Every check below compares the real table
// with its stand-in through shape-core's own readings, or through statistics computed here from the rows. The
// tables are synthesized below: invented words, invented codes, no real or personal data.

// ---- synthesized tables -------------------------------------------------------------------------------
function prng(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

const REGIONS = ["Northfield", "Eastvale", "Southmere", "Westbrook", "Midhollow"];
const CITIES: Record<string, string[]> = {
    Northfield: ["Arlenport", "Brisdon", "Corvale"], Eastvale: ["Dunmarrow", "Elsworth", "Fenwick"],
    Southmere: ["Galloway", "Harrowby", "Ivelton"], Westbrook: ["Jessamine", "Kelbourne", "Lindqvale"],
    Midhollow: ["Marrowdene", "Netherby", "Oakhurst"],
};
const WORDS = ["copper", "kettle", "linen", "basket", "walnut", "lantern", "velvet", "teapot", "garden", "bench"];
const STATES = ["CA", "TX", "NY", "FL", "WA", "OR", "IL", "OH", "GA", "AZ", "CO", "NV"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Orders: a sorted fixed-length code, a skewed category, a city within it, free text, US states, daily dates
 *  across a leap day, month names, whole and decimal measures with signs and zeros, a share, a percent, a
 *  small whole-number age, scattered reference codes, and blanks. */
function salesTable(): ObfuscateTable {
    const r = prng(11);
    const header = ["OrderCode", "Region", "City", "Product", "State", "OrderDate", "OrderMonth",
        "Quantity", "Revenue", "Profit", "Margin", "DiscountPct", "AgeYears", "TicketRef"];
    const rows: (string | number | null)[][] = [];
    const start = Date.UTC(2024, 0, 20);
    for (let i = 0; i < 160; i++) {
        const region = r() < 0.45 ? REGIONS[0] : pick(r, REGIONS);
        const day = new Date(start + i * 86400000);
        const qty = Math.floor(r() * 40) + (r() < 0.1 ? 0 : 1);
        const revenue = Math.round((qty * 12.75 + r() * 300) * 100) / 100;
        const profit = Math.round((r() - 0.3) * 900 * 100) / 100;
        rows.push([
            "KQZ" + String(1000 + i * 3),
            region,
            pick(r, CITIES[region]),
            pick(r, WORDS) + " " + pick(r, WORDS) + (r() < 0.4 ? " " + pick(r, WORDS) : ""),
            r() < 0.05 ? "" : pick(r, STATES),
            isoDay(day),
            MONTHS[day.getUTCMonth()],
            String(qty),
            r() < 0.04 ? "" : revenue.toFixed(2),
            profit === 0 ? "0" : profit.toFixed(2),
            (Math.round(r() * 900) / 1000).toFixed(3),
            String(Math.round(r() * 60 * 10) / 10),
            String(18 + Math.floor(r() * 50)),
            // Scattered five-digit references: a mask drawn blind would often carry four digits of another one.
            "T-" + String(10000 + Math.floor(r() * 90000)),
        ]);
    }
    return { header, rows };
}

/** Sites with coordinates in the US, and a site label. */
function sitesTable(): ObfuscateTable {
    const r = prng(23);
    const rows: (string | number | null)[][] = [];
    for (let i = 0; i < 60; i++) {
        rows.push(["Site " + pick(r, WORDS) + "-" + (i + 101),
            (32 + r() * 14).toFixed(4), (-120 + r() * 38).toFixed(4), String(Math.floor(r() * 500) + 20)]);
    }
    return { header: ["SiteLabel", "Latitude", "Longitude", "Visits"], rows };
}

/** Hourly readings across the 2024 leap day (time of day), a year number and a monthly series. */
function readingsTable(): ObfuscateTable {
    const r = prng(37);
    const rows: (string | number | null)[][] = [];
    const t0 = Date.UTC(2024, 1, 27, 6, 0);
    for (let i = 0; i < 96; i++) {
        const t = new Date(t0 + i * 3 * 3600000);
        rows.push([t.toISOString().slice(0, 16).replace("T", " "), t.getUTCFullYear(),
            isoDay(new Date(Date.UTC(2019, i % 60, 1))), Math.round(r() * 1000) / 10]);
    }
    return { header: ["ReadingTime", "Year", "PeriodStart", "Level"], rows };
}

// ---- readings and statistics computed here, independently of the implementation ---------------------
const READING_KEYS = ["dataType", "isMeasure", "isTemporal", "valueNature", "ordinalPattern", "distinctCount",
    "blankCount", "formatSignature", "sortedDirection", "modelFormat", "numericPrecision"];
const ISO_LIKE = /^\d{4}-\d{2}-\d{2}/;
function stripDates(v: any): any {
    if (Array.isArray(v)) return v.map(stripDates);
    if (v && typeof v === "object") {
        const o: any = {};
        for (const k of Object.keys(v)) if (!(typeof v[k] === "string" && ISO_LIKE.test(v[k]))) o[k] = stripDates(v[k]);
        return o;
    }
    return v;
}
function readings(t: ObfuscateTable) {
    return ingest({ kind: "grid", header: t.header, rows: t.rows }).columns.map(c => {
        const o: Record<string, any> = {};
        for (const k of READING_KEYS) o[k] = (c as any)[k];
        for (const k of Object.keys(c)) if (/geo/i.test(k)) o[k] = (c as any)[k];
        if ((c as any).temporalCadence) o.cadence = stripDates((c as any).temporalCadence);
        return o;
    });
}
const blank = (v: any) => v === null || v === undefined || String(v).trim() === "";
const col = (t: ObfuscateTable, j: number) => t.rows.map(r => r[j]);
function freqVector(xs: any[]): number[] {
    const m = new Map<string, number>();
    for (const x of xs) if (!blank(x)) m.set(String(x), (m.get(String(x)) ?? 0) + 1);
    return [...m.values()].sort((a, b) => b - a);
}
const distinctTuples = (t: ObfuscateTable, js: number[]) => new Set(t.rows.map(r => JSON.stringify(js.map(j => r[j])))).size;
function pearson(x: number[], y: number[]): number {
    const n = x.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sx = 0, sy = 0;
    for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sx += (x[i] - mx) ** 2; sy += (y[i] - my) ** 2; }
    return sxy / Math.sqrt(sx * sy);
}
const keyCol = (key: StandInKey, name: string) => key.columns.find(c => c.name === name)!;
const idx = (t: ObfuscateTable, name: string) => t.header.indexOf(name);

/**
 * CHECK 7's DETECTOR, written here so it does not share the masker's blind spots. Findings are strings naming
 * what leaked. Exempt: columns the reader kept or whose values only moved (`keep`, `place`, `shuffle`), real names
 * unless masked, and the detector words a masked name keeps.
 */
const MIN_LEAK = 4;
function windows(s: string): string[] {
    const cps = Array.from(s.toLowerCase());
    const out: string[] = [];
    for (let i = 0; i + MIN_LEAK <= cps.length; i++) out.push(cps.slice(i, i + MIN_LEAK).join(""));
    return out;
}
const ENUM_KEYS = new Set(["dataType", "valueNature", "formatSignature", "sortedDirection", "ordinalPattern", "geoKind",
    "dominantGeoRegion", "additivity", "aggregation", "defaultAgg", "temporalGrain", "dateFormatPattern", "grain"]);
function jsonStrings(v: any, keyName: string, out: string[]) {
    if (typeof v === "string") { if (!ENUM_KEYS.has(keyName)) out.push(v); return; }
    if (typeof v === "number") { out.push(String(v)); return; }
    if (Array.isArray(v)) { v.forEach(x => jsonStrings(x, keyName, out)); return; }
    if (v && typeof v === "object") for (const k of Object.keys(v)) jsonStrings(v[k], k, out);
}
function leakFindings(real: ObfuscateTable, standIn: ObfuscateTable, key: StandInKey, keptNameWords: string[] = []): string[] {
    const findings: string[] = [];
    const exempt = (j: number) => ["keep", "place", "shuffle"].includes(key.columns[j].transform);
    const realShape = ingest({ kind: "grid", header: real.header, rows: real.rows }).columns;
    const standShape = ingest({ kind: "grid", header: standIn.header, rows: standIn.rows }).columns;
    // Text: every 4-character window of a real label of a masked column.
    const labelWin = new Set<string>();
    key.columns.forEach((c, j) => {
        if (c.transform !== "mask") return;
        for (const v of col(real, j)) if (!blank(v)) windows(String(v)).forEach(w => labelWin.add(w));
    });
    // Names: the real name words a masked name must not carry.
    const masking = key.options.names === "mask";
    if (masking) for (const n of real.header) for (const w of n.split(/[^\p{L}\p{N}]+|(?<=\p{Ll})(?=\p{Lu})/u)) {
        if (w.length >= MIN_LEAK && !keptNameWords.includes(w.toLowerCase())) windows(w).forEach(x => labelWin.add(x));
    }
    // A plain number is read against its own column's real numbers (below), not against label text: a code's
    // digits turning up inside an unrelated float is not a label.
    const hitText = (where: string, s: string) => {
        if (/^[+-]?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(s.trim())) return;
        for (const w of windows(s)) if (labelWin.has(w)) { findings.push(`${where}: "${s}" carries "${w}"`); return; }
    };
    standIn.rows.forEach((row, i) => row.forEach((v, j) => {
        if (exempt(j) || blank(v)) return;
        hitText(`row ${i} col ${j}`, String(v));
        // Numbers and dates: the real value at its own place.
        const rv = real.rows[i][j];
        const rs = blank(rv) ? "" : String(rv);
        if (rs.length >= MIN_LEAK && Number(rs) !== 0 && String(v).includes(rs)) findings.push(`row ${i} col ${j}: real "${rs}" kept`);
    }));
    if (masking) standIn.header.forEach((n, j) => hitText(`name ${j}`, n));
    // The stand-in's shape: its strings carry no real label, and a column's numbers carry none of the real
    // column's statistics.
    standShape.forEach((c: any, j) => {
        const strs: string[] = [];
        const own: any = { ...c };
        if (!masking) { delete own.name; delete own.hostName; }
        jsonStrings(own, "", strs);
        if (!exempt(j)) for (const s of strs) hitText(`shape col ${j}`, s);
        if (exempt(j)) return;
        const realStats: string[] = [];
        for (const k of ["lowValue", "highValue", "avgValue", "medianValue", "sum", "quantiles", "topCategoryValues"]) {
            if ((realShape[j] as any)[k] !== undefined) jsonStrings((realShape[j] as any)[k], k, realStats);
        }
        // A statistic is a number: it leaks when the stand-in's shape carries that same number (a text statistic,
        // a top category, leaks when the shape carries the text). `0.04` inside `0.0444` is another number.
        const asNumber = (s: string) => /^[+-]?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(s.trim()) ? Number(s) : null;
        const standNums = new Set(strs.map(asNumber).filter(x => x !== null));
        const joined = strs.join("\u0001");
        for (const s of realStats) {
            if (s.length < MIN_LEAK || Number(s) === 0) continue;
            const x = asNumber(s);
            if (x !== null ? standNums.has(x) : joined.includes(s)) findings.push(`shape col ${j}: real statistic "${s}"`);
        }
    });
    return findings;
}

// ---- the checks ------------------------------------------------------------------------------------------
const SEED = "stand-in-seed-a";
const TABLES: Array<[string, () => ObfuscateTable]> = [["sales", salesTable], ["sites", sitesTable], ["readings", readingsTable]];

describe("check 1: the stand-in is read the same", () => {
    for (const [name, make] of TABLES) {
        it(`${name}: rows, columns and order, and each column's readings, under the defaults`, () => {
            const real = make();
            const { standIn } = obfuscate(real, { seed: SEED });
            expect(standIn.header).toEqual(real.header);
            expect(standIn.rows.length).toBe(real.rows.length);
            standIn.rows.forEach((r, i) => expect(r.length).toBe(real.rows[i].length));
            expect(readings(standIn)).toEqual(readings(real));
        });
    }
    it("a fixed-length code keeps its length and a sorted code its order", () => {
        const real = salesTable();
        const { standIn } = obfuscate(real, { seed: SEED });
        const j = idx(real, "OrderCode");
        expect(new Set(col(standIn, j).map(v => String(v).length))).toEqual(new Set([7]));
        const codes = col(standIn, j).map(String);
        expect(codes).toEqual([...codes].sort());
        expect(codes.some((c, i) => c === real.rows[i][j])).toBe(false);
    });
    it("a small whole-number column keeps its reading (left unscaled when scaling would change it)", () => {
        const real = salesTable();
        const { key } = obfuscate(real, { seed: SEED });
        const age = keyCol(key, "AgeYears");
        expect(["keep", "scale"]).toContain(age.transform);
        expect(readings(obfuscate(real, { seed: SEED }).standIn)[idx(real, "AgeYears")]).toEqual(readings(real)[idx(real, "AgeYears")]);
    });
    it("masked names keep the words shape-core reads, and the readings hold", () => {
        const real = salesTable();
        const { standIn, key } = obfuscate(real, { seed: SEED, names: "mask" });
        expect(new Set(standIn.header).size).toBe(real.header.length);
        for (const m of ["OrderCode", "Region", "Product", "OrderDate", "Revenue", "Profit", "AgeYears"]) {
            expect(standIn.header[idx(real, m)], m).not.toBe(m);
        }
        expect(standIn.header[idx(real, "State")]).toBe("State");
        expect(standIn.header[idx(real, "AgeYears")]).toMatch(/^Age/);
        expect(standIn.header[idx(real, "OrderMonth")]).toMatch(/Month$/);
        expect(key.columns.map(c => c.standInName)).toEqual(standIn.header);
        expect(readings(standIn).map(({ ...r }) => r)).toEqual(readings(real));
    });
    it("masked names keep the words the server reads: a target, a rep, a retention role", () => {
        const header = ["Revenue Target", "Sales Rep", "Last Activity Date", "Customer Name", "Verkäufer"];
        const rows = Array.from({ length: 12 }, (_, i) => [1000 + i * 37, `Person ${i % 3}`, `2024-0${1 + (i % 9)}-15`, `Client ${i}`, `V ${i % 4}`]);
        const real: ObfuscateTable = { header, rows };
        const { standIn } = obfuscate(real, { seed: SEED, names: "mask" });
        const at = (h: string) => standIn.header[header.indexOf(h)];
        expect(at("Revenue Target")).toMatch(/ Target$/);
        expect(at("Revenue Target")).not.toMatch(/^Revenue/);
        expect(at("Sales Rep")).toBe("Sales Rep");
        expect(at("Last Activity Date")).toMatch(/^Last Activity /);
        expect(at("Customer Name")).not.toMatch(/^Customer/);
        expect(at("Verkäufer")).toBe("Verkäufer");
    });
});

describe("check 2: counts, blanks, frequencies and hierarchies", () => {
    for (const [name, make] of TABLES) {
        it(`${name}: per column, and across category pairs`, () => {
            const real = make();
            const { standIn } = obfuscate(real, { seed: SEED });
            const n = real.header.length;
            for (let j = 0; j < n; j++) {
                expect(new Set(col(standIn, j).filter(v => !blank(v)).map(String)).size, real.header[j])
                    .toBe(new Set(col(real, j).filter(v => !blank(v)).map(String)).size);
                expect(col(standIn, j).map(blank), real.header[j]).toEqual(col(real, j).map(blank));
                expect(freqVector(col(standIn, j)), real.header[j]).toEqual(freqVector(col(real, j)));
            }
            const cats = readings(real).map((r, j) => [r, j] as const).filter(([r]) => !r.isMeasure).map(([, j]) => j);
            expect(distinctTuples(standIn, cats)).toBe(distinctTuples(real, cats));
            for (const a of cats) for (const b of cats) if (a < b) {
                expect(distinctTuples(standIn, [a, b]), `${real.header[a]} x ${real.header[b]}`).toBe(distinctTuples(real, [a, b]));
            }
        });
    }
});

describe("check 3: measures", () => {
    const MEASURES = ["Quantity", "Revenue", "Profit", "Margin", "DiscountPct"];
    it("scale (the default): ranks, signs, zeros and whole numbers identical; Pearson to 1e-9 before rounding", () => {
        const real = salesTable();
        const { standIn, key } = obfuscate(real, { seed: SEED });
        const unrounded: Record<string, number[]> = {};
        for (const m of MEASURES) {
            const j = idx(real, m), c = keyCol(key, m);
            expect(c.transform, m).toBe("scale");
            expect(c.factor!).toBeGreaterThan(1);
            expect(c.factor!).toBeLessThanOrEqual(1.5);
            const rv = col(real, j), sv = col(standIn, j);
            const live = rv.map((v, i) => i).filter(i => !blank(rv[i]));
            for (const i of live) {
                const x = Number(rv[i]), y = Number(sv[i]);
                expect(Math.sign(y), `${m} row ${i}`).toBe(Math.sign(x));

                for (const k of live) expect(Math.sign(Number(sv[k]) - y)).toBe(Math.sign(Number(rv[k]) - x));
                // The stand-in is the real value times the factor, rounded to the column's own precision.
                expect(Math.abs(y - x * c.factor!)).toBeLessThanOrEqual(0.5 * 10 ** -(String(rv[i]).split(".")[1]?.length ?? 0) + 1e-9);
            }
            // Whole numbers stay whole: a column written without decimals is written without them.
            const whole = (xs: any[]) => xs.every(v => blank(v) || !String(v).includes("."));
            expect(whole(sv), m).toBe(whole(rv));
            expect(rv.filter(v => Number(v) === 0 && !blank(v)).length).toBe(sv.filter(v => Number(v) === 0 && !blank(v)).length);
            unrounded[m] = rv.map(v => blank(v) ? 0 : Number(v) * c.factor!);
        }
        for (const a of MEASURES) for (const b of MEASURES) if (a < b) {
            const ra = col(real, idx(real, a)).map(v => blank(v) ? 0 : Number(v));
            const rb = col(real, idx(real, b)).map(v => blank(v) ? 0 : Number(v));
            expect(Math.abs(pearson(unrounded[a], unrounded[b]) - pearson(ra, rb)), `${a} x ${b}`).toBeLessThan(1e-9);
        }
    });
    it("shuffle: each column's sorted values are identical, and the values moved", () => {
        const real = salesTable();
        const { standIn, key } = obfuscate(real, { seed: SEED, measures: "shuffle" });
        for (const m of MEASURES) {
            const j = idx(real, m);
            expect(keyCol(key, m).transform).toBe("shuffle");
            const sorted = (xs: any[]) => xs.filter(v => !blank(v)).map(String).sort();
            expect(sorted(col(standIn, j))).toEqual(sorted(col(real, j)));
            expect(col(standIn, j).map(blank)).toEqual(col(real, j).map(blank));
            expect(col(standIn, j).filter((v, i) => v !== real.rows[i][j]).length).toBeGreaterThan(real.rows.length / 2);
        }
    });
    it("bounds hold either way: a share stays in 0-1 and a percent in 0-100", () => {
        const real = salesTable();
        // A share and a percent that reach near their tops, so a factor of 1.1 would cross them.
        real.rows[5][idx(real, "Margin")] = "0.990";
        real.rows[6][idx(real, "DiscountPct")] = "97.5";
        for (const measures of ["scale", "shuffle"] as const) {
            const { standIn } = obfuscate(real, { seed: SEED, measures });
            for (const v of col(standIn, idx(real, "Margin"))) if (!blank(v)) expect(Number(v)).toBeGreaterThanOrEqual(0), expect(Number(v)).toBeLessThanOrEqual(1);
            for (const v of col(standIn, idx(real, "DiscountPct"))) if (!blank(v)) expect(Number(v)).toBeGreaterThanOrEqual(0), expect(Number(v)).toBeLessThanOrEqual(100);
        }
    });
});

describe("check 4: dates", () => {
    const DAY = 86400000;
    const stats = (vs: any[]) => {
        const ts = vs.filter(v => !blank(v)).map(v => Date.parse(String(v).replace(" ", "T") + (String(v).length > 10 ? ":00Z" : "T00:00:00Z")));
        const distinct = [...new Set(ts)].sort((a, b) => a - b);
        const gaps: Record<number, number> = {};
        for (let i = 1; i < distinct.length; i++) gaps[distinct[i] - distinct[i - 1]] = (gaps[distinct[i] - distinct[i - 1]] ?? 0) + 1;
        const weekdays = [0, 0, 0, 0, 0, 0, 0];
        ts.forEach(t => weekdays[new Date(t).getUTCDay()]++);
        const tod = ts.some(t => t % DAY !== 0);
        const monthStarts = ts.every(t => new Date(t).getUTCDate() === 1);
        return { span: distinct[distinct.length - 1] - distinct[0], distinct: distinct.length, gaps, weekdays, tod, monthStarts };
    };
    it("daily dates across a leap day: span, distinct count, gaps, weekdays, granularity", () => {
        const real = salesTable();
        const { standIn, key } = obfuscate(real, { seed: SEED });
        const j = idx(real, "OrderDate");
        expect(col(real, j)).toContain("2024-02-29");
        expect(stats(col(standIn, j))).toEqual(stats(col(real, j)));
        expect(Math.abs(key.dateShiftYears) % 28).toBe(0);
        expect(key.dateShiftYears).not.toBe(0);
        const leap = col(real, j).indexOf("2024-02-29");
        expect(String(standIn.rows[leap][j])).toBe(`${2024 + key.dateShiftYears}-02-29`);
    });
    it("time of day kept; a year number and a monthly series shift with the dates", () => {
        const real = readingsTable();
        const { standIn, key } = obfuscate(real, { seed: SEED });
        for (const name of ["ReadingTime", "PeriodStart"]) {
            const j = idx(real, name);
            expect(stats(col(standIn, j)), name).toEqual(stats(col(real, j)));
        }
        const t = idx(real, "ReadingTime");
        standIn.rows.forEach((r, i) => expect(String(r[t]).slice(10)).toBe(String(real.rows[i][t]).slice(10)));
        const y = idx(real, "Year");
        standIn.rows.forEach((r, i) => expect(r[y]).toBe((real.rows[i][y] as number) + key.dateShiftYears));
        expect(stats(col(standIn, idx(real, "PeriodStart"))).monthStarts).toBe(true);
    });
});

describe("check 5: ordered labels and places", () => {
    it("ordinalDetector and geoDetector give the same verdicts", () => {
        const real = salesTable();
        const { standIn, key } = obfuscate(real, { seed: SEED });
        for (let j = 0; j < real.header.length; j++) {
            const rv = [...new Set(col(real, j).filter(v => !blank(v)).map(String))];
            const sv = [...new Set(col(standIn, j).filter(v => !blank(v)).map(String))];
            expect(detectOrdinalDomain(sv)?.pattern, real.header[j]).toBe(detectOrdinalDomain(rv)?.pattern);
            expect(detectGeo(sv, standIn.header[j])?.geoKind, real.header[j]).toBe(detectGeo(rv, real.header[j])?.geoKind);
        }
        expect(keyCol(key, "OrderMonth").transform).toBe("keep");
        expect(keyCol(key, "State").transform).toBe("place");
        expect(col(standIn, idx(real, "State")).some((v, i) => v !== real.rows[i][idx(real, "State")])).toBe(true);
    });
    it("coordinates: one shift keeps every distance and the extent class; rounding is the option", () => {
        const real = sitesTable();
        const la = idx(real, "Latitude"), lo = idx(real, "Longitude");
        const pts = (t: ObfuscateTable) => t.rows.map(r => ({ lat: Number(r[la]), lon: Number(r[lo]) }));
        const cls = (t: ObfuscateTable) => { const e = summarizeGeoExtent(pts(t))!; return [e.dominantFrame, e.pctUsa >= 50, e.pctNa >= 50]; };
        const { standIn, key } = obfuscate(real, { seed: SEED });
        expect(keyCol(key, "Latitude").transform).toBe("coordShift");
        const d0 = Number(standIn.rows[0][la]) - Number(real.rows[0][la]);
        expect(Math.abs(d0)).toBeGreaterThan(0);
        standIn.rows.forEach((r, i) => expect(Number(r[la]) - Number(real.rows[i][la])).toBeCloseTo(d0, 9));
        expect(cls(standIn)).toEqual(cls(real));
        const rounded = obfuscate(real, { seed: SEED, latLon: "round" });
        expect(keyCol(rounded.key, "Longitude").transform).toBe("coordRound");
        rounded.standIn.rows.forEach((r, i) => {
            expect(Number(r[lo]) * 2).toBe(Math.round(Number(r[lo]) * 2));
            expect(Math.abs(Number(r[lo]) - Number(real.rows[i][lo]))).toBeLessThanOrEqual(0.25 + 1e-9);
        });
    });
});

describe("check 7: no leak", () => {
    for (const [name, make] of TABLES) {
        it(`${name}: no real label, date or number of 4+ characters in the stand-in or its shape`, () => {
            const real = make();
            const { standIn, key } = obfuscate(real, { seed: SEED });
            expect(leakFindings(real, standIn, key)).toEqual([]);
        });
    }
    it("masked names leak no name word but the ones shape-core reads", () => {
        const real = salesTable();
        const { standIn, key } = obfuscate(real, { seed: SEED, names: "mask" });
        expect(leakFindings(real, standIn, key, ["state", "city", "month", "years", "code", "date", "pct", "margin"])).toEqual([]);
    });
    it("THE DETECTOR BITES: a planted real label, a planted real number and a planted name are each found", () => {
        const real = salesTable();
        const { standIn, key } = obfuscate(real, { seed: SEED, names: "mask" });
        const planted = (f: (t: ObfuscateTable) => void) => {
            const t: ObfuscateTable = { header: standIn.header.slice(), rows: standIn.rows.map(r => r.slice()) };
            f(t);
            return leakFindings(real, t, key, ["state", "city", "month", "years", "code", "date", "pct", "margin"]);
        };
        expect(planted(t => { t.rows[9][idx(real, "Region")] = real.rows[3][idx(real, "Region")]; })).not.toEqual([]);
        expect(planted(t => { t.rows[9][idx(real, "Product")] = "x" + String(real.rows[9][idx(real, "Product")]).slice(2, 7); })).not.toEqual([]);
        expect(planted(t => { t.rows[4][idx(real, "Revenue")] = real.rows[4][idx(real, "Revenue")]; })).not.toEqual([]);
        expect(planted(t => { t.header[idx(real, "Revenue")] = "Revenue"; })).not.toEqual([]);
    });
});

describe("check 8: repeatable and reversible", () => {
    it("the same seed gives the same stand-in; another seed other labels", () => {
        const real = salesTable();
        expect(obfuscate(real, { seed: SEED })).toEqual(obfuscate(real, { seed: SEED }));
        const other = obfuscate(real, { seed: "stand-in-seed-b" }).standIn;
        const a = obfuscate(real, { seed: SEED }).standIn;
        const j = idx(real, "Region");
        expect(new Set(col(other, j))).not.toEqual(new Set(col(a, j)));
    });
    for (const [name, make] of TABLES) {
        for (const opts of [{}, { names: "mask", measures: "shuffle", latLon: "round" }] as const) {
            it(`${name} ${JSON.stringify(opts)}: real -> stand-in -> real byte for byte, through the key file`, () => {
                const real = make();
                const realJson = JSON.stringify(real);
                const { standIn, key } = obfuscate(real, { seed: SEED, ...opts });
                expect(JSON.stringify(real)).toBe(realJson); // the input is not touched
                expect(JSON.stringify(restoreRows(standIn, key))).toBe(realJson);
                const file = serializeKey(key);
                expect(typeof file).toBe("string");
                expect(JSON.stringify(restoreRows(standIn, parseKey(file)))).toBe(realJson);
                expect(serializeKey(parseKey(file))).toBe(file);
            });
        }
    }
    it("parseKey refuses what is not a key", () => {
        expect(() => parseKey("{}")).toThrow();
        expect(() => parseKey("not json")).toThrow();
    });
});

describe("rebinding", () => {
    it("rebindRows: the real rows under the stand-in's names, for code that is not edited", () => {
        const real = salesTable();
        const { key } = obfuscate(real, { seed: SEED, names: "mask" });
        const rows = rebindRows(real, key);
        expect(rows.length).toBe(real.rows.length);
        expect(rows[3][key.columns[1].standInName]).toBe(real.rows[3][1]);
    });
    it("rebindCode: a name inside a string literal is swapped back; the same text in an identifier or a longer word is not", () => {
        const real = salesTable();
        const { key } = obfuscate(real, { seed: SEED, names: "mask" });
        const s = key.columns[idx(real, "Revenue")].standInName;
        expect(s).toMatch(/^[A-Za-z]+$/);
        const code = [
            `const ${s} = rows.map(d => d["${s}"]);`,
            `const title = '${s} by month'; // ${s} in a comment`,
            "const t = `Total ${" + s + "} of " + s + "`;",
            `const other = "${s}Extra";`,
        ].join("\n");
        const out = rebindCode(code, key);
        expect(out.code).toContain(`const ${s} = rows.map(d => d["Revenue"]);`);
        expect(out.code).toContain(`const title = 'Revenue by month'; // ${s} in a comment`);
        expect(out.code).toContain("`Total ${" + s + "} of Revenue`");
        expect(out.code).toContain(`"${s}Extra"`);
        expect(out.flagged).toEqual([]);
    });
    it("rebindCode flags a hard-coded stand-in label and a range end", () => {
        const real = salesTable();
        const { standIn, key } = obfuscate(real, { seed: SEED });
        const label = String(standIn.rows[0][idx(real, "Region")]);
        // A data-like range end (Revenue's top, several significant digits) is flagged; Quantity's top is a small
        // integer, which a layout number equals by chance, so it is not.
        const top = keyCol(key, "Revenue").rangeEnds![1];
        const qtyTop = keyCol(key, "Quantity").rangeEnds![1];
        expect(String(top).replace(/[^0-9]/g, "").replace(/^0+/, "").length).toBeGreaterThanOrEqual(3);
        expect(Number.isInteger(qtyTop) && qtyTop <= 100).toBe(true);
        const code = `const keep = d => d.Region === "${label}";\nconst y = d3.scaleLinear().domain([0, ${top}]);\nconst pad = ${qtyTop};\nconst ok = "Region";`;
        const out = rebindCode(code, key);
        expect(out.code).toBe(code);
        expect(out.flagged.map(f => f.literal)).toEqual([`"${label}"`, String(top)]);
        expect(out.flagged[0].column).toBe("Region");
        expect(out.flagged[1].column).toBe("Revenue");
    });
});

// ---- the equivalence run's findings: each a synthesized table showing the case -----------------------------
const profileOf = (t: ObfuscateTable) => ingest({ kind: "grid", header: t.header, rows: t.rows }).columns as any[];

describe("finding 1: true/false text is kept", () => {
    it("True/False, TRUE/FALSE and yes/no columns keep their flag reading", () => {
        const r = prng(41);
        const rows: (string | number)[][] = [];
        for (let i = 0; i < 150; i++) {
            rows.push(["T-" + (20000 + i * 7), r() < 0.6 ? "True" : "False", r() < 0.3 ? "TRUE" : "FALSE", r() < 0.5 ? "yes" : "no",
                pick(r, REGIONS), String(1 + Math.floor(r() * 30))]);
        }
        const real: ObfuscateTable = { header: ["Ticket", "ResolvedSameWeek", "Locked", "Answered", "Region", "Days"], rows };
        const { standIn, key } = obfuscate(real, { seed: SEED });
        for (const n of ["ResolvedSameWeek", "Locked", "Answered"]) expect(keyCol(key, n).transform, n).toBe("keep");
        const a = profileOf(real), b = profileOf(standIn);
        for (const k of ["isBinaryFlag", "safeDistinctValues", "formatSignature", "isFreeText", "twoSetPairing"]) {
            expect(b.map(c => c[k]), k).toEqual(a.map(c => c[k]));
        }
        expect(readings(standIn)).toEqual(readings(real));
    });
});

describe("finding 2: the coordinate shift stays inside the frames", () => {
    it("points near the North America frame's edges keep every frame share and the latitude's region reading", () => {
        const r = prng(43);
        const rows: string[][] = [];
        const at = (lat: number, lon: number) => rows.push([(lat + r() * 0.2).toFixed(4), (lon + r() * 0.2).toFixed(4), String(5 + Math.floor(r() * 90))]);
        for (let i = 0; i < 40; i++) at(36 + r() * 6, -105 + r() * 20);       // the middle
        for (let i = 0; i < 4; i++) at(47 + r(), -53.6);                      // 1.4 degrees inside the east edge
        for (let i = 0; i < 4; i++) at(60 + r(), -166.6);                     // 1.4 degrees inside the west edge
        for (let i = 0; i < 3; i++) at(70.6, -120 + r() * 10);                // 1.2 degrees inside the north edge
        for (let i = 0; i < 3; i++) at(8.4, -100 + r() * 3);                  // 1.4 degrees inside the south edge
        const real: ObfuscateTable = { header: ["Latitude", "Longitude", "Visits"], rows };
        const { standIn, key } = obfuscate(real, { seed: SEED });
        expect(keyCol(key, "Latitude").transform).toBe("coordShift");
        const ext = (t: ObfuscateTable) => summarizeGeoExtent(t.rows.map(x => ({ lat: Number(x[0]), lon: Number(x[1]) })));
        expect({ ...ext(standIn), latP5: 0, latP95: 0, lonP5: 0, lonP95: 0 }).toEqual({ ...ext(real), latP5: 0, latP95: 0, lonP5: 0, lonP95: 0 });
        const geo = (t: ObfuscateTable) => profileOf(t).map(c => [c.dominantGeoRegion, c.dominantGeoRegionPct, c.admin1RollupPct]);
        expect(geo(standIn)).toEqual(geo(real));
        expect(geo(real)[0][1]).toBe(100);
    });
});

describe("finding 3: grouped measures share one factor", () => {
    function mixTable(): ObfuscateTable {
        const r = prng(47);
        const rows: string[][] = [];
        for (let i = 0; i < 120; i++) {
            const a = 200 + Math.floor(r() * 500), b = 100 + Math.floor(r() * (900 - a));
            const won = 100 + Math.floor(r() * 2000), lost = 100 + Math.floor(r() * (4000 - won));
            const actual = 1000 + r() * 9000;
            rows.push(["ACC" + (1000 + i), (a / 10).toFixed(1), (b / 10).toFixed(1), ((1000 - a - b) / 10).toFixed(1),
                String(won), String(lost), String(5000 - won - lost),
                (actual * (0.8 + r() * 0.4)).toFixed(2), actual.toFixed(2), String(10 + Math.floor(r() * 400))]);
        }
        return { header: ["Account", "DirectPct", "PartnerPct", "SelfServePct", "Seats Won", "Seats Lost", "Seats Open",
            "Revenue Budget", "Revenue Actual", "Headcount"], rows };
    }
    it("a percent split keeps its total of 100 exactly (left unscaled); a split of a count shares one factor", () => {
        const real = mixTable();
        const { standIn, key } = obfuscate(real, { seed: SEED });
        const a = profileOf(real), b = profileOf(standIn);
        expect(a[1].constantSumGroup?.columns.length).toBe(3);
        expect(b[1].constantSumGroup).toEqual(a[1].constantSumGroup);
        for (const n of ["DirectPct", "PartnerPct", "SelfServePct"]) expect(keyCol(key, n).transform, n).toBe("keep");
        // The engine reports one group per table, so the split of a count stands in a table of its own.
        const cut = (t: ObfuscateTable, js: number[]): ObfuscateTable => ({ header: js.map(j => t.header[j]), rows: t.rows.map(r => js.map(j => r[j])) });
        const realSeats = cut(real, [0, 4, 5, 6, 9]);
        const seatsOut = obfuscate(realSeats, { seed: SEED });
        const seats = ["Seats Won", "Seats Lost", "Seats Open"].map(n => keyCol(seatsOut.key, n));
        const sa = profileOf(realSeats), sb = profileOf(seatsOut.standIn);
        expect(sa[1].constantSumGroup?.columns).toEqual(["Seats Won", "Seats Lost", "Seats Open"]);
        expect(sb[1].constantSumGroup?.columns).toEqual(sa[1].constantSumGroup?.columns);
        expect(sb[1].constantSumGroup?.matchedPct).toBe(sa[1].constantSumGroup?.matchedPct);
        expect(seats.every(c => c.transform === "scale")).toBe(true);
        expect(new Set(seats.map(c => c.factor)).size).toBe(1);
    });
    it("a same-unit pair the engine pairs by name shares one factor; an unrelated measure keeps its own", () => {
        const real = mixTable();
        const { standIn, key } = obfuscate(real, { seed: SEED });
        const bud = keyCol(key, "Revenue Budget"), act = keyCol(key, "Revenue Actual"), hc = keyCol(key, "Headcount");
        expect(bud.transform).toBe("scale");
        expect(bud.factor).toBe(act.factor);
        expect(hc.factor).not.toBe(bud.factor);
        const jb = idx(real, "Revenue Budget"), ja = idx(real, "Revenue Actual");
        real.rows.forEach((row, i) => {
            const rr = Number(row[jb]) / Number(row[ja]), sr = Number(standIn.rows[i][jb]) / Number(standIn.rows[i][ja]);
            expect(Math.abs(sr - rr)).toBeLessThan(1e-5);
        });
    });
});

describe("finding 4: a large table", () => {
    it("200,000 rows make a stand-in (no spread over a row-sized array)", () => {
        const r = prng(53);
        const rows: string[][] = [];
        const t0 = Date.UTC(2018, 0, 1);
        for (let i = 0; i < 200000; i++) {
            rows.push([isoDay(new Date(t0 + (i % 2000) * 86400000)), pick(r, WORDS), (r() * 900).toFixed(2), String(Math.floor(r() * 50)),
                (30 + r() * 15).toFixed(3), (-120 + r() * 40).toFixed(3)]);
        }
        const real: ObfuscateTable = { header: ["Day", "Segment", "Amount", "Units", "Latitude", "Longitude"], rows };
        const { standIn, key } = obfuscate(real, { seed: SEED });
        expect(standIn.rows.length).toBe(200000);
        expect(keyCol(key, "Day").transform).toBe("date");
        expect(keyCol(key, "Amount").transform).toBe("scale");
        expect(keyCol(key, "Amount").rangeEnds![1]).toBeGreaterThan(0);
    }, 180000);
});

describe("finding 5: rebind is one call, and its code and rows always agree", () => {
    const sumOf = (code: string, rows: Record<string, unknown>[]) => new Function("rows", code)(rows) as number;
    it("names masked: the rebound code and rows draw the real values, with the real names or the stand-in's", () => {
        const real = salesTable();
        const { key } = obfuscate(real, { seed: SEED, names: "mask" });
        const s = keyCol(key, "Revenue").standInName;
        const j = idx(real, "Revenue");
        const expected = real.rows.reduce((a, row) => a + (Number(row[j]) || 0), 0);
        const bracket = `const title = "${s} by month"; return rows.reduce((a, d) => a + (+d["${s}"] || 0), 0);`;
        const real1 = rebind(bracket, real, key);
        expect(real1.names).toBe("real");
        expect(real1.code).toContain(`"Revenue by month"`);
        expect(sumOf(real1.code, real1.rows)).toBeCloseTo(expected, 6);
        // Code that reads a column through an identifier cannot have its names swapped: rows keep the stand-in's names.
        const dotted = `return rows.reduce((a, d) => a + (+d.${s} || 0), 0);`;
        const real2 = rebind(dotted, real, key);
        expect(real2.names).toBe("standIn");
        expect(real2.code).toBe(dotted);
        expect(sumOf(real2.code, real2.rows)).toBeCloseTo(expected, 6);
        // Asked for the stand-in's names, the code is not edited.
        const real3 = rebind(bracket, real, key, { names: "standIn" });
        expect(real3.code).toBe(bracket);
        expect(sumOf(real3.code, real3.rows)).toBeCloseTo(expected, 6);
    });
    it("rebindCode's code is for the real rows under their real names, and rebindRows' rows are for unedited code", () => {
        const real = salesTable();
        const { key } = obfuscate(real, { seed: SEED, names: "mask" });
        const s = keyCol(key, "Revenue").standInName;
        const code = `return rows.reduce((a, d) => a + (+d["${s}"] || 0), 0);`;
        const asObjects = real.rows.map(row => Object.fromEntries(real.header.map((h, k) => [h, row[k]])));
        expect(sumOf(rebindCode(code, key).code, asObjects)).toBe(sumOf(code, rebindRows(real, key)));
        expect(sumOf(code, rebindRows(real, key))).toBeGreaterThan(0);
    });
});

describe("finding 6: rebindCode flags only data-like literals", () => {
    const key: StandInKey = {
        format: "bicharts-stand-in-key", version: 1, seed: "x", options: { names: "keep", measures: "scale", latLon: "shift" }, dateShiftYears: 0,
        columns: [
            { name: "Amount", standInName: "Amount", transform: "scale", factor: 1.2, rangeEnds: [0.4, 812.25] },
            { name: "Units", standInName: "Units", transform: "scale", factor: 1.3, rangeEnds: [3, 12] },
            { name: "Share", standInName: "Share", transform: "scale", factor: 1.1, rangeEnds: [0.07, 1] },
            { name: "State", standInName: "State", transform: "place", pairs: [["CA", "TX"], ["TX", "CA"]] },
            { name: "Team", standInName: "Team", transform: "mask", pairs: [["Qzvrel", "Harbor"]] },
        ],
    };
    it("a small integer, a short decimal outside a domain or comparison, and a place are not flagged", () => {
        const code = [
            "const pad = 12, cols = 3, lineW = 1;",
            "const opacity = 0.4;",
            "const y = d3.scaleLinear().domain([0, 12]);",
            "const keepCA = rows.filter(d => d.State === \"CA\");",
            // A domain read and closed, then a layout number inside a later open parenthesis.
            "const y0 = y.domain()[0]; if (y0 >= 0) line.attr('stroke-opacity', 0.4);",
        ].join("\n");
        expect(rebindCode(code, key).flagged).toEqual([]);
    });
    it("a data-like range end, a short one in a domain or a comparison, and a masked label are flagged", () => {
        const code = [
            "const top = 812.25;",
            "const y = d3.scaleLinear().domain([0.4, 1]);",
            "const low = rows.filter(d => d.Share < 0.07);",
            "const t = rows.filter(d => d.Team === \"Qzvrel\");",
        ].join("\n");
        expect(rebindCode(code, key).flagged.map(f => f.literal)).toEqual(["812.25", "0.4", "0.07", "\"Qzvrel\""]);
    });
});

describe("finding 7: places shuffle within their region and their parent", () => {
    it("countries keep every region share and the Middle East share", () => {
        const names = ["Israel", "United Arab Emirates", "Saudi Arabia", "Qatar", "Japan", "South Korea", "China", "Thailand",
            "Vietnam", "Egypt", "Kenya", "Nigeria", "Ghana", "France", "Spain"];
        const rows: string[][] = [];
        names.forEach((n, i) => { for (let k = 0; k < 1 + ((i * 7) % 11); k++) rows.push([n, String(10 + k * i)]); });
        const real: ObfuscateTable = { header: ["Country", "Sales"], rows };
        const { standIn, key } = obfuscate(real, { seed: SEED });
        expect(keyCol(key, "Country").transform).toBe("place");
        const geo = (t: ObfuscateTable) => profileOf(t).map(c => [c.geoKind, c.dominantGeoRegion, c.dominantGeoRegionPct, c.geoRegionCount, c.middleEastPct]);
        expect(geo(standIn)).toEqual(geo(real));
        expect(geo(real)[0][4]).toBeGreaterThan(0);
        expect(col(standIn, 0).some((v, i) => v !== real.rows[i][0])).toBe(true);
    });
    it("cities move only among the cities of their own state", () => {
        const C: Record<string, string[]> = { TX: ["Austin", "Dallas", "Houston", "El Paso"], FL: ["Miami", "Tampa", "Orlando"],
            WA: ["Seattle", "Spokane", "Tacoma"], CA: ["Fresno", "Oakland", "San Diego", "Sacramento"] };
        const rows: string[][] = [];
        let k = 0;
        for (const [st, cs] of Object.entries(C)) for (const c of cs) for (let i = 0; i < 3 + (k++ % 4); i++) rows.push([c, st, String(10 + i * k)]);
        const real: ObfuscateTable = { header: ["City", "State", "Sales"], rows };
        const { standIn, key } = obfuscate(real, { seed: SEED });
        expect(keyCol(key, "City").transform).toBe("place");
        standIn.rows.forEach((row, i) => expect(C[String(real.rows[i][1])], `row ${i}`).toContain(row[0]));
        expect(col(standIn, 0).some((v, i) => v !== real.rows[i][0])).toBe(true);
    });
});

describe("finding 8: masked names keep the words the engine reads", () => {
    it("outcome words (Churned) and attribute words (Status) are kept, and the flag reading holds", () => {
        const rows: string[][] = [];
        for (let i = 0; i < 60; i++) rows.push(["C" + (500 + i), i % 3 ? "Open" : "Closed", i % 4 ? "Stayed" : "Left", String(i * 1.5)]);
        const real: ObfuscateTable = { header: ["CustomerRef", "CustomerStatus", "Churned", "Score"], rows };
        const { standIn } = obfuscate(real, { seed: SEED, names: "mask" });
        expect(standIn.header[1]).toMatch(/Status$/);
        expect(standIn.header[2]).toBe("Churned");
        const flags = (t: ObfuscateTable) => profileOf(t).map(c => c.isBinaryFlag);
        expect(flags(standIn)).toEqual(flags(real));
    });
});
