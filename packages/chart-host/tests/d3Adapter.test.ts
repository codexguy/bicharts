// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createD3Adapter, NULL_ADAPTER } from "../src/adapters";
import type { AdapterScene, RendererAdapter } from "../src/adapters";
import * as main from "../src/index";
import {
    collectD3GlyphCenters, rowIdxsFromMark, selectionRuleOf,
} from "../src/selection";
import { censusHitBands, hitBandFlag } from "../src/hitBands";
import { ensureCrossfilterHitTargets } from "../src/hitTargets";
import {
    CONTROL_CLASS, MARK_KEY_ATTR, SELECTION_RULE_ATTR, SELECTION_RULE_CLICKED_MARKS,
} from "../src/contract";

// THE D3 BINDING, NAMED, CHANGING NOTHING.
//
// The adapter wraps functions chart-host already ships (selection.ts, hitTargets.ts, hitBands.ts) in the shape a
// renderer adapter has. These cases pin that it answers exactly as those functions do on the same chart, that it tells
// the four gestures a click can be apart (a mark, a control, empty canvas, a mark that names no rows), and that the
// seam stays off the main entry.

const pkgRoot = resolve(__dirname, "..");

let container: HTMLDivElement;
let logs: Array<{ tag: string; data?: object }>;
let scene: AdapterScene;
let adapter: RendererAdapter<Element>;

beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    logs = [];
    scene = { container, doc: document, log: (tag, data) => logs.push({ tag, data }) };
    adapter = createD3Adapter();
});
afterEach(() => { document.body.innerHTML = ""; });

function add(html: string): Element {
    const host = document.createElement("div");
    host.innerHTML = html.trim();
    const node = host.firstElementChild!;
    container.appendChild(node);
    return node;
}

const click = (target: Element, extra: Record<string, unknown> = {}) =>
    ({ native: { target, ...extra }, modifiers: {} });

describe("the D3 adapter: identity", () => {
    it("is the container-click binding", () => {
        expect(adapter.id).toBe("D3");
        expect(adapter.input).toBe("container-click");
    });

    it("the null adapter is legal: no marks, no binding, no capability", () => {
        expect(NULL_ADAPTER.id).toBe("NONE");
        expect(NULL_ADAPTER.input).toBe("none");
        for (const k of ["bind", "marks", "hit", "rowsOf", "declaredRule", "paint", "glyphAnchors", "prepare", "census"]) {
            expect((NULL_ADAPTER as any)[k]).toBeUndefined();
        }
    });
});

describe("the D3 adapter: what a click hit", () => {
    it("a data mark: its rows, its key, its role, and the element itself as the handle", () => {
        const m = add(`<div class="d3-mark" data-row-idx="3,7"></div>`);
        const hit = adapter.hit!(click(m), scene);
        expect(hit.kind).toBe("mark");
        if (hit.kind !== "mark") return;
        expect(hit.mark.handle).toBe(m);
        expect(hit.mark.role).toBe("mark");
        expect(hit.mark.rows).toEqual([3, 7]);
        expect(hit.mark.key).toBe("rows:3,7");
    });

    it("a click on something inside a mark resolves up to the mark", () => {
        const m = add(`<div class="d3-mark" data-row-idx="4"><span id="inner">x</span></div>`);
        const inner = m.querySelector("#inner")!;
        const hit = adapter.hit!(click(inner), scene);
        expect(hit.kind === "mark" && hit.mark.handle === m).toBe(true);
    });

    it("a legend swatch and an axis label are told apart from a data mark", () => {
        const sw = add(`<div class="d3-legend-mark" data-row-idx="1,2,3"></div>`);
        const tick = add(`<div class="d3-axis-filter" data-row-idx="5"></div>`);
        const a = adapter.hit!(click(sw), scene);
        const b = adapter.hit!(click(tick), scene);
        expect(a.kind === "mark" && a.mark.role).toBe("legend");
        expect(b.kind === "mark" && b.mark.role).toBe("axis");
    });

    it("a mark's own key wins over its rows", () => {
        const m = add(`<div class="d3-mark" data-row-idx="2" ${MARK_KEY_ATTR}="word:alpha"></div>`);
        const hit = adapter.hit!(click(m), scene);
        expect(hit.kind === "mark" && hit.mark.key).toBe("word:alpha");
    });

    it("a click inside a control the chart drew is a control, not a selection and not empty canvas", () => {
        const ctl = add(`<div class="${CONTROL_CLASS}"><input id="box"></div>`);
        const hit = adapter.hit!(click(ctl.querySelector("#box")!), scene);
        expect(hit).toEqual({ kind: "control" });
    });

    it("a click on empty canvas is empty", () => {
        add(`<div class="d3-mark" data-row-idx="1"></div>`);
        expect(adapter.hit!(click(container, { clientX: 5, clientY: 5 }), scene)).toEqual({ kind: "empty" });
    });

    it("a mark that names no rows is ignored, with the reason", () => {
        const m = add(`<div class="d3-mark" data-row-idx="x"></div>`);
        const hit = adapter.hit!(click(m), scene);
        expect(hit.kind).toBe("ignored");
        if (hit.kind === "ignored") expect(hit.reason).toMatch(/no rows/);
    });
});

