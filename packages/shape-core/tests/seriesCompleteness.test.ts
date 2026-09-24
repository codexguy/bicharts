import { describe, it, expect } from "vitest";
import {
    IndexedText, measureSeriesCompleteness, pickSeriesColumn, seriesKeyVerdict, parseTemporalPoint,
    measureCadence, SERIES_COMPLETENESS_MAX_LISTED,
} from "../src";
import type { LLMColumnWithValue } from "../src/models";
import type { SeriesKeyCandidate } from "../src/seriesCompleteness";

// PER-SERIES COMPLETENESS (2026-09-24).
//
// The shape this exists for: eight states by twelve months of city-service requests, where the date
// column itself is perfectly contiguous, one state reports only from May, another only from February,
// and two more each have one month missing in the middle. A generated horizon chart drew every absent
// state-month as zero - a fall to the baseline no observation supports, which also dragged each lane's
// minimum down and rescaled its bands - and nothing it had been told said which series were short.

function col(name: string, dataType: string, isMeasure = false): LLMColumnWithValue {
    return { name, dataType, isMeasure };
}

const MONTHS = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2024, 8 + i, 1)));   // 2024-09 .. 2025-08
const STATES = ["Arizona", "California", "Illinois", "New York", "North Carolina", "Rhode Island", "Texas", "Washington"];
const CATEGORIES = ["Illegal Dumping", "Missed Trash Pickup", "Noise Complaint", "Pothole & Street Repair", "Street Light Outage"];

/** Is state s observed in month index m (0 = 2024-09)? The motivating shape's own pattern. */
function present(s: string, m: number): boolean {
    if (s === "Rhode Island") return m >= 8;        // from 2025-05
    if (s === "North Carolina") return m >= 5;      // from 2025-02
    if (s === "Illinois") return m !== 6;           // no 2025-03
    if (s === "New York") return m !== 7;           // no 2025-04
    return true;
}

function panelTable(level: string): LLMColumnWithValue[] {
    const t = new IndexedText();
    t.setColumns([
        col("Report Month", "DateTime"), col("State", "String"), col("Service Category", "String"),
        col("Requests Closed", "Integer", true),
    ]);
    let n = 0;
    MONTHS.forEach((d, m) => STATES.forEach(s => {
        if (!present(s, m)) return;
        // Some present state-months are also missing a category, as in the motivating shape: a partial month
        // is still an observed month.
        CATEGORIES.forEach((c, ci) => {
            if ((m + ci + s.length) % 11 === 0) return;
            t.addRow([d, s, c, 100 + (n++ % 400)]);
        });
    }));
    return t.getColumnsWithStats(level, "en-US");
}

const month = (cols: LLMColumnWithValue[]) => cols.find(c => c.name === "Report Month")!;

describe("series completeness - the motivating shape", () => {
    it("names the ENTITY column, not the lower-cardinality attribute, and lists the four short states least covered first", () => {
        const cols = panelTable("20");
        // The premise: the date column itself has no gap, so the column-level fact has nothing to say.
        const cad = month(cols).temporalCadence!;
        expect(cad.grain).toBe("month");
        expect(cad.coveragePct).toBe(100);
        expect(cad.runs).toBe(1);
        expect(cad.largestGapUnits).toBe(1);

        const sc = month(cols).seriesCompleteness!;
        // Service Category has five values to State's eight; lowest cardinality alone would pick it,
        // and every category is present in every month, so the fact would be silent.
        expect(sc.seriesColumn).toBe("State");
        expect(sc.grain).toBe("month");
        expect(sc.periods).toBe(12);
        expect(sc.incompleteSeries).toBe(4);
        expect(sc.more).toBe(0);
        expect(sc.series).toEqual([
            { first: "2025-05-01", last: "2025-08-01", missingInterior: 0, coverage: 0.333 },   // Rhode Island: a ragged start
            { first: "2025-02-01", last: "2025-08-01", missingInterior: 0, coverage: 0.583 },   // North Carolina: a ragged start
            { first: "2024-09-01", last: "2025-08-01", missingInterior: 1, coverage: 0.917 },   // Illinois: one hole
            { first: "2024-09-01", last: "2025-08-01", missingInterior: 1, coverage: 0.917 },   // New York: one hole
        ]);
    });

    it("fires on ONE missing state-month, and is silent on the same panel with none missing", () => {
        const build = (skip: boolean) => {
            const t = new IndexedText();
            t.setColumns([col("Report Month", "DateTime"), col("State", "String"), col("Requests Closed", "Integer", true)]);
            let n = 0;
            MONTHS.forEach((d, m) => STATES.forEach(s => {
                if (skip && s === "Texas" && m === 10) return;
                t.addRow([d, s, 100 + n++]);
            }));
            return month(t.getColumnsWithStats("20")).seriesCompleteness;
        };
        expect(build(true)).toEqual({
            seriesColumn: "State", grain: "month", periods: 12, incompleteSeries: 1,
            series: [{ first: "2024-09-01", last: "2025-08-01", missingInterior: 1, coverage: 0.917 }], more: 0,
        });
        expect(build(false)).toBeUndefined();
    });
});

