import { describe, it, expect } from "vitest";
import { safeDistinctValuesToShip } from "../src/ordinalDetector";
import { IndexedText } from "../src/indexedText";

// A SINGLE-CHARACTER CODE SET IS SAYABLE, AND WITHHOLDING IT COSTS MORE THAN IT PROTECTS.
//
// A three-value result column of H / A / D was withheld: not an allowlist token, and no digit, so
// the code-structure test rejected it and one rejection disqualifies the whole column. The server
// then described it downstream as "3 distinct, average length 1" and nothing else - and a model
// asked to colour a three-value football result column assumed W/D/L, which is a reasonable guess
// and the wrong one. That guess became a hardcoded colour map, the real categories fell through
// to a fallback that reused an already-assigned colour, and the chart shipped with two identical
// grey legend swatches under different labels.
//
// The widening is EXACTLY one character. Two-letter tokens stay excluded on purpose: they can be
// a person's initials, which is the residual risk the digit requirement was added for.
describe("single-character category codes ship", () => {
    it("ships a three-letter code set that used to be withheld entirely", () => {
        expect(safeDistinctValuesToShip(["H", "A", "D"])).toEqual(["H", "A", "D"]);
    });

    it("ships the ordinary single-character dimensions", () => {
        expect(safeDistinctValuesToShip(["M", "F"])).toEqual(["M", "F"]);
        expect(safeDistinctValuesToShip(["N", "S", "E", "W"])).toEqual(["N", "S", "E", "W"]);
        expect(safeDistinctValuesToShip(["A", "B", "C", "D", "F"])).toEqual(["A", "B", "C", "D", "F"]);
    });

    it("still refuses TWO-letter tokens, which can be initials", () => {
        // The decision this file already made, unchanged - one unsafe value disqualifies the
        // column, so a set containing initials ships nothing at all.
        expect(safeDistinctValuesToShip(["JC", "MB", "RT"])).toBeNull();
        expect(safeDistinctValuesToShip(["H", "A", "JC"])).toBeNull();
    });

    it("still refuses free text and anything over the cardinality cap", () => {
        expect(safeDistinctValuesToShip(["Arsenal", "Brentford"])).toBeNull();
        expect(safeDistinctValuesToShip("ABCDEFGHIJKLMNOPQ".split(""))).toBeNull();
    });

    it("does not admit punctuation as a character code", () => {
        expect(safeDistinctValuesToShip(["-", "+"])).toBeNull();
    });
});

// A DATE-DECLARED COLUMN MAY NOT HOLD A DATE, and the profiler must not die of it.
//
// `new Date(x).toISOString()` throws RangeError on an unparseable value, and the throw took down
// the whole getColumnsWithStats call - so ONE odd cell cost the caller every statistic for every
// column. Reached for real by a host that types a bare time of day as a DateTime.
describe("a DateTime column holding a non-date", () => {
    it("still returns stats for every column instead of throwing", () => {
        const it_ = new IndexedText();
        it_.dedupRows = false;
        it_.setColumns([
            { name: "TimeSlot", dataType: "DateTime", isMeasure: false, isGrouping: true } as any,
            { name: "Attendees", dataType: "Integer", isMeasure: true, isGrouping: false } as any,
        ]);
        for (const [slot, n] of [["9:00", 238], ["10:00", 37], ["9:00", 120]] as const) {
            it_.addRow([slot, n]);
        }
        const cols = it_.getColumnsWithStats("20");
        expect(cols).toHaveLength(2);
        // The measure's statistics survive - which is the point: one bad cell in ANOTHER column
        // used to cost them.
        expect(cols[1].sum).toBe(395);
        // ...and the unparseable extreme comes back as the raw value rather than an exception.
        expect(cols[0].lowValue).toBeDefined();
    });

    it("still emits an ISO day for a genuine date-only column", () => {
        // LOCAL midnight, deliberately. The date-only branch is chosen by `hastime`, which reads
        // LOCAL hours - so a UTC-midnight Date is "has a time component" anywhere west of
        // Greenwich and takes the raw-value branch instead. Constructing the fixture in UTC made
        // this test pass in London and fail here, which is a property of the fixture and not of
        // the guard being added.
        const it_ = new IndexedText();
        it_.dedupRows = false;
        it_.setColumns([
            { name: "Day", dataType: "DateTime", isMeasure: false, isGrouping: true } as any,
        ]);
        it_.addRow([new Date(2025, 4, 1)]);
        it_.addRow([new Date(2025, 4, 31)]);
        const cols = it_.getColumnsWithStats("20");
        expect(String(cols[0].lowValue)).toBe("2025-05-01T00:00:00.000Z");
        expect(String(cols[0].highValue)).toBe("2025-05-31T00:00:00.000Z");
    });
});
