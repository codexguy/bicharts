import { describe, it, expect } from "vitest";
import { catalogSource } from "../src/hostText";
import { qualifyFilterCountText } from "../src/qualifyFilter";
import { qualifyTooSmallHeading, qualifyRefusalUnspecified, QUALIFY_TOO_SMALL_HEADING, QUALIFY_REFUSAL_UNSPECIFIED } from "../src/qualifyGroups";
import { reviewDialogText } from "../src/reviewDialog";
import { composeSummaryText } from "../src/summaryText";

// THE CHOOSER, THE REVIEW DIALOG AND THE SUMMARY IN THE READER'S LANGUAGE. Each reads a text source when the host passes
// one and its English, byte for byte as before, when it does not.

const de = catalogSource("de", {
    "qualify.too_small_heading": "Braucht eine größere Kachel",
    "qualify.refusal_unspecified": "für die gebundenen Felder abgelehnt",
    "qualify.count": "{matched} von {total}",
    "qualify.count_more": "{matched} von {total} (+{more})",
    "review.title": "Verbesserungen übernehmen?",
    "review.accept": "Übernehmen",
    "summary.warning": "Warnung: {message}",
});

describe("the chooser's words", () => {
    it("read English with no source and the source's words with one", () => {
        expect(qualifyTooSmallHeading()).toBe(QUALIFY_TOO_SMALL_HEADING);
        expect(qualifyTooSmallHeading(de)).toBe("Braucht eine größere Kachel");
        expect(qualifyRefusalUnspecified(null)).toBe(QUALIFY_REFUSAL_UNSPECIFIED);
        expect(qualifyRefusalUnspecified(de)).toBe("für die gebundenen Felder abgelehnt");
    });

    it("count matches in the reader's words, the refused extra included", () => {
        const view = { tier: "name" as const, matched: 3, total: 19 };
        expect(qualifyFilterCountText(view)).toBe("3 of 19");
        expect(qualifyFilterCountText({ ...view, refusalMatched: 1 })).toBe("3 of 19 (+1)");
        expect(qualifyFilterCountText(view, de)).toBe("3 von 19");
        expect(qualifyFilterCountText({ ...view, refusalMatched: 1 }, de)).toBe("3 von 19 (+1)");
        expect(qualifyFilterCountText({ tier: "all", matched: 19, total: 19 }, de)).toBe("19");
    });
});

describe("the review dialog's words", () => {
    it("read the source's words, English where the source is silent", () => {
        const t = reviewDialogText(de);
        expect(t.title).toBe("Verbesserungen übernehmen?");
        expect(t.accept).toBe("Übernehmen");
        expect(t.decline).toBe("No thanks");
        expect(reviewDialogText()).toEqual({
            title: "Apply improvements?",
            fallbackReason: "The AI review suggests a change to this chart.",
            cost: "Applying creates a new chart version and uses a generation. Declining costs nothing.",
            decline: "No thanks",
            accept: "Apply",
        });
    });
});

describe("the summary's warning label", () => {
    it("is English as before with no source, and the reader's with one", () => {
        expect(composeSummaryText("A bar chart", "the pick was changed")).toBe("A bar chart. Warning: the pick was changed");
        expect(composeSummaryText("Ein Balkendiagramm", "die Auswahl wurde geändert", de)).toBe("Ein Balkendiagramm. Warnung: die Auswahl wurde geändert");
        expect(composeSummaryText("A bar chart", "  ", de)).toBe("A bar chart");
    });
});