describe("series completeness - a ragged END, on period strings", () => {
    const QUARTERS = ["2023-Q1", "2023-Q2", "2023-Q3", "2023-Q4", "2024-Q1", "2024-Q2", "2024-Q3", "2024-Q4"];
    function routes(): LLMColumnWithValue[] {
        const t = new IndexedText();
        t.setColumns([col("Quarter", "String"), col("Route", "String"), col("Passengers", "Integer", true)]);
        let n = 0;
        for (const q of QUARTERS) for (const r of ["Harbour Line", "Airport Express", "Coastal"]) {
            // Coastal is withdrawn after 2024-Q1.
            if (r === "Coastal" && QUARTERS.indexOf(q) > 4) continue;
            t.addRow([q, r, 5000 + 37 * n++]);
        }
        return t.getColumnsWithStats("20");
    }

    it("reports a series that stops early as ending there, with no hole", () => {
        const sc = routes().find(c => c.name === "Quarter")!.seriesCompleteness!;
        expect(sc.seriesColumn).toBe("Route");
        expect(sc.grain).toBe("quarter");
        expect(sc.periods).toBe(8);
        expect(sc.incompleteSeries).toBe(1);
        expect(sc.series).toEqual([{ first: "2023-01-01", last: "2024-01-01", missingInterior: 0, coverage: 0.625 }]);
    });
});

describe("series completeness - silence where a panel is not", () => {
    it("a SPARSE EVENT LOG stays silent: under half the (series x day) lattice is filled", () => {
        // Four machines and one alarm a day between them, over four months: the log has a row every
        // day, so the axis is daily, and each machine misses three days in four - the nature of an
        // event log, and not news about any machine.
        const t = new IndexedText();
        t.setColumns([col("Alarm Date", "DateTime"), col("Machine", "String"), col("Duration", "Decimal", true)]);
        const machines = ["Press 1", "Press 2", "Lathe", "Furnace"];
        for (let k = 0; k < 120; k++) {
            t.addRow([new Date(Date.UTC(2025, 0, 1 + k)), machines[(k * 3) % 4], 1.5 + k / 10]);
        }
        const cols = t.getColumnsWithStats("20");
        const date = cols.find(c => c.name === "Alarm Date")!;
        expect(date.temporalCadence?.grain).toBe("day");
        expect(date.seriesCompleteness).toBeUndefined();

        // Not vacuous: the SAME rows with the fill gate removed would have made the claim.
        const rows = t.toObjectArray();
        const iso = (d: Date) => d.toISOString().slice(0, 10);
        const ungated = measureSeriesCompleteness({
            periods: rows.map(r => iso(r["Alarm Date"])), series: rows.map(r => r["Machine"]),
            seriesColumn: "Machine", minFill: 0,
        });
        expect(ungated?.incompleteSeries).toBe(4);
    });

    it("an ID key is never picked as the series, even when it has the fewest values", () => {
        const t = new IndexedText();
        t.setColumns([col("Month", "DateTime"), col("Account ID", "String"), col("Region", "String"), col("Revenue", "Integer", true)]);
        let n = 0;
        MONTHS.forEach((d, m) => {
            ["A-100", "A-200", "A-300"].forEach((a, ai) => ["North", "South", "East", "West", "Central"].forEach((r, ri) => {
                if (ai === 2 && m < 6) return;          // the third account opens mid-year
                if (ri === 4 && m >= 9) return;         // Central is dropped for the last quarter
                t.addRow([d, a, r, 1000 + n++]);
            }));
        });
        const sc = t.getColumnsWithStats("20").find(c => c.name === "Month")!.seriesCompleteness!;
        expect(sc.seriesColumn).toBe("Region");
        expect(sc.series).toEqual([{ first: "2024-09-01", last: "2025-05-01", missingInterior: 0, coverage: 0.75 }]);
    });

    it("and a table whose only categorical is an ID key has no series at all - the same column named as an entity does", () => {
        const build = (keyName: string) => {
            const t = new IndexedText();
            t.setColumns([col("Month", "DateTime"), col(keyName, "String"), col("Spend", "Integer", true)]);
            let n = 0;
            MONTHS.forEach((d, m) => ["C1", "C2", "C3", "C4"].forEach((c, ci) => {
                if (ci === 0 && m < 4) return;
                t.addRow([d, c, 50 + n++]);
            }));
            return t.getColumnsWithStats("20").find(c => c.name === "Month")!.seriesCompleteness;
        };
        expect(build("Customer ID")).toBeUndefined();
        // C1..C4 are safe short codes, so at this tier the name ships with them.
        expect(build("Customer")?.series).toEqual([{ name: "C1", first: "2025-01-01", last: "2025-08-01", missingInterior: 0, coverage: 0.667 }]);
    });
});

