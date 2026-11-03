// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createChartHost } from "../src/host";
import { KEYBOARD_STAMP } from "../src/keyboardMarks";

// FOCUS SURVIVES A CHART'S OWN REDRAW. A generated table sorts on a header press by calling its own render(), which
// replaces every node, the focused header included. The host gave focus back only across its own render(), so a sort
// by Enter dropped focus to the page body and a keyboard reader had to Tab back into the table after every sort. The
// host remembers what had focus in the chart and puts it back on that element's replacement: the same header, or the
// same row by its data-row-idx, wherever the sort moved it.

const BODY = `
function render(container, data, options) {
  container.replaceChildren();
  const doc = container.ownerDocument;
  const sort = (options.uiState && options.uiState.sort) || { key: "Country", asc: true };
  ["Country", "Revenue"].forEach((key, ci) => {
    const h = doc.createElement("div");
    h.className = "lch-control sort-head";
    h.setAttribute("aria-label", key);
    if (options.keyboardMarks !== true) h.setAttribute("tabindex", "0");
    h.textContent = key + (sort.key === key ? (sort.asc ? " up" : " down") : "");
    const go = () => {
      const next = { key, asc: sort.key === key ? !sort.asc : true };
      if (typeof options.setUiState === "function") options.setUiState({ sort: next });
      render(container, data, Object.assign({}, options, { uiState: { sort: next } }));
    };
    h.addEventListener("click", (e) => { e.stopPropagation(); go(); });
    if (options.keyboardMarks !== true) h.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
    container.appendChild(h);
  });
  const ci = sort.key === "Country" ? 0 : 1;
  const order = data.rows.map((r, i) => i).sort((a, b) => {
    const x = data.rows[a][ci], y = data.rows[b][ci];
    return (sort.asc ? 1 : -1) * (x < y ? -1 : x > y ? 1 : 0);
  });
  for (const i of order) {
    const row = doc.createElement("div");
    row.className = "d3-mark";
    row.setAttribute("data-row-idx", String(i));
    row.textContent = data.rows[i][0];
    row.addEventListener("dblclick", () => render(container, data, options));
    container.appendChild(row);
  }
}`;
const STAMPED = `${KEYBOARD_STAMP}\n${BODY}`;
const DATA = { columns: [{ name: "Country" }, { name: "Revenue" }], rows: [["Brazil", 3], ["Japan", 1], ["Kenya", 2]] };
const tick = () => new Promise(r => setTimeout(r, 0));

let els: HTMLElement[] = [];
afterEach(() => { els.forEach(e => e.remove()); els = []; });
function mount(code: string) {
    const el = document.createElement("div");
    document.body.appendChild(el);
    els.push(el);
    const host = createChartHost(el, { code, d3: {}, data: DATA as any } as any);
    host.render();
    return { el, host };
}
const head = (el: HTMLElement, key: string) => el.querySelector(`.sort-head[aria-label="${key}"]`) as HTMLElement;
const row = (el: HTMLElement, i: number) => el.querySelector(`.d3-mark[data-row-idx="${i}"]`) as HTMLElement;
const enter = (t: Element) => t.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

describe("focus survives a chart's own redraw", () => {
    it("a sort by Enter on a stamped chart's header keeps focus on that header", async () => {
        const { el, host } = mount(STAMPED);
        const before = head(el, "Revenue");
        before.focus();
        expect(document.activeElement).toBe(before);
        enter(before);
        await tick();
        expect(head(el, "Revenue")).not.toBe(before);          // the chart drew a new header
        expect(head(el, "Revenue").textContent).toContain("up");
        expect(document.activeElement).toBe(head(el, "Revenue"));
        host.destroy();
    });

    it("an unstamped chart's own keyboard sort keeps focus on the same header too", async () => {
        const { el, host } = mount(BODY);
        head(el, "Revenue").focus();
        enter(head(el, "Revenue"));
        await tick();
        expect(document.activeElement).toBe(head(el, "Revenue"));
        host.destroy();
    });

    it("a focused row keeps focus on the same row after a redraw that moves it", async () => {
        const { el, host } = mount(STAMPED);
        enter(head(el, "Revenue"));                            // sort by revenue: Japan, Kenya, Brazil
        await tick();
        const brazil = row(el, 0);
        brazil.focus();
        expect(document.activeElement).toBe(brazil);
        brazil.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));   // the chart redraws itself again
        await tick();
        expect(row(el, 0)).not.toBe(brazil);
        expect(document.activeElement).toBe(row(el, 0));
        host.destroy();
    });

    it("rows stay keyboard tab stops after a chart's own redraw with nothing selected", async () => {
        const { el, host } = mount(STAMPED);
        enter(head(el, "Revenue"));
        await tick();
        const tabbable = Array.from(el.querySelectorAll<HTMLElement>(".d3-mark")).filter(m => m.hasAttribute("tabindex"));
        expect(tabbable).toHaveLength(3);
        expect(tabbable.filter(m => m.getAttribute("tabindex") === "0")).toHaveLength(1);
        host.destroy();
    });

    it("focus the reader moved out of the chart is not pulled back by a later redraw", async () => {
        const { el, host } = mount(STAMPED);
        const outside = document.createElement("button");
        document.body.appendChild(outside);
        els.push(outside);
        head(el, "Revenue").focus();
        outside.focus();
        head(el, "Country").click();                           // a pointer sort while focus is elsewhere
        await tick();
        expect(document.activeElement).toBe(outside);
        host.destroy();
    });

    it("after destroy, a late redraw by the chart moves no focus", async () => {
        const { el, host } = mount(STAMPED);
        const h = head(el, "Revenue");
        h.focus();
        host.destroy();
        enter(h);   // no host keyboard any more; the chart's click handler still runs on a click
        h.click();
        await tick();
        expect(document.activeElement === head(el, "Revenue")).toBe(false);
    });
});
