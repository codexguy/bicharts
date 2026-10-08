// THE RENDERER ADAPTER: the seam between chart-host's renderer-neutral core and one renderer's binding.
//
// The grammar every host shares (the lch-* names, the cross-filter event, the container slots, the options, the view
// state, the selection rules in selection.ts) is renderer-neutral: that is the core. What a MARK is, how a click
// resolves to rows and how a selection is painted back are not:
//   - D3: a mark is a DOM element. Its rows are in `data-row-idx`, a click is resolved by closest() then geometry, and
//     a selection is painted by toggling a class.
//   - Plotly: a mark is a {curve, point} pair from the click event, never a DOM node. Its rows come from `customdata`,
//     bounded by the row count; a legend click names a whole trace; a selection is painted by restyling the figure.
//   - Vega: a click names dimension VALUES, not rows, so rows come from the row table; a selection is painted inside
//     the dataflow from the selected row set; a click on no item is IGNORED, where a D3 click on empty canvas CLEARS.
//
// This file is TYPES ONLY, written against those three. Nothing in the core consumes it yet: it names the boundary so a
// second renderer can be added without touching the core, and so the D3 binding has a name (adapters/d3.ts wraps
// the functions that exist today and changes no behavior). The constants stay in contract.ts, where the server's
// contract validator reads them.

import type { RendererId } from "../host/services";
import type { SelectionModifiers, SelectionPaintPlan, SelectionRule, GlyphCenter } from "../selection";

/** What a renderer calls a mark. Opaque to the core: D3 an Element, Plotly {curve, point}, Vega a scenegraph item. */
export type MarkHandle = unknown;

/** What a mark is for: a data mark, a legend swatch, or an axis label that filters. */
export type MarkRole = "mark" | "legend" | "axis";

/** Which renderer an adapter binds: the same vocabulary a host declares it supports (host/services.ts). */
export type AdapterId = RendererId | "NONE";

/** The rows a renderer that works in values (Vega) resolves a click against. */
export interface RowTable {
    rows: readonly Record<string, unknown>[];
    columns: readonly { name?: string; isMeasure?: boolean }[];
}

/** Everything an adapter may need about the chart it is bound to. */
export interface AdapterScene {
    container: HTMLElement;
    doc: Document;
    /** How many rows the chart has: the bound a renderer that reads row numbers from its own data must check. */
    rowCount?: number;
    /** The row table, for a renderer whose marks name values. */
    table?: RowTable;
    /** The diagnostics sink; the resolution logic logs through it and never throws. */
    log(tag: string, data?: object): void;
}

/** One mark as the core sees it. */
export interface MarkInfo<H = MarkHandle> {
    handle: H;
    role: MarkRole;
    /** The data rows the mark stands for. */
    rows: readonly number[];
    /** The mark's identity under the "clicked-marks" selection rule. */
    key: string;
}

/** A click as the core hands it over. `native` is whatever the renderer's own event is. */
export interface AdapterEvent {
    native: unknown;
    clientX?: number;
    clientY?: number;
    modifiers: SelectionModifiers;
}

/**
 * What a click turned out to be. The four are different gestures and the core answers each differently, so an
 * adapter must say which:
 *   mark    - a mark (furniture included; `role` says which);
 *   control - inside a control the chart drew: neither a selection nor a click on empty canvas;
 *   empty   - the empty canvas: the core MAY clear the selection (D3);
 *   ignored - a click that resolves to nothing the adapter can use: log it and change nothing (Vega).
 */
export type AdapterHit<H = MarkHandle> =
    | { kind: "mark"; mark: MarkInfo<H> }
    | { kind: "control" }
    | { kind: "empty" }
    | { kind: "ignored"; reason: string };

/** A request to draw a selection. `plan` is present when the renderer's marks can be listed (D3). */
export interface PaintRequest<H = MarkHandle> {
    selection: ReadonlySet<number>;
    active: boolean;
    dimOpacity: number;
    plan?: { marks: readonly MarkInfo<H>[]; result: SelectionPaintPlan };
}

/**
 * One renderer's binding. Every capability but identity is optional, because renderers differ in what they own: a
 * renderer that subscribes to its own click events implements `bind` and leaves `hit` out; one the core's container
 * listener serves implements `hit`.
 */
export interface RendererAdapter<H = MarkHandle> {
    readonly id: AdapterId;
    /** Who delivers clicks: the core's container listener, the adapter's own subscription, or nobody. */
    readonly input: "container-click" | "adapter-bound" | "none";
    /** Subscribe to the renderer's own click events; returns the unsubscribe. */
    bind?(scene: AdapterScene, onHit: (hit: AdapterHit<H>, modifiers: SelectionModifiers) => void): () => void;
    /** Every mark the chart drew, as opaque handles. */
    marks?(scene: AdapterScene): readonly MarkInfo<H>[];
    /** Resolve a click to what it hit. */
    hit?(event: AdapterEvent, scene: AdapterScene): AdapterHit<H>;
    /** The data rows a mark stands for. */
    rowsOf?(handle: H, scene: AdapterScene, role?: MarkRole): number[];
    /** How a selection lights this chart's marks; "any-row" when the chart declared nothing. */
    declaredRule?(scene: AdapterScene): SelectionRule;
    /** Draw a selection. */
    paint?(request: PaintRequest<H>, scene: AdapterScene): void | Promise<void>;
    /** Where each selected mark's glyph goes, in pixels from `base`. */
    glyphAnchors?(base: { left: number; top: number }, scene: AdapterScene): GlyphCenter[];
    /** Make the render hittable after it draws; returns what it changed. */
    prepare?(scene: AdapterScene): unknown;
    /** A behavior tag and detail for the render, or null when there is nothing to say. */
    census?(scene: AdapterScene): { flag: string; detail: object } | null;
}

/** No marks and no binding: legal, and what a chart that cannot be selected from is. */
export const NULL_ADAPTER: RendererAdapter = { id: "NONE", input: "none" };
