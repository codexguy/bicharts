import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { createChartHost } from "../src/host";
import {
    MARK_CLASS, LEGEND_MARK_CLASS, ROW_IDX_ATTR, HOST_CONTAINER_CLASS,
    SELECTION_ACTIVE_CLASS, MARK_SELECTED_CLASS, DIM_OPACITY_VAR, DIM_OPACITY_DEFAULT,
    LIFT_SELECTED_CLASS, CONTAINER_SLOT_XF_CLEAR, CONTAINER_SLOT_ANIM_STOP, CONTAINER_SLOT_INITIAL_XF_MARK,
    CONTAINER_SLOT_CLICKED_MARKS,
} from "../src/contract";

// The SELECTION AFFORDANCE — what a selection LOOKS like, and how a user gets OUT of one.
// All four behaviours here came from driving the React demo by hand (2026-07-26):
// "how can I go back to nothing selected?", "clicking a table row should filter the map
// too", and "when I click a legend swatch I expected some kind of feedback... such as
// dimming that PBI might do".

const DATA = {
    columns: [{ name: "City" }, { name: "Rev" }, { name: "__rowIdx__" }],
    rows: [["A", 1, 0], ["B", 2, 1], ["C", 3, 2]],
};

// A conformant chart: three marks + one legend swatch covering rows 0 and 1.
const CODE = `
function render(container, data, options) {
  container.innerHTML = '';
  data.rows.forEach(function (r) {
    var m = container.ownerDocument.createElement('div');
    m.setAttribute('class', '${MARK_CLASS}');
    m.setAttribute('${ROW_IDX_ATTR}', String(r[2]));
    m.textContent = r[0];
    container.appendChild(m);
  });
  var lg = container.ownerDocument.createElement('div');
  lg.setAttribute('class', '${LEGEND_MARK_CLASS}');
  lg.setAttribute('${ROW_IDX_ATTR}', '0,1');
  container.appendChild(lg);
}`;

let dom: JSDOM;
let container: HTMLElement;

function host() {
    return createChartHost(container, { code: CODE, data: DATA as any, d3: {} });
}
function marks() {
    return Array.from(container.querySelectorAll(`.${MARK_CLASS}`));
}
function click(el: Element) {
    el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
}
// A selection the CHART publishes - a scrubber tick, a sunburst arc - rather than one the host reads off a
// clicked mark. The host ignores clicks for a moment after a chart dispatch (its echo guard), so the clock
// is stepped past that before the next gesture.
function chartSelects(el: Element) {
    container.dispatchEvent(new dom.window.CustomEvent("llm-xfilter-refresh", {
        bubbles: true, detail: { mark: el, source: "user" },
    }));
    vi.setSystemTime(Date.now() + 1000);
}
afterEach(() => { vi.useRealTimers(); });

beforeEach(() => {
    dom = new JSDOM("<!doctype html><html><body><div id='c'></div></body></html>");
    (globalThis as any).MouseEvent = dom.window.MouseEvent;
    container = dom.window.document.getElementById("c") as unknown as HTMLElement;
});

