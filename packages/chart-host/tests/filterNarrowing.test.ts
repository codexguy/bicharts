import { describe, it, expect } from "vitest";
import { isNarrowedByFilter, isEmptiedByFilter, updateRowHighWater } from "../src/index";

// A click in one chart cross-filtered a cached heatmap from 110 rows to 44; the heatmap drew an empty
// figure and the blank-figure guard blamed changed FIELDS, which the reader never touched. These cases
// pin the signal that lets a host tell the two causes apart. They were written against the Power BI
// visual's own copy of these predicates and moved here with every expected value unchanged.

const SCHEMA_A = 111111;
const SCHEMA_B = 222222;

describe("isNarrowedByFilter", () => {
    it("flags the Sankey cross-filter repro (110 -> 44 on the same schema)", () => {
        expect(isNarrowedByFilter({
            currentRows: 44, highWaterRows: 110,
            highWaterSchemaHash: SCHEMA_A, currentSchemaHash: SCHEMA_A,
        })).toBe(true);
    });

    it("does NOT flag an unfiltered load at full width", () => {
        expect(isNarrowedByFilter({
            currentRows: 110, highWaterRows: 110,
            highWaterSchemaHash: SCHEMA_A, currentSchemaHash: SCHEMA_A,
        })).toBe(false);
    });

    it("does NOT flag a schema change — field drift keeps the schema-drift message", () => {
        // The whole point: a genuinely changed/removed field must not be excused
        // as "you just filtered too far".
        expect(isNarrowedByFilter({
            currentRows: 44, highWaterRows: 110,
            highWaterSchemaHash: SCHEMA_A, currentSchemaHash: SCHEMA_B,
        })).toBe(false);
    });

    it("does NOT flag before any baseline exists (first load, incl. first-load-already-filtered)", () => {
        expect(isNarrowedByFilter({
            currentRows: 44, highWaterRows: 0,
            highWaterSchemaHash: null, currentSchemaHash: SCHEMA_A,
        })).toBe(false);
        expect(isNarrowedByFilter({
            currentRows: 44, highWaterRows: 0,
            highWaterSchemaHash: SCHEMA_A, currentSchemaHash: SCHEMA_A,
        })).toBe(false);
    });

    it("does NOT flag zero rows — filtered-to-nothing is isEmptiedByFilter's question", () => {
        expect(isNarrowedByFilter({
            currentRows: 0, highWaterRows: 110,
            highWaterSchemaHash: SCHEMA_A, currentSchemaHash: SCHEMA_A,
        })).toBe(false);
    });

    it("does NOT flag a grown dataset (more rows than ever seen)", () => {
        expect(isNarrowedByFilter({
            currentRows: 200, highWaterRows: 110,
            highWaterSchemaHash: SCHEMA_A, currentSchemaHash: SCHEMA_A,
        })).toBe(false);
    });
});

describe("updateRowHighWater", () => {
    it("keeps the maximum across loads on one schema", () => {
        expect(updateRowHighWater(110, SCHEMA_A, 44, SCHEMA_A)).toEqual({ rows: 110, schemaHash: SCHEMA_A });
        expect(updateRowHighWater(110, SCHEMA_A, 250, SCHEMA_A)).toEqual({ rows: 250, schemaHash: SCHEMA_A });
    });

    it("RESETS on a schema change so a stale baseline can't fake narrowing forever", () => {
        // Without the reset, dropping a field (fewer rows, new schema) would leave
        // the old 110 baseline in place and make every later load look narrowed.
        expect(updateRowHighWater(110, SCHEMA_A, 44, SCHEMA_B)).toEqual({ rows: 44, schemaHash: SCHEMA_B });
    });

    it("seeds cleanly from the null (no baseline) start state", () => {
        expect(updateRowHighWater(0, null, 110, SCHEMA_A)).toEqual({ rows: 110, schemaHash: SCHEMA_A });
    });

    it("round-trips: a reset baseline immediately reports not-narrowed", () => {
        const hw = updateRowHighWater(110, SCHEMA_A, 44, SCHEMA_B);
        expect(isNarrowedByFilter({
            currentRows: 44, highWaterRows: hw.rows,
            highWaterSchemaHash: hw.schemaHash, currentSchemaHash: SCHEMA_B,
        })).toBe(false);
    });
});

// A production chart - six renders at 58/58/58/32/32/32 rows - ended on a flat "no data" after the
// reader's own cross-filter emptied it, with nothing connecting the empty chart to the click. The
// zero-row case is deliberately excluded from isNarrowedByFilter; this predicate covers it using the
// same high-water signal, so no new state was needed to tell the two empties apart.
describe("isEmptiedByFilter", () => {
    it("flags the production shape - this schema has delivered rows, and now delivers none", () => {
        expect(isEmptiedByFilter({
            currentRows: 0, highWaterRows: 58,
            highWaterSchemaHash: SCHEMA_A, currentSchemaHash: SCHEMA_A,
        })).toBe(true);
    });

    it("does NOT flag a genuinely empty dataset that has never had rows", () => {
        // highWaterRows 0 = this schema has produced nothing, ever. That is an empty
        // model or an unrefreshed one, and the plain no-data wording is the true one.
        expect(isEmptiedByFilter({
            currentRows: 0, highWaterRows: 0,
            highWaterSchemaHash: SCHEMA_A, currentSchemaHash: SCHEMA_A,
        })).toBe(false);
    });

    it("does NOT flag a schema change - field drift keeps the plain wording", () => {
        // Same boundary isNarrowedByFilter draws: removing a field must not be excused
        // as "you filtered too far". The high water resets on schema change anyway, so
        // this is belt and braces against a caller passing a stale baseline.
        expect(isEmptiedByFilter({
            currentRows: 0, highWaterRows: 58,
            highWaterSchemaHash: SCHEMA_A, currentSchemaHash: SCHEMA_B,
        })).toBe(false);
    });

    it("does NOT flag a non-empty narrowed load - that is isNarrowedByFilter's question", () => {
        // The two predicates must not both answer true for one state, or the caller
        // would have to re-check a row count to know which message it earned.
        const narrowedButDrawable = {
            currentRows: 32, highWaterRows: 58,
            highWaterSchemaHash: SCHEMA_A, currentSchemaHash: SCHEMA_A,
        };
        expect(isEmptiedByFilter(narrowedButDrawable)).toBe(false);
        expect(isNarrowedByFilter(narrowedButDrawable)).toBe(true);
    });

    it("round-trips through the high-water updater: filter to zero on a live schema", () => {
        // The full production sequence: 58 rows load, then a cross-filter delivers 0.
        const hw = updateRowHighWater(0, null, 58, SCHEMA_A);
        const after = updateRowHighWater(hw.rows, hw.schemaHash, 0, SCHEMA_A);
        expect(after.rows).toBe(58);   // max(), so the baseline survives the empty load
        expect(isEmptiedByFilter({
            currentRows: 0, highWaterRows: after.rows,
            highWaterSchemaHash: after.schemaHash, currentSchemaHash: SCHEMA_A,
        })).toBe(true);
    });
});
