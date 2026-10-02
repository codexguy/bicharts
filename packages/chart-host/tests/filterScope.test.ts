// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createFilter, createFilterScope, bindFilter, payloadRowReader, fromVegaInteraction,
         type FilterChangeReason } from "../src/filterScope";
import { createChartHost, type ChartHost } from "../src/host";
import { MARK_SELECTED_CLASS } from "../src/contract";

// THE PAGE'S FILTERS: a selection kept by column VALUES, with every change reported and why.
// Five of five agent-built apps wired this by hand and each got some of it wrong - an empty
// selection ignored (a second click never un-filtered), a page Clear that left the marks lit, a
// re-query that dropped the chart's selection while the page still showed it. These pin the rules
// the library now owns.

describe("a filter keyed by one column", () => {
    it("selects rows by their key, reports why, and clears", () => {
        const f = createFilter("CountryCode", { label: "Country", display: "Country" });
        const seen: FilterChangeReason[] = [];
        f.onChange((_, r) => seen.push(r));
        expect(f.active).toBe(false);
        expect(f.value).toBeNull();
        f.selectRows([{ CountryCode: "AUS", Country: "Australia", Revenue: 9 }], "click");
        expect(f.active).toBe(true);
        expect(f.value).toBe("AUS");
        expect(f.values).toEqual(["AUS"]);
        expect(f.row?.Country).toBe("Australia");
        expect(f.text).toBe("Australia");
        f.clear();
        expect(f.active).toBe(false);
        expect(f.row).toBeNull();
        expect(seen).toEqual(["click", "page"]);
    });

    it("notifies nobody when a change changes nothing (so a repaint can't loop)", () => {
        const f = createFilter("CountryCode");
        let n = 0;
        f.onChange(() => n++);
        f.clear();
        f.set("AUS");
        f.set(["AUS"]);
        f.selectRows([{ CountryCode: "AUS" }]);
        expect(n).toBe(1);
        expect(f.version).toBe(1);
    });

    it("sets by value, with or without arrays, and keeps known rows for the chip", () => {
        const f = createFilter("CountryCode", { display: "Country" });
        f.selectRows([{ CountryCode: "AUS", Country: "Australia" }, { CountryCode: "CHL", Country: "Chile" }]);
        expect(f.text).toBe("Australia, Chile");
        f.set(["AUS"]);
        expect(f.text).toBe("Australia");
        f.set("IND");
        expect(f.text).toBe("IND");
    });

    it("keeps the rows that carry the key - any of several columns, for a route table", () => {
        const f = createFilter("CountryCode");
        const lanes = [
            { OriginCountryCode: "IND", DestinationCountryCode: "AUS" },
            { OriginCountryCode: "AUS", DestinationCountryCode: "CHL" },
            { OriginCountryCode: "CHN", DestinationCountryCode: "USA" },
        ];
        const cols = ["OriginCountryCode", "DestinationCountryCode"];
        expect(f.keep(lanes, cols)).toHaveLength(3);
        f.set("AUS");
        const a = f.keep(lanes, cols);
        expect(a.map(l => l.OriginCountryCode)).toEqual(["IND", "AUS"]);
        // The same array while nothing changed - safe to call in a render.
        expect(f.keep(lanes, cols)).toBe(a);
        f.set("CHN");
        expect(f.keep(lanes, cols)).not.toBe(a);
    });
});

describe("a filter keyed by several columns (a route)", () => {
    it("matches the whole key, and shows both ends", () => {
        const f = createFilter(["OriginCountryCode", "DestinationCountryCode"],
                               { label: "Lane", display: ["OriginCountry", "DestinationCountry"] });
        f.selectRows([{ OriginCountryCode: "IND", DestinationCountryCode: "CHL", OriginCountry: "India", DestinationCountry: "Chile" }]);
        expect(f.keys).toEqual([["IND", "CHL"]]);
        expect(f.text).toBe("India → Chile");
        expect(f.has({ OriginCountryCode: "IND", DestinationCountryCode: "CHL" })).toBe(true);
        expect(f.has({ OriginCountryCode: "CHL", DestinationCountryCode: "IND" })).toBe(false);
        f.set(["CHN", "USA"]);                       // one key given flat
        expect(f.keys).toEqual([["CHN", "USA"]]);
    });
});

describe("a scope lists a page's filters and clears them all", () => {
    it("tracks active filters and notifies on any change", () => {
        const s = createFilterScope();
        const country = s.filter("CountryCode", { label: "Country" });
        const lane = s.filter(["O", "D"], { label: "Lane" });
        let n = 0;
        s.onChange(() => n++);
        country.set("AUS");
        lane.set(["IND", "CHL"]);
        expect(s.active.map(f => f.label)).toEqual(["Country", "Lane"]);
        s.clearAll();
        expect(s.active).toHaveLength(0);
        expect(n).toBe(4);
    });
});

// ── the chart side, through a real host ─────────────────────────────────────────

