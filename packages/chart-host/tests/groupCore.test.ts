// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createChartGroup, toSourceRows, assembleD3, createChartHost, type ChartGroup, type ChartHost } from "../src/index";
import { MARK_SELECTED_CLASS } from "../src/contract";

// THE CROSS-FILTER GROUP WITHOUT REACT - the path a plain page or a Blazor app over JS interop
// takes. The same rules the React binding's tests pin (reactGroup.test.tsx), reached through
// createChartGroup + createChartHost + attach, with no framework in between.

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

describe("the group's rules, as pure functions of its selection", () => {
    it("a member is never filtered by its own selection, and filteredBy listens to one partner", () => {
        const g = createChartGroup(COLUMNS, ROWS);
        expect(g.incomingFor("a")).toBeNull();
        g.publish("a", [1, 3]);
        expect(g.incomingFor("a")).toBeNull();
        expect(g.incomingFor("b")).toEqual([1, 3]);
        expect(g.incomingFor(undefined)).toEqual([1, 3]);
        expect(g.incomingFor("c", "a")).toEqual([1, 3]);
        expect(g.incomingFor("c", "b")).toBeNull();
    });

    it("a payload for a subset carries the payload-row -> source-row map", () => {
        const g = createChartGroup(COLUMNS, ROWS);
        const { payload, rowMap } = g.payloadFor([4, 1]);
        expect(rowMap).toEqual([4, 1]);
        expect(payload.rows.map(r => r[0])).toEqual(["r4", "r1"]);
        expect(g.payloadFor(null).rowMap).toEqual([0, 1, 2, 3, 4]);
        expect(toSourceRows([4, 1], [1, 0, 7])).toEqual([1, 4]);
        expect(toSourceRows(null, [2])).toEqual([2]);
    });

    it("memberPayload applies the member's options: a highlight member keeps every row", () => {
        const g = createChartGroup(COLUMNS, ROWS);
        g.publish("a", [2]);
        expect(g.memberPayload("b").rowMap).toEqual([2]);
        expect(g.memberPayload("b", { respondsWith: "highlight" }).rowMap).toEqual([0, 1, 2, 3, 4]);
        expect(g.memberPayload("a").rowMap).toEqual([0, 1, 2, 3, 4]);
    });

    it("an empty publish clears; every publish and clear is a new selection object; a new table keeps it", () => {
        const g = createChartGroup(COLUMNS, ROWS);
        const seen: string[] = [];
        g.onChange((s, change) => seen.push(`${change}:${s.sourceId}:${s.rows.join(",")}`));
        g.publish("a", [1]);
        const first = g.selection;
        g.publish("a", []);
        expect(g.selection.sourceId).toBeNull();
        g.clear();
        expect(g.selection).not.toBe(first);
        g.publish("b", [0]);
        const before = g.selection;
        g.setSource(COLUMNS, ROWS.slice(0, 2));
        expect(g.selection).toBe(before);
        expect(g.rows.length).toBe(2);
        expect(seen).toEqual(["select:a:1", "clear:null:", "clear:null:", "select:b:0", "source:b:0"]);
    });
});

