// The obfuscated sample masks every script, not only ASCII. Before, `Москва` and `東京都` shipped
// verbatim at the privacy level that promises obfuscation, and `Zürich` kept its `ü`.
import { describe, it, expect } from "vitest";
import { maskSampleText } from "../src/sampleMask";
import { IndexedText } from "../src/indexedText";

/** A seeded uniform [0,1) - deterministic, so a failure reproduces. */
function seeded(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const SAMPLES = ["Москва", "東京都", "Zürich", "القاهرة", "मुंबई", "กรุงเทพ", "Ελλάδα", "서울", "ירושלים", "Kraków", "İstanbul"];
const SCRIPTS: Record<string, RegExp> = {
    Latin: /\p{Script=Latin}/u, Cyrillic: /\p{Script=Cyrillic}/u, Han: /\p{Script=Han}/u,
    Arabic: /\p{Script=Arabic}/u, Devanagari: /\p{Script=Devanagari}/u, Thai: /\p{Script=Thai}/u,
    Greek: /\p{Script=Greek}/u, Hangul: /\p{Script=Hangul}/u, Hebrew: /\p{Script=Hebrew}/u,
};
const scriptsOf = (s: string) => Object.keys(SCRIPTS).filter(k => SCRIPTS[k].test(s)).sort();
const letters = (s: string) => Array.from(s).filter(c => /[\p{L}\p{M}\p{Nd}]/u.test(c));

describe("maskSampleText - every script is masked", () => {
    it.each(SAMPLES)("%s keeps none of its own letters, over 300 draws", (value) => {
        const own = new Set(letters(value));
        for (let seed = 1; seed <= 300; seed++) {
            const masked = maskSampleText(value, seeded(seed));
            for (const ch of letters(masked)) expect(own.has(ch), `${value} -> ${masked} kept ${ch}`).toBe(false);
        }
    });

    it.each(SAMPLES)("%s stays in its own script, so the shape signal survives", (value) => {
        for (let seed = 1; seed <= 50; seed++) {
            expect(scriptsOf(maskSampleText(value, seeded(seed)))).toEqual(scriptsOf(value));
        }
    });

    it("keeps case in a cased script, and a mark stays a mark", () => {
        for (let seed = 1; seed <= 50; seed++) {
            // Case survives per character: one capital becomes one capital (two if the length
            // jitter repeats it, none if the jitter removes it - the same jitter ASCII has always
            // had), and the lower-case letters stay lower-case modern Cyrillic.
            const ru = maskSampleText("Москва", seeded(seed));
            expect(ru).toMatch(/^[\u0400-\u045F\u0490\u0491]+$/u);
            expect(Array.from(ru).filter(c => /\p{Lu}/u.test(c)).length).toBeLessThanOrEqual(2);
            expect(Array.from(ru).filter(c => /\p{Ll}/u.test(c)).length).toBeGreaterThanOrEqual(3);
            const hi = Array.from(maskSampleText("मुंबई", seeded(seed)));
            // A vowel sign never starts the value: the first character is still a letter.
            expect(hi[0]).toMatch(/^\p{L}$/u);
        }
    });

    it("an Arabic-Indic digit stays an Arabic-Indic digit, and an ASCII one ASCII", () => {
        for (let seed = 1; seed <= 50; seed++) {
            expect(maskSampleText("٢٠٢٤", seeded(seed))).toMatch(/^[٠-٩]+$/u);
            expect(maskSampleText("2024", seeded(seed))).toMatch(/^[0-9]+$/);
        }
    });

    it("leaves the format alone: separators, spaces, punctuation", () => {
        for (let seed = 1; seed <= 50; seed++) {
            expect(maskSampleText("USD-12345", seeded(seed))).toMatch(/^[A-Z]+-[0-9]+$/);
            expect(maskSampleText("Санкт-Петербург", seeded(seed))).toMatch(/^[\u0400-\u045F\u0490\u0491]+-[\u0400-\u045F\u0490\u0491]+$/u);
            expect(maskSampleText("東京 大阪", seeded(seed)).split(" ").length).toBe(2);
        }
    });

    it("keeps an e-mail's shape", () => {
        const m = maskSampleText("maria.garcia@empresa.com", seeded(7));
        expect(m).toMatch(/^[a-z]+\.[a-z]+@[a-z]+\.com$/);
    });
});

describe("the sample the engine ships", () => {
    it("carries none of the letters of a non-Latin value", async () => {
        const it = new IndexedText();
        it.setColumns([{ name: "City", dataType: "String", isMeasure: false } as any]);
        const cities = ["Москва", "東京都", "Zürich", "القاهرة", "मुंबई", "กรุงเทพ"];
        cities.forEach((c, i) => it.addRow([c], i));
        const csv = await it.getCSVAsync(true);
        const own = new Set(cities.flatMap(letters));
        for (const ch of letters(csv)) expect(own.has(ch), `sample kept ${ch}: ${csv}`).toBe(false);
    });
});