describe("series completeness - the cap", () => {
    it(`lists at most ${SERIES_COMPLETENESS_MAX_LISTED}, least covered first, and counts the rest in 'more'`, () => {
        // Twelve stores; store k opens in month k - 1, so eleven of them are short by 1..11 months.
        const t = new IndexedText();
        t.setColumns([col("Month", "DateTime"), col("Store", "String"), col("Sales", "Integer", true)]);
        const stores = Array.from({ length: 12 }, (_, k) => `Store ${String.fromCharCode(65 + k)}`);
        let n = 0;
        MONTHS.forEach((d, m) => stores.forEach((s, k) => { if (m >= k) t.addRow([d, s, 900 + n++]); }));
        const sc = t.getColumnsWithStats("20").find(c => c.name === "Month")!.seriesCompleteness!;
        expect(sc.incompleteSeries).toBe(11);
        expect(sc.series).toHaveLength(SERIES_COMPLETENESS_MAX_LISTED);
        expect(sc.more).toBe(3);
        expect(sc.series.map(s => s.coverage)).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map(k => Math.round(k / 12 * 1000) / 1000));
        expect(sc.series[0].first).toBe("2025-08-01");
    });
});

describe("series completeness - privacy tiers", () => {
    const structure = (cols: LLMColumnWithValue[]) => {
        const sc = month(cols).seriesCompleteness!;
        return { ...sc, series: sc.series.map(s => ({ missingInterior: s.missingInterior, coverage: s.coverage })) };
    };

    it("the counts ship at EVERY tier and are identical at each; the key never changes with the tier", () => {
        const base = structure(panelTable("0"));
        for (const level of ["10", "20", "30"]) expect(structure(panelTable(level))).toEqual(base);
        expect(base.seriesColumn).toBe("State");
    });

    it("first / last name calendar periods, so they ride the detailed-stats tier like runBounds", () => {
        for (const level of ["0", "10"]) {
            for (const s of month(panelTable(level)).seriesCompleteness!.series) {
                expect(s.first).toBeUndefined();
                expect(s.last).toBeUndefined();
            }
        }
        for (const level of ["20", "30"]) {
            expect(month(panelTable(level)).seriesCompleteness!.series[0].first).toBe("2025-05-01");
        }
    });

    it("a free-text series NAME is a category value and is withheld at every tier, as its column's values are", () => {
        for (const level of ["0", "10", "20", "30"]) {
            const cols = panelTable(level);
            const state = cols.find(c => c.name === "State")!;
            expect(state.topCategoryValues).toBeUndefined();
            expect(state.safeDistinctValues).toBeUndefined();
            for (const s of month(cols).seriesCompleteness!.series) expect(s).not.toHaveProperty("name");
        }
    });

    it("a series whose values are safe short codes carries its names from the detailed-stats tier up, and never below", () => {
        const build = (level: string) => {
            const t = new IndexedText();
            t.setColumns([col("Month", "DateTime"), col("Zone", "String"), col("Pallets", "Integer", true)]);
            let n = 0;
            MONTHS.forEach((d, m) => ["Z-01", "Z-02", "Z-03", "Z-04"].forEach((z, zi) => {
                if (zi === 3 && m < 3) return;
                t.addRow([d, z, 70 + n++]);
            }));
            return t.getColumnsWithStats(level);
        };
        for (const level of ["0", "10"]) {
            const s = build(level).find(c => c.name === "Month")!.seriesCompleteness!.series[0];
            expect(s).not.toHaveProperty("name");
        }
        for (const level of ["20", "30"]) {
            const cols = build(level);
            expect(cols.find(c => c.name === "Zone")!.safeDistinctValues).toEqual(["Z-01", "Z-02", "Z-03", "Z-04"]);
            expect(cols.find(c => c.name === "Month")!.seriesCompleteness!.series).toEqual([
                { name: "Z-04", first: "2024-12-01", last: "2025-08-01", missingInterior: 0, coverage: 0.75 },
            ]);
        }
    });

    it("the pure measurement withholds both by default: a missing argument reads as the strictest tier", () => {
        const out = measureSeriesCompleteness({
            periods: ["2025-01", "2025-02", "2025-03", "2025-01", "2025-02", "2025-03", "2025-03"],
            series: ["a", "a", "a", "b", "b", "b", "c"],
            seriesColumn: "Unit",
        })!;
        expect(out.series).toEqual([{ missingInterior: 0, coverage: 0.333 }]);
    });
});

