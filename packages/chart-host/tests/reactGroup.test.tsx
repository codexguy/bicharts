// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BicChart, BicChartGroup, useBicSelection } from "../src/react";
import { MARK_SELECTED_CLASS } from "../src/contract";

// THE CROSS-FILTER GROUP, PINNED BY BEHAVIOUR through the React binding's public components.
//
// A group owns one source table and one selection. Every member draws a payload derived from
// the table; a click in one member publishes SOURCE row indices (a filtered member's payload
// renumbers from zero, so its indices are translated on the way out); every other member
// filters (or, asked to, highlights) to that selection; the member that made it never filters
// itself. These cases hold on the React binding as it stood before the group moved into the
// package core, and must hold unchanged after.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Draws one mark per payload row, naming the SOURCE record it carries, and counts its renders
// on the container (the chart empties its children, never its attributes).
const PROBE = `
function render(container, data, options) {
  container.innerHTML = "";
  const doc = container.ownerDocument;
  const nameAt = data.columns.findIndex(c => c.name === "name");
  container.setAttribute("data-renders", String(Number(container.getAttribute("data-renders") || 0) + 1));
  for (let r = 0; r < data.rows.length; r++) {
    const m = doc.createElement("div");
    m.className = "d3-mark";
    m.setAttribute("data-row-idx", String(r));
    m.setAttribute("data-name", String(data.rows[r][nameAt]));
    container.appendChild(m);
  }
}`;

const COLUMNS = [
    { name: "name", dataType: "String", isMeasure: false },
    { name: "v", dataType: "Int64", isMeasure: true },
];
const ROWS = ["r0", "r1", "r2", "r3", "r4"].map((name, i) => ({ name, v: i * 10 }));

let el: HTMLDivElement;
let root: Root;
beforeEach(() => {
    el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
});
afterEach(async () => {
    await act(async () => root.unmount());
    el.remove();
});

/** The chart element a member rendered into, by its class. */
const chart = (cls: string) => el.querySelector(`.${cls}`) as HTMLElement;
const names = (cls: string) => Array.from(chart(cls).querySelectorAll(".d3-mark")).map(m => m.getAttribute("data-name"));
const selectedNames = (cls: string) =>
    Array.from(chart(cls).querySelectorAll(`.d3-mark.${MARK_SELECTED_CLASS}`)).map(m => m.getAttribute("data-name"));
const renders = (cls: string) => Number(chart(cls).getAttribute("data-renders") || 0);
const markNamed = (cls: string, name: string) =>
    chart(cls).querySelector(`.d3-mark[data-name="${name}"]`) as HTMLElement;
const click = async (target: Element, mod?: "ctrlKey") => {
    await act(async () => {
        target.dispatchEvent(new MouseEvent("click", { bubbles: true, ...(mod ? { [mod]: true } : {}) } as any));
    });
};

/** A probe of the group's selection, as a page reads it. */
let lastSel: { rows: number[]; sourceId: string | null; clear: () => void } | null = null;
function SelectionProbe() {
    const s = useBicSelection();
    useEffect(() => { lastSel = s; });
    return null;
}

type Member = { id?: string; cls: string; filteredBy?: string; respondsWith?: "filter" | "highlight"; onSelect?: (r: number[]) => void };

async function mountGroup(members: Member[], rows = ROWS) {
    lastSel = null;
    const tree = () => createElement(BicChartGroup, { rows, columns: COLUMNS },
        createElement(SelectionProbe),
        ...members.map(m => createElement(BicChart, {
            key: m.cls, id: m.id, code: PROBE, d3: {}, className: m.cls,
            filteredBy: m.filteredBy, respondsWith: m.respondsWith, onSelect: m.onSelect,
            labelContrast: false,
        })));
    await act(async () => { root.render(tree()); });
}

