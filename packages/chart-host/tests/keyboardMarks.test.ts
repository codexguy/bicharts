// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createChartHost } from "../src/host";
import { codeHasKeyboardStamp, KEYBOARD_STAMP } from "../src/keyboardMarks";
import { MARK_SELECTED_CLASS, SELECTION_ACTIVE_CLASS } from "../src/contract";

// EVERY SELECTABLE MARK WORKS FROM THE KEYBOARD. Nothing in a chart took focus: no row, tile or
// badge, so a keyboard-only reader couldn't pick a country, and adding an action item needs a picked one. Behind a flag
// on every path: the server stamps a chart it generated while its keyboard switch is on, and the host wires keys
// only for a stamped chart. One tab stop per chart (a roving tabindex); arrows, Home and End move; Enter or Space
// selects as a click does; Escape clears. A note's badge and a control the chart declares take focus too.

const BODY = `
function render(container, data, options) {
  container.__opts = options;
  const doc = container.ownerDocument;
  for (let i = 0; i < data.rows.length; i++) {
    const m = doc.createElement("div");
    m.className = "d3-mark";
    m.setAttribute("data-row-idx", String(i));
    container.appendChild(m);
  }
  const c = doc.createElement("div");
  c.className = "lch-control flip-next";
  c.setAttribute("aria-label", "Next face");
  c.addEventListener("click", () => { container.__flips = (container.__flips || 0) + 1; });
  container.appendChild(c);
}`;
const STAMPED = `${KEYBOARD_STAMP}\n${BODY}`;
const DATA = { columns: [{ name: "Country" }, { name: "Revenue" }], rows: [["Brazil", 1], ["Japan", 2], ["Kenya", 3]] };

let els: HTMLElement[] = [];
afterEach(() => { els.forEach(e => e.remove()); els = []; });
function mount(code: string, extra: Record<string, unknown> = {}) {
    const el = document.createElement("div");
    document.body.appendChild(el);
    els.push(el);
    const host = createChartHost(el, { code, d3: {}, data: DATA as any, ...extra } as any);
    const heard: number[][] = [];
    host.selection.onChange(rows => heard.push(rows));
    host.render();
    return { el, host, heard };
}
const marks = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLElement>(".d3-mark"));
const key = (t: Element, k: string, mods: Partial<KeyboardEventInit> = {}) =>
    t.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...mods }));

describe("the stamp", () => {
    it("is read from the code's header only", () => {
        expect(codeHasKeyboardStamp(STAMPED)).toBe(true);
        expect(codeHasKeyboardStamp(`// BIC generated chart\n// host contract v1\n${STAMPED}`)).toBe(true);
        expect(codeHasKeyboardStamp(BODY)).toBe(false);
        expect(codeHasKeyboardStamp(`${BODY}\n${"\n".repeat(30)}${KEYBOARD_STAMP}`)).toBe(false);
        expect(codeHasKeyboardStamp(undefined)).toBe(false);
    });
});

describe("an unstamped chart is untouched", () => {
    it("takes no focus and answers no key", () => {
        const { el, heard } = mount(BODY);
        expect(marks(el).every(m => !m.hasAttribute("tabindex"))).toBe(true);
        expect((el as any).__opts.keyboardMarks).toBeUndefined();
        key(marks(el)[0], "Enter");
        expect(heard).toEqual([]);
    });
});

