// The localized chart-type names have no human review: these checks are their gate, and every one is pass/fail.
// A name that fails is fixed in vocab/chartNames.ts (and the server copy regenerated), never waved through.
import { describe, it, expect } from "vitest";
import {
    CHART_NAME_LANGUAGES, LOCALIZED_CHART_NAMES, foldChartName, localizedChartName, chartNameFromLocalized,
} from "../src/vocab/chartNames";

const SCRIPT: Record<string, RegExp> = {
    ru: /\p{Script=Cyrillic}/u, uk: /\p{Script=Cyrillic}/u, el: /\p{Script=Greek}/u,
    zh: /\p{Script=Han}/u, ja: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u, ko: /\p{Script=Hangul}/u,
    ar: /\p{Script=Arabic}/u, he: /\p{Script=Hebrew}/u, hi: /\p{Script=Devanagari}/u, th: /\p{Script=Thai}/u,
};
// Proper names (and the abbreviations a field uses as names) that may stay in Latin letters in any language.
const PROPER = /^(sankey|gantt|pareto|voronoi|marimekko|mekko|likert|kaplan|meier|lorenz|venn|euler|bollinger|nightingale|mermaid|ohlc|kpi|zip|q|qq|abc|rfm|bcg|swot|raci|kde|ecdf|cdf|pdf|ridgeline|hexbin|treemap|sunburst|waffle|bullet|streamgraph|joyplot|boxplot|violin|lollipop|dumbbell|slope|word|cloud|tag|chord|arc|alluvial|candlestick|heatmap|bubble|funnel|radar|spider|polar|donut|pie|mosaic|parallel|sparkline|x|y|xy|2d|3d|d3|ui|vs|d|k|p|n|a|b|c|l|r|s|t|v|z)$/;

// Names a language writes exactly as English does, each a decision that the language really uses the word: "Histogram"
// in the Germanic and West Slavic languages, Turkish, Croatian and Indonesian; "Thermometer" in Dutch and German; the
// loanwords "Heatmap" and "Treemap" in Dutch and German (their Excel and Power BI use them); Romanian "Card".
const SAME_AS_ENGLISH = new Set([
    "Histogram:nl", "Histogram:pl", "Histogram:cs", "Histogram:sk", "Histogram:sv", "Histogram:da", "Histogram:nb",
    "Histogram:tr", "Histogram:hr", "Histogram:id", "Thermometer:nl", "Thermometer:de", "Heatmap:nl", "Heatmap:de",
    "Treemap:nl", "Treemap:de", "Card:ro",
]);

const rows = Object.entries(LOCALIZED_CHART_NAMES);

describe("the localized chart-type name table", () => {
    it("has a row for every catalogue type it names, and a name in every language", () => {
        expect(rows.length).toBeGreaterThanOrEqual(130);
        for (const [en, row] of rows) {
            expect(Object.keys(row), en).toEqual([...CHART_NAME_LANGUAGES]);
            for (const lang of CHART_NAME_LANGUAGES) expect((row[lang] ?? "").trim(), `${en} [${lang}]`).not.toBe("");
        }
    });

    it("gives every type a DISTINCT name within each language (folded)", () => {
        for (const lang of CHART_NAME_LANGUAGES) {
            const seen = new Map<string, string>();
            const dup: string[] = [];
            for (const [en, row] of rows) {
                const k = foldChartName(row[lang]);
                if (seen.has(k)) dup.push(`${seen.get(k)} / ${en} = "${row[lang]}"`);
                else seen.set(k, en);
            }
            expect(dup, lang).toEqual([]);
        }
    });

    it("writes each name in its language's own script; Latin letters only in proper names", () => {
        const bad: string[] = [];
        for (const [en, row] of rows) {
            for (const lang of Object.keys(SCRIPT)) {
                const v = row[lang];
                if (!SCRIPT[lang].test(v)) { bad.push(`${lang} ${en}: "${v}" has no ${lang} script`); continue; }
                for (const w of v.match(/[A-Za-z]+/g) ?? []) if (!PROPER.test(w.toLowerCase())) bad.push(`${lang} ${en}: "${v}" keeps "${w}"`);
            }
        }
        expect(bad).toEqual([]);
    });

    it("keeps a name's length in a band around the English", () => {
        const bad: string[] = [];
        for (const [en, row] of rows)
            for (const lang of CHART_NAME_LANGUAGES)
                if ([...row[lang]].length > 2 * en.length + 12) bad.push(`${lang} ${en}: "${row[lang]}"`);
        expect(bad).toEqual([]);
    });

    it("leaves few names identical to the English, and only proper-name ones", () => {
        const same: string[] = [];
        for (const [en, row] of rows)
            for (const lang of CHART_NAME_LANGUAGES)
                if (foldChartName(row[lang]) === foldChartName(en) && !SAME_AS_ENGLISH.has(`${en}:${lang}`)
                    && !foldChartName(en).split(/[\s()\-]+/).filter(Boolean).every(w => PROPER.test(w))) same.push(`${lang}: ${en}`);
        expect(same).toEqual([]);
    });

    it("reads a typed name back to its type, in any language, folded", () => {
        const es = localizedChartName("Area chart", "es")!;
        expect(chartNameFromLocalized(es)).toBe("Area chart");
        expect(chartNameFromLocalized("  " + es.toUpperCase() + " ")).toBe("Area chart");
        expect(chartNameFromLocalized(foldChartName(es))).toBe("Area chart");
        expect(chartNameFromLocalized("no such chart")).toBeUndefined();
        // nearly every name reads back unambiguously
        let ambiguous = 0, total = 0;
        for (const [en, row] of rows) for (const lang of CHART_NAME_LANGUAGES) { total++; if (chartNameFromLocalized(row[lang]) !== en) ambiguous++; }
        expect(ambiguous / total).toBeLessThan(0.01);
    });
});
