// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createChartHost } from "../src/host";
import { createFilter, bindFilter, payloadRowReader } from "../src/filterScope";
import { chartContainers, findMark, clickMark, clickEmpty, selectedRows } from "../src/testing";

// The reader's gestures, from a test: what an app checks so the defects agent-built apps shipped
// (a second click that didn't un-filter, a Clear that left marks lit) can't come back unnoticed.

const PROBE = `
function render(container, data) {
  container.innerHTML = "";
  for (let r = 0; r < data.rows.length; r++) {
    const m = container.ownerDocument.createElement("div");
    m.className = "d3-mark"; m.setAttribute("data-row-idx", String(r)); m.setAttribute("data-code", String(data.rows[r][0]));
    container.appendChild(m);
  }
}`;

describe("testing gestures", () => {
    it("click, click again, Ctrl-click, empty canvas - and what's selected after each", () => {
        const page = document.createElement("div");
        const el = document.createElement("div");
        page.appendChild(el); document.body.appendChild(page);
        const data = { columns: [{ name: "CountryCode" }], rows: [["AUS"], ["CHL"], ["IND"]] };
        const host = createChartHost(el, { code: PROBE, data, d3: {}, labelContrast: false });
        host.render();
        const f = createFilter("CountryCode");
        bindFilter(host, f, payloadRowReader(() => data));
        const [chart] = chartContainers(page);
        expect(chart).toBe(el);
        clickMark(findMark(chart, 1)!);
        expect(selectedRows(chart)).toEqual([1]);
        expect(f.value).toBe("CHL");
        clickMark(findMark(chart, 1)!);
        expect(selectedRows(chart)).toEqual([]);
        expect(f.active).toBe(false);
        clickMark(findMark(chart, m => m.getAttribute("data-code") === "AUS")!);
        clickMark(findMark(chart, 2)!, { add: true });
        expect(selectedRows(chart)).toEqual([0, 2]);
        expect(f.values).toEqual(["AUS", "IND"]);
        clickEmpty(chart);
        expect(selectedRows(chart)).toEqual([]);
        expect(f.active).toBe(false);
        host.destroy(); page.remove();
    });
});