describe("a group member draws the source table and filters to a sibling's selection", () => {
    it("with no selection every member draws every source row", async () => {
        await mountGroup([{ id: "a", cls: "ca" }, { id: "b", cls: "cb" }]);
        expect(names("ca")).toEqual(["r0", "r1", "r2", "r3", "r4"]);
        expect(names("cb")).toEqual(["r0", "r1", "r2", "r3", "r4"]);
        // Once each. (Until 2026-09-24 twice: the data effect handed the payload the host was just
        // built with straight back to setData - measured and pinned by the move, fixed on its own.)
        expect(renders("ca")).toBe(1);
        expect(renders("cb")).toBe(1);
        expect(lastSel!.rows).toEqual([]);
        expect(lastSel!.sourceId).toBeNull();
    });

    it("a click in one member filters the other to the source rows it picked", async () => {
        const seenA: number[][] = [];
        await mountGroup([{ id: "a", cls: "ca", onSelect: r => seenA.push(r) }, { id: "b", cls: "cb" }]);
        await click(markNamed("ca", "r2"));
        expect(lastSel!.sourceId).toBe("a");
        expect(lastSel!.rows).toEqual([2]);
        expect(seenA).toEqual([[2]]);
        expect(names("cb")).toEqual(["r2"]);
        // The member that made the selection NEVER filters itself: every mark stays, the picked
        // one painted as selected, so there is always something left to click.
        expect(names("ca")).toEqual(["r0", "r1", "r2", "r3", "r4"]);
        expect(selectedNames("ca")).toEqual(["r2"]);
    });

    it("a filtered member's click publishes SOURCE rows, not its renumbered payload rows", async () => {
        const seenB: number[][] = [];
        await mountGroup([{ id: "a", cls: "ca" }, { id: "b", cls: "cb", onSelect: r => seenB.push(r) }]);
        await click(markNamed("ca", "r1"));
        await click(markNamed("ca", "r3"), "ctrlKey");
        expect(lastSel!.rows.slice().sort()).toEqual([1, 3]);
        expect(names("cb")).toEqual(["r1", "r3"]);
        // r3 is payload row 1 in b; the group must hear source row 3.
        await click(markNamed("cb", "r3"));
        expect(seenB).toEqual([[3]]);
        expect(lastSel!.sourceId).toBe("b");
        expect(lastSel!.rows).toEqual([3]);
        expect(names("ca")).toEqual(["r3"]);
        // b is now the origin, so it stops filtering and draws the whole table again.
        expect(names("cb")).toEqual(["r0", "r1", "r2", "r3", "r4"]);
    });

    it("a filtered member that becomes the origin paints the record it clicked", async () => {
        // b was filtered to [r1, r3], and its click on r3 was payload row 1. Becoming the origin it
        // re-derives the WHOLE table, where payload row 1 is r1 - so the selection it holds is
        // repainted through the new row map. (It used to paint r1: pinned as a known defect by the
        // move into the core, fixed on its own.)
        await mountGroup([{ id: "a", cls: "ca" }, { id: "b", cls: "cb" }]);
        await click(markNamed("ca", "r1"));
        await click(markNamed("ca", "r3"), "ctrlKey");
        await click(markNamed("cb", "r3"));
        expect(lastSel!.rows).toEqual([3]);
        expect(selectedNames("cb")).toEqual(["r3"]);
        // And the selection it holds is in the new payload's rows: growing it adds the right record.
        await click(markNamed("cb", "r4"), "ctrlKey");
        expect(lastSel!.rows.slice().sort()).toEqual([3, 4]);
        expect(selectedNames("cb")).toEqual(["r3", "r4"]);
        expect(names("ca")).toEqual(["r3", "r4"]);
    });

    it("clearing the selection in the originating member unfilters every sibling", async () => {
        await mountGroup([{ id: "a", cls: "ca" }, { id: "b", cls: "cb" }]);
        await click(markNamed("ca", "r2"));
        expect(names("cb")).toEqual(["r2"]);
        await click(markNamed("ca", "r2"));   // clicking the selected mark again clears it
        expect(lastSel!.rows).toEqual([]);
        expect(lastSel!.sourceId).toBeNull();
        expect(names("cb")).toEqual(["r0", "r1", "r2", "r3", "r4"]);
    });

    it("the page's clear drops the filter AND the origin's own highlight", async () => {
        await mountGroup([{ id: "a", cls: "ca" }, { id: "b", cls: "cb" }]);
        await click(markNamed("ca", "r4"));
        expect(selectedNames("ca")).toEqual(["r4"]);
        await act(async () => { lastSel!.clear(); });
        expect(lastSel!.rows).toEqual([]);
        expect(names("cb")).toEqual(["r0", "r1", "r2", "r3", "r4"]);
        expect(selectedNames("ca")).toEqual([]);
    });

    it("a selection made elsewhere clears a member's stale highlight", async () => {
        await mountGroup([{ id: "a", cls: "ca" }, { id: "b", cls: "cb" }]);
        await click(markNamed("ca", "r0"));
        expect(selectedNames("ca")).toEqual(["r0"]);
        await click(markNamed("cb", "r0"));
        expect(lastSel!.sourceId).toBe("b");
        expect(selectedNames("ca")).toEqual([]);
        expect(names("ca")).toEqual(["r0"]);
    });
});