describe("attach: live chart hosts coordinated by the group", () => {
    let els: HTMLElement[];
    let group: ChartGroup;
    beforeEach(() => { els = []; group = createChartGroup(COLUMNS, ROWS); });
    afterEach(() => { group.destroy(); els.forEach(e => e.remove()); });

    function member(id: string | undefined, opts: { filteredBy?: string; respondsWith?: "filter" | "highlight"; onSelect?: (r: number[]) => void } = {}) {
        const el = document.createElement("div");
        document.body.appendChild(el);
        els.push(el);
        const host: ChartHost = createChartHost(el, { code: PROBE, d3: {}, data: group.memberPayload(id, opts).payload, labelContrast: false });
        host.render();
        const m = group.attach(id, host, opts);
        return { el, host, m };
    }
    const names = (el: HTMLElement) => Array.from(el.querySelectorAll(".d3-mark")).map(m => m.getAttribute("data-name"));
    const selected = (el: HTMLElement) =>
        Array.from(el.querySelectorAll(`.d3-mark.${MARK_SELECTED_CLASS}`)).map(m => m.getAttribute("data-name"));
    const click = (el: HTMLElement, name: string, mod?: "ctrlKey") =>
        (el.querySelector(`.d3-mark[data-name="${name}"]`) as HTMLElement)
            .dispatchEvent(new MouseEvent("click", { bubbles: true, ...(mod ? { [mod]: true } : {}) } as any));

    it("a click filters the sibling and never the origin; the page hears SOURCE rows", () => {
        const heard: number[][] = [];
        group.onChange(s => heard.push(s.rows.slice()));
        const a = member("a");
        const b = member("b");
        click(a.el, "r2");
        expect(heard.at(-1)).toEqual([2]);
        expect(names(b.el)).toEqual(["r2"]);
        expect(names(a.el)).toEqual(["r0", "r1", "r2", "r3", "r4"]);
        expect(selected(a.el)).toEqual(["r2"]);
    });

    it("a filtered member's click is translated to source rows", () => {
        const seenB: number[][] = [];
        const a = member("a");
        const b = member("b", { onSelect: r => seenB.push(r) });
        click(a.el, "r1");
        click(a.el, "r3", "ctrlKey");
        expect(names(b.el)).toEqual(["r1", "r3"]);
        click(b.el, "r3");
        expect(seenB).toEqual([[3]]);
        expect(group.selection).toEqual({ sourceId: "b", rows: [3] });
        expect(names(a.el)).toEqual(["r3"]);
        // Becoming the origin re-derived b's payload; the record it clicked is still the one painted,
        // and growing the selection adds the record clicked.
        expect(selected(b.el)).toEqual(["r3"]);
        click(b.el, "r0", "ctrlKey");
        expect(group.selection.rows.slice().sort()).toEqual([0, 3]);
        expect(selected(b.el)).toEqual(["r0", "r3"]);
        expect(names(b.el)).toEqual(["r0", "r1", "r2", "r3", "r4"]);
    });

    it("clear drops every filter and the origin's own highlight", () => {
        const a = member("a");
        const b = member("b");
        click(a.el, "r4");
        group.clear();
        expect(names(b.el)).toEqual(["r0", "r1", "r2", "r3", "r4"]);
        expect(selected(a.el)).toEqual([]);
    });

    it("highlight keeps every row and paints; its painted selection is not republished", () => {
        const t = member("t");
        const m = member("m", { respondsWith: "highlight" });
        click(t.el, "r3");
        expect(names(m.el)).toEqual(["r0", "r1", "r2", "r3", "r4"]);
        expect(selected(m.el)).toEqual(["r3"]);
        expect(group.selection.sourceId).toBe("t");
        click(m.el, "r1");
        expect(group.selection).toEqual({ sourceId: "m", rows: [1] });
        expect(names(t.el)).toEqual(["r1"]);
    });

    it("filteredBy listens to one partner; a member with no id never publishes", () => {
        const heard: number[] = [];
        const a = member("a");
        const b = member(undefined, { onSelect: r => heard.push(...r) });
        const c = member("c", { filteredBy: "a" });
        click(b.el, "r2");
        expect(heard).toEqual([2]);
        expect(group.selection.rows).toEqual([]);
        click(a.el, "r0");
        expect(names(c.el)).toEqual(["r0"]);
        expect(names(b.el)).toEqual(["r0"]);
    });

    it("only a member whose rows change is redrawn; the origin and a highlight member are repainted", () => {
        const renders = (el: HTMLElement) => Number(el.getAttribute("data-renders") || 0);
        const a = member("a");
        const b = member("b");
        const m = member("m", { respondsWith: "highlight" });
        const c = member("c", { filteredBy: "b" });
        expect([a, b, m, c].map(x => renders(x.el))).toEqual([1, 1, 1, 1]);
        click(a.el, "r2");
        // b filters (redraw); a is the origin, m highlights, c listens to b only - all repainted.
        expect([a, b, m, c].map(x => renders(x.el))).toEqual([1, 2, 1, 1]);
        expect(selected(m.el)).toEqual(["r2"]);
        group.clear();
        expect([a, b, m, c].map(x => renders(x.el))).toEqual([1, 3, 1, 1]);
        expect(selected(a.el)).toEqual([]);
        // A new source table redraws every member.
        group.setSource(COLUMNS, ROWS.slice(0, 3));
        expect([a, b, m, c].map(x => renders(x.el))).toEqual([2, 4, 2, 2]);
    });

    it("detach unwires a member: its clicks stop publishing and the group stops redrawing it", () => {
        const a = member("a");
        const b = member("b");
        b.m.detach();
        click(b.el, "r1");
        expect(group.selection.rows).toEqual([]);
        click(a.el, "r2");
        expect(names(b.el)).toEqual(["r0", "r1", "r2", "r3", "r4"]);
    });

    it("a new source table re-derives every attached member under the kept selection", () => {
        const a = member("a");
        const b = member("b");
        click(a.el, "r1");
        group.setSource(COLUMNS, ["s0", "s1", "s2"].map((name, i) => ({ name, v: i })));
        expect(names(a.el)).toEqual(["s0", "s1", "s2"]);
        expect(names(b.el)).toEqual(["s1"]);
    });
});

describe("assembleD3", () => {
    it("one extensible object from d3 and its plugins, later arguments winning", () => {
        const base = Object.freeze({ select: () => "d3", version: "7" });
        const sankeyNs = Object.freeze({ sankey: () => "sankey" });
        const d3 = assembleD3(base, sankeyNs, { version: "7-local" });
        expect(d3.select()).toBe("d3");
        expect(d3.sankey()).toBe("sankey");
        expect(d3.version).toBe("7-local");
        d3.llmHelper = 1;   // a chart installs its helpers onto the d3 it is given
        expect(d3.llmHelper).toBe(1);
        expect(Object.isFrozen(d3)).toBe(false);
    });
});
