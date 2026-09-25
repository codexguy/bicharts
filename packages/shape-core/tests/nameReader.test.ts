// The column-name reader in every script, pinned by the shared fixture file - the same file a
// server-side twin tokenises, so the two cannot drift without one suite going red.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    nameWords, readName, foldName, matchNameToken, wordEndsWith, gluedPrefixStems, unsegmentedRuns,
    hangulWordEndsWith, HANGUL_MIN_STEM,
} from "../src/nameReader";
import { SUPPORTED_LANGUAGE_CODES } from "../src/languages";
import { foldAccents, nameLooksIntensiveRate, stripHostAggPrefix } from "../src/aggregation";
import { nameWords as utilNameWords } from "../src/util";

interface Fixture {
    names: Array<{ lang: string; kind: string; name: string; words: string[]; folded: string[] }>;
    fold: Array<{ in: string; out: string }>;
    matches: Array<{ lang: string; token: string; name: string; view: string | null }>;
}
const fixture: Fixture = JSON.parse(readFileSync(resolve(__dirname, "fixtures", "name-reader.json"), "utf8"));

describe("the shared name-reader fixture", () => {
    it.each(fixture.names.map(n => [n.lang, n.name, n]))("[%s] %s reads as its words", (_l, _n, e) => {
        expect(nameWords(e.name)).toEqual(e.words);
        expect(readName(e.name).words).toEqual(e.words);
    });

    it.each(fixture.names.map(n => [n.lang, n.name, n]))("[%s] %s folds as written", (_l, _n, e) => {
        expect(readName(e.name).folded).toEqual(e.folded);
    });

    it.each(fixture.fold.map(f => [f.in, f.out]))("fold(%s) = %s, same length", (input, out) => {
        expect(foldName(input)).toBe(out);
        expect(foldName(input).length).toBe(input.length);
    });

    it.each(fixture.matches.map(m => [m.lang, m.token, m.name, m.view]))(
        "[%s] %s in %s -> %s", (lang, token, name, view) => {
            expect(matchNameToken(name as string, token as string, lang as string)).toBe(view);
        });

    it("covers every Tier 1 language, at least twice, and nothing else", () => {
        const per = new Map<string, number>();
        for (const n of fixture.names) per.set(n.lang, (per.get(n.lang) ?? 0) + 1);
        for (const code of SUPPORTED_LANGUAGE_CODES) expect(per.get(code) ?? 0, code).toBeGreaterThanOrEqual(2);
        for (const lang of per.keys()) expect(SUPPORTED_LANGUAGE_CODES, lang).toContain(lang);
    });

    it("carries every kind the contract names", () => {
        const kinds = new Set(fixture.names.map(n => n.kind));
        for (const k of ["glued", "camel", "underscore", "accented", "compound", "cjk"]) expect(kinds, k).toContain(k);
    });
});

// The reference: the reader as it stood before every script was read. An all-ASCII name must read
// EXACTLY as it did, because every English verdict hangs off these words.
function asciiEraNameWords(name: string): string[] {
    if (!name) return [];
    return name
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_\-./]+/g, " ")
        .toLowerCase()
        .split(/\s+/)
        .filter(t => t.length > 0);
}

describe("an all-ASCII name reads exactly as it always did", () => {
    it("on the names that carry the most punctuation", () => {
        for (const n of ["Sales (USD)", "Growth Rate %", "% to Goal", "Permit Sub-Limit (t CO2e/yr)",
            "Net Sales (Wk)", "single item productivity (ml/day) (bins)", "Sum of Peak Force (kN)",
            ">3 adds and same viz >2", "Deposit Balance ($M)", "Customer ID#", "a..b__c--d//e",
            "XMLHttpRequest", "iPhone12Pro", "  padded  ", "Year:", "O'Brien", "fiscal_year",
            "OlympicYear", "FY2024", "LatencyMs"]) {
            expect(nameWords(n), n).toEqual(asciiEraNameWords(n));
        }
    });

    it("on 5,000 random ASCII names", () => {
        let seed = 12345;
        const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000);
        const alphabet = "abcXYZ019 _-./()%#:$'&+,;!?[]{}@\t";
        for (let i = 0; i < 5000; i++) {
            let s = "";
            const len = 1 + Math.floor(rand() * 16);
            for (let k = 0; k < len; k++) s += alphabet[Math.floor(rand() * alphabet.length)];
            expect(nameWords(s), JSON.stringify(s)).toEqual(asciiEraNameWords(s));
        }
    });

    it("util's nameWords IS the reader's (one reading, not two)", () => {
        expect(utilNameWords).toBe(nameWords);
    });
});