describe("series key - which column counts as an entity", () => {
    const cand = (name: string, values: string[], extra: Partial<SeriesKeyCandidate> = {}): SeriesKeyCandidate =>
        ({ name, dataType: "String", isMeasure: false, identifierNamed: /\b(id|key|code)$/i.test(name), values, rows: 1000, ...extra });

    it("refuses attributes, identifiers, flags, ordinal scales, time columns and row identities, with the reason", () => {
        expect(seriesKeyVerdict(cand("Service Category", ["Noise", "Potholes", "Graffiti"]))).toBe("attribute");
        expect(seriesKeyVerdict(cand("AQICategory", ["Good", "Moderate", "Unhealthy"]))).toBe("attribute");   // glued capitals
        expect(seriesKeyVerdict(cand("Ticket Type", ["Adult", "Child", "Senior"]))).toBe("attribute");
        expect(seriesKeyVerdict(cand("Account ID", ["A-100", "A-200", "A-300"]))).toBe("identifier");
        expect(seriesKeyVerdict(cand("Batch", ["B7F3A91C22", "C81D0E4A9B", "D2A6F0B3C1"]))).toBe("identifier");   // opaque codes
        expect(seriesKeyVerdict(cand("Churned", ["Yes", "No"], { isBinaryFlag: true }))).toBe("flag");
        expect(seriesKeyVerdict(cand("Satisfaction", ["Very dissatisfied", "Dissatisfied", "Neutral", "Satisfied", "Very satisfied"]))).toBe("ordinal");
        expect(seriesKeyVerdict(cand("Fiscal Year", ["2023", "2024", "2025"], { isTemporal: true }))).toBe("temporal");
        expect(seriesKeyVerdict(cand("Revenue", ["1", "2"], { isMeasure: true }))).toBe("measure");
        expect(seriesKeyVerdict(cand("Invoice", ["i1", "i2", "i3"], { rows: 3 }))).toBe("row-identity");
        expect(seriesKeyVerdict(cand("Only", ["x"]))).toBe("cardinality");
    });

    it("accepts the entities, including a recognised place whatever its column is called", () => {
        expect(seriesKeyVerdict(cand("State", ["Texas", "Ohio", "Utah"]))).toBe("entity");
        expect(seriesKeyVerdict(cand("Route", ["LAX-JFK", "SFO-ORD", "SEA-BOS"]))).toBe("entity");
        expect(seriesKeyVerdict(cand("Resource", ["Crane 1", "Crane 2"]))).toBe("entity");      // not a "source"
        expect(seriesKeyVerdict(cand("Region Type", ["Texas", "Ohio"], { geoKind: "us-state-name" }))).toBe("entity");
    });

    it("picks the entity with the fewest values; a recognised place wins a tie", () => {
        const cs = [
            cand("Segment", ["a", "b"]),
            cand("Store", ["s1", "s2", "s3", "s4"]),
            cand("Country", ["France", "Spain", "Italy", "Chad"], { geoKind: "country-name" }),
            cand("Route", ["r1", "r2", "r3", "r4", "r5"]),
        ];
        expect(pickSeriesColumn(cs)).toBe(2);
        // Column order does not decide it: the port column comes first and has more values.
        expect(pickSeriesColumn([cand("Port", ["p1", "p2", "p3", "p4", "p5"]), cand("Hub", ["h1", "h2", "h3"])])).toBe(1);
        expect(pickSeriesColumn([cand("Customer ID", ["1", "2"]), cand("Channel", ["x", "y"])])).toBe(-1);
    });
});

