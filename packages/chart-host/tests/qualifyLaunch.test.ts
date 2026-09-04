import { describe, it, expect } from "vitest";
import {
    shouldOpenInlineChooserOnGenerate,
    qualifyPick, qualifyAuto, qualifyCancel,
    launchGenerates, launchFavorStyle,
    chooserFitsViewport, shouldOpenChooserOnGenerate,
    canConfirmLaunch, confirmLaunch, qualifyFailureFallsOpen,
    CHOOSER_MIN_WIDTH_PX, CHOOSER_MIN_HEIGHT_PX,
} from "../src/qualifyLaunch";
import * as api from "../src/index";

describe("auto and cancel are different answers", () => {
    // The whole reason this module exists. A host modelling the exit as one boolean collapses
    // them, and the collapse is silent in both directions.
    it("auto generates, cancel does not", () => {
        expect(launchGenerates(qualifyAuto())).toBe(true);
        expect(launchGenerates(qualifyCancel())).toBe(false);
    });

    it("a named pick generates", () => {
        expect(launchGenerates(qualifyPick("Sunburst"))).toBe(true);
    });

    it("auto expresses NO preference, so it carries the host's own sentinel", () => {
        // The two hosts genuinely disagree about how auto is spelled; what must not differ is
        // WHICH outcomes get the sentinel.
        expect(launchFavorStyle(qualifyAuto(), null)).toBeNull();
        expect(launchFavorStyle(qualifyAuto(), "")).toBe("");
        expect(launchFavorStyle(qualifyPick("Treemap"), null)).toBe("Treemap");
        expect(launchFavorStyle(qualifyPick("Treemap"), "")).toBe("Treemap");
    });

    it("cancel never leaks a stale pick to a caller that ignores launchGenerates", () => {
        expect(launchFavorStyle(qualifyCancel(), null)).toBeNull();
        expect(launchFavorStyle(qualifyCancel(), "")).toBe("");
    });
});

describe("there has to be room to draw the chooser", () => {
    it("accepts the measured floor exactly", () => {
        expect(chooserFitsViewport(CHOOSER_MIN_WIDTH_PX, CHOOSER_MIN_HEIGHT_PX)).toBe(true);
    });

    it("rejects one pixel under, in either dimension", () => {
        expect(chooserFitsViewport(CHOOSER_MIN_WIDTH_PX - 1, CHOOSER_MIN_HEIGHT_PX)).toBe(false);
        expect(chooserFitsViewport(CHOOSER_MIN_WIDTH_PX, CHOOSER_MIN_HEIGHT_PX - 1)).toBe(false);
    });

    it("rejects the shapes a small tile actually takes", () => {
        expect(chooserFitsViewport(300, 200)).toBe(false);   // a KPI card
        expect(chooserFitsViewport(1230, 120)).toBe(false);  // a wide, very short banner
        expect(chooserFitsViewport(150, 800)).toBe(false);   // a narrow column
    });

    it("accepts a roomy tile and the wide-short shape that is actually common", () => {
        expect(chooserFitsViewport(1230, 474)).toBe(true);
        expect(chooserFitsViewport(800, 600)).toBe(true);
    });

    it("treats a non-finite measurement as no room", () => {
        // A tile measured before layout reads 0 or NaN; opening a dialog into that is worse
        // than declining, because declining is just the old behaviour.
        expect(chooserFitsViewport(NaN, 600)).toBe(false);
        expect(chooserFitsViewport(800, Infinity)).toBe(false);
        expect(chooserFitsViewport(0, 0)).toBe(false);
    });
});

describe("the floor is the ESCAPABILITY floor, not a legibility one (re-measured 2026-09-04)", () => {
    // These are the sizes that moved, pinned as sizes rather than as arithmetic on the
    // constants: the point of the re-measure is which REAL tiles changed answer, and a test
    // written against CHOOSER_MIN_* would go on passing if someone put the old numbers back.

    it("opens on a 400px-wide tile, which is what a 400px tile actually measures", () => {
        // THE CASE THAT STARTED THE RE-MEASURE. An author drags a tile to 400 x 360 - the
        // roundest width there is - and Power BI's chrome takes a flat 10px, so the drawable
        // surface the host measures is 390. Under the old 400 floor that tile silently never
        // got the chooser while the 420 tile beside it did, which read as a bug and was one.
        expect(chooserFitsViewport(390, 320)).toBe(true);
    });

    it("still opens where it always did", () => {
        // The old floor exactly. Nothing that had the chooser loses it - this change only ever
        // adds tiles, which is what makes it safe to ship without auditing every report.
        expect(chooserFitsViewport(400, 240)).toBe(true);
        expect(chooserFitsViewport(1230, 474)).toBe(true);
    });

    it("keeps the margin the sweep left, in both dimensions", () => {
        // Measured escapability holds from 300 x 190. The shipped floor sits one sweep step
        // above that on each side, so a longer localized title has somewhere to wrap into.
        // Anything inside the margin stays declined, deliberately.
        expect(chooserFitsViewport(310, 220)).toBe(false);
        expect(chooserFitsViewport(320, 210)).toBe(false);
        expect(chooserFitsViewport(300, 190)).toBe(false);
    });

    it("a KPI card and a banner strip are still too small to draw a modal in", () => {
        // The shapes real tiles take at the small end. The banner fails on height alone even
        // though it is enormously wide - the card's three buttons need a line, and the pinned
        // chrome above them needs somewhere to be.
        expect(chooserFitsViewport(300, 200)).toBe(false);
        expect(chooserFitsViewport(1230, 120)).toBe(false);
    });
});

