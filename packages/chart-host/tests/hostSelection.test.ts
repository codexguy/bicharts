// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveOptions } from "../src/defaults";
import { createChartHost, type ChartHost } from "../src/host";
import { createFilter, bindFilter, payloadRowReader } from "../src/filterScope";
import { HOST_CONTRACT_VERSION, CONTAINER_SLOT_HOST_SELECTION, XFILTER_REFRESH_EVENT } from "../src/contract";
import * as pkg from "../src/index";

// WHAT THE HOST HOLDS OF THE SELECTION (contract 1.21.0). A filter that hides selected rows need not drop them: Power BI keeps
// their identities and goes on filtering by them while no mark can show them, and a filter keyed by value does the same. The
// chart is told {rows, hidden}; a chart whose set means "what the reader holds among the rows in view" publishes keepHidden,
// and the hidden held keys stay selected instead of being replaced.

describe("the contract and the option", () => {
    it("is announced and exported", () => {
        expect(HOST_CONTRACT_VERSION).toBe("1.21.0");
        expect(pkg.CONTAINER_SLOT_HOST_SELECTION).toBe("__lchHostSelection");
        expect(typeof pkg.cleanHostSelection).toBe("function");
    });

    it("resolveOptions passes a fact through cleaned, and leaves an absent or junk one absent", () => {
        expect(resolveOptions({}).hostSelection).toBeUndefined();
        for (const junk of [null, 3, "x", {}, { rows: "1,2" }]) expect(resolveOptions({ hostSelection: junk }).hostSelection, String(junk)).toBeUndefined();
        expect(resolveOptions({ hostSelection: { rows: [3, 1, 1, -2, 2.5, "4"], hidden: 2.7 } }).hostSelection).toEqual({ rows: [1, 3], hidden: 2 });
        expect(resolveOptions({ hostSelection: { rows: [], hidden: -1 } }).hostSelection).toEqual({ rows: [], hidden: 0 });
        expect(resolveOptions({ hostSelection: { rows: [0], hidden: 0, narrowed: { published: 5, kept: 3 } } }).hostSelection)
            .toEqual({ rows: [0], hidden: 0, narrowed: { published: 5, kept: 3 } });
        expect(resolveOptions({ hostSelection: { rows: [0], hidden: 0, narrowed: { published: 3, kept: 3 } } }).hostSelection)
            .toEqual({ rows: [0], hidden: 0 });
    });
});

// A chart that draws one mark per row, records the fact each draw hands it, and sets the slot.
const PROBE = `
function render(container, data, options) {
  container.innerHTML = "";
  const doc = container.ownerDocument;
  const at = data.columns.findIndex(c => c.name === "Name");
  (container.__draws = container.__draws || []).push(options.hostSelection);
  container.__lchHostSelection = function (f) { (container.__told = container.__told || []).push(f); };
  for (let r = 0; r < data.rows.length; r++) {
    const m = doc.createElement("div");
    m.className = "d3-mark";
    m.setAttribute("data-row-idx", String(r));
    m.setAttribute("data-name", String(data.rows[r][at]));
    container.appendChild(m);
  }
}`;
const payload = (names: string[]) => ({
    columns: [{ name: "Name", dataType: "String" }, { name: "Score", dataType: "Double", isMeasure: true }],
    rows: names.map((n, i) => [n, i]),
});
const ALL = ["Ada", "Bo", "Cy", "Di", "Ed", "Gus", "Jo"];
const OPEN = ["Ada", "Di", "Gus", "Jo"];

let el: HTMLDivElement;
let host: ChartHost;
let data = payload(ALL);
const told = () => (el as any).__told as any[];
const draws = () => (el as any).__draws as any[];
const publish = (rows: number[], keepHidden?: boolean) =>
    el.dispatchEvent(new CustomEvent(XFILTER_REFRESH_EVENT, { detail: keepHidden ? { rows, source: "user", keepHidden: true } : { rows, source: "user" } }));

beforeEach(async () => {
    el = document.createElement("div");
    document.body.appendChild(el);
    data = payload(ALL);
    host = createChartHost(el, { code: PROBE, data, d3: {}, labelContrast: false });
    await host.render();
});
afterEach(() => { host.destroy(); el.remove(); });

