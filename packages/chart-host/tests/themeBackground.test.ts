// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createChartHost } from "../src/host";

// ONE BACKGROUND FOR EVERY CHART, WHICHEVER NAME THE PAGE PASSES IT UNDER. A page that passes only `backgroundColor`
// left `themeBg` unset, and a chart that paints its cards with `options.themeBg || '#fff'` drew white cards under the
// dark theme's white text. A page that passes only `themeBg` left the other half unset the same way. The host resolves
// each from the other when one is unset, and leaves both alone when the page names both.

const CHART = `
function render(container, data, options) {
  container.replaceChildren();
  const card = container.ownerDocument.createElement("div");
  card.className = "card";
  card.style.background = options.themeBg || "#fff";
  card.setAttribute("data-bg", String(options.backgroundColor));
  card.setAttribute("data-theme-bg", String(options.themeBg));
  container.appendChild(card);
}`;
const DATA = { columns: [{ name: "Region" }], rows: [["Europe"]] };

let els: HTMLElement[] = [];
afterEach(() => { els.forEach(e => e.remove()); els = []; });
function mount(options: Record<string, unknown>) {
    const el = document.createElement("div");
    document.body.appendChild(el);
    els.push(el);
    const host = createChartHost(el, { code: CHART, d3: {}, data: DATA as any, options } as any);
    host.render();
    return { el, host };
}
const card = (el: HTMLElement) => el.querySelector(".card") as HTMLElement;

describe("the page background reaches a chart under both names", () => {
    it("backgroundColor alone reaches options.themeBg, so a dark page gets a dark card", () => {
        const { el, host } = mount({ backgroundColor: "#1b1a19", themeFg: "#ffffff" });
        expect(card(el).getAttribute("data-theme-bg")).toBe("#1b1a19");
        expect(card(el).style.background).not.toMatch(/255, 255, 255|#fff/i);
        host.destroy();
    });

    it("themeBg alone reaches options.backgroundColor", () => {
        const { el, host } = mount({ themeBg: "#252423" });
        expect(card(el).getAttribute("data-bg")).toBe("#252423");
        host.destroy();
    });

    it("a theme switch through setOptions carries the new background to both names", () => {
        const { el, host } = mount({ backgroundColor: "#ffffff" });
        expect(card(el).getAttribute("data-theme-bg")).toBe("#ffffff");
        host.setOptions({ backgroundColor: "#1b1a19" });
        expect(card(el).getAttribute("data-theme-bg")).toBe("#1b1a19");
        expect(card(el).getAttribute("data-bg")).toBe("#1b1a19");
        host.destroy();
    });

    it("a page that names both keeps both as named", () => {
        const { el, host } = mount({ backgroundColor: "transparent", themeBg: "#1b1a19" });
        expect(card(el).getAttribute("data-bg")).toBe("transparent");
        expect(card(el).getAttribute("data-theme-bg")).toBe("#1b1a19");
        host.destroy();
    });

    it("a blank name is unset, and a page that names neither still names neither", () => {
        const a = mount({ backgroundColor: "#101010", themeBg: "" });
        expect(card(a.el).getAttribute("data-theme-bg")).toBe("#101010");
        a.host.destroy();
        const b = mount({});
        expect(card(b.el).getAttribute("data-bg")).toBe("undefined");
        expect(card(b.el).getAttribute("data-theme-bg")).toBe("undefined");
        b.host.destroy();
    });
});
