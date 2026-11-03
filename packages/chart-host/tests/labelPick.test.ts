// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createChartHost } from "../src/host";
import { bindFilter, createFilter, isAnyValue } from "../src/filterScope";
import { treatAs } from "../src/dax";

// A LABEL PICKS ITS OWN FIELD. A stacked bar of region by stage labels each region on its axis as a `d3-axis-filter`
// carrying the union of that region's rows, while the page's filter is keyed by (Region, Stage). A click on "EMEA"
// became the (EMEA, stage) tuples drawn at that moment, so once another filter cleared and EMEA's other stages came back,
// the region stayed narrowed to the stages that happened to be drawn. A label pick now selects on the label's own field:
// a partial key (EMEA, any stage) that the filter matches, paints, names and passes into a query as just that field.

const CHART = `
function render(container, data, options) {
  container.replaceChildren();
  const doc = container.ownerDocument;
  const byRegion = {};
  data.rows.forEach((r, i) => { (byRegion[r[0]] = byRegion[r[0]] || []).push(i); });
  for (const region of Object.keys(byRegion)) {
    const label = doc.createElement("div");
    label.className = "d3-axis-filter";
    label.setAttribute("data-row-idx", byRegion[region].join(","));
    label.setAttribute("data-region", region);
    label.textContent = region;
    container.appendChild(label);
  }
  data.rows.forEach((r, i) => {
    const m = doc.createElement("div");
    m.className = "d3-mark";
    m.setAttribute("data-row-idx", String(i));
    container.appendChild(m);
  });
}`;
const COLS = [{ name: "Region" }, { name: "Stage" }, { name: "Open" }];
const ROWS = [["EMEA", "1-Qualify", 5], ["EMEA", "2-Develop", 3], ["APAC", "1-Qualify", 4], ["APAC", "2-Develop", 2]];

let els: HTMLElement[] = [];
afterEach(() => { els.forEach(e => e.remove()); els = []; });
function mount(rows = ROWS) {
    const el = document.createElement("div");
    document.body.appendChild(el);
    els.push(el);
    let data = { columns: COLS, rows };
    const host = createChartHost(el, { code: CHART, d3: {}, data: data as any } as any);
    host.render();
    const filter = createFilter(["Region", "Stage"], { label: "Region and stage" });
    const binding = bindFilter(host, filter, {
        rowCount: () => data.rows.length,
        rowAt: i => data.rows[i] ? Object.fromEntries(COLS.map((c, k) => [c.name, data.rows[i][k]])) : null,
    });
    const setData = (next: unknown[][]) => { data = { columns: COLS, rows: next }; host.setData(data as any); binding.reconcile(); };
    return { el, host, filter, binding, setData };
}
const click = (t: Element) => t.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const label = (el: HTMLElement, region: string) => el.querySelector(`.d3-axis-filter[data-region="${region}"]`)!;
const mark = (el: HTMLElement, i: number) => el.querySelector(`.d3-mark[data-row-idx="${i}"]`)!;

describe("a label pick selects on the label's own field", () => {
    it("a region label sets (EMEA, any stage), named EMEA, and its query filters the region alone", () => {
        const { el, filter } = mount();
        click(label(el, "EMEA"));
        expect(filter.keys).toHaveLength(1);
        expect(filter.keys[0][0]).toBe("EMEA");
        expect(isAnyValue(filter.keys[0][1])).toBe(true);
        expect(filter.text).toBe("EMEA");
        expect(filter.has({ Region: "EMEA", Stage: "3-Propose" })).toBe(true);     // a stage not drawn when it was picked
        expect(filter.has({ Region: "APAC", Stage: "1-Qualify" })).toBe(false);
        expect(treatAs(filter, "Accounts[Region]", "Opportunities[PipelineStep]")).toBe(`TREATAS({"EMEA"}, Accounts[Region])`);
    });

    it("a stage that comes back after another filter clears is still in the pick, and painted", () => {
        const { el, filter, setData } = mount([ROWS[0], ROWS[2]]);                 // another filter left one stage drawn
        click(label(el, "EMEA"));
        setData(ROWS.concat([["EMEA", "3-Propose", 1]]));                          // that filter cleared: every stage is back
        expect(filter.keys).toHaveLength(1);
        expect(isAnyValue(filter.keys[0][1])).toBe(true);
        const lit = Array.from(el.querySelectorAll(".d3-mark.lch-mark-selected")).map(m => m.getAttribute("data-row-idx"));
        expect(lit.sort()).toEqual(["0", "1", "4"]);
    });

    it("the same label again clears; a mark still picks its full key", () => {
        const { el, filter } = mount();
        click(label(el, "EMEA"));
        click(label(el, "EMEA"));
        expect(filter.active).toBe(false);
        click(mark(el, 2));
        expect(filter.keys).toEqual([["APAC", "1-Qualify"]]);
    });

    it("a mixed selection goes into a query as one filter over both columns; a saved pick survives JSON", () => {
        const { filter } = mount();
        filter.set([["EMEA", { __bicAny: true }], ["APAC", "2-Develop"]]);
        expect(filter.has({ Region: "EMEA", Stage: "9" })).toBe(true);
        expect(filter.has({ Region: "APAC", Stage: "2-Develop" })).toBe(true);
        expect(filter.has({ Region: "APAC", Stage: "1-Qualify" })).toBe(false);
        expect(treatAs(filter, "Accounts[Region]", "Opportunities[PipelineStep]")).toBe(
            `FILTER(CROSSJOIN(VALUES(Accounts[Region]), VALUES(Opportunities[PipelineStep])), `
            + `(Accounts[Region] = "EMEA") || (Accounts[Region] = "APAC" && Opportunities[PipelineStep] = "2-Develop"))`);
        const again = createFilter(["Region", "Stage"]);
        again.set(JSON.parse(JSON.stringify(filter.keys)));
        expect(again.has({ Region: "EMEA", Stage: "anything" })).toBe(true);
    });

    it("a label whose rows share every key column is an ordinary pick", () => {
        const f = createFilter(["Region"]);
        const { el, host } = mount();
        bindFilter(host, f, { rowCount: () => ROWS.length, rowAt: i => ({ Region: ROWS[i][0], Stage: ROWS[i][1] }) });
        click(label(el, "APAC"));
        expect(f.keys).toEqual([["APAC"]]);
    });
});