describe("the gate in front of Generate", () => {
    const roomy = { enabled: true, width: 900, height: 600, hasData: true };

    it("opens when the setting is on, there is data, and there is room", () => {
        expect(shouldOpenChooserOnGenerate(roomy)).toBe(true);
    });

    it("the opt-out restores one-click Generate", () => {
        expect(shouldOpenChooserOnGenerate({ ...roomy, enabled: false })).toBe(false);
    });

    it("declines with nothing bound - the generate path says it better", () => {
        expect(shouldOpenChooserOnGenerate({ ...roomy, hasData: false })).toBe(false);
    });

    it("declines on a tile too small to draw it in", () => {
        expect(shouldOpenChooserOnGenerate({ ...roomy, width: 320, height: 200 })).toBe(false);
    });

    it("every false answer lands on the pre-existing behaviour, so it is never a dead end", () => {
        // Belt-and-braces on the design claim above: there is no input for which the gate says
        // "do not open" AND the host is left with nothing to do.
        for (const input of [
            { ...roomy, enabled: false },
            { ...roomy, hasData: false },
            { ...roomy, width: 10, height: 10 },
        ]) {
            expect(shouldOpenChooserOnGenerate(input)).toBe(false);
        }
    });
});

describe("an inline scrolling panel has no size clause, and that is measured", () => {
    it("opens at any pane size when the setting is on and there is data", () => {
        expect(shouldOpenInlineChooserOnGenerate({ enabled: true, hasData: true })).toBe(true);
    });

    it("still honours the opt-out and the nothing-bound case", () => {
        expect(shouldOpenInlineChooserOnGenerate({ enabled: false, hasData: true })).toBe(false);
        expect(shouldOpenInlineChooserOnGenerate({ enabled: true, hasData: false })).toBe(false);
    });

    it("differs from the modal gate exactly where the layouts differ", () => {
        // Applying the card's number to a flowing panel would switch the feature off for the
        // common case and protect nobody - the panel cannot trap a reader, because it wraps and
        // scrolls.
        //
        // THE BAND WHERE THEY DIFFER NARROWED WITH THE 2026-09-04 RE-MEASURE, and the narrowing
        // is the point rather than an inconvenience: once the modal's floor answers the same
        // question the panel's absence of one answers - can the reader get out - the two hosts
        // stop disagreeing anywhere the card can actually be drawn. This case used 320 x 500,
        // which BOTH gates now open, and moving it to a genuinely narrower pane is what keeps it
        // testing the asymmetry instead of testing a number that moved.
        const narrow = { enabled: true, hasData: true, width: 300, height: 500 };
        expect(shouldOpenChooserOnGenerate(narrow)).toBe(false);
        expect(shouldOpenInlineChooserOnGenerate(narrow)).toBe(true);
    });

    it("a default task pane now clears the modal floor too, and that is the intended consequence", () => {
        // Recorded because it is the visible half of the re-measure: at 400 x 240 an ordinary
        // Office task pane was under the card's floor, so the two hosts reached opposite answers
        // on the SAME pane and only the panel's own no-floor rule made Excel usable. They now
        // agree there. The asymmetry survives only below the card's drawable minimum, which is
        // the only place it was ever describing something real.
        const pane = { enabled: true, hasData: true, width: 340, height: 600 };
        expect(shouldOpenChooserOnGenerate(pane)).toBe(true);
        expect(shouldOpenInlineChooserOnGenerate(pane)).toBe(true);
    });
});

describe("confirm is armed by a selection, never by hope", () => {
    it("arms on a real name", () => {
        expect(canConfirmLaunch("Bar chart")).toBe(true);
    });

    it("stays disarmed for nothing, blank, and whitespace", () => {
        expect(canConfirmLaunch(null)).toBe(false);
        expect(canConfirmLaunch(undefined)).toBe(false);
        expect(canConfirmLaunch("")).toBe(false);
        expect(canConfirmLaunch("   ")).toBe(false);
    });

    it("confirming a selection is a pick, trimmed", () => {
        expect(confirmLaunch("  Sankey  ")).toEqual({ kind: "pick", chartType: "Sankey" });
    });

    it("confirming NOTHING is a cancel, not an auto - it must not spend anything", () => {
        // The UI should not permit this. If it does, the honest reading of a meaningless click
        // is "nothing happens", never "generate a chart".
        expect(confirmLaunch(null)).toEqual({ kind: "cancel" });
        expect(launchGenerates(confirmLaunch(""))).toBe(false);
    });
});

describe("a failed qualify means different things at the two doors", () => {
    it("falls open to a generation when the reader pressed Generate", () => {
        expect(qualifyFailureFallsOpen(true)).toBe(true);
    });

    it("shows the error and spends nothing when the reader asked a question", () => {
        expect(qualifyFailureFallsOpen(false)).toBe(false);
    });
});

describe("the launch contract is reachable from the package barrel", () => {
    // Same failure mode barrelResolvability.test.ts guards for contract.ts: a symbol defined
    // here and never added to index.ts is invisible to a NodeNext consumer, silently.
    it("exports every launch symbol the hosts import by name", () => {
        for (const name of [
            "qualifyPick", "qualifyAuto", "qualifyCancel",
            "launchGenerates", "launchFavorStyle",
            "chooserFitsViewport", "shouldOpenChooserOnGenerate",
            "canConfirmLaunch", "confirmLaunch", "qualifyFailureFallsOpen", "shouldOpenInlineChooserOnGenerate",
            "CHOOSER_MIN_WIDTH_PX", "CHOOSER_MIN_HEIGHT_PX",
        ]) {
            expect(name in api, `barrel is missing ${name}`).toBe(true);
        }
    });
});
