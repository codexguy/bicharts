import { describe, it, expect } from "vitest";
import { shouldCaptureThumbnail, type ThumbnailGate } from "../src/index";

// The Power BI visual's capture rule, written down as the table it always was, plus the Excel add-in's
// rule stated as the same table with the two inputs that host does not have (a forced capture and a
// by-default capture) held false.

const ALL: ThumbnailGate[] = [];
for (const consented of [false, true])
    for (const forced of [false, true])
        for (const capturesByDefault of [false, true])
            for (const firstRenderAfterGenerate of [false, true])
                ALL.push({ consented, forced, capturesByDefault, firstRenderAfterGenerate });

describe("shouldCaptureThumbnail", () => {
    it("enumerates all sixteen gates: forced, or (consented or by-default) on the first render of a generation", () => {
        for (const g of ALL) {
            const expected = g.forced || ((g.consented || g.capturesByDefault) && g.firstRenderAfterGenerate);
            expect(shouldCaptureThumbnail(g).capture, JSON.stringify(g)).toBe(expected);
        }
    });

    it("the consent flag is the reader's opt-in and nothing else - forced and by-default never raise it", () => {
        for (const g of ALL) expect(shouldCaptureThumbnail(g).consent, JSON.stringify(g)).toBe(g.consented);
    });

    it("a repaint of the same version (resize, reopen, filter) never re-captures an opted-in chart", () => {
        expect(shouldCaptureThumbnail({ consented: true, forced: false, capturesByDefault: false, firstRenderAfterGenerate: false }))
            .toEqual({ capture: false, consent: true });
    });

    it("a forced capture of a reader who did not opt in is captured and flagged as NOT consented", () => {
        expect(shouldCaptureThumbnail({ consented: false, forced: true, capturesByDefault: false, firstRenderAfterGenerate: false }))
            .toEqual({ capture: true, consent: false });
    });

    it("a by-default capture happens on the first render only, and is not consent", () => {
        expect(shouldCaptureThumbnail({ consented: false, forced: false, capturesByDefault: true, firstRenderAfterGenerate: true }))
            .toEqual({ capture: true, consent: false });
        expect(shouldCaptureThumbnail({ consented: false, forced: false, capturesByDefault: true, firstRenderAfterGenerate: false }))
            .toEqual({ capture: false, consent: false });
    });

    it("a host with no forced or by-default capture captures exactly when the reader opted in and this is a new generation", () => {
        for (const consented of [false, true])
            for (const firstRenderAfterGenerate of [false, true])
                expect(shouldCaptureThumbnail({ consented, forced: false, capturesByDefault: false, firstRenderAfterGenerate }).capture)
                    .toBe(consented && firstRenderAfterGenerate);
    });
});
