// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createChartHost } from "../src/host";
import { KEYBOARD_STAMP } from "../src/keyboardMarks";

// A MARK THE KEYBOARD FOCUSES SHOWS ITS TOOLTIP. A chart's tooltip opens on the pointer's hover, so a sighted keyboard
// reader who tabbed to a map tile or a scatter point heard its name and never saw its figures. On focus the host plays the
// chart's own hover path at the mark, and blur or Escape plays the leave, so the chart's own tooltip comes and goes as it
// does for a pointer.

const BODY = `
function render(container, data, options) {
  container.replaceChildren();
  const doc = container.ownerDocument;
  data.rows.forEach((r, i) => {
    const m = doc.createElement("div");
    m.className = "d3-mark";
    m.setAttribute("data-row-idx", String(i));
    m.addEventListener("mouseover", () => {
      let tip = container.querySelector(".tip");
      if (!tip) { tip = doc.createElement("div"); tip.className = "tip"; container.appendChild(tip); }
      tip.textContent = r[0] + ": " + r[1];
    });
    m.addEventListener("mouseout", () => { const tip = container.querySelector(".tip"); if (tip) tip.remove(); });
    container.appendChild(m);
  });
}`;
const DATA = { columns: [{ name: "Country" }, { name: "Revenue" }], rows: [["Brazil", 12], ["Japan", 30]] };

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
const marks = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLElement>(".d3-mark"));
const tip = (el: HTMLElement) => el.querySelector(".tip")?.textContent ?? null;
const key = (t: Element, k: string) => t.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

describe("a keyboard-focused mark shows its tooltip", () => {
    it("focus shows the chart's own tooltip, an arrow moves it, blur hides it", () => {
        const { el } = mount(`${KEYBOARD_STAMP}\n${BODY}`);
        marks(el)[0].focus();
        expect(tip(el)).toBe("Brazil: 12");
        key(marks(el)[0], "ArrowRight");
        expect(document.activeElement).toBe(marks(el)[1]);
        expect(tip(el)).toBe("Japan: 30");
        marks(el)[1].blur();
        expect(tip(el)).toBeNull();
    });
    it("Escape hides it", () => {
        const { el } = mount(`${KEYBOARD_STAMP}\n${BODY}`);
        marks(el)[1].focus();
        expect(tip(el)).toBe("Japan: 30");
        key(marks(el)[1], "Escape");
        expect(tip(el)).toBeNull();
    });
    it("an unstamped chart takes no focus and plays no hover", () => {
        const { el } = mount(BODY);
        expect(marks(el)[0].hasAttribute("tabindex")).toBe(false);
        expect(tip(el)).toBeNull();
    });
});