describe("createChartHost tells the chart what it holds", () => {
    it("every draw gets the fact, and a selection change calls the slot", () => {
        expect(draws()[0]).toEqual({ rows: [], hidden: 0 });
        const seen: any[] = [];
        host.selection.onChange((rows, source, meta) => seen.push({ rows, source, meta }));
        publish([0, 3], true);
        expect(seen.at(-1)).toEqual({ rows: [0, 3], source: "user", meta: { keepHidden: true } });
        expect(told().at(-1)).toEqual({ rows: [0, 3], hidden: 0 });
        publish([1]);
        expect(seen.at(-1).meta).toBeUndefined();
    });

    it("setHidden reaches the chart, and a clear resets it", () => {
        publish([0]);
        host.selection.setHidden(2);
        expect(told().at(-1)).toEqual({ rows: [0], hidden: 2 });
        host.selection.clear();
        expect(told().at(-1)).toEqual({ rows: [], hidden: 0 });
    });

    it("a fact the caller states wins over the host's own", async () => {
        host.setOptions({ hostSelection: { rows: [1], hidden: 4 } });
        await host.rendered;
        expect(draws().at(-1)).toEqual({ rows: [1], hidden: 4 });
    });
});

describe("a filter keyed by value, narrowed by another filter (React's useBicFilter)", () => {
    // Keys ANOTHER hand set (the page, another chart) survive new data that does not carry them; a selection THIS chart made
    // is cleared by reconcile (reason "data") when its keys go - the existing rule, unchanged here, so hidden keys in React
    // are always someone else's.
    it("tells the chart how many selected keys its rows cannot show, and keeps them through a keepHidden publish", async () => {
        const f = createFilter("Name");
        const b = bindFilter(host, f, payloadRowReader(() => data));
        f.set(["Ada", "Bo", "Di", "Ed"]);                             // the page selects four
        expect(told().at(-1)).toEqual({ rows: [0, 1, 3, 4], hidden: 0 });
        data = payload(OPEN);                                         // another filter leaves the Open four
        host.setData(data);
        await host.rendered;
        b.reconcile();
        expect(told().at(-1)).toEqual({ rows: [0, 1], hidden: 2 });
        expect(draws().at(-1)).toBeUndefined();                       // new data: no fact until the selection is settled again
        publish([0, 1, 2], true);                                     // tick Gus among the rows in view
        expect([...f.values].sort()).toEqual(["Ada", "Bo", "Di", "Ed", "Gus"]);
        publish([0, 1], false);                                       // a lasso's set means exactly that set
        expect([...f.values].sort()).toEqual(["Ada", "Di"]);
    });

    it("unticking every row in view leaves the hidden keys, not a clear", async () => {
        const f = createFilter("Name");
        const b = bindFilter(host, f, payloadRowReader(() => data));
        f.set(["Ada", "Bo"]);
        data = payload(OPEN);
        host.setData(data);
        await host.rendered;
        b.reconcile();
        publish([], true);
        expect([...f.values]).toEqual(["Bo"]);
    });

    it("a selection this chart made is KEPT when new data drops its keys, and the chart is told how many are hidden", async () => {
        const f = createFilter("Name");
        const seen: string[] = [];
        f.onChange((_, r) => seen.push(r));
        const b = bindFilter(host, f, payloadRowReader(() => data));
        publish([0, 1, 3]);                                           // Ada, Bo, Di, made here
        data = payload(OPEN);                                         // another filter hides Bo
        host.setData(data);
        await host.rendered;
        b.reconcile();
        expect([...f.values].sort()).toEqual(["Ada", "Bo", "Di"]);
        expect(seen).toEqual(["click"]);                              // no "data" clear
        expect(told().at(-1)).toEqual({ rows: [0, 1], hidden: 1 });  // Ada and Di in view, Bo hidden
        publish([0, 1, 2], true);                                     // tick Gus among the rows in view: Bo rides along
        expect([...f.values].sort()).toEqual(["Ada", "Bo", "Di", "Gus"]);
    });

    it("Clear all (the clear form) still clears everything, the hidden keys too", async () => {
        const f = createFilter("Name");
        const b = bindFilter(host, f, payloadRowReader(() => data));
        publish([0, 1]);                                              // Ada, Bo
        data = payload(OPEN);
        host.setData(data);
        await host.rendered;
        b.reconcile();
        expect([...f.values].sort()).toEqual(["Ada", "Bo"]);
        el.dispatchEvent(new CustomEvent(XFILTER_REFRESH_EVENT, { detail: { clear: true, source: "user" } }));
        expect(f.active).toBe(false);
        expect(told().at(-1)).toEqual({ rows: [], hidden: 0 });
    });
});
