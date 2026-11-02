// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createChartHost } from "../src/host";

// A CHART THAT REDRAWS ITSELF. A generated table re-sorts on a header click by calling its own render(),
// which starts with container.replaceChildren(). That took the host's badge layer and every mark's selected class with
// it, while the container kept its selection class - so every row dimmed and every note's badge disappeared. The host
// owns its layers, so it repaints them after the chart's own redraw, with no change to code already generated.

const CHART = `
function render(container, data, options) {
  container.replaceChildren();
  const doc = container.ownerDocument;
  const sort = (options.uiState && options.uiState.sort) || "asc";
  const head = doc.createElement("div");
  head.className = "hdr";
  head.textContent = "Country";
  head.addEventListener("click", (event) => {
    event.stopPropagation();   // as the generated table does: a header click is not a click on the chart's background
    const ns = { sort: sort === "asc" ? "desc" : "asc" };
    if (typeof options.setUiState === "function") options.setUiState(ns);
    render(container, data, Object.assign({}, options, { uiState: ns }));
  });
  container.appendChild(head);
  const order = data.rows.map((r, i) => i).sort((a, b) => (sort === "asc" ? 1 : -1) * String(data.rows[a][0]).localeCompare(String(data.rows[b][0])));
  for (const i of order) {
    const row = doc.createElement("div");
    row.className = "d3-mark";
    row.setAttribute("data-row-idx", String(i));
    row.textContent = data.rows[i][0];
    container.appendChild(row);
  }
}`;

const DATA = { columns: [{ name: "Country" }], rows: [["Brazil"], ["Japan"], ["Kenya"]] };
const tick = () => new Promise(r => setTimeout(r, 0));

function mount() {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const host = createChartHost(el, {
        code: CHART, d3: {}, data: DATA as any,
        annotations: [{ column: "Country", value: "Japan", label: "2" }],
    } as any);
    host.render();
    return { el, host };
}
const markOf = (el: HTMLElement, i: number) => el.querySelector(`.d3-mark[data-row-idx="${i}"]`)!;

describe("a chart's own redraw keeps the host's layers", () => {
    it("the selected row stays lit and the others alone dim after a header click re-sorts the table", async () => {
        const { el, host } = mount();
        host.selection.highlight([1]);
        expect(markOf(el, 1).classList.contains("lch-mark-selected")).toBe(true);

        (el.querySelector(".hdr") as HTMLElement).click();
        await tick();
        expect(el.classList.contains("lch-has-selection")).toBe(true);
        expect(markOf(el, 1).classList.contains("lch-mark-selected")).toBe(true);
        expect(markOf(el, 0).classList.contains("lch-mark-selected")).toBe(false);
        host.destroy();
    });

    it("the note's badge comes back after the chart's own redraw", async () => {
        const { el, host } = mount();
        expect(el.querySelectorAll(".bic-annotation")).toHaveLength(1);

        (el.querySelector(".hdr") as HTMLElement).click();
        await tick();
        expect(el.querySelectorAll(".bic-annotation")).toHaveLength(1);
        host.destroy();
    });

    it("a host render is not mistaken for the chart's own redraw, and a cleared selection stays cleared", async () => {
        const { el, host } = mount();
        host.selection.highlight([1]);
        host.selection.clear();
        (el.querySelector(".hdr") as HTMLElement).click();
        await tick();
        expect(el.classList.contains("lch-has-selection")).toBe(false);
        expect(el.querySelectorAll(".lch-mark-selected")).toHaveLength(0);
        host.render();
        await tick();
        expect(el.querySelectorAll(".bic-annotation")).toHaveLength(1);
        host.destroy();
    });

    it("after destroy, a late redraw by the chart paints nothing of the host's", async () => {
        const { el, host } = mount();
        host.selection.highlight([1]);
        const head = el.querySelector(".hdr") as HTMLElement;
        host.destroy();
        // The chart's closure still holds the container; the host that owned the layers is gone.
        el.appendChild(head);
        head.click();
        await tick();
        expect(el.querySelectorAll(".bic-annotation")).toHaveLength(0);
        expect(el.querySelectorAll(".lch-mark-selected")).toHaveLength(0);
    });
});
