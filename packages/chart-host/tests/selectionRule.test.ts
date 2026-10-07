// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createChartHost } from "../src/host";
import {
    MARK_SELECTED_CLASS, SELECTION_ACTIVE_CLASS, SELECTION_RULE_ATTR, SELECTION_RULE_CLICKED_MARKS,
    MARK_KEY_ATTR, CONTAINER_SLOT_CLICKED_MARKS,
} from "../src/contract";
import { selectionRuleOf, markKeyOf, planSelectionPaint, nextClickedMarks } from "../src/selection";
import * as pkg from "../src/index";

// A DECLARED SELECTION RULE: "clicked-marks".
//
// A word cloud tokenised from a comment column gives each word the list of rows containing it, and
// the words share rows: on a 7,745-comment column every word shares a comment with every other. The
// default rule lights a mark when ANY of its rows is selected, so one click lit all 100 words. The
// cross-filter to other visuals was exact; only the chart's own highlight was wrong. A chart that
// declares "clicked-marks" lights exactly the marks the reader clicked and dims the rest.
//
// Fixture words (rows): next 0,1,2,3 | refund 1,2 (inside next's rows) | late 3,4 | price 5.

const WORDS: Array<[string, string]> = [["next", "0,1,2,3"], ["refund", "1,2"], ["late", "3,4"], ["price", "5"]];

const chart = (declare: boolean, withKeys = true) => `
function render(container, data, options) {
  const doc = container.ownerDocument;
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  ${declare ? `svg.setAttribute("${SELECTION_RULE_ATTR}", "${SELECTION_RULE_CLICKED_MARKS}");` : ""}
  container.appendChild(svg);
  for (const [w, rows] of ${JSON.stringify(WORDS)}) {
    const t = doc.createElementNS("http://www.w3.org/2000/svg", "text");
    t.setAttribute("class", "word d3-mark");
    t.setAttribute("data-row-idx", rows);
    ${withKeys ? `t.setAttribute("${MARK_KEY_ATTR}", w);` : ""}
    t.textContent = w;
    svg.appendChild(t);
  }
}`;

const ROWS = [["a"], ["b"], ["c"], ["d"], ["e"], ["f"]];

describe("the selection-rule predicate (pure)", () => {
    const marks = WORDS.map(([key, rows]) => ({ key, rows: rows.split(",").map(Number) }));
    const lit = (on: boolean[]) => marks.filter((_, i) => on[i]).map(m => m.key);

    it("reads the declaration off any element the chart drew, and defaults to any-row", () => {
        const c = document.createElement("div");
        expect(selectionRuleOf(c)).toBe("any-row");
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        c.appendChild(svg);
        expect(selectionRuleOf(c)).toBe("any-row");
        svg.setAttribute(SELECTION_RULE_ATTR, "something-else");
        expect(selectionRuleOf(c)).toBe("any-row");
        svg.setAttribute(SELECTION_RULE_ATTR, SELECTION_RULE_CLICKED_MARKS);
        expect(selectionRuleOf(c)).toBe("clicked-marks");
        expect(selectionRuleOf(null)).toBe("any-row");
    });

    it("names a mark by its key, else by its row list", () => {
        const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
        t.setAttribute("data-row-idx", "1,2");
        const byRows = markKeyOf(t);
        t.setAttribute(MARK_KEY_ATTR, "refund");
        expect(markKeyOf(t)).toBe("refund");
        expect(byRows).not.toBe("refund");
        expect(byRows).toContain("1,2");
    });

    it("any-row (the default) lights every mark that shares a selected row - today's rule", () => {
        const p = planSelectionPaint(marks, [0, 1, 2, 3], "any-row", null);
        expect(lit(p.on)).toEqual(["next", "refund", "late"]);
        expect(p.mode).toBe("any-row");
    });

    it("clicked-marks: a click on a word lights that word only, even with another word's rows inside it", () => {
        const clicked = nextClickedMarks(null, [], "next", [0, 1, 2, 3]);
        const p = planSelectionPaint(marks, [0, 1, 2, 3], "clicked-marks", clicked);
        expect(lit(p.on)).toEqual(["next"]);
        expect(p.mode).toBe("clicked");
    });

    it("Ctrl adds a mark to the clicked set and Ctrl again takes it off", () => {
        let c = nextClickedMarks(null, [], "next", [0, 1, 2, 3]);
        c = nextClickedMarks(c, [0, 1, 2, 3], "price", [0, 1, 2, 3, 5], { ctrl: true });
        expect(lit(planSelectionPaint(marks, [0, 1, 2, 3, 5], "clicked-marks", c).on)).toEqual(["next", "price"]);
        c = nextClickedMarks(c, [0, 1, 2, 3, 5], "next", [5], { ctrl: true });
        expect(lit(planSelectionPaint(marks, [5], "clicked-marks", c).on)).toEqual(["price"]);
        expect(nextClickedMarks(c, [5], "price", [], { ctrl: true })).toBeNull();
    });

    it("a selection nobody clicked here lights the marks whose rows EQUAL it", () => {
        const p = planSelectionPaint(marks, [4, 3], "clicked-marks", null);
        expect(lit(p.on)).toEqual(["late"]);
        expect(p.mode).toBe("exact");
    });

    it("clicked keys recorded for a DIFFERENT selection are not used", () => {
        const stale = nextClickedMarks(null, [], "next", [0, 1, 2, 3]);
        const p = planSelectionPaint(marks, [1, 2], "clicked-marks", stale);
        expect(lit(p.on)).toEqual(["refund"]);
        expect(p.mode).toBe("exact");
    });

    it("with no clicked mark and no exact match it falls back to any-row, and says so", () => {
        const p = planSelectionPaint(marks, [0, 5], "clicked-marks", null);
        expect(lit(p.on)).toEqual(["next", "price"]);
        expect(p.mode).toBe("fallback-any-row");
    });

    it("an empty selection lights nothing under either rule", () => {
        expect(planSelectionPaint(marks, [], "clicked-marks", null).on.some(Boolean)).toBe(false);
        expect(planSelectionPaint(marks, [], "any-row", null).on.some(Boolean)).toBe(false);
    });

    it("is exported from the package entry", () => {
        for (const n of ["selectionRuleOf", "markKeyOf", "planSelectionPaint", "nextClickedMarks",
            "SELECTION_RULE_ATTR", "SELECTION_RULE_CLICKED_MARKS", "MARK_KEY_ATTR", "CONTAINER_SLOT_CLICKED_MARKS"]) {
            expect((pkg as any)[n], n).toBeDefined();
        }
    });
});