describe("a stamped chart works from the keyboard", () => {
    it("one tab stop, every mark a named button, and the chart is told", () => {
        const { el } = mount(STAMPED);
        const ms = marks(el);
        expect(ms.map(m => m.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
        expect(ms.map(m => m.getAttribute("role"))).toEqual(["button", "button", "button"]);
        expect(ms[1].getAttribute("aria-label")).toBe("Japan, 2");
        expect(ms[1].getAttribute("aria-pressed")).toBe("false");
        expect((el as any).__opts.keyboardMarks).toBe(true);
    });

    it("arrows, Home and End move the tab stop and focus with it", () => {
        const { el } = mount(STAMPED);
        marks(el)[0].focus();
        key(marks(el)[0], "ArrowRight");
        expect(document.activeElement).toBe(marks(el)[1]);
        expect(marks(el).map(m => m.getAttribute("tabindex"))).toEqual(["-1", "0", "-1"]);
        key(marks(el)[1], "End");
        expect(document.activeElement).toBe(marks(el)[2]);
        key(marks(el)[2], "ArrowDown");
        expect(document.activeElement).toBe(marks(el)[2]);   // stops at the end
        key(marks(el)[2], "Home");
        expect(document.activeElement).toBe(marks(el)[0]);
        key(marks(el)[0], "ArrowUp");
        expect(document.activeElement).toBe(marks(el)[0]);
    });

    it("Enter selects as a click does, Space on the same mark clears it, Escape clears", () => {
        const { el, heard } = mount(STAMPED);
        key(marks(el)[1], "Enter");
        expect(heard).toEqual([[1]]);
        expect(marks(el)[1].classList.contains(MARK_SELECTED_CLASS)).toBe(true);
        expect(marks(el)[1].getAttribute("aria-pressed")).toBe("true");
        key(marks(el)[1], " ");
        expect(heard).toEqual([[1], []]);
        key(marks(el)[2], "Enter", { ctrlKey: true });
        key(marks(el)[0], "Enter", { ctrlKey: true });
        expect(heard[heard.length - 1].slice().sort()).toEqual([0, 2]);
        key(marks(el)[0], "Escape");
        expect(heard[heard.length - 1]).toEqual([]);
        expect(el.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(false);
    });

    it("Ctrl+Shift+C clears on every host, the chord Power BI uses for its own clear", () => {
        const { el, heard } = mount(STAMPED);
        key(marks(el)[1], "Enter");
        key(marks(el)[1], "C", { ctrlKey: true, shiftKey: true });
        expect(heard).toEqual([[1], []]);
    });

    it("a host whose frame takes Escape (escapeClears false) keeps the selection on Escape", async () => {
        const { installKeyboard } = await import("../src/keyboardMarks");
        const el = document.createElement("div");
        document.body.appendChild(el);
        els.push(el);
        const m = document.createElement("div");
        m.className = "d3-mark";
        m.setAttribute("data-row-idx", "0");
        el.appendChild(m);
        let clears = 0;
        const kb = installKeyboard({
            container: el, markSelector: ".d3-mark", pressSelector: ".lch-control", skipSelector: ".none",
            inert: () => false, select: () => {}, clear: () => { clears++; }, escapeClears: false,
            isSelected: () => false, labelOf: () => null, keyOf: () => "0",
        } as any);
        kb.refresh();
        key(m, "Escape");
        expect(clears).toBe(0);
        key(m, "c", { ctrlKey: true, shiftKey: true });
        expect(clears).toBe(1);
        kb.destroy();
    });

    it("a dimmed mark with keyboard focus is drawn at full strength, so its ring isn't faded", () => {
        mount(STAMPED);
        const css = Array.from(document.querySelectorAll("style")).map(s => s.textContent || "").join("\n");
        expect(css).toMatch(/\.lch-keyboard\.lch-has-selection \.d3-mark\[data-lch-kb\]:focus-visible:not\(\.lch-mark-selected\) \{ opacity: 1 !important; \}/);
    });

    it("the tab stop follows the selection across a redraw", () => {
        const { el, host } = mount(STAMPED);
        key(marks(el)[2], "Enter");
        host.render();
        expect(marks(el).map(m => m.getAttribute("tabindex"))).toEqual(["-1", "-1", "0"]);
    });

    it("a control the chart declares takes focus and Enter presses it", () => {
        const { el } = mount(STAMPED);
        const c = el.querySelector(".flip-next") as HTMLElement;
        expect(c.getAttribute("tabindex")).toBe("0");
        expect(c.getAttribute("role")).toBe("button");
        key(c, "Enter");
        key(c, " ");
        expect((el as any).__flips).toBe(2);
    });

    it("a note's badge takes focus and Enter opens it", () => {
        const opened: unknown[] = [];
        const { el } = mount(STAMPED, {
            annotations: [{ column: "Country", value: "Japan", label: "1" }],
            onAnnotationClick: (a: unknown) => opened.push(a),
        });
        const b = el.querySelector(".bic-annotation") as HTMLElement;
        expect(b.getAttribute("tabindex")).toBe("0");
        key(b, "Enter");
        expect(opened).toHaveLength(1);
    });

    it("an inert chart's marks take no focus, but its badges still do", () => {
        const { el } = mount(STAMPED, {
            marksSelect: () => false,
            annotations: [{ column: "Country", value: "Japan", label: "1" }],
        });
        expect(marks(el).every(m => !m.hasAttribute("tabindex"))).toBe(true);
        expect((el.querySelector(".bic-annotation") as HTMLElement).getAttribute("tabindex")).toBe("0");
    });

    it("a mark's own name is kept, and a mark the chart made focusable itself is left alone", () => {
        const code = `${KEYBOARD_STAMP}
function render(container, data) {
  const doc = container.ownerDocument;
  for (let i = 0; i < data.rows.length; i++) {
    const m = doc.createElement("div");
    m.className = "d3-mark";
    m.setAttribute("data-row-idx", String(i));
    if (i === 0) m.setAttribute("aria-label", "Brazil, top seller");
    if (i === 1) m.setAttribute("tabindex", "0");
    container.appendChild(m);
  }
}`;
        const { el } = mount(code);
        expect(marks(el)[0].getAttribute("aria-label")).toBe("Brazil, top seller");
        expect(marks(el)[1].getAttribute("tabindex")).toBe("0");
    });
});
