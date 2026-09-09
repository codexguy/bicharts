import { describe, it, expect, afterEach } from "vitest";
import { ingest } from "../packages/shape-core/src/ingest";
import { parseDateStable } from "../packages/shape-core/src/util";

// A DATE THAT ARRIVES AS TEXT. dateWireStability.test.ts pins what happens to a Date once it
// exists; this pins how a Date COMES INTO existence from a string.
//
// Date.parse is three rules wearing one name: an ISO date is UTC, an ISO date-time with no zone
// is LOCAL, and every other spelling is implementation-defined and read as LOCAL. So a CSV
// column of a zone-less timestamp became 17:30Z in Los Angeles and 01:30Z in Tokyo, and the
// profile that shipped depended on which machine happened to run it.
// Whole-day values were rescued downstream by wholeDayIso (midnight in EITHER frame); a value
// with a TIME has no such tell, and no read-side rule can recover an instant already wrong.

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ; else process.env.TZ = ORIGINAL_TZ;
});

const TZS = ["UTC", "America/Los_Angeles", "Asia/Tokyo"];

/** Profile a one-date-column grid of TEXT dates and return the wire-visible parts. */
function wireFor(texts: string[]): string {
    const rows = texts.map((t, i) => [t, "Eng", 100 + i]);
    const m = ingest({ kind: "grid", header: ["When", "Dept", "Amount"], rows }, { dedup: false });
    const col = m.columns[0] as any;
    return JSON.stringify({
        dataType: col.dataType, dateWithTime: col.dateWithTime, valueNature: col.valueNature,
        lowValue: col.lowValue, highValue: col.highValue, avgLength: col.avgLength,
        top: [...(col.topCategoryValues ?? [])].sort(),
    });
}

function acrossZones(fn: () => string) {
    const out: Record<string, string> = {};
    const offsets: Record<string, number> = {};
    for (const tz of TZS) {
        process.env.TZ = tz;
        offsets[tz] = new Date(Date.UTC(2024, 6, 1)).getTimezoneOffset();
        out[tz] = fn();
    }
    // HONESTY CHECK on the test: three identical runs of one timezone must not pass as three.
    expect(new Set(Object.values(offsets)).size).toBe(3);
    return out;
}

