import { describe, it, expect } from "vitest";
import { formatSourceDate, formatSourceDateFor } from "../src/sourceDateFormat";

// THE BUG THIS FILE EXISTS FOR: a click on a weekly point in the Excel add-in answered with the
// header `2025-08-31T00:00:00.000Z`. That is the WIRE form - correct on the wire, and the reason
// it reached a reader at all is that the selection card read the payload's rows with String().
//
// Two things are being protected here and they pull in different directions. The first is that a
// date prints the way the SOURCE prints it, which is what makes the card agree with the cells it
// floats over. The second is that NOTHING here may ever throw or return a worse string than the
// ISO it replaced - a card is a courtesy, and every rung of the fallback has a test.

const AUG31 = "2025-08-31T00:00:00.000Z";

describe("formatSourceDate - the ISO instant never reaches a reader", () => {
    it("renders the Excel source format, which is the whole point of the change", () => {
        expect(formatSourceDate(AUG31, { format: "m/d/yyyy", dialect: "excel" })).toBe("8/31/2025");
        expect(formatSourceDate(AUG31, { format: "mm/dd/yyyy", dialect: "excel" })).toBe("08/31/2025");
        expect(formatSourceDate(AUG31, { format: "yyyy-mm-dd", dialect: "excel" })).toBe("2025-08-31");
        expect(formatSourceDate(AUG31, { format: "d-mmm-yy", dialect: "excel", culture: "en-US" }))
            .toBe("31-Aug-25");
    });

    it("falls back to a LOCALE date when the host supplies no format at all", () => {
        // The MCP and React hosts read CSVs, which have no cell formatting, and every chart
        // cached before this shipped has no format either. The fallback is the answer they get,
        // and it still has to be a date a person reads rather than an instant.
        const shown = formatSourceDate(AUG31, { culture: "en-US" });
        expect(shown).toBe("Aug 31, 2025");
        expect(shown).not.toContain("T00:00");
        expect(shown).not.toContain("Z");
    });

    it("returns null for a value that is not a date, so a caller keeps its own behaviour", () => {
        // NARROW on purpose: Date.parse accepts a startling amount of prose, and a formatter that
        // reformatted "Boston" or "12345" would corrupt every other column on the card.
        expect(formatSourceDate("Boston")).toBeNull();
        expect(formatSourceDate(12345)).toBeNull();
        expect(formatSourceDate(null)).toBeNull();
        expect(formatSourceDate("")).toBeNull();
        expect(formatSourceDate("March 2024")).toBeNull();
        expect(formatSourceDate(new Date("nonsense"))).toBeNull();
    });
});

describe("formatSourceDate - which clock", () => {
    it("prints the day the CELL showed, not the day the reader's timezone would give", () => {
        // The regression that keeps coming back. An Excel serial is built against
        // Date.UTC(1899,11,30), so a whole day is UTC midnight; reading it in local time is
        // 17:00 the PREVIOUS day anywhere west of Greenwich. shape-core's wholeDayFrame is the
        // shared rule, and this test is the reason it is shared rather than copied.
        expect(formatSourceDate(AUG31, { format: "d", dialect: "excel" })).toBe("31");
        expect(formatSourceDate("2025-01-01T00:00:00.000Z", { format: "yyyy-mm-dd", dialect: "excel" }))
            .toBe("2025-01-01");
    });

    it("keeps the wall clock of a value that carries a real time", () => {
        expect(formatSourceDate("2025-08-31T14:05:09.000Z",
            { format: "yyyy-mm-dd hh:mm:ss", dialect: "excel" })).toBe("2025-08-31 14:05:09");
    });

    it("shows a time in the locale fallback only when there IS one", () => {
        expect(formatSourceDate(AUG31, { culture: "en-US" })).toBe("Aug 31, 2025");
        expect(formatSourceDate("2025-08-31T14:05:00.000Z", { culture: "en-US" }))
            .toMatch(/^Aug 31, 2025, 2:05/);
    });
});

describe("formatSourceDate - Excel's m is a month OR a minute", () => {
    const at = "2025-08-31T14:05:09.000Z";

    it("reads m as a MONTH away from an hour or a second", () => {
        expect(formatSourceDate(at, { format: "m/d/yyyy", dialect: "excel" })).toBe("8/31/2025");
        expect(formatSourceDate(at, { format: "dd/mm/yyyy", dialect: "excel" })).toBe("31/08/2025");
    });

    it("reads m as a MINUTE next to an hour or a second, across the separator", () => {
        // "Immediately after h" has a colon in between in every real format string, so the rule
        // has to look past the literal or `h:mm` prints the month.
        expect(formatSourceDate(at, { format: "h:mm", dialect: "excel" })).toBe("14:05");
        expect(formatSourceDate(at, { format: "hh:mm", dialect: "excel" })).toBe("14:05");
        expect(formatSourceDate(at, { format: "mm:ss", dialect: "excel" })).toBe("05:09");
        expect(formatSourceDate(at, { format: "m/d/yyyy hh:mm", dialect: "excel" }))
            .toBe("8/31/2025 14:05");
    });

    it("switches to a 12-hour clock when the format asks for a meridiem", () => {
        expect(formatSourceDate(at, { format: "h:mm AM/PM", dialect: "excel" })).toBe("2:05 PM");
        expect(formatSourceDate("2025-08-31T00:30:00.000Z", { format: "h:mm AM/PM", dialect: "excel" }))
            .toBe("12:30 AM");
    });
});