const PROBE = `
function render(container, data) {
  container.innerHTML = "";
  const doc = container.ownerDocument;
  const at = data.columns.findIndex(c => c.name === "CountryCode");
  for (let r = 0; r < data.rows.length; r++) {
    const m = doc.createElement("div");
    m.className = "d3-mark";
    m.setAttribute("data-row-idx", String(r));
    m.setAttribute("data-code", String(data.rows[r][at]));
    container.appendChild(m);
  }
}`;
const payload = (codes: string[]) => ({
    columns: [{ name: "CountryCode", dataType: "String" }, { name: "Revenue", dataType: "Double", isMeasure: true }],
    rows: codes.map((c, i) => [c, i]),
});

let el: HTMLDivElement;
let host: ChartHost;
let data = payload(["AUS", "CHL", "IND"]);
beforeEach(() => {
    el = document.createElement("div");
    document.body.appendChild(el);
    data = payload(["AUS", "CHL", "IND"]);
    host = createChartHost(el, { code: PROBE, data, d3: {}, labelContrast: false });
    host.render();
});
afterEach(() => { host.destroy(); el.remove(); });

const mark = (code: string) => el.querySelector(`.d3-mark[data-code="${code}"]`) as HTMLElement;
const selected = () => Array.from(el.querySelectorAll(`.d3-mark.${MARK_SELECTED_CLASS}`)).map(m => m.getAttribute("data-code"));
const click = (t: Element) => t.dispatchEvent(new MouseEvent("click", { bubbles: true }));

describe("bindFilter: one chart, one filter", () => {
    it("a click sets it; the same click again clears it (the toggle the page never writes)", () => {
        const f = createFilter("CountryCode");
        const seen: FilterChangeReason[] = [];
        f.onChange((_, r) => seen.push(r));
        bindFilter(host, f, payloadRowReader(() => data));
        click(mark("AUS"));
        expect(f.value).toBe("AUS");
        click(mark("AUS"));
        expect(f.active).toBe(false);
        expect(seen).toEqual(["click", "clear"]);
    });

    it("a page clear clears the chart's marks too", () => {
        const f = createFilter("CountryCode");
        bindFilter(host, f, payloadRowReader(() => data));
        click(mark("CHL"));
        expect(selected()).toEqual(["CHL"]);
        f.clear();
        expect(selected()).toEqual([]);
        expect(host.selection.current ?? []).toEqual([]);
    });

    it("a page set paints the chart, and a click on it then clears (the chart knows what's selected)", () => {
        const f = createFilter("CountryCode");
        bindFilter(host, f, payloadRowReader(() => data));
        f.set("IND");
        expect(selected()).toEqual(["IND"]);
        click(mark("IND"));
        expect(f.active).toBe(false);
    });

    it("new data keeps a selection whose key is still drawn, renumbered", () => {
        const f = createFilter("CountryCode");
        const b = bindFilter(host, f, payloadRowReader(() => data));
        click(mark("IND"));
        data = payload(["IND", "USA"]);              // IND moves from row 2 to row 0
        host.setData(data);
        b.reconcile();
        expect(f.value).toBe("IND");
        expect(selected()).toEqual(["IND"]);
    });

    it("new data that drops the key clears the filter, reason 'data' - never silently", () => {
        const f = createFilter("CountryCode");
        const seen: FilterChangeReason[] = [];
        f.onChange((_, r) => seen.push(r));
        const b = bindFilter(host, f, payloadRowReader(() => data));
        click(mark("CHL"));
        data = payload(["AUS", "USA"]);
        host.setData(data);
        b.reconcile();
        expect(f.active).toBe(false);
        expect(seen).toEqual(["click", "data"]);
    });

    it("an empty payload is data still arriving: the selection stays", () => {
        const f = createFilter("CountryCode");
        const b = bindFilter(host, f, payloadRowReader(() => data));
        click(mark("CHL"));
        data = payload([]);
        host.setData(data);
        b.reconcile();
        expect(f.value).toBe("CHL");
    });

    it("a selection another hand made is never dropped by this chart's new data", () => {
        const f = createFilter("CountryCode");
        const b = bindFilter(host, f, payloadRowReader(() => data));
        f.set("NZL");                                // the page, or another chart
        data = payload(["AUS"]);
        host.setData(data);
        b.reconcile();
        expect(f.value).toBe("NZL");
    });
});

describe("Microsoft's VegaVisual / DataGrid events drive the same filter", () => {
    it("a select with a predicate on the key sets it; clear clears", () => {
        const f = createFilter("CountryCode");
        const changed = fromVegaInteraction(f, [{ action: "select", selections: [{ predicates: [
            { type: "set", name: "Country", values: ["Australia"] },
            { type: "set", name: "CountryCode", values: ["AUS"] },
            { type: "set", name: "Revenue", values: [9] },
        ] }] }]);
        expect(changed).toBe(true);
        expect(f.value).toBe("AUS");
        expect(f.reason).toBe("click");
        fromVegaInteraction(f, [{ action: "clear" }]);
        expect(f.active).toBe(false);
        expect(f.reason).toBe("clear");
    });

    it("a selection that doesn't name the key is skipped", () => {
        const f = createFilter("CountryCode");
        expect(fromVegaInteraction(f, [{ action: "select", selections: [{ predicates: [{ type: "set", name: "Region", values: ["APAC"] }] }] }])).toBe(false);
        expect(f.active).toBe(false);
    });
});
