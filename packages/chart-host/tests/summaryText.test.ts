// The description and the warning must read as TWO statements.
//
// These cases were written against the defect: a description that does not end in punctuation,
// followed immediately by "Warning: ", reads as one run-on sentence. They also pin the two
// things that made the naive version wrong in a way no eye would catch - a null description
// printing the literal "null", and a whitespace-only warning producing a bare "Warning: ".

import { describe, it, expect } from "vitest";
import { composeSummaryText } from "../src/summaryText";

describe("composeSummaryText", () => {
    const WARN = "Your requested chart type wasn't used: a streamgraph needs a date column.";

    it("closes the sentence when the model did not", () => {
        const summary = "Cumulative quarterly revenue contributions with connector lines and total bar";
        const out = composeSummaryText(summary, WARN);
        expect(out).toBe(summary + ". Warning: " + WARN);
        // The failure this exists to prevent: "...total bar Warning: ..." as one phrase.
        expect(out).not.toContain("bar Warning");
    });

    it("leaves terminal punctuation the model DID supply alone", () => {
        expect(composeSummaryText("A bar chart of revenue by quarter.", WARN)).toContain("by quarter. Warning: ");
        expect(composeSummaryText("Which quarter led?", WARN)).toContain("led? Warning: ");
        expect(composeSummaryText("Revenue by quarter:", WARN)).toContain("quarter: Warning: ");
        expect(composeSummaryText("Revenue by quarter!", WARN)).toContain("quarter! Warning: ");
        expect(composeSummaryText("Revenue by quarter;", WARN)).toContain("quarter; Warning: ");
    });

    it("does not leave a gap where the description had trailing space", () => {
        expect(composeSummaryText("A bar chart of revenue.  ", WARN)).toContain("revenue. Warning: ");
        expect(composeSummaryText("A bar chart of revenue  ", WARN)).toContain("revenue. Warning: ");
    });

    it("never prints the word null, and contributes no separator with no description", () => {
        expect(composeSummaryText(null, WARN)).toBe("Warning: " + WARN);
        expect(composeSummaryText(undefined, WARN)).toBe("Warning: " + WARN);
        expect(composeSummaryText("", WARN)).toBe("Warning: " + WARN);
        expect(composeSummaryText("   ", WARN)).toBe("Warning: " + WARN);
    });

    it("is the description alone when there is no warning", () => {
        expect(composeSummaryText("A bar chart of revenue by quarter", null)).toBe("A bar chart of revenue by quarter");
        expect(composeSummaryText("A bar chart of revenue by quarter", "")).toBe("A bar chart of revenue by quarter");
    });

    it("treats a whitespace-only warning as no warning", () => {
        expect(composeSummaryText("A bar chart", "   ")).toBe("A bar chart");
    });

    it("is empty when there is nothing to say, so the result is its own is-there-anything test", () => {
        expect(composeSummaryText(null, null)).toBe("");
        expect(composeSummaryText("", "")).toBe("");
    });
});