describe("formatSourceDate - the .NET dialect is NOT the Excel one", () => {
    it("reads M as month and m as minute, case-sensitively", () => {
        // The exact string that makes a shared table impossible: `dd/mm/yyyy` is an ordinary
        // day/month/year format in Excel and day/MINUTE/year in .NET. Both readings are correct
        // for their own dialect, which is why the host states which one it wrote.
        expect(formatSourceDate(AUG31, { format: "dd/MM/yyyy", dialect: "dotnet" })).toBe("31/08/2025");
        expect(formatSourceDate(AUG31, { format: "MMMM d, yyyy", dialect: "dotnet", culture: "en-US" }))
            .toBe("August 31, 2025");
    });

    it("reads a TIMED .NET value on the LOCAL clock, which is the one Power BI handed over", () => {
        // Built the way the visual's values are built - a Date in local time - because that is
        // what the frame rule is FOR. `buildRenderPayload` will call toISOString() on this and
        // shift the wall clock into UTC; reading it back in UTC would print an hour the report
        // author never saw. Constructed from local parts so the assertion holds in any timezone,
        // which the previous version of this test did not.
        const local = new Date(2025, 7, 31, 14, 5, 9);
        expect(formatSourceDate(local, { format: "HH:mm", dialect: "dotnet" })).toBe("14:05");
        expect(formatSourceDate(local, { format: "dd/MM/yyyy HH:mm", dialect: "dotnet" }))
            .toBe("31/08/2025 14:05");
    });

    it("honours a quoted literal and an escaped character", () => {
        expect(formatSourceDate(AUG31, { format: "yyyy'-W'MM", dialect: "dotnet" })).toBe("2025-W08");
        expect(formatSourceDate(AUG31, { format: 'yyyy" wk "MM', dialect: "excel" })).toBe("2025 wk 08");
    });
});

describe("formatSourceDate - a format it cannot use falls through, it does not fail", () => {
    it("ignores a NUMBER format on a date column and gives the locale date", () => {
        expect(formatSourceDate(AUG31, { format: "General", dialect: "excel", culture: "en-US" }))
            .toBe("Aug 31, 2025");
        expect(formatSourceDate(AUG31, { format: "#,##0.00", dialect: "excel", culture: "en-US" }))
            .toBe("Aug 31, 2025");
        expect(formatSourceDate(AUG31, { format: "@", dialect: "excel", culture: "en-US" }))
            .toBe("Aug 31, 2025");
    });

    it("does not read a 'd' that is inside quoted text as a day", () => {
        // The same trap gridAdapter's isDateFormat documents: `0.00" days"` is a NUMBER whose
        // format string contains a 'd', and treating it as a date turns a duration into a
        // 1900-era timestamp.
        expect(formatSourceDate(AUG31, { format: '0.00" days"', dialect: "excel", culture: "en-US" }))
            .toBe("Aug 31, 2025");
    });

    it("strips Excel's bracket decorations and takes only the first section", () => {
        expect(formatSourceDate(AUG31, { format: "[$-en-US]m/d/yyyy;@", dialect: "excel" }))
            .toBe("8/31/2025");
        expect(formatSourceDate(AUG31, { format: "[Red]yyyy-mm-dd", dialect: "excel" }))
            .toBe("2025-08-31");
    });

    it("survives a bad culture code rather than costing the reader the date", () => {
        const shown = formatSourceDate(AUG31, { culture: "not-a-locale" });
        expect(shown).toBeTruthy();
        expect(shown).toContain("2025");
    });

    it("needs a dialect before it will read a format, and degrades when there is none", () => {
        // No default dialect anywhere: `dd/mm/yyyy` means two different things and guessing
        // prints a wrong date instead of failing. Without one, the locale fallback answers.
        expect(formatSourceDate(AUG31, { format: "dd/mm/yyyy", culture: "en-US" }))
            .toBe("Aug 31, 2025");
    });
});

describe("formatSourceDateFor - the map lookup a host actually calls", () => {
    const formats = { dialect: "excel" as const, byColumn: { Week: "d-mmm-yy" } };

    it("uses the named column's format and leaves an unlisted column to the fallback", () => {
        expect(formatSourceDateFor(AUG31, "Week", formats, "en-US")).toBe("31-Aug-25");
        expect(formatSourceDateFor(AUG31, "Created", formats, "en-US")).toBe("Aug 31, 2025");
        expect(formatSourceDateFor(AUG31, "Week", null, "en-US")).toBe("Aug 31, 2025");
    });
});
