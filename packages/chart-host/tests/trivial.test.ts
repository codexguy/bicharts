import { describe, it, expect, beforeEach } from "vitest";
import { JSDOM } from "jsdom";
import { planTrivialChart, compileTrivialSource } from "../src/trivial";
import { MARK_CLASS, ROW_IDX_ATTR } from "../src/contract";

// Deterministic charts for shapes with exactly one defensible answer.
//
// Two halves matter and are tested separately: WHAT IT CLAIMS (it must refuse every shape
// where a real choice exists, because a wrong claim becomes a permanent quality ceiling for
// everyone), and WHAT IT DRAWS (it must honour the same interaction grammar as generated
// code, or a deterministic chart is a downgrade dressed as a saving).

const OPTS: any = {
    width: 640, height: 400, palette: ["#3182bd"], themeFg: "#333333",
    backgroundColor: "#ffffff", cultureCode: "en-US", allowTooltips: true,
};

let dom: JSDOM;
let container: HTMLElement;
beforeEach(() => {
    dom = new JSDOM("<!doctype html><body><div id='c'></div>");
    (globalThis as any).document = dom.window.document;
    container = dom.window.document.getElementById("c") as unknown as HTMLElement;
});

const col = (name: string, isMeasure = false) => ({ name, isMeasure, dataType: isMeasure ? "Double" : "String" });

describe("planTrivialChart — what it claims", () => {
    it("claims a single value as a card", () => {
        const plan = planTrivialChart({ columns: [col("First M-Sector")], rows: [["Financials"]] });
        expect(plan?.kind).toBe("card");
        // The reason is shown to the user verbatim, so it must actually say the good news.
        expect(plan!.reason).toMatch(/none was used/i);
    });

    it("ignores host metadata columns when counting the shape", () => {
        // The real wire payload always carries __rowIdx__; a shape that counted it would
        // see two columns and never fire on the case this exists for.
        const plan = planTrivialChart({
            columns: [col("First M-Sector"), col("__rowIdx__")],
            rows: [["Financials", 0]],
        });
        expect(plan?.kind).toBe("card");
        expect(plan?.columnIndex).toBe(0);
    });

    it("claims one categorical column with repeats as a frequency bar", () => {
        const rows = [["a"], ["b"], ["a"], ["c"], ["a"], ["b"]];
        const plan = planTrivialChart({ columns: [col("Sector")], rows });
        expect(plan?.kind).toBe("frequency-bar");
    });

    it("claims one numeric column as a histogram", () => {
        const rows = Array.from({ length: 40 }, (_, i) => [i * 1.5]);
        const plan = planTrivialChart({ columns: [col("Amount", true)], rows });
        expect(plan?.kind).toBe("histogram");
    });

    it("REFUSES two data columns — that is a real choice", () => {
        const plan = planTrivialChart({
            columns: [col("Sector"), col("Amount", true)],
            rows: [["a", 1], ["b", 2]],
        });
        expect(plan).toBeNull();
    });

    it("REFUSES all-distinct categories — every bar would be 1 and say nothing", () => {
        const rows = [["a"], ["b"], ["c"], ["d"]];
        expect(planTrivialChart({ columns: [col("Id")], rows })).toBeNull();
    });

    it("REFUSES high-cardinality categories — top-N vs group-to-other is a judgement", () => {
        const rows: any[][] = [];
        for (let i = 0; i < 200; i++) rows.push(["cat" + (i % 60)]);
        expect(planTrivialChart({ columns: [col("Many")], rows })).toBeNull();
    });

    it("REFUSES a text column falsely flagged as a measure", () => {
        // A host can mark a text column as a measure (a 'First' aggregation over a string).
        // Believing the flag would draw a histogram of words.
        const rows = Array.from({ length: 20 }, () => ["Financials"]);
        const plan = planTrivialChart({ columns: [col("Sector", true)], rows });
        expect(plan?.kind).not.toBe("histogram");
    });

    it("REFUSES an empty dataset", () => {
        expect(planTrivialChart({ columns: [col("X")], rows: [] })).toBeNull();
        expect(planTrivialChart(null)).toBeNull();
    });
});