describe("selection affordance", () => {
    it("stamps the container and injects the shared stylesheet once", () => {
        host();
        expect(container.classList.contains(HOST_CONTAINER_CLASS)).toBe(true);
        const styles = dom.window.document.querySelectorAll("#bic-chart-host-affordances");
        expect(styles.length).toBe(1);
        // A second host on the same document must NOT duplicate the rules.
        const c2 = dom.window.document.createElement("div");
        dom.window.document.body.appendChild(c2);
        createChartHost(c2 as unknown as HTMLElement, { code: CODE, data: DATA as any, d3: {} });
        expect(dom.window.document.querySelectorAll("#bic-chart-host-affordances").length).toBe(1);
    });

    it("flags the clicked mark and the container so the rest dim", () => {
        const h = host();
        h.render();
        click(marks()[1]);
        expect(container.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(true);
        expect(marks()[1].classList.contains(MARK_SELECTED_CLASS)).toBe(true);
        expect(marks()[0].classList.contains(MARK_SELECTED_CLASS)).toBe(false);
    });

    it("a LEGEND swatch lights up every mark it covers — the reported gap", () => {
        const h = host();
        h.render();
        click(container.querySelector(`.${LEGEND_MARK_CLASS}`)!);
        // Swatch covers rows 0,1 → those marks selected, row 2 dimmed.
        expect(marks()[0].classList.contains(MARK_SELECTED_CLASS)).toBe(true);
        expect(marks()[1].classList.contains(MARK_SELECTED_CLASS)).toBe(true);
        expect(marks()[2].classList.contains(MARK_SELECTED_CLASS)).toBe(false);
    });

    it("a DECLARED group lifts its selected marks to full paint; an undeclared chart is untouched", () => {
        // A chart that rests its marks below full opacity by design (a parallel-coordinates
        // plot at 0.38) used to show its SELECTED marks at 38% - the eye reads that as dimmed,
        // because the affordance only ever dims the others. The lift is opt-in by class so a
        // chart using alpha as an ENCODING is never flattened by a fix meant for another.
        const h = host();
        h.render();
        const css = dom.window.document.getElementById("bic-chart-host-affordances")?.textContent ?? "";
        expect(css).toContain(`.${LIFT_SELECTED_CLASS} .${MARK_CLASS}.${MARK_SELECTED_CLASS}`);
        expect(css).toContain("stroke-opacity: 1 !important");
        // The dim rule itself is untouched: an undeclared selected mark is still merely exempt.
        expect(css).toContain(`.${MARK_CLASS}:not(.${MARK_SELECTED_CLASS})`);
    });

    it("re-clicking the same mark toggles the selection OFF", () => {
        const h = host();
        h.render();
        click(marks()[0]);
        expect(h.selection.current).toEqual([0]);
        click(marks()[0]);
        expect(h.selection.current).toEqual([]);
        expect(container.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(false);
    });

    it("clicking empty canvas clears — the way out of a selection", () => {
        const h = host();
        h.render();
        click(marks()[0]);
        expect(h.selection.current).toEqual([0]);
        click(container);                       // no mark under the pointer
        expect(h.selection.current).toEqual([]);
        expect(container.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(false);
    });

    it("an empty click asks the CHART to clear when the chart owns the selection", () => {
        // Found 2026-09-15. selection.clear() has always called the container's __llmXfClear slot first;
        // the CLICK path never did, so it published an empty selection while the chart went on
        // drawing the filter it had set. Measured through 0.5.101 in Chromium: zoomed on Sales, a
        // real click on an empty corner fired onChange([], 'user') with the breadcrumb still
        // reading All > Sales. The Power BI visual does not clear on an empty click and was never
        // wrong; this is the Excel add-in and React/MCP path.
        vi.useFakeTimers({ toFake: ["Date"] });
        const h = host();
        h.render();
        chartSelects(marks()[0]);               // the CHART published this selection
        expect(h.selection.current).toEqual([0]);

        let slotCalls = 0;
        (container as any).__llmXfClear = () => {
            slotCalls++;
            // A chart that owns its selection zooms out and publishes its own clear, which
            // onXf turns into notify([]) — the same route a scrubber tick takes.
            container.dispatchEvent(new dom.window.CustomEvent("llm-xfilter-refresh", {
                bubbles: true, detail: { clear: true, source: "chart" },
            }));
        };
        click(container);
        expect(slotCalls).toBe(1);              // the chart was ASKED, not bypassed
        expect(h.selection.current).toEqual([]);
        expect(container.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(false);
    });

    it("an empty click still settles the host when the chart clears without dispatching", () => {
        // The other branch, and the reason the notify is not simply deleted: a chart whose slot
        // repaints but dispatches nothing would otherwise leave the host — and every subscriber —
        // believing the old selection is live. Same contract as selection.clear().
        vi.useFakeTimers({ toFake: ["Date"] });
        const h = host();
        h.render();
        chartSelects(marks()[0]);
        let slotCalls = 0;
        (container as any).__llmXfClear = () => { slotCalls++; /* repaints, dispatches nothing */ };
        click(container);
        expect(slotCalls).toBe(1);
        expect(h.selection.current).toEqual([]);
        expect(container.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(false);
    });

    it("an empty click never asks the chart to clear a selection it did not publish", () => {
        // The slot is more than a clear: an animated chart's returns its scrubber to "All periods".
        // A reader paused on one period who clicks a BAR and then empty canvas is dropping the bar,
        // not the period - the unconditional call jumped that chart to All (reproduced in Chromium).
        const h = host();
        h.render();
        let slotCalls = 0;
        (container as any).__llmXfClear = () => { slotCalls++; };
        click(marks()[0]);                      // a selection read off a clicked mark
        const seen: Array<[number[], string]> = [];
        h.selection.onChange((rows, source) => seen.push([rows, source]));
        click(container);
        expect(slotCalls).toBe(0);
        expect(seen).toEqual([[[], "user"]]);   // cleared exactly as a chart with no slot clears
        // ...and a selection the HOST handed in is not the chart's either.
        h.selection.highlight([1]);
        click(container);
        expect(slotCalls).toBe(0);
        expect(h.selection.current).toEqual([]);
    });

    it("a chart-published selection replaced by a mark click is no longer the chart's to clear", () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        const h = host();
        h.render();
        chartSelects(marks()[0]);
        let slotCalls = 0;
        (container as any).__llmXfClear = () => { slotCalls++; };
        click(marks()[2]);                      // the reader moved on to a plain mark
        click(container);
        expect(slotCalls).toBe(0);
        expect(h.selection.current).toEqual([]);
    });

    it("an empty click on a chart that owns NOTHING clears exactly as before", () => {
        // The no-slot branch is the one every static chart takes, and it must be untouched:
        // 505 adds a call, it does not change what an ordinary chart does.
        const h = host();
        h.render();
        click(marks()[0]);
        const seen: Array<[number[], string]> = [];
        h.selection.onChange((rows, source) => seen.push([rows, source]));
        click(container);
        expect(seen).toEqual([[[], "user"]]);   // one notify, source 'user', not 'host'
        expect(h.selection.current).toEqual([]);
    });

    it("survives a repaint — a restyle must not silently drop the highlight", () => {
        const h = host();
        h.render();
        click(marks()[1]);
        h.setOptions({ width: 400 });           // full re-render: the chart rebuilds its DOM
        expect(container.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(true);
        expect(marks()[1].classList.contains(MARK_SELECTED_CLASS)).toBe(true);
    });

    it("clear() settles host state even when the chart owns the clear", () => {
        const h = host();
        h.render();
        click(marks()[0]);
        // A chart that clears WITHOUT dispatching the refresh event: the host must not be
        // left believing the old selection is still live.
        (container as any).__llmXfClear = () => { /* repaints, dispatches nothing */ };
        h.selection.clear();
        expect(h.selection.current).toEqual([]);
        expect(container.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(false);
    });

    it("reports the clear as source 'host' so a coordinator can ignore its own echo", () => {
        const h = host();
        h.render();
        const seen: string[] = [];
        h.selection.onChange((_rows, source) => seen.push(source));
        click(marks()[0]);
        h.selection.clear();
        expect(seen).toEqual(["user", "host"]);
    });
});

describe("typography firewall", () => {
    it("neutralizes inherited line-height/letter-spacing inside the container", () => {
        host();
        const css = dom.window.document.getElementById("bic-chart-host-affordances")!.textContent!;
        // A host page with `:root { font: 18px/145% }` (the stock Vite template) otherwise
        // hands an 11px chart label a 26px line box and slices it. Found in the React demo
        // on a chart that renders perfectly inside Power BI.
        expect(css).toContain(`.${HOST_CONTAINER_CLASS} { line-height: normal; letter-spacing: normal; }`);
    });
});

describe("affordance grammar is a STABLE contract", () => {
    it("pins the literals every other host must match", () => {
        // This used to read the Power BI visual's own CSS and assert the
        // two copies agreed. The package split inverts that: a public package cannot reach
        // into a private consumer, and should not want to — the CONSUMER asserts it conforms
        // to the package. That half now lives in the visual's own repo, comparing the visual's CSS
        // against these exported constants.
        //
        // What stays here is the half this package genuinely owns: the values themselves,
        // pinned so a rename is deliberate, visible, and semver-relevant rather than a silent
        // change that makes a chart look different depending on where it runs.
        expect(HOST_CONTAINER_CLASS).toBe("bic-chart-host");
        expect(SELECTION_ACTIVE_CLASS).toBe("lch-has-selection");
        expect(MARK_SELECTED_CLASS).toBe("lch-mark-selected");
        expect(DIM_OPACITY_VAR).toBe("--lch-dim-opacity");
        expect(DIM_OPACITY_DEFAULT).toBe(0.25);
        expect(LIFT_SELECTED_CLASS).toBe("d3-lift-selected");
    });
});

// THE DIM LEVEL AS A HOST OPTION. A page could always set the CSS variable itself; options.dimOpacity lets a host move it
// per chart, live through setOptions, without writing CSS. Unset, nothing is written: the page and the stylesheet decide.
describe("dim opacity option", () => {
    const dimHost = (options?: Record<string, unknown>) =>
        createChartHost(container, { code: CODE, data: DATA as any, d3: {}, ...(options ? { options } : {}) });
    const dimVar = () => container.style.getPropertyValue(DIM_OPACITY_VAR);

    it("no option: nothing is written on the container, before or after a click", () => {
        const h = dimHost();
        h.render();
        click(marks()[1]);
        expect(container.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(true);
        expect(dimVar()).toBe("");
    });

    it("an option sets the level on the container, and setOptions moves it", () => {
        const h = dimHost({ dimOpacity: 0.4 });
        h.render();
        click(marks()[1]);
        expect(dimVar()).toBe("0.4");
        h.setOptions({ dimOpacity: 0.6 });
        expect(dimVar()).toBe("0.6");
    });

    it("a page's own value survives a host with no option; a host removes only what it wrote", () => {
        container.style.setProperty(DIM_OPACITY_VAR, "0.7");
        const plain = dimHost();
        plain.render();
        click(marks()[1]);
        expect(dimVar()).toBe("0.7");
        plain.destroy();
        expect(dimVar()).toBe("0.7");

        container.style.removeProperty(DIM_OPACITY_VAR);
        const h = dimHost({ dimOpacity: 0.4 });
        h.render();
        click(marks()[1]);
        expect(dimVar()).toBe("0.4");
        h.setOptions({ dimOpacity: undefined });
        expect(dimVar()).toBe("");
    });

    it("destroy() removes the value the host wrote, so a host rebuilt on the same element starts clean", () => {
        const h = dimHost({ dimOpacity: 0.3 });
        h.render();
        click(marks()[0]);
        expect(dimVar()).toBe("0.3");
        h.destroy();
        expect(dimVar()).toBe("");
    });

    it("a page's own inline value under a host WITH the option comes back when the host lets go", () => {
        container.style.setProperty(DIM_OPACITY_VAR, "0.6");
        const h = dimHost({ dimOpacity: 0.3 });
        h.render();
        click(marks()[1]);
        expect(dimVar()).toBe("0.3");
        h.setOptions({ dimOpacity: undefined });
        expect(dimVar()).toBe("0.6");
        h.setOptions({ dimOpacity: 0.2 });
        expect(dimVar()).toBe("0.2");
        h.destroy();
        expect(dimVar()).toBe("0.6");
    });

    // Two hosts alive on one element (a page that builds the next before it tears the old down). The first to write saves
    // what the page had; the last to let go puts it back. Neither may take another host's write for the page's.
    it("two hosts on one element: the page's own value comes back whichever lets go first", () => {
        for (const order of [[0, 1], [1, 0]]) {
            container.style.setProperty(DIM_OPACITY_VAR, "0.6");
            const hosts = [dimHost({ dimOpacity: 0.3 }), dimHost({ dimOpacity: 0.4 })];
            hosts[0].render();
            hosts[1].render();
            expect(dimVar()).toBe("0.4");
            hosts[order[0]].destroy();
            hosts[order[1]].destroy();
            expect(dimVar()).toBe("0.6");
        }
    });

    // The count of hosts holding the page's value is what keeps the first one to let go from restoring it under the other.
    it("two hosts on one element: after the first lets go the container still reads the other's level", () => {
        container.style.setProperty(DIM_OPACITY_VAR, "0.6");
        const a = dimHost({ dimOpacity: 0.3 });
        const b = dimHost({ dimOpacity: 0.4 });
        a.render();
        b.render();
        a.destroy();
        expect(dimVar()).toBe("0.4");
        b.destroy();
        expect(dimVar()).toBe("0.6");
    });

    // A page that changes its own inline value while a host holds it has the last word: letting go restores the saved
    // value only if the container still holds the level the host wrote.
    it("a value the page set while a host held the variable is left alone when the host lets go", () => {
        container.style.setProperty(DIM_OPACITY_VAR, "0.6");
        const h = dimHost({ dimOpacity: 0.3 });
        h.render();
        expect(dimVar()).toBe("0.3");
        container.style.setProperty(DIM_OPACITY_VAR, "0.9");
        h.destroy();
        expect(dimVar()).toBe("0.9");
    });

    it("a value the page set where there was none is not removed when the option goes away, nor when the host lets go", () => {
        const h = dimHost({ dimOpacity: 0.3 });
        h.render();
        container.style.setProperty(DIM_OPACITY_VAR, "0.9");
        h.setOptions({ dimOpacity: undefined });
        expect(dimVar()).toBe("0.9");
        const g = dimHost({ dimOpacity: 0.2 });
        g.render();
        container.style.setProperty(DIM_OPACITY_VAR, "0.8");
        g.destroy();
        expect(dimVar()).toBe("0.8");
    });

    it("a value the page set while two hosts held the variable is left alone by the last to let go", () => {
        container.style.setProperty(DIM_OPACITY_VAR, "0.6");
        const a = dimHost({ dimOpacity: 0.3 });
        const b = dimHost({ dimOpacity: 0.4 });
        a.render();
        b.render();
        container.style.setProperty(DIM_OPACITY_VAR, "0.9");
        a.destroy();
        expect(dimVar()).toBe("0.9");
        b.destroy();
        expect(dimVar()).toBe("0.9");
    });

    it("a host that moved its level after the first write still gives the page's value back", () => {
        container.style.setProperty(DIM_OPACITY_VAR, "0.6");
        const h = dimHost({ dimOpacity: 0.3 });
        h.render();
        h.setOptions({ dimOpacity: 0.5 });
        expect(dimVar()).toBe("0.5");
        h.destroy();
        expect(dimVar()).toBe("0.6");
    });

    it("two hosts on one element with no page value: nothing is left behind by either", () => {
        const a = dimHost({ dimOpacity: 0.3 });
        const b = dimHost({ dimOpacity: 0.4 });
        a.render();
        b.render();
        a.destroy();
        b.destroy();
        expect(dimVar()).toBe("");
    });

    it("a host created after the last one let go saves the page's value afresh", () => {
        container.style.setProperty(DIM_OPACITY_VAR, "0.6");
        const a = dimHost({ dimOpacity: 0.3 });
        a.render();
        a.destroy();
        expect(dimVar()).toBe("0.6");
        container.style.setProperty(DIM_OPACITY_VAR, "0.7");          // the page moved its own value in between
        const b = dimHost({ dimOpacity: 0.4 });
        b.render();
        expect(dimVar()).toBe("0.4");
        b.destroy();
        expect(dimVar()).toBe("0.7");
    });

    it("the option going away on one of two hosts leaves the other's hold on the page's value", () => {
        container.style.setProperty(DIM_OPACITY_VAR, "0.6");
        const a = dimHost({ dimOpacity: 0.3 });
        const b = dimHost({ dimOpacity: 0.4 });
        a.render();
        b.render();
        a.setOptions({ dimOpacity: undefined });
        b.destroy();
        expect(dimVar()).toBe("0.6");
        a.destroy();
        expect(dimVar()).toBe("0.6");
    });

    // jsdom's style declaration drops the priority of a custom property, so this one carries its own: it records what the
    // host asked for, which is the whole of the host's part.
    it("a page's value set with !important comes back with its priority", () => {
        const real = container.style;
        const props = new Map<string, { value: string; priority: string }>();
        Object.defineProperty(container, "style", {
            configurable: true,
            value: new Proxy(real, {
                get: (t, k) => {
                    if (k === "getPropertyValue") return (n: string) => props.get(n)?.value ?? "";
                    if (k === "getPropertyPriority") return (n: string) => props.get(n)?.priority ?? "";
                    if (k === "setProperty") return (n: string, v: string, pr = "") => { props.set(n, { value: v, priority: pr }); };
                    if (k === "removeProperty") return (n: string) => { props.delete(n); return ""; };
                    const v = (t as any)[k];
                    return typeof v === "function" ? v.bind(t) : v;
                },
                set: (t, k, v) => { (t as any)[k] = v; return true; },
            }),
        });
        container.style.setProperty(DIM_OPACITY_VAR, "0.6", "important");
        const h = dimHost({ dimOpacity: 0.3 });
        h.render();
        expect(props.get(DIM_OPACITY_VAR)).toEqual({ value: "0.3", priority: "" });
        h.destroy();
        expect(props.get(DIM_OPACITY_VAR)).toEqual({ value: "0.6", priority: "important" });
    });

    // A paint after the page's own write (a click, setData, setOptions) used to overwrite it as if it were the host's, and
    // the restore then put back the first-saved value: the page's later value is the one that comes back.
    it("a value the page set between two paints is the one that comes back, not the first-saved one", () => {
        container.style.setProperty(DIM_OPACITY_VAR, "0.6");
        const h = dimHost({ dimOpacity: 0.3 });
        h.render();
        container.style.setProperty(DIM_OPACITY_VAR, "0.9");
        click(marks()[1]);
        expect(dimVar()).toBe("0.3");
        h.setData(DATA as any);
        h.destroy();
        expect(dimVar()).toBe("0.9");
    });

    it("a blank set by the page between two paints means nothing comes back", () => {
        container.style.setProperty(DIM_OPACITY_VAR, "0.6");
        const h = dimHost({ dimOpacity: 0.3 });
        h.render();
        container.style.removeProperty(DIM_OPACITY_VAR);
        click(marks()[1]);
        h.destroy();
        expect(dimVar()).toBe("");
    });

    // A recording style (jsdom drops a custom property's priority), with getPropertyValue optionally missing.
    const recordingStyle = (opts: { unreadable?: boolean } = {}) => {
        const real = container.style;
        const props = new Map<string, { value: string; priority: string }>();
        Object.defineProperty(container, "style", {
            configurable: true,
            value: new Proxy(real, {
                get: (t, k) => {
                    if (k === "getPropertyValue") return opts.unreadable ? undefined : (n: string) => props.get(n)?.value ?? "";
                    if (k === "getPropertyPriority") return opts.unreadable ? undefined : (n: string) => props.get(n)?.priority ?? "";
                    if (k === "setProperty") return (n: string, v: string, pr = "") => { props.set(n, { value: v, priority: pr }); };
                    if (k === "removeProperty") return (n: string) => { props.delete(n); return ""; };
                    const v = (t as any)[k];
                    return typeof v === "function" ? v.bind(t) : v;
                },
                set: (t, k, v) => { (t as any)[k] = v; return true; },
            }),
        });
        return props;
    };

    it("the host's own number set by the page with !important is the page's, and is left alone", () => {
        const props = recordingStyle();
        container.style.setProperty(DIM_OPACITY_VAR, "0.6");
        const h = dimHost({ dimOpacity: 0.3 });
        h.render();
        container.style.setProperty(DIM_OPACITY_VAR, "0.3", "important");
        h.destroy();
        expect(props.get(DIM_OPACITY_VAR)).toEqual({ value: "0.3", priority: "important" });
    });

    it("a style that cannot be read does not keep the host's level on the container", () => {
        const props = recordingStyle({ unreadable: true });
        const h = dimHost({ dimOpacity: 0.3 });
        h.render();
        expect(props.get(DIM_OPACITY_VAR)?.value).toBe("0.3");
        h.destroy();
        expect(props.has(DIM_OPACITY_VAR)).toBe(false);
    });

    it("setOptions() and setData() on a destroyed host neither throw nor draw", () => {
        const h = dimHost({ dimOpacity: 0.3 });
        h.render();
        h.destroy();
        expect(() => h.setOptions({ dimOpacity: 0.5 })).not.toThrow();
        expect(() => h.setData(DATA as any)).not.toThrow();
        expect(marks()).toHaveLength(0);
        expect(h.options.dimOpacity).toBe(0.3);
        expect(dimVar()).toBe("");
    });

    it("a selection handed to a destroyed host paints nothing on the container", () => {
        const h = dimHost({ dimOpacity: 0.3 });
        h.render();
        h.destroy();
        h.selection.highlight([0]);
        expect(container.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(false);
        expect(dimVar()).toBe("");
        h.selection.clear();
        expect(container.classList.contains(SELECTION_ACTIVE_CLASS)).toBe(false);
        expect(dimVar()).toBe("");
    });
});

// A HOST REBUILT ON THE SAME ELEMENT. The chart's slots on the container (its clear, its animation stop, its initial
// mark) and the clicked-marks record belong to whichever host drew last; a reference to the destroyed one (a stale
// closure, a late callback) must reach none of them.
describe("a destroyed host leaves the host rebuilt on its element alone", () => {
    it("clear(), animation.stop(), setAnnotations() and initialMark() on the old host touch nothing of the new one", () => {
        const old = host();
        old.render();
        old.destroy();
        const live = host();
        const seen: Array<[number[], string]> = [];
        live.selection.onChange((rows, src) => seen.push([rows, src]));
        live.render();
        const calls: string[] = [];
        (container as any)[CONTAINER_SLOT_XF_CLEAR] = () => calls.push("clear");
        (container as any)[CONTAINER_SLOT_ANIM_STOP] = () => calls.push("stop");
        (container as any)[CONTAINER_SLOT_INITIAL_XF_MARK] = marks()[2];
        click(marks()[1]);
        const clicked = (container as any)[CONTAINER_SLOT_CLICKED_MARKS];
        expect(live.selection.current).toEqual([1]);

        old.selection.clear();
        old.animation.stop();
        old.setAnnotations([{ column: "City", value: "B", label: "1" }]);
        const oldMark = old.initialMark();

        expect(calls).toEqual([]);
        expect(live.selection.current).toEqual([1]);
        expect(seen).toEqual([[[1], "user"]]);
        expect((container as any)[CONTAINER_SLOT_CLICKED_MARKS] === clicked).toBe(true);
        expect(container.querySelector(".bic-annotations") === null).toBe(true);
        expect(oldMark === null).toBe(true);
        expect(marks()[1].classList.contains(MARK_SELECTED_CLASS)).toBe(true);
        live.destroy();
    });
});
