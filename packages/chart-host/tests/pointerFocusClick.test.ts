// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createChartHost } from "../src/host";
import { KEYBOARD_STAMP } from "../src/keyboardMarks";

// A MOUSE PRESS THAT FOCUSES A MARK IS STILL A CLICK.
//
// On a chart that works from the keyboard every mark takes focus, and a focused mark plays the chart's hover path at
// its own centre so a keyboard reader sees the tooltip. A mouse press focuses the mark too (the browser focuses a
// tabindex element on mousedown), and the hover it played carried a pointermove at the mark's centre. The host's press
// tracker read that move as the reader's pointer travelling, so a press 5px or more from the mark's centre - anywhere
// along a long line, an error bar's tall hit box, the rim of a bubble - became a "drag", and the click that followed
// selected nothing. A second click on the same, already focused, mark selected it, so the selection seemed to arrive
// one click late. A pointer that focuses a mark is already on it: the host plays no hover for it.

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
const DATA = { columns: [{ name: "Country" }, { name: "Revenue" }], rows: [["Brazil", 12], ["Japan", 30], ["Chile", 7]] };

let els: HTMLElement[] = [];
afterEach(() => { els.forEach(e => e.remove()); els = []; });
function mount() {
    const el = document.createElement("div");
    document.body.appendChild(el);
    els.push(el);
    const host = createChartHost(el, { code: `${KEYBOARD_STAMP}\n${BODY}`, d3: {}, data: DATA as any } as any);
    const seen: number[][] = [];
    host.selection.onChange(rows => seen.push(rows.slice()));
    host.render();
    return { el, host, seen };
}
const marks = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLElement>(".d3-mark"));

// What a browser does for one mouse click at (x, y) on `m`: press, focus (the mousedown's default action), release,
// click. jsdom lays nothing out, so every mark's centre is (0, 0) and a press at (100, 40) is far from it - the case
// of a reader clicking a long line or a tall box away from its middle.
function mouseClick(m: HTMLElement, x: number, y: number) {
    const PE = ((window as any).PointerEvent ?? MouseEvent) as typeof MouseEvent;
    m.dispatchEvent(new PE("pointerdown", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
    m.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
    m.focus();
    m.dispatchEvent(new PE("pointerup", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
    m.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
    m.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: x, clientY: y, detail: 1 }));
}

describe("a mouse press that focuses a mark selects it on that click", () => {
    it("the first click on a mark, away from its centre, selects its rows", () => {
        const { el, seen } = mount();
        expect(marks(el)[1].getAttribute("tabindex")).not.toBeNull();     // the chart works from the keyboard
        mouseClick(marks(el)[1], 100, 40);
        expect(seen.at(-1)).toEqual([1]);
    });

    it("a click on a second mark selects the second mark, not one click late", () => {
        const { el, seen } = mount();
        mouseClick(marks(el)[0], 100, 40);
        expect(seen.at(-1)).toEqual([0]);
        mouseClick(marks(el)[2], 140, 80);
        expect(seen.at(-1)).toEqual([2]);
        expect(seen.length).toBe(2);
    });

    it("the keyboard still plays the hover: a mark focused with no pointer down shows its tooltip", () => {
        const { el } = mount();
        marks(el)[1].focus();
        expect(el.querySelector(".tip")?.textContent).toBe("Japan: 30");
    });

    it("a press released outside the chart does not stop a later keyboard focus showing the tooltip", () => {
        const { el } = mount();
        const PE = ((window as any).PointerEvent ?? MouseEvent) as typeof MouseEvent;
        marks(el)[0].dispatchEvent(new PE("pointerdown", { bubbles: true, clientX: 5, clientY: 5, button: 0 }));
        document.body.dispatchEvent(new PE("pointerup", { bubbles: true, clientX: 900, clientY: 900, button: 0 }));
        marks(el)[2].focus();
        expect(el.querySelector(".tip")?.textContent).toBe("Chile: 7");
    });
});
