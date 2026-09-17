import { describe, it, expect } from "vitest";
import { isInvalidSentinelError, invalidSentinelReason } from "../src/invalidSentinel";
import * as api from "../src/index";

// The sentinel rule every host shares. The recognition cases came across from the Power BI
// visual, where this rule was written and proven; a host that recognises the sentinel by any
// other rule reports a data state as a crash, or a crash as a data state.

describe("isInvalidSentinelError", () => {
    it("detects the Python ValueError sentinel inside a full traceback", () => {
        const trace =
            "PythonError: Traceback (most recent call last):\n" +
            '  File "<exec>", line 55, in <module>\n' +
            "ValueError: INVALID:word cloud requires multiple distinct text elements";
        expect(isInvalidSentinelError(trace)).toBe(true);
    });

    it("detects a D3 runtime throw message", () => {
        expect(isInvalidSentinelError("INVALID: funnel chart needs at least three stages")).toBe(true);
        expect(isInvalidSentinelError("INVALID:Pareto needs at least three categories")).toBe(true);
        expect(isInvalidSentinelError('INVALID:column "Revenue" not found')).toBe(true);
    });

    it("detects the sentinel mid-message (Error-prefixed result strings)", () => {
        expect(isInvalidSentinelError("Error: INVALID:empty input data for word cloud")).toBe(true);
    });

    it("does NOT fire on ordinary errors", () => {
        expect(isInvalidSentinelError("TypeError: Cannot read properties of undefined (reading 'rowIdxs')")).toBe(false);
        expect(isInvalidSentinelError("ReferenceError: d is not defined")).toBe(false);
        expect(isInvalidSentinelError("Invalid property specified for object of type plot")).toBe(false); // lowercase 'Invalid' is not the sentinel
        expect(isInvalidSentinelError("the value was INVALID for this chart")).toBe(false);               // no colon
    });

    it("handles null/empty without throwing", () => {
        expect(isInvalidSentinelError(null)).toBe(false);
        expect(isInvalidSentinelError(undefined)).toBe(false);
        expect(isInvalidSentinelError("")).toBe(false);
    });
});

describe("invalidSentinelReason", () => {
    it("takes the text after INVALID: to the end of that line, trimmed", () => {
        expect(invalidSentinelReason('Error: INVALID:column "X" not found\n  at render')).toBe('column "X" not found');
        expect(invalidSentinelReason("INVALID:   funnel chart needs at least three stages   ")).toBe("funnel chart needs at least three stages");
        expect(invalidSentinelReason("ValueError: INVALID:word cloud requires multiple distinct text elements\r\n")).toBe(
            "word cloud requires multiple distinct text elements");
    });

    it("reads the FIRST sentinel when a message repeats it", () => {
        expect(invalidSentinelReason("INVALID:first reason\nINVALID:second reason")).toBe("first reason");
    });

    it("is empty when there is no sentinel", () => {
        expect(invalidSentinelReason("TypeError: x is not a function")).toBe("");
        expect(invalidSentinelReason("Invalid: lowercase is not the sentinel")).toBe("");
        expect(invalidSentinelReason(null)).toBe("");
        expect(invalidSentinelReason(undefined)).toBe("");
        expect(invalidSentinelReason("")).toBe("");
    });

    it("caps at 240 characters by default with an ASCII ellipsis", () => {
        const long = "INVALID:" + "x".repeat(400);
        const r = invalidSentinelReason(long);
        expect(r.length).toBe(240);
        expect(r.endsWith("...")).toBe(true);
        expect(/[^\x00-\x7F]/.test(r)).toBe(false);
        // Exactly at the cap is untouched.
        expect(invalidSentinelReason("INVALID:" + "y".repeat(240))).toBe("y".repeat(240));
    });

    it("honours a caller's own cap", () => {
        expect(invalidSentinelReason("INVALID:abcdefghij", 8)).toBe("abcde...");
        expect(invalidSentinelReason("INVALID:abcdefghij", 20)).toBe("abcdefghij");
    });
});

describe("the sentinel rule is on the public surface", () => {
    it("exports both functions from the package entry", () => {
        expect(api.isInvalidSentinelError).toBe(isInvalidSentinelError);
        expect(api.invalidSentinelReason).toBe(invalidSentinelReason);
    });
});
