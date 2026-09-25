import { describe, it, expect } from "vitest";
import { canShowLastChart, shouldRestoreVersionAfterLicenseSave } from "../src/index";

// Written against the Power BI visual's own copy of these two decisions and moved here with every
// expected value unchanged.

describe("canShowLastChart - the way back to the last working chart", () => {
    // THE REGRESSION: a distributed copy stranded at version 4 with its licence details stripped. The
    // landing screen is up, Generate cannot succeed, and the other recovery links are suppressed
    // because the landing screen is up. This button is the only exit, and the old version-is-0 term
    // hid it precisely here.
    it("offers the button when stranded at a NON-zero version with cached code", () => {
        expect(canShowLastChart(4, "function render(container, data, options) {}")).toBe(true);
    });

    // The landing-screen case differs ONLY in the host's current version selector being 0 - which is
    // deliberately no longer an input. The CACHED version is still 4 on the landing screen, so the two
    // states collapse to the same call, which is the point of dropping the version term.
    it("collapses landing-page and stranded to the same answer (the current version is not an input)", () => {
        const code = "function render(container, data, options) {}";
        expect(canShowLastChart(4, code)).toBe(true); // stranded at version 4
        expect(canShowLastChart(4, code)).toBe(true); // landing, current version 0, cache still 4
    });

    it("offers it at any cached version, not just 0 or 4", () => {
        for (const v of [1, 2, 17, 99]) {
            expect(canShowLastChart(v, "code")).toBe(true);
        }
    });

    // Nothing cached => nothing to go back TO. The fresh-setup flow must stay clean.
    it("hides it with no cached version", () => {
        expect(canShowLastChart(0, "")).toBe(false);
        expect(canShowLastChart(null, "code")).toBe(false);
        expect(canShowLastChart(undefined, "code")).toBe(false);
    });

    it("hides it when a version is cached but the code is missing/blank", () => {
        expect(canShowLastChart(4, "")).toBe(false);
        expect(canShowLastChart(4, "   ")).toBe(false);
        expect(canShowLastChart(4, null)).toBe(false);
        expect(canShowLastChart(4, undefined)).toBe(false);
    });

    it("treats a negative cached version as nothing cached", () => {
        expect(canShowLastChart(-1, "code")).toBe(false);
    });
});

describe("shouldRestoreVersionAfterLicenseSave", () => {
    const code = "function render(container, data, options) {}";

    // THE CASE. A reader with a chart enters a licence. Getting to the licence panel put the version
    // at 0; without this they land on setup, press the only button there, and own a duplicate version
    // they did not ask for - on the conversion path.
    it("restores when parked on the landing page with a cached chart in hand", () => {
        expect(shouldRestoreVersionAfterLicenseSave(0, 4, code)).toBe(true);
    });

    // The asymmetry with canShowLastChart, stated as a test because it is the part someone will later
    // think is a copy-paste slip. The BUTTON must ignore the current version (the stranded dead end);
    // this must not - a non-zero version means the reader is somewhere on purpose.
    it("leaves a non-zero version exactly where it is", () => {
        expect(shouldRestoreVersionAfterLicenseSave(4, 4, code)).toBe(false);
        expect(shouldRestoreVersionAfterLicenseSave(7, 4, code)).toBe(false);
    });

    it("does nothing on a first-ever licence with no chart to go back to", () => {
        expect(shouldRestoreVersionAfterLicenseSave(0, 0, "")).toBe(false);
        expect(shouldRestoreVersionAfterLicenseSave(0, null, code)).toBe(false);
        expect(shouldRestoreVersionAfterLicenseSave(0, 4, "")).toBe(false);
    });

    it("treats a missing current version the same as zero", () => {
        expect(shouldRestoreVersionAfterLicenseSave(null, 4, code)).toBe(true);
        expect(shouldRestoreVersionAfterLicenseSave(undefined, 4, code)).toBe(true);
    });
});
