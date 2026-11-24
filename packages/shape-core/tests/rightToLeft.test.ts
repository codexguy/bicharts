import { describe, it, expect } from "vitest";
import { isRightToLeft, resolveLanguage } from "../src/index";

// The writing direction of a culture tag, by the language list's own `dir`, reading the tag the way resolveLanguage
// reads it.
describe("isRightToLeft", () => {
    it("is true for Arabic, Hebrew and Persian in every tag form a host sends", () => {
        for (const t of ["ar", "he", "iw", "IW", "ar-SA", "AR_sa", "ar-SA-u-nu-arab", "ar-EG-u-nu-latn", "he-IL", "fa-IR"]) {
            expect(isRightToLeft(t), t).toBe(true);
        }
    });
    it("is false for a left-to-right language, a language the list does not carry, and an absent or bad tag", () => {
        for (const t of ["en", "en-US", "de", "zh-Hant-TW", "ja-JP", "hi-IN", "sw-KE", "", "  ", "!!", null, undefined]) {
            expect(isRightToLeft(t as any), String(t)).toBe(false);
        }
    });
    it("agrees with resolveLanguage on every Tier 1 language", () => {
        for (const code of ["en", "ar", "he", "de", "zh", "th"]) {
            expect(isRightToLeft(code)).toBe(resolveLanguage(code).language.dir === "rtl");
        }
    });
    it("a Latin numbering system does not change the language", () => {
        expect(resolveLanguage("ar-SA-u-nu-latn").code).toBe("ar");
        expect(resolveLanguage("he-IL-u-nu-latn").code).toBe("he");
    });
});