describe("the reader reads every script", () => {
    it("splits camelCase in any cased script, which the ASCII-era reader could not", () => {
        expect(nameWords("СредняяЦена")).toEqual(["средняя", "цена"]);
        expect(nameWords("ΜέσηΤιμή")).toEqual(["μέση", "τιμή"]);
        expect(nameWords("VevőKód")).toEqual(["vevő", "kód"]);
        expect(asciiEraNameWords("СредняяЦена")).toEqual(["средняяцена"]);
    });

    it("keeps a Devanagari or Thai word whole across its vowel signs", () => {
        expect(nameWords("मुंबई")).toEqual(["मुंबई"]);
        expect(nameWords("กรุงเทพ")).toEqual(["กรุงเทพ"]);
    });

    it("separates at non-ASCII punctuation - an en dash, a degree sign, an ideographic comma", () => {
        expect(nameWords("Umsatz – Summe")).toEqual(["umsatz", "summe"]);
        expect(nameWords("顧客・地域")).toEqual(["顧客", "地域"]);
        expect(nameWords("المبيعات، الإجمالي")).toEqual(["المبيعات", "الإجمالي"]);
    });

    it("finds the unsegmented runs a substring match may look inside", () => {
        expect(unsegmentedRuns("売上高_2024年")).toEqual(["売上高", "年"]);
        expect(unsegmentedRuns("Sales")).toEqual([]);
    });
});

describe("the views", () => {
    it("a compound suffix needs a real stem in front of it", () => {
        expect(wordEndsWith("durchschnittstemperatur", "temperatur")).toBe(true);
        expect(wordEndsWith("temperatur", "temperatur")).toBe(false);   // equal is a WORD match
        expect(wordEndsWith("xytemperatur", "temperatur")).toBe(false); // a 2-letter stem is not a compound
    });

    it("a glued prefix is the language's own, longest first, and leaves a real stem", () => {
        expect(gluedPrefixStems("الإيرادات", "ar")).toEqual(["إيرادات"]);
        expect(gluedPrefixStems("והכנסות", "he")).toEqual(["כנסות", "הכנסות"]);
        expect(gluedPrefixStems("והכנסות", "de")).toEqual([]);
        expect(gluedPrefixStems("ال", "ar")).toEqual([]);
    });

    it("chooses the view by the TOKEN's language: German compounds are not read into English", () => {
        expect(matchNameToken("Durchschnittstemperatur", "temperatur", "de")).toBe("suffix");
        expect(matchNameToken("Durchschnittstemperatur", "temperatur", "en")).toBeNull();
    });

    it("an unknown language finds nothing rather than guessing", () => {
        expect(matchNameToken("Temperatur", "temperatur", "xx")).toBeNull();
    });

    it("a Hangul compound is read at its END, with a two-syllable stem in front", () => {
        expect(hangulWordEndsWith("매출실적", "실적")).toBe(true);
        expect(hangulWordEndsWith("시가총액", "시가")).toBe(false);   // the start is a modifier, not the head
        expect(hangulWordEndsWith("무계획", "계획")).toBe(false);     // a one-syllable stem is often a negation
        expect(hangulWordEndsWith("실적", "실적")).toBe(false);       // equal is a WORD match
        expect(hangulWordEndsWith("durchschnittstemperatur", "temperatur")).toBe(false); // Hangul tokens only
        expect(HANGUL_MIN_STEM).toBe(2);
    });

    it("the Hangul view is keyed by the token's script, like the substring view", () => {
        expect(matchNameToken("매출실적", "실적", "ko")).toBe("suffix");
        expect(matchNameToken("매출실적", "실적", "en")).toBe("suffix");
        // ...and a Latin token never gains the view from a Korean name around it.
        expect(matchNameToken("Salesactual", "actual", "ko")).toBeNull();
    });
});

describe("the fold reaches the additivity reader (two localized tokens that could never match)", () => {
    it("folds the stroke letters", () => {
        expect(foldAccents("Udział")).toBe("Udzial");
        expect(foldAccents("Sıcaklık")).toBe("Sicaklik");
        expect(foldAccents("Sjø")).toBe("Sjo");
        expect(foldAccents("Đakovo")).toBe("Dakovo");
    });

    it("a Polish share and a Turkish temperature now read as intensive, as their tokens always said", () => {
        expect(nameLooksIntensiveRate("Udział")).toBe(true);
        expect(nameLooksIntensiveRate("Sum of Udział")).toBe(true);
        expect(nameLooksIntensiveRate("Sıcaklık")).toBe(true);
        expect(nameLooksIntensiveRate("Ortalama Sıcaklık")).toBe(true);
    });

    it("stays length-preserving, so the prefix strip still slices the original", () => {
        expect(stripHostAggPrefix("Suma de Udział")).toBe("Udział");
        for (const s of ["Udział", "Sıcaklık", "٢٠٢٤", "ＱＴＹ", "😀 x", "日本語"]) {
            expect(foldAccents(s).length, s).toBe(s.length);
        }
    });
});