describe("member options", () => {
    it("filteredBy wires a member to ONE partner: another sibling's selection leaves it whole", async () => {
        await mountGroup([{ id: "a", cls: "ca" }, { id: "b", cls: "cb" }, { id: "c", cls: "cc", filteredBy: "a" }]);
        await click(markNamed("cb", "r1"));
        expect(names("cc")).toEqual(["r0", "r1", "r2", "r3", "r4"]);
        expect(names("ca")).toEqual(["r1"]);
        await click(markNamed("ca", "r1"));   // a is filtered to r1; its only mark is source row 1
        expect(lastSel!.sourceId).toBe("a");
        expect(names("cc")).toEqual(["r1"]);
    });

    it("respondsWith highlight keeps every row and paints the sibling's selection instead", async () => {
        await mountGroup([{ id: "t", cls: "ct" }, { id: "m", cls: "cm", respondsWith: "highlight" }]);
        await click(markNamed("ct", "r3"));
        expect(names("cm")).toEqual(["r0", "r1", "r2", "r3", "r4"]);
        expect(selectedNames("cm")).toEqual(["r3"]);
        await act(async () => { lastSel!.clear(); });
        expect(selectedNames("cm")).toEqual([]);
    });

    it("a highlight member's own click publishes, and the painted selection it held is not republished", async () => {
        await mountGroup([{ id: "t", cls: "ct" }, { id: "m", cls: "cm", respondsWith: "highlight" }]);
        await click(markNamed("ct", "r3"));
        expect(lastSel!.sourceId).toBe("t");      // painting r3 in m did not steal the selection
        await click(markNamed("cm", "r1"));
        expect(lastSel!.sourceId).toBe("m");
        expect(lastSel!.rows).toEqual([1]);
        expect(names("ct")).toEqual(["r1"]);
    });

    it("a member with no id is filtered by its siblings but never publishes; onSelect still hears it", async () => {
        const seen: number[][] = [];
        await mountGroup([{ id: "a", cls: "ca" }, { cls: "cn", onSelect: r => seen.push(r) }]);
        await click(markNamed("cn", "r2"));
        expect(seen).toEqual([[2]]);
        expect(lastSel!.rows).toEqual([]);
        expect(names("ca")).toEqual(["r0", "r1", "r2", "r3", "r4"]);
        await click(markNamed("ca", "r4"));
        expect(names("cn")).toEqual(["r4"]);
    });
});

describe("what a selection change costs", () => {
    it("only a member whose rows change re-renders; the origin and a highlight member are repainted", async () => {
        // A filtered member's rows change, so it redraws. The origin keeps every row and a
        // highlight member keeps every row by design - both are repainted, never redrawn, so a map
        // keeps its projection and zoom. (Until 2026-09-24 every member redrew on every selection
        // change: its payload was re-derived whenever the selection moved - measured and pinned by
        // the move into the core, fixed on its own.)
        await mountGroup([{ id: "a", cls: "ca" }, { id: "b", cls: "cb" }, { id: "m", cls: "cm", respondsWith: "highlight" }]);
        expect([renders("ca"), renders("cb"), renders("cm")]).toEqual([1, 1, 1]);
        await click(markNamed("ca", "r2"));
        expect([renders("ca"), renders("cb"), renders("cm")]).toEqual([1, 2, 1]);
        expect(selectedNames("ca")).toEqual(["r2"]);
        expect(selectedNames("cm")).toEqual(["r2"]);
        await click(markNamed("ca", "r4"), "ctrlKey");
        expect([renders("ca"), renders("cb"), renders("cm")]).toEqual([1, 3, 1]);
        await act(async () => { lastSel!.clear(); });
        expect([renders("ca"), renders("cb"), renders("cm")]).toEqual([1, 4, 1]);
        expect(selectedNames("ca")).toEqual([]);
        expect(selectedNames("cm")).toEqual([]);
    });

    it("a live restyle is one redraw, and the options the chart was built with are not handed back", async () => {
        const opts = { width: 300, height: 200 };
        const d3 = {};   // one d3 for the chart's life, as a page holds it: a new one is a rebuild
        const tree = (o: object) => createElement(BicChartGroup, { rows: ROWS, columns: COLUMNS },
            createElement(BicChart, { key: "a", id: "a", code: PROBE, d3, className: "ca", options: o, labelContrast: false }));
        await act(async () => { root.render(tree(opts)); });
        expect(renders("ca")).toBe(1);
        await act(async () => { root.render(tree({ ...opts })); });   // equal options, new object
        expect(renders("ca")).toBe(1);
        await act(async () => { root.render(tree({ ...opts, width: 320 })); });
        expect(renders("ca")).toBe(2);
    });
});

describe("the source table changes under a live selection", () => {
    it("members re-derive from the new rows and the selection's source indices are kept", async () => {
        const Host = () => {
            const [rows, setRows] = useState(ROWS);
            useEffect(() => { (globalThis as any).__setRows = setRows; }, []);
            return createElement(BicChartGroup, { rows, columns: COLUMNS },
                createElement(SelectionProbe),
                createElement(BicChart, { key: "a", id: "a", code: PROBE, d3: {}, className: "ca", labelContrast: false }),
                createElement(BicChart, { key: "b", id: "b", code: PROBE, d3: {}, className: "cb", labelContrast: false }));
        };
        await act(async () => { root.render(createElement(Host)); });
        await click(markNamed("ca", "r1"));
        expect(names("cb")).toEqual(["r1"]);
        const next = ["s0", "s1", "s2"].map((name, i) => ({ name, v: i }));
        await act(async () => { (globalThis as any).__setRows(next); });
        expect(lastSel!.rows).toEqual([1]);
        expect(names("ca")).toEqual(["s0", "s1", "s2"]);
        expect(names("cb")).toEqual(["s1"]);
    });
});