describe("the D3 adapter: the rest is the shared functions' answer", () => {
    it("rowsOf is rowIdxsFromMark, which drops negatives and non-numbers", () => {
        const m = add(`<div class="d3-mark" data-row-idx=" 3, 7 ,x,-1,0"></div>`);
        expect(adapter.rowsOf!(m, scene)).toEqual(rowIdxsFromMark(m));
        expect(adapter.rowsOf!(m, scene)).toEqual([3, 7, 0]);
    });

    it("declaredRule is any-row until the chart declares clicked-marks", () => {
        expect(adapter.declaredRule!(scene)).toBe("any-row");
        add(`<g ${SELECTION_RULE_ATTR}="${SELECTION_RULE_CLICKED_MARKS}"></g>`);
        expect(adapter.declaredRule!(scene)).toBe("clicked-marks");
        expect(adapter.declaredRule!(scene)).toBe(selectionRuleOf(container));
    });

    it("glyphAnchors is collectD3GlyphCenters over the container", () => {
        const m = add(`<div class="d3-mark lch-mark-selected" data-row-idx="0"></div>`);
        (m as any).getBoundingClientRect = () =>
            ({ left: 40, top: 30, width: 20, height: 10, right: 60, bottom: 40, x: 40, y: 30 }) as DOMRect;
        const base = { left: 10, top: 5 };
        const direct: { x: number; y: number }[] = [];
        collectD3GlyphCenters(container, base, direct);
        expect(direct.length).toBe(1);
        expect(adapter.glyphAnchors!(base, scene)).toEqual(direct);
    });

    it("prepare is ensureCrossfilterHitTargets and reports what it changed", () => {
        add(`<div class="d3-mark" data-row-idx="1"></div>`);
        expect(adapter.prepare!(scene)).toEqual(ensureCrossfilterHitTargets(container, document));
    });

    it("census is the hit-band flag with its detail, and null when there is nothing to say", () => {
        expect(adapter.census!(scene)).toBeNull();
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        container.appendChild(svg);
        const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
        p.setAttribute("d", "M0,0L10,10");
        p.setAttribute("fill", "none");
        p.setAttribute("stroke", "#2e86ab");
        p.setAttribute("stroke-width", "2");
        p.setAttribute("class", "ecdf-line d3-mark");
        p.setAttribute("data-row-idx", "0,1,2");
        svg.appendChild(p);
        const detail = censusHitBands(container, document);
        const got = adapter.census!(scene);
        expect(got).toEqual({ flag: hitBandFlag(detail), detail });
        expect(got!.flag).toBe("hitband:d3:thin");
    });
});

describe("the seam stays off the main entry", () => {
    it("the main entry exports no adapter code (types cost nothing; the binding is its own entry)", () => {
        expect("createD3Adapter" in main).toBe(false);
        expect("NULL_ADAPTER" in main).toBe(false);
    });

    it("package.json exports ./adapters and build.mjs builds it", () => {
        const pkg = JSON.parse(readFileSync(resolve(pkgRoot, "package.json"), "utf8"));
        expect(pkg.exports["./adapters"]).toEqual({
            types: "./dist/types/adapters/index.d.ts",
            import: "./dist/adapters.mjs",
            default: "./dist/adapters.mjs",
        });
        const build = readFileSync(resolve(pkgRoot, "build.mjs"), "utf8");
        expect(build).toMatch(/adapters:\s*join\(here,\s*"src\/adapters\/index\.ts"\)/);
    });

    it("the adapter does not touch the contract: the server-read constants stay literal strings", () => {
        const src = readFileSync(resolve(pkgRoot, "src/contract.ts"), "utf8");
        for (const name of ["MARK_CLASS", "AXIS_FILTER_CLASS", "ROW_IDX_ATTR", "XFILTER_REFRESH_EVENT",
            "CONTAINER_SLOT_ANIM_STOP", "CONTAINER_SLOT_XF_CLEAR", "CONTAINER_SLOT_INITIAL_XF_MARK"]) {
            expect(src, name).toMatch(new RegExp(`export const ${name}\\s*=\\s*"[^"]+"`));
        }
    });
});
