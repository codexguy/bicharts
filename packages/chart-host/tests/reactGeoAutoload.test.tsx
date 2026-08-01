// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { BicChart } from "../src/react";
import { clearGeoCache, geoFromCache, registerGeoAsset } from "../src/geoLazy";

// 2026-08-01: a dashboard built against a cold cache mounted a bubble map with
// geoKind="north-america" and got marks over NO land — core render() is sync by contract,
// so it can only attach cached geometry, and nothing in the React binding filled the cache.
// The only signal was a console warning. The binding is the async-aware layer, so IT owns
// the fetch now: cold cache -> loadGeo -> re-render with the basemap. These tests pin that,
// and that a chart with no geoKind never pays for geometry.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// The chart reports what it was handed: it stamps whether options.geo was present, every
// render. That is the observable the whole fix is about.
const GEO_PROBE = `
function render(container, data, options) {
  container.innerHTML = "";
  const d = container.ownerDocument.createElement("div");
  d.className = "probe";
  d.setAttribute("data-has-geo", options && options.geo ? "yes" : "no");
  container.appendChild(d);
}`;

const DATA = { columns: [{ name: "v" }], rows: [[1], [2]] } as any;

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });

// The cold-cache path awaits a real dynamic import, so "one tick" is not a deadline. Poll
// OUTSIDE act — polling inside a single act() defers React's flush to the end of the act,
// so the observable could never flip mid-poll (measured: 5s timeout, then the broken act
// state failed every later test in the file).
const waitFor = async (cond: () => boolean, ms = 4000) => {
    const t0 = Date.now();
    while (!cond() && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 10));
};

let el: HTMLDivElement;
let root: Root;
beforeEach(() => {
    clearGeoCache();
    el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
});
afterEach(async () => {
    await act(async () => root.unmount());
    el.remove();
    clearGeoCache();
});

const probe = () => el.querySelector(".probe")?.getAttribute("data-has-geo");

describe("<BicChart geoKind> — cold geo cache auto-loads instead of silently drawing no basemap", () => {
    it("fetches the geometry itself and re-renders with it attached", async () => {
        expect(geoFromCache("north-america")).toBeUndefined();   // genuinely cold
        await act(async () => {
            root.render(createElement(BicChart, {
                code: GEO_PROBE, data: DATA, d3: {}, geoKind: "north-america",
            }));
        });
        await waitFor(() => !!geoFromCache("north-america"));     // let loadGeo resolve
        await flush();                                            // apply the tick + re-render
        expect(probe()).toBe("yes");
        expect(geoFromCache("north-america")).toBeTruthy();       // cache warmed for siblings
    }, 15000);

    it("a pre-warmed cache renders with geometry on the FIRST paint (no pop-in)", async () => {
        registerGeoAsset("world", { type: "FeatureCollection", features: [] });
        await act(async () => {
            root.render(createElement(BicChart, {
                code: GEO_PROBE, data: DATA, d3: {}, geoKind: "north-america",
            }));
        });
        expect(probe()).toBe("yes");
    });

    it("no geoKind -> never touches geometry", async () => {
        await act(async () => {
            root.render(createElement(BicChart, { code: GEO_PROBE, data: DATA, d3: {} }));
        });
        await flush();
        expect(probe()).toBe("no");
        // The load path must not have run as a side effect of mounting chart N of a page.
        expect(geoFromCache("world")).toBeUndefined();
    });

    it("an unknown geoKind resolves to nothing and stays a warn-only no-op", async () => {
        await act(async () => {
            root.render(createElement(BicChart, {
                code: GEO_PROBE, data: DATA, d3: {}, geoKind: "mars-colonies",
            }));
        });
        await flush();
        expect(probe()).toBe("no");   // no geometry, but the chart still rendered its marks
    });
});
