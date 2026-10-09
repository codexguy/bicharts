// THE D3 BINDING, NAMED. Every capability here is a function chart-host already ships and the core already calls; the
// adapter only gives them the renderer-adapter shape (adapters/types.ts). Nothing here changes how a click, a paint or a
// census behaves, and the core does not consume it yet.
//
// Not wrapped, because nothing exists to wrap: `marks` and `paint`. The core lists D3 marks and toggles the selected
// class inline (host.ts), and the visual does the same in its own copy. Making them adapter capabilities is a
// behavior-neutral refactor of those two call sites, and a separate change from naming the seam.

import { AXIS_FILTER_CLASS, LEGEND_MARK_CLASS, MARK_CLASS, ROW_IDX_ATTR } from "../contract";
import { censusHitBands, hitBandFlag } from "../hitBands";
import { ensureCrossfilterHitTargets } from "../hitTargets";
import {
    clickWasDrag, collectD3GlyphCenters, createMarkResolver, isInsideControl, markKeyOf, rowIdxsFromMark, selectionRuleOf,
} from "../selection";
import type { AdapterEvent, AdapterHit, AdapterScene, MarkInfo, MarkRole, RendererAdapter } from "./types";

/** What a click may land on: a data mark, a legend swatch or an axis label, each only when it names rows. */
const CLICK_SELECTOR =
    `.${MARK_CLASS}[${ROW_IDX_ATTR}], .${LEGEND_MARK_CLASS}[${ROW_IDX_ATTR}], .${AXIS_FILTER_CLASS}[${ROW_IDX_ATTR}]`;

function roleOf(el: Element): MarkRole {
    const cl = el.classList;
    if (cl?.contains(AXIS_FILTER_CLASS)) return "axis";
    if (cl?.contains(LEGEND_MARK_CLASS)) return "legend";
    return "mark";
}

function markInfo(el: Element): MarkInfo<Element> {
    return { handle: el, role: roleOf(el), rows: rowIdxsFromMark(el), key: markKeyOf(el) };
}

/** The adapter for a chart drawn with D3: a mark is a DOM element, and its rows are in `data-row-idx`. */
export function createD3Adapter(): RendererAdapter<Element> {
    return {
        id: "D3",
        input: "container-click",

        hit(event: AdapterEvent, scene: AdapterScene): AdapterHit<Element> {
            const e: any = event.native;
            // A click in the chart's own control is neither a selection nor a click on empty canvas.
            if (isInsideControl(e?.target, scene.container)) return { kind: "control" };
            const x = event.clientX ?? e?.clientX;
            const y = event.clientY ?? e?.clientY;
            // The click that ends a drag is the tail of a gesture the chart owns: it resolves nothing and clears
            // nothing (a drag released on empty canvas is not an empty click). Reads the press the host recorded.
            if (clickWasDrag(scene.container, { clientX: x, clientY: y, detail: e?.detail })) {
                return { kind: "ignored", reason: "a drag, not a click" };
            }
            const resolver = createMarkResolver({
                root: scene.container, doc: scene.doc, log: (tag, data) => scene.log(tag, data),
            });
            // The same three steps, in the same order, the core's click handler runs: the event target, then the mark
            // under a transparent overlay, then geometry. The later two run only when the earlier resolved nothing.
            let el: Element | null = resolver.findMark(e?.target, CLICK_SELECTOR, e);
            if (!el) el = resolver.penetrateOverlayAt(x, y, CLICK_SELECTOR);
            if (!el) el = resolver.resolveByGeometry(x, y, CLICK_SELECTOR);
            if (!el) return { kind: "empty" };
            const info = markInfo(el);
            if (!info.rows.length) return { kind: "ignored", reason: "mark names no rows" };
            return { kind: "mark", mark: info };
        },

        rowsOf: (handle) => rowIdxsFromMark(handle),

        declaredRule: (scene) => selectionRuleOf(scene.container),

        glyphAnchors(base, scene) {
            const out: { x: number; y: number }[] = [];
            collectD3GlyphCenters(scene.container, base, out);
            return out;
        },

        prepare: (scene) => ensureCrossfilterHitTargets(scene.container, scene.doc),

        census(scene) {
            const detail = censusHitBands(scene.container, scene.doc);
            const flag = hitBandFlag(detail);
            return flag ? { flag, detail } : null;
        },
    };
}