describe("month names are measurable periods", () => {
    // classifyTemporal has always called "Apr 2025" a time axis; the cadence reader could not read it,
    // so the column carried no cadence and nothing could say whether it was monthly or had a hole.
    it("reads a month word beside a four-digit year, either order, English always and the reader's language too", () => {
        expect(parseTemporalPoint("Apr 2025")!.iso).toBe("2025-04-01");
        expect(parseTemporalPoint("April-2025")!.iso).toBe("2025-04-01");
        expect(parseTemporalPoint("Sept 2025")!.iso).toBe("2025-09-01");
        expect(parseTemporalPoint("2025 Dec")!.iso).toBe("2025-12-01");
        expect(parseTemporalPoint("Ene 2024", undefined, "es-ES")!.iso).toBe("2024-01-01");
        expect(parseTemporalPoint("Jan 2024", undefined, "es-ES")!.iso).toBe("2024-01-01");
        // And no further: a two-digit year ("Apr 25" is as likely the 25th of April), a word that is
        // not a month, a month with no year, and another language's month with no locale to read it.
        for (const v of ["Apr 25", "Widgets 2024", "FY 2024", "April", "Ene 2024"]) expect(parseTemporalPoint(v), v).toBeNull();
    });

    it("a text-month column now carries a cadence, and a per-series fact over it", () => {
        const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map(m => `${m} 2025`);
        expect(measureCadence(names)?.grain).toBe("month");
        const t = new IndexedText();
        t.setColumns([col("Month", "String"), col("Queue", "String"), col("Calls", "Integer", true)]);
        let n = 0;
        names.forEach((m, i) => ["Billing", "Technical", "Sales"].forEach((q, qi) => {
            if (qi === 2 && i < 6) return;               // the Sales queue opens in July
            t.addRow([m, q, 3000 + n++]);
        }));
        const c = t.getColumnsWithStats("20", "en-US").find(x => x.name === "Month")!;
        expect(c.isTemporal).toBe(true);
        expect(c.temporalCadence?.grain).toBe("month");
        expect(c.seriesCompleteness?.series).toEqual([{ first: "2025-07-01", last: "2025-12-01", missingInterior: 0, coverage: 0.5 }]);
    });

    it("a month column in the report's own language is read in that language", () => {
        const t = new IndexedText();
        t.setColumns([col("Mes", "String"), col("Importe", "Integer", true)]);
        ["Ene", "Feb", "Mar", "Abr", "May", "Jun"].forEach((m, i) => t.addRow([`${m} 2025`, 10 + i]));
        const c = t.getColumnsWithStats("20", "es-ES").find(x => x.name === "Mes")!;
        expect(c.isTemporal).toBe(true);
        expect(c.temporalCadence?.grain).toBe("month");
        expect(c.temporalCadence?.expectedPoints).toBe(6);
    });
});
