import { describe, it, expect } from "vitest";
import { stableFingerprintOptions, fingerprintComponentDigest } from "../src/clientIdentity";
import * as barrel from "../src/index";

// ONE RECIPE FOR EVERY BROWSER HOST. The id a host derives lives exactly as long as the inputs these options keep, so the
// options are the contract: the two inputs that change with every browser release are out, and so is vendor logging.
describe("stableFingerprintOptions", () => {
    it("excludes the user agent and the parsed browser version, plus fonts, and turns vendor logging off", () => {
        const o = stableFingerprintOptions();
        expect(o.exclude).toEqual(["fonts", "system.useragent", "system.browser.version"]);
        expect(o.logging).toBe(false);
    });
    it("keeps the browser NAME - one person in two browsers is two ids, never two people in one", () => {
        expect(stableFingerprintOptions().exclude).not.toContain("system.browser");
        expect(stableFingerprintOptions().exclude).not.toContain("system");
    });
    it("hands every caller its own object, so no host can change another's recipe", () => {
        const a = stableFingerprintOptions();
        a.exclude.push("canvas");
        expect(stableFingerprintOptions().exclude).not.toContain("canvas");
    });
    it("is exported from the package barrel", () => {
        expect(typeof (barrel as Record<string, unknown>).stableFingerprintOptions).toBe("function");
        expect(typeof (barrel as Record<string, unknown>).fingerprintComponentDigest).toBe("function");
    });
});

describe("fingerprintComponentDigest", () => {
    const components = { audio: { sampleHash: 123 }, canvas: { commonImageDataHash: "abc" }, locales: { timezone: "UTC" } };

    it("names every component, in order, with a 4-hex digest", () => {
        expect(fingerprintComponentDigest(components)).toMatch(/^audio:[0-9a-f]{4},canvas:[0-9a-f]{4},locales:[0-9a-f]{4}$/);
    });
    it("is deterministic, and moves only for the component whose value moved", () => {
        const a = fingerprintComponentDigest(components).split(",");
        const b = fingerprintComponentDigest({ ...components, locales: { timezone: "Asia/Kolkata" } }).split(",");
        expect(fingerprintComponentDigest(components)).toBe(a.join(","));
        expect(b[0]).toBe(a[0]);
        expect(b[1]).toBe(a[1]);
        expect(b[2]).not.toBe(a[2]);
    });
    it("marks a component the library gave up on", () => {
        expect(fingerprintComponentDigest({ audio: { timeout: "true" }, math: { x: 1 } })).toMatch(/^audio:timeout,math:[0-9a-f]{4}$/);
    });
    it("carries no source value", () => {
        expect(fingerprintComponentDigest({ locales: { timezone: "Europe/Berlin" } })).not.toContain("Berlin");
    });
    it("reads nothing into a missing result", () => {
        expect(fingerprintComponentDigest(null)).toBe("");
        expect(fingerprintComponentDigest(undefined)).toBe("");
    });
});