describe("a date written as TEXT means the same thing on every machine", () => {
    it("a SPACE-SEPARATED zone-less timestamp is identical under UTC, Los Angeles and Tokyo", () => {
        // The everyday CSV shape, and the one that was actually broken: Date.parse reads
        // "2024-03-15 10:30:00" as LOCAL, so this column shipped 17:30Z from Los Angeles and
        // 01:30Z from Tokyo for the same file.
        const texts = ["2024-03-15 10:30:00", "2024-03-16 09:05:00", "2024-03-17 23:45:00"];
        const out = acrossZones(() => wireFor(texts));
        expect(out["America/Los_Angeles"]).toBe(out["UTC"]);
        expect(out["Asia/Tokyo"]).toBe(out["UTC"]);
        // ...and it is the RIGHT answer: the wall clock the author wrote, read as UTC.
        const w = JSON.parse(out["UTC"]);
        expect(w.dataType).toBe("DateTime");
        expect(w.dateWithTime).toBe(true);
        expect(w.lowValue).toBe("2024-03-15T10:30:00.000Z");
        expect(w.highValue).toBe("2024-03-17T23:45:00.000Z");
    });

    it("MEASURED EXPOSURE: only ISO-ish text ever becomes a Date with a time on it", () => {
        // Worth pinning, because it bounds this whole fix. The type sniffer accepts a NON-ISO
        // whole-day date ("3/15/2024") but refuses a non-ISO timestamp, so a column of
        // "3/15/2024 10:30 AM" is typed String and never constructs a Date at all - there was
        // never an unstable instant there to fix. If that ever changes, this test fails and the
        // stable parser is already in the path waiting for it.
        process.env.TZ = "America/Los_Angeles";
        for (const s of ["3/15/2024 10:30 AM", "March 15, 2024 10:30", "15-Mar-2024 10:30"]) {
            const m = ingest({ kind: "grid", header: ["When", "Dept"], rows: [[s, "Eng"], [s, "Ops"]] },
                             { dedup: false });
            expect((m.columns[0] as any).dataType).toBe("String");
        }
    });

    it("an ISO date-time with NO zone is the wall clock, not the machine's idea of it", () => {
        const out = acrossZones(() => wireFor(["2024-03-15T10:30:00", "2024-03-16T09:05:00"]));
        expect(out["Asia/Tokyo"]).toBe(out["UTC"]);
        expect(JSON.parse(out["UTC"]).lowValue).toBe("2024-03-15T10:30:00.000Z");
    });

    it("a non-ISO WHOLE DAY prints the day the author wrote, everywhere", () => {
        const out = acrossZones(() => wireFor(["3/15/2024", "6/1/2024", "11/2/2023"]));
        expect(out["America/Los_Angeles"]).toBe(out["UTC"]);
        expect(out["Asia/Tokyo"]).toBe(out["UTC"]);
        const w = JSON.parse(out["UTC"]);
        expect(w.dateWithTime).toBe(false);
        expect(w.valueNature).toBe("Ordinal");
        expect(w.top).toEqual(["2023-11-02", "2024-03-15", "2024-06-01"]);
        expect(w.avgLength).toBe(10);
    });

    it("an ISO date is left exactly alone - re-anchoring it would move it a day", () => {
        // The regression this fix could most easily have caused: "2024-03-15" is ALREADY UTC by
        // spec, so reading its local fields and rebuilding in UTC would drag it to the 14th west
        // of Greenwich - reintroducing the bug the sibling test exists to stop.
        const out = acrossZones(() => wireFor(["2024-03-15", "2024-06-01"]));
        expect(out["America/Los_Angeles"]).toBe(out["UTC"]);
        expect(JSON.parse(out["UTC"]).top).toEqual(["2024-03-15", "2024-06-01"]);
    });
});

describe("parseDateStable: when the text states a zone, believe it", () => {
    it("keeps an explicit offset and an explicit Z", () => {
        process.env.TZ = "America/Los_Angeles";
        expect(parseDateStable("2024-03-15T10:30:00Z")!.toISOString()).toBe("2024-03-15T10:30:00.000Z");
        expect(parseDateStable("2024-03-15T10:30:00+05:30")!.toISOString()).toBe("2024-03-15T05:00:00.000Z");
        expect(parseDateStable("2024-03-15T10:30:00-0700")!.toISOString()).toBe("2024-03-15T17:30:00.000Z");
    });

    it("keeps a NAMED zone, including the one a Date.toString() round-trip produces", () => {
        process.env.TZ = "Asia/Tokyo";
        const s = "Thu Mar 14 2024 17:00:00 GMT-0700 (Pacific Daylight Time)";
        expect(parseDateStable(s)!.toISOString()).toBe("2024-03-15T00:00:00.000Z");
    });

    it("anchors a zone-less wall clock to UTC, in every zone", () => {
        for (const tz of TZS) {
            process.env.TZ = tz;
            expect(parseDateStable("March 15, 2024 10:30")!.toISOString()).toBe("2024-03-15T10:30:00.000Z");
        }
    });

    it("returns null for text that is not a date at all", () => {
        expect(parseDateStable("Total")).toBeNull();
        expect(parseDateStable("")).toBeNull();
        expect(parseDateStable("not a date")).toBeNull();
    });

    it("does not send a two-digit year to the 1900s by accident", () => {
        // Date.UTC maps 0-99 onto 1900-1999; setUTCFullYear does not, and a year 47 that came
        // back as 1947 would be a silent century error in a column nobody re-reads.
        process.env.TZ = "America/Los_Angeles";
        const d = parseDateStable("0047-03-15T10:30:00");
        expect(d!.getUTCFullYear()).toBe(47);
    });
});
