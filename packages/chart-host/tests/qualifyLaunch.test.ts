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
        // A default task pane is narrower than the modal's floor. Applying the card's number to
        // a flowing panel would switch the feature off for the common case and protect nobody -
        // the panel cannot trap a reader, because it wraps and scrolls.
        const tiny = { enabled: true, hasData: true, width: 320, height: 500 };
        expect(shouldOpenChooserOnGenerate(tiny)).toBe(false);
        expect(shouldOpenInlineChooserOnGenerate(tiny)).toBe(true);
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