describe("planTrivialChart — the artifact it emits", () => {
    // The emitted source is what gets persisted, shared inside a report, and possibly
    // opened on a build older than the one that made it. It has to stand alone.
    const ALL = [
        planTrivialChart({ columns: [col("V")], rows: [["x"]] })!,
        planTrivialChart({ columns: [col("Sector")], rows: [["a"], ["b"], ["a"], ["c"], ["a"]] })!,
        planTrivialChart({ columns: [col("Amount", true)], rows: Array.from({ length: 30 }, (_, i) => [i]) })!,
    ];

    it("emits a single top-level render function, the shape every host compiles", () => {
        for (const p of ALL) {
            expect(p.source).toMatch(/^function render\(container, data, options\)/);
        }
    });

    it("emits nothing that needs resolving at load time", () => {
        // No imports, no requires, and no d3 — it must draw before any chart library has
        // loaded and on a host that has none.
        for (const p of ALL) {
            expect(p.source).not.toMatch(/\bimport\s|\brequire\s*\(|\bexport\s/);
            expect(p.source).not.toMatch(/\bd3\./);
        }
    });

    it("the compiled plan IS the emitted source, not a parallel implementation", () => {
        // If these ever diverge, the tests below would be certifying something the user
        // never receives.
        const p = ALL[0];
        const recompiled = compileTrivialSource(p.source);
        const a = dom.window.document.createElement("div");
        const b = dom.window.document.createElement("div");
        p.render(a as any, { columns: [col("V")], rows: [["x"]] }, OPTS);
        recompiled(b as any, { columns: [col("V")], rows: [["x"]] }, OPTS);
        expect(a.innerHTML).toBe(b.innerHTML);
    });
});

describe("planTrivialChart — what it draws", () => {
    it("card shows the value and names the column", () => {
        const plan = planTrivialChart({ columns: [col("First M-Sector")], rows: [["Financials"]] })!;
        plan.render(container, { columns: [col("First M-Sector")], rows: [["Financials"]] }, OPTS);
        const text = container.textContent || "";
        expect(text).toContain("Financials");
        expect(text).toContain("First M-Sector");
    });

    it("card formats a number by culture rather than dumping the raw value", () => {
        const data = { columns: [col("Invoiced Qty", true)], rows: [[186778062]] };
        const plan = planTrivialChart(data)!;
        plan.render(container, data, OPTS);
        expect(container.textContent).toContain("186,778,062");
    });

    it("frequency bars carry the cross-filter grammar, with every row accounted for", () => {
        const rows = [["a"], ["b"], ["a"], ["c"], ["a"], ["b"]];
        const data = { columns: [col("Sector")], rows };
        planTrivialChart(data)!.render(container, data, OPTS);
        const marks = [...container.querySelectorAll("." + MARK_CLASS)];
        expect(marks.length).toBe(3);                       // a, b, c
        // Painted hit targets: an unpainted shape takes no pointer events.
        for (const m of marks) expect(m.getAttribute("fill")).toBe("transparent");
        const claimed = marks
            .flatMap(m => (m.getAttribute(ROW_IDX_ATTR) || "").split(","))
            .filter(s => s !== "").map(Number).sort((x, y) => x - y);
        expect(claimed).toEqual([0, 1, 2, 3, 4, 5]);        // no row is unreachable
    });

    it("histogram bins every value, and the maximum lands inside the last bin", () => {
        const rows = Array.from({ length: 40 }, (_, i) => [i]);
        const data = { columns: [col("Amount", true)], rows };
        planTrivialChart(data)!.render(container, data, OPTS);
        const marks = [...container.querySelectorAll("." + MARK_CLASS)];
        const claimed = marks
            .flatMap(m => (m.getAttribute(ROW_IDX_ATTR) || "").split(","))
            .filter(s => s !== "").map(Number);
        expect(claimed.length).toBe(40);                    // every row is in exactly one bin
        expect(new Set(claimed).size).toBe(40);
    });

    it("histogram survives a constant column instead of dividing by a zero span", () => {
        const rows = Array.from({ length: 12 }, () => [7]);
        const data = { columns: [col("Same", true)], rows };
        const plan = planTrivialChart(data)!;
        expect(() => plan.render(container, data, OPTS)).not.toThrow();
        expect(container.querySelectorAll("." + MARK_CLASS).length).toBe(1);
    });

    it("renders inside the viewport it was given", () => {
        const rows = [["a"], ["b"], ["a"]];
        const data = { columns: [col("Sector")], rows };
        planTrivialChart(data)!.render(container, data, { ...OPTS, width: 300, height: 200 });
        const svg = container.querySelector("svg")!;
        expect(Number(svg.getAttribute("width"))).toBe(300);
        expect(Number(svg.getAttribute("height"))).toBe(200);
    });

    it("re-rendering replaces rather than appends", () => {
        const data = { columns: [col("Sector")], rows: [["a"], ["b"], ["a"]] };
        const plan = planTrivialChart(data)!;
        plan.render(container, data, OPTS);
        plan.render(container, data, OPTS);
        expect(container.querySelectorAll("svg").length).toBe(1);
    });
});