describe("createChartHost applies the declared rule", () => {
    let container: HTMLElement;
    let seen: number[][];
    let reports: any[];

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        seen = [];
        reports = [];
    });
    afterEach(() => container.remove());

    const host = (declare: boolean, withKeys = true) => {
        const h = createChartHost(container, {
            data: { columns: [{ name: "c", dataType: "Text", isMeasure: false }], rows: ROWS },
            code: chart(declare, withKeys), d3: {},
            onSelectionPaint: r => reports.push(r),
        } as any);
        h.selection.onChange(rows => seen.push(rows.slice().sort((a, b) => a - b)));
        h.render();
        return h;
    };
    const word = (w: string) => Array.from(container.querySelectorAll(".d3-mark"))
        .find(m => m.textContent === w) as Element;
    const click = (w: string, ctrl = false) =>
        word(w).dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: ctrl }));
    const lit = () => Array.from(container.querySelectorAll(`.d3-mark.${MARK_SELECTED_CLASS}`)).map(m => m.textContent);

    it("undeclared: a click lights every word sharing a row (today's rule, unchanged)", () => {
        host(false);
        click("next");
        expect(seen.at(-1)).toEqual([0, 1, 2, 3]);
        expect(lit()).toEqual(["next", "refund", "late"]);
        expect(reports).toEqual([]);
    });

    it("declared: a click lights the clicked word only and dims the rest; the wire is unchanged", () => {
        host(true);
        click("next");
        expect(seen.at(-1)).toEqual([0, 1, 2, 3]);
        expect(lit()).toEqual(["next"]);
        expect(container.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(true);
    });

    it("declared: a click on a word whose rows sit inside another's lights that word only", () => {
        host(true);
        click("refund");
        expect(seen.at(-1)).toEqual([1, 2]);
        expect(lit()).toEqual(["refund"]);
    });

    it("declared: Ctrl-click adds and removes words; the host still toggles rows on the wire", () => {
        host(true);
        click("next");
        click("price", true);
        expect(seen.at(-1)).toEqual([0, 1, 2, 3, 5]);
        expect(lit()).toEqual(["next", "price"]);
        click("next", true);
        expect(seen.at(-1)).toEqual([5]);
        expect(lit()).toEqual(["price"]);
    });

    it("declared: a clear undims everything", () => {
        const h = host(true);
        click("next");
        h.selection.clear();
        expect(lit()).toEqual([]);
        expect(container.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(false);
        expect((container as any)[CONTAINER_SLOT_CLICKED_MARKS] ?? null).toBeNull();
    });

    it("declared: a re-render with the same selection re-lights the clicked word", () => {
        const h = host(true);
        click("next");
        h.setOptions({});
        expect(lit()).toEqual(["next"]);
    });

    it("declared: a host re-created on the same element keeps the clicked word", () => {
        const h = host(true);
        click("next");
        h.destroy();
        const h2 = host(true);
        h2.selection.highlight([0, 1, 2, 3]);
        expect(lit()).toEqual(["next"]);
    });

    it("declared: a selection handed in lights the word whose rows equal it", () => {
        const h = host(true);
        h.selection.highlight([3, 4]);
        expect(lit()).toEqual(["late"]);
        expect(reports.at(-1)).toMatchObject({ rule: "clicked-marks", mode: "exact", lit: 1 });
    });

    it("declared: with no equal word it falls back to any-row and reports the fallback", () => {
        const h = host(true);
        h.selection.highlight([0, 5]);
        expect(lit()).toEqual(["next", "price"]);
        expect(reports.at(-1)).toMatchObject({ rule: "clicked-marks", mode: "fallback-any-row" });
    });

    it("declared without per-mark keys: the row list names the mark", () => {
        host(true, false);
        click("next");
        expect(lit()).toEqual(["next"]);
    });
});
