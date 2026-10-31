import { describe, it, expect, beforeEach } from "vitest";
import { JSDOM } from "jsdom";
import { createChartHost } from "../src/host";

// A point map that placed nothing (the resolver refused, e.g. every row resolves to the same country after a
// filter) carries geoPointRefused on the payload. The host promotes it into options exactly like geoPoint, so the
// chart can say why it has no coordinates instead of failing.

const DATA = { columns: [{ name: "Country" }, { name: "Orders" }], rows: [["France", 1]] };

const CODE = `
function render(container, data, options) {
  container.setAttribute('data-refused', JSON.stringify(options.geoPointRefused || null));
}`;

let container: HTMLElement;

beforeEach(() => {
    const dom = new JSDOM("<!doctype html><html><body><div id='c'></div></body></html>");
    container = dom.window.document.getElementById("c") as unknown as HTMLElement;
});

describe("geoPointRefused is promoted into options", () => {
    it("reaches the chart when the payload carries it", () => {
        const refused = ["country=Country (every row resolves to the same country - nothing to place apart)"];
        const h = createChartHost(container, { code: CODE, data: { ...DATA, geoPointRefused: refused } as any, d3: {} });
        h.render();
        expect(JSON.parse(container.getAttribute("data-refused")!)).toEqual(refused);
    });

    it("is absent when nothing was refused", () => {
        const h = createChartHost(container, { code: CODE, data: DATA as any, d3: {} });
        h.render();
        expect(JSON.parse(container.getAttribute("data-refused")!)).toBeNull();
    });

    it("never overrides an option the host set itself", () => {
        const h = createChartHost(container, {
            code: CODE, data: { ...DATA, geoPointRefused: ["from the payload"] } as any, d3: {},
            options: { geoPointRefused: ["from the host"] } as any,
        });
        h.render();
        expect(JSON.parse(container.getAttribute("data-refused")!)).toEqual(["from the host"]);
    });
});
