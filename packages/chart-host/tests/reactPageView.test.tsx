// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BicChart, BicChartGroup, BicDevtools, useBicControls, useBicFilter, useBicUrlState, useBicView,
         type Filter, type Controls } from "../src/react";
import { createFilter, createFilterScope, viewFromToken, viewToken, LINKED_HOVER_CLASS } from "../src/filterScope";
import { createControls } from "../src/controls";

// TIER 2 OF THE PAGE'S STATE: a saved view (filters + a chart's controls) put back, a link that carries it, linked
// hover across charts bound to one filter, and a developer's view of it all.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("a saved view: every filter's keys and every chart's controls", () => {
    it("save and restore round-trip, and a filter the view doesn't name is cleared", () => {
        const scope = createFilterScope();
        const region = scope.filter("RegionCode", { label: "Region" });
        const route = scope.filter(["OriginCode", "DestinationCode"], { label: "Route" });
        const ctl = createControls();
        scope.addControls("forecast", ctl);
        region.set(["JPN", "ESP"]);
        route.set(["ESP", "PRT"]);
        ctl.set({ rate: 0.02, horizon: 24 });
        const view = scope.save();
        expect(view).toEqual({ v: 1, filters: { RegionCode: [["JPN"], ["ESP"]], "OriginCode+DestinationCode": [["ESP", "PRT"]] },
                               controls: { forecast: { rate: 0.02, horizon: 24 } } });
        scope.clearAll();
        route.set(["X", "Y"]);
        scope.restore({ v: 1, filters: { RegionCode: [["JPN"]] } });
        expect(region.values).toEqual(["JPN"]);
        expect(route.active).toBe(false);          // not in the view: cleared
        expect(region.reason).toBe("page");
    });

    it("a view travels as a URL-safe token, and anything else reads as no view", () => {
        const view = { v: 1 as const, filters: { RegionCode: [["São Tomé"]] } };
        const t = viewToken(view);
        expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(viewFromToken(t)).toEqual(view);
        expect(viewFromToken("not-a-view")).toBeNull();
        expect(viewFromToken(null)).toBeNull();
    });
});

let el: HTMLDivElement;
let root: Root;
beforeEach(() => {
    el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
    window.history.replaceState(null, "", "/page");
});
afterEach(async () => {
    await act(async () => root.unmount());
    el.remove();
});

describe("useBicView and useBicUrlState", () => {
    it("a page's filters and controls go into the address bar, and a link with them opens the page as it was", async () => {
        let region: Filter | null = null;
        let ctl: Controls | null = null;
        let view: ReturnType<typeof useBicView> | null = null;
        function Page() {
            region = useBicFilter("RegionCode", { label: "Region" });
            ctl = useBicControls(undefined, { id: "forecast" });
            view = useBicView();
            useBicUrlState("v");
            return null;
        }
        await act(async () => { root.render(createElement(Page)); });
        await act(async () => { region!.set("JPN"); });
        const url = new URL(window.location.href);
        const token = url.searchParams.get("v");
        expect(viewFromToken(token)).toEqual({ v: 1, filters: { RegionCode: [["JPN"]] } });
        expect(view!.token()).toBe(token);
        await act(async () => { region!.clear(); });
        expect(new URL(window.location.href).searchParams.has("v")).toBe(false);

        // A fresh page opened from the link.
        await act(async () => root.unmount());
        root = createRoot(el);
        window.history.replaceState(null, "", "/page?v=" + viewToken({ v: 1, filters: { RegionCode: [["ESP"]] }, controls: { forecast: { rate: 0.03 } } }));
        await act(async () => { root.render(createElement(Page)); });
        expect(region!.value).toBe("ESP");
        expect(ctl!.values).toEqual({ rate: 0.03 });
    });
});

const PROBE = `
function render(container, data) {
  container.innerHTML = "";
  const at = data.columns.findIndex(c => c.name === "RegionCode");
  for (let r = 0; r < data.rows.length; r++) {
    const m = container.ownerDocument.createElement("div");
    m.className = "d3-mark"; m.setAttribute("data-row-idx", String(r)); m.setAttribute("data-code", String(data.rows[r][at]));
    container.appendChild(m);
  }
}`;
const COLUMNS = [{ name: "RegionCode", dataType: "String" }, { name: "Value", dataType: "Double", isMeasure: true }];
const D3 = {};

describe("linked hover", () => {
    it("hovering a mark lights the same key's marks on another chart bound to the filter - a glow, not a selection", async () => {
        let region: Filter | null = null;
        function Chart(p: { cls: string; codes: string[]; f: Filter }) {
            const rows = p.codes.map((c, i) => ({ RegionCode: c, Value: i }));
            return createElement(BicChartGroup, { columns: COLUMNS, rows, children:
                createElement(BicChart, { code: PROBE, d3: D3, className: p.cls, labelContrast: false, selects: p.f }) });
        }
        function Page() {
            region = useBicFilter("RegionCode", { hover: true });
            return createElement(Fragment, null,
                createElement(Chart, { cls: "a", codes: ["JPN", "ESP", "PRT"], f: region }),
                createElement(Chart, { cls: "b", codes: ["PRT", "JPN"], f: region }));
        }
        await act(async () => { root.render(createElement(Page)); });
        const mark = (cls: string, code: string) => el.querySelector(`.${cls} .d3-mark[data-code="${code}"]`) as HTMLElement;
        await act(async () => { mark("a", "JPN").dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); });
        expect(region!.hovered).toEqual(["JPN"]);
        expect(mark("b", "JPN").classList.contains(LINKED_HOVER_CLASS)).toBe(true);
        expect(mark("b", "PRT").classList.contains(LINKED_HOVER_CLASS)).toBe(false);
        expect(region!.active).toBe(false);                     // hover never selects
        expect(document.head.querySelector('style[data-bic="linked-hover"]')).not.toBeNull();
        await act(async () => { (el.querySelector(".a") as HTMLElement).dispatchEvent(new MouseEvent("mouseleave")); });
        expect(mark("b", "JPN").classList.contains(LINKED_HOVER_CLASS)).toBe(false);
    });

    it("is off unless the filter asks for it", () => {
        expect(createFilter("RegionCode").hoverEnabled).toBe(false);
    });
});

describe("BicDevtools", () => {
    it("lists each filter with its keys and the reason for its last change", async () => {
        let region: Filter | null = null;
        function Page() {
            region = useBicFilter("RegionCode", { label: "Region" });
            return createElement(BicDevtools);
        }
        await act(async () => { root.render(createElement(Page)); });
        await act(async () => { region!.set("JPN"); });
        const text = (el.querySelector(".bic-devtools") as HTMLElement).textContent ?? "";
        expect(text).toContain("Region");
        expect(text).toContain('[["JPN"]]');
        expect(text).toContain("last: page");
    });
});
