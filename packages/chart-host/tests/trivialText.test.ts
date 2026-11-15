import { describe, it, expect, beforeEach } from "vitest";
import { JSDOM } from "jsdom";
import { planTrivialChart } from "../src/trivial";
import { catalogSource, renderText } from "../src/hostText";
import { resolveOptions } from "../src/defaults";

// The words a deterministic (trivial) chart draws, in the reader's language at RENDER time. Its source is saved with the
// report, so a word baked into it froze in the language it was planned in: a German reader opening an English author's
// one-column chart read "count of 6 rows". The emitted source now asks options.text (a host's text source, made by
// renderText(strings)) for each word and falls back to the English it always drew, so a host that passes nothing, and
// every chart saved before this, still read English byte for byte.

const OPTS: any = {
    width: 640, height: 400, palette: ["#3182bd"], themeFg: "#333333",
    backgroundColor: "#ffffff", cultureCode: "en-US", allowTooltips: true,
};
const col = (name: string, isMeasure = false) => ({ name, isMeasure, dataType: isMeasure ? "Double" : "String" });
const FREQ = { columns: [col("Sector")], rows: [["a"], ["b"], ["a"], [null], ["a"], ["b"]] };
const HIST = { columns: [col("Amount", true)], rows: Array.from({ length: 40 }, (_, i) => [i * 1000]) };

const JA = catalogSource("ja", {
    "trivial.count_title": "{name} — {count} 行の件数",
    "trivial.distribution_title": "{name} — {count} 個の値の分布",
    "trivial.blank": "(空白)",
    "trivial.value": "値",
    "trivial.reason.frequency": "1 つのカテゴリ列には妥当なグラフが 1 つあります。",
});

let container: HTMLElement;
beforeEach(() => {
    const dom = new JSDOM("<!doctype html><body><div id='c'></div>");
    (globalThis as any).document = dom.window.document;
    container = dom.window.document.getElementById("c") as unknown as HTMLElement;
});

const draw = (data: any, opts: any) => { planTrivialChart(data)!.render(container, data, opts); return container.textContent || ""; };

describe("a trivial chart with no text source draws the English it always drew", () => {
    it("frequency bars: title, blank label", () => {
        const text = draw(FREQ, OPTS);
        expect(text).toContain("Sector — count of 6 rows");
        expect(text).toContain("(blank)");
    });

    it("histogram: title and compact endpoints", () => {
        const text = draw(HIST, OPTS);
        expect(text).toContain("Amount — distribution of 40 values");
        expect(text).toContain("39K");
    });

    it("a card over an unnamed column is labelled Value", () => {
        expect(draw({ columns: [col("")], rows: [["x"]] }, OPTS)).toContain("Value");
    });
});

describe("a trivial chart with a text source draws the reader's language", () => {
    const opts = { ...OPTS, cultureCode: "ja-JP", text: renderText(JA) };

    it("words the title and the blank label", () => {
        const text = draw(FREQ, opts);
        expect(text).toContain("Sector — 6 行の件数");
        expect(text).toContain("(空白)");
        expect(text).not.toContain("count of");
    });

    it("words the histogram title and writes the endpoints in the culture's compact form", () => {
        const text = draw(HIST, opts);
        expect(text).toContain("Amount — 40 個の値の分布");
        expect(text).toContain("3.9万");
        expect(text).not.toContain("39K");
    });

    it("labels an unnamed column in the reader's language", () => {
        expect(draw({ columns: [col("")], rows: [["x"]] }, opts)).toContain("値");
    });

    it("a text source that throws costs the reader nothing but the language", () => {
        const text = draw(FREQ, { ...OPTS, text: () => { throw new Error("boom"); } });
        expect(text).toContain("Sector — count of 6 rows");
    });
});

describe("the plan's reason and the option itself", () => {
    it("planTrivialChart words its reason from a source, English without one", () => {
        expect(planTrivialChart(FREQ)!.reason).toMatch(/^A single categorical column/);
        expect(planTrivialChart(FREQ, JA)!.reason).toBe("1 つのカテゴリ列には妥当なグラフが 1 つあります。");
    });

    it("resolveOptions passes options.text through", () => {
        const t = renderText(JA);
        expect(resolveOptions({ text: t } as any).text).toBe(t);
    });
});
