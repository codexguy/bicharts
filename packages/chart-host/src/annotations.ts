// A NOTE SHOWS ON ITS MARK. An app that lets readers leave a note on a country or a route has to show it on that
// mark the next time anyone opens the page. Measured on an agent building one: it read each mark's data-row-idx
// after paint and positioned badges over bounding boxes itself - code that breaks on the next redraw, filter or
// zoom, and that every host would otherwise write again. The host already knows every mark (the same
// `.d3-mark[data-row-idx]` it resolves clicks from) and every render's settled moment, so it draws them.
//
// Keyed by a VALUE IN A COLUMN - a model key such as a country code - never by a row position: a filter, a
// re-query or a group member's own payload renumbers rows, and the same integer then names a different record.
// The key is matched against the chart's CURRENT data on every draw, so it lands on the right mark in any
// payload space. Host-side and additive: no generated chart has to know annotations exist.

import { CONTROL_CLASS, MARK_CLASS, ROW_IDX_ATTR } from "./contract";
import { clipWindowOf } from "./fitDom";
import { LASSO_OUTLINE_CLASS } from "./lasso";

export interface MarkAnnotation {
    /** The column holding the key (with `value`). */
    column?: string;
    /** The key's value; matched as text, trimmed, so a number column and a string key agree. */
    value?: string | number;
    /**
     * A key over several columns - a route by both of its ends, `{ Origin: "BRA", Dest: "CHL" }` - so no key
     * column has to be added to the query or the chart. Every named column must match. Used instead of column/value.
     */
    where?: Record<string, string | number>;
    /** Badge text (a count, a letter). Default: a dot. */
    label?: string;
    /** Tooltip text - the note, or a summary of several. */
    title?: string;
    /** Anything the host wants back on click. */
    id?: string;
}

export interface AnnotationReport {
    /** Annotations drawn on a mark. */
    shown: number;
    /** Annotations with no mark in this render (filtered out, off the map, no such key). */
    notShown: number;
}

export const ANNOTATION_LAYER_CLASS = "bic-annotations";
export const ANNOTATION_CLASS = "bic-annotation";

/** The class the d3.llmGeoZoom helper gives its button pad - a control drawn by a generated chart without the
 *  contract's CONTROL_CLASS, so the badge layer names it too. */
export const ZOOM_PAD_CLASS = "llm-zoom-pad";

const text = (v: unknown) => (v == null ? "" : String(v).trim());

type Box = { l: number; t: number; r: number; b: number };
const FREE: Box = { l: -Infinity, t: -Infinity, r: Infinity, b: Infinity };
const box = (r: { left: number; top: number; right: number; bottom: number }): Box => ({ l: r.left, t: r.top, r: r.right, b: r.bottom });
const area = (b: Box) => (b.r - b.l) * (b.b - b.t);
const cut = (a: Box | null, b: Box): Box | null => {
    if (!a) return null;
    const c = { l: Math.max(a.l, b.l), t: Math.max(a.t, b.t), r: Math.min(a.r, b.r), b: Math.min(a.b, b.b) };
    return c.r > c.l && c.b > c.t ? c : null;
};

/** Is a screen point on this mark's filled shape? Answers "yes" wherever the browser can't say (no isPointInFill, no
 *  screen matrix, a throw), so a host without geometry keeps the plain box placement. */
function shapeTest(mark: Element | null): (x: number, y: number) => boolean {
    const g = mark as unknown as { isPointInFill?: (p: DOMPointInit) => boolean; getScreenCTM?: () => DOMMatrix | null } | null;
    let inv: { a: number; b: number; c: number; d: number; e: number; f: number } | null = null;
    try { inv = g?.isPointInFill ? g.getScreenCTM?.()?.inverse() ?? null : null; } catch { inv = null; }
    if (!g || !inv) return () => true;
    const m = inv;
    return (x, y) => {
        try { return g.isPointInFill!({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }); } catch { return true; }
    };
}

const parseIdxs = (s: string | null) => (s || "").split(",").map(x => parseInt(x, 10)).filter(n => Number.isFinite(n));

export interface AnnotationLayer {
    set(list: MarkAnnotation[]): void;
    /** Redraw against the container's current marks and the given data. */
    draw(data: { columns: any[]; rows: any[][] }, theme: { fg?: string; accent?: string; bg?: string }): void;
    readonly report: AnnotationReport;
    destroy(): void;
}

export function createAnnotationLayer(container: HTMLElement, onClick?: (a: MarkAnnotation) => void): AnnotationLayer {
    let list: MarkAnnotation[] = [];
    let report: AnnotationReport = { shown: 0, notShown: 0 };
    let last: { data: { columns: any[]; rows: any[][] }; theme: { fg?: string; accent?: string; bg?: string } } | null = null;
    const doc = container.ownerDocument;
    const win = doc.defaultView;

    // MOVING MARKS. A zoom, a pan or a transition moves marks without a render; the badges follow on the next
    // frame. Connected only while there is something to draw, and blind to the layer's own changes.
    let observer: MutationObserver | null = null;
    let queued = false;
    const redrawSoon = () => {
        if (queued || !last) return;
        queued = true;
        const run = () => { queued = false; if (last) paint(last.data, last.theme); };
        if (win?.requestAnimationFrame) win.requestAnimationFrame(run); else setTimeout(run, 16);
    };
    const watch = (on: boolean) => {
        const MO = (win as any)?.MutationObserver as typeof MutationObserver | undefined;
        if (on && !observer && MO) {
            observer = new MO(records => {
                // Blind to the layer's own changes, and to the lasso outline, whose path changes on every pointer move
                // and moves no mark.
                if (records.some(r => !(r.target as Element).closest?.(`.${ANNOTATION_LAYER_CLASS}, .${LASSO_OUTLINE_CLASS}`))) redrawSoon();
            });
            observer.observe(container, { subtree: true, attributes: true, attributeFilter: ["transform", "d", "cx", "cy", "x", "y", "points"] });
        } else if (!on && observer) { observer.disconnect(); observer = null; }
    };

    function paint(data: { columns: any[]; rows: any[][] }, theme: { fg?: string; accent?: string; bg?: string }) {
        let layer = container.querySelector<HTMLElement>(`:scope > .${ANNOTATION_LAYER_CLASS}`);
        if (!list.length) {
            layer?.remove();
            report = { shown: 0, notShown: 0 };
            return;
        }
        if (!layer) {
            layer = doc.createElement("div");
            layer.className = ANNOTATION_LAYER_CLASS;
            layer.setAttribute("aria-hidden", "false");
            Object.assign(layer.style, { position: "absolute", left: "0", top: "0", width: "0", height: "0", overflow: "visible", zIndex: "2" });
            // A positioned ancestor for the badges, set only when the page left the container static.
            if (win?.getComputedStyle(container).position === "static") container.style.position = "relative";
            container.appendChild(layer);
        }
        layer.textContent = "";

        // Rows by key, then marks by row: each annotation's rows in THIS render's data.
        const names = (data.columns || []).map((c: any) => (typeof c === "string" ? c : c?.name));
        const marks = Array.from(container.querySelectorAll<Element>(`.${MARK_CLASS}[${ROW_IDX_ATTR}]`))
            .filter(m => !m.closest(`.${ANNOTATION_LAYER_CLASS}`));
        const marksByRow = new Map<number, Element[]>();
        for (const m of marks) for (const r of parseIdxs(m.getAttribute(ROW_IDX_ATTR))) {
            const at = marksByRow.get(r);
            if (at) at.push(m); else marksByRow.set(r, [m]);
        }
        const origin = container.getBoundingClientRect();
        const open = origin.width > 0 && origin.height > 0 ? box(origin) : FREE;
        // Where a reader can see a mark: the container, the mark's svg (an svg clips at its own frame) and every
        // clip-path window on the way up. A host that hasn't laid out yet constrains nothing.
        const clipOf = new Map<Element, Box | null>();
        const viewOf = (m: Element): Box | null => {
            let v: Box | null = open;
            const svg = m.closest("svg");
            if (svg) { const s = svg.getBoundingClientRect(); if (s.width > 0 && s.height > 0) v = cut(v, box(s)); }
            for (let el: Element | null = m.parentElement; v && el && el !== svg && el !== container; el = el.parentElement) {
                if (!clipOf.has(el)) { const w = clipWindowOf(el); clipOf.set(el, w && box(w)); }
                const w = clipOf.get(el);
                if (w) v = cut(v, w);
            }
            return v;
        };
        // The chart's own controls - the contract's, and the zoom helper's button pad - which no badge may cover.
        const controls = Array.from(container.querySelectorAll(`.${CONTROL_CLASS}, .${ZOOM_PAD_CLASS}`))
            .map(c => c.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0).map(box);
        // A point for a badge of this label inside `v`, its box clear of every control, and ON the mark's own shape
        // where the browser can say (a country's visible box can be mostly ocean): the centre first, then the nearest
        // points across the visible part, then just past the edge of a control it would cover. None -> null.
        const clear = (v: Box, len: number, mark: Element | null): [number, number] | null => {
            const hw = Math.max(16, len * 6 + 8) / 2, hh = 8, g = 2;
            const cx = (v.l + v.r) / 2, cy = (v.t + v.b) / 2;
            const free = (x: number, y: number) => x >= v.l && x <= v.r && y >= v.t && y <= v.b
                && controls.every(c => x + hw <= c.l || x - hw >= c.r || y + hh <= c.t || y - hh >= c.b);
            const onShape = shapeTest(mark);
            const tries: Array<[number, number]> = [[cx, cy]];
            for (let i = 0; i <= 8; i++) for (let j = 0; j <= 6; j++) tries.push([v.l + (v.r - v.l) * i / 8, v.t + (v.b - v.t) * j / 6]);
            tries.sort((p, q) => Math.hypot(p[0] - cx, p[1] - cy) - Math.hypot(q[0] - cx, q[1] - cy));
            for (const c of controls) tries.push([cx, c.b + hh + g], [cx, c.t - hh - g], [c.l - hw - g, cy], [c.r + hw + g, cy]);
            return tries.find(([x, y]) => free(x, y) && onShape(x, y))
                ?? tries.find(([x, y]) => free(x, y)) ?? null;
        };
        let shown = 0;
        for (const a of list) {
            // The key as (column index, wanted text) pairs; a column this chart doesn't have matches nothing.
            const pairs: Array<[number, string]> = (a.where
                ? Object.entries(a.where)
                : a.column != null ? [[a.column, a.value] as [string, unknown]] : []
            ).map(([c, v]) => [names.indexOf(c), text(v)]);
            const want = pairs.map(p => p[1]).join(" / ");
            const hits = new Set<Element>();
            if (pairs.length && pairs.every(p => p[0] >= 0)) (data.rows || []).forEach((row, r) => {
                if (pairs.every(([ci, v]) => text(row?.[ci]) === v)) for (const m of marksByRow.get(r) ?? []) hits.add(m);
            });
            if (!hits.size) continue;
            // The biggest VISIBLE part of the key's marks carries the badge: a country's mainland, not an island; a
            // route's arc, not its end dot; and on a zoomed or panned map, the part in view (a box clipped to the
            // map, the svg, any clip-path) - not the centre of an outline running off the edge.
            let best: Box | null = null, bestMark: Element | null = null, laidOut = false;
            for (const m of hits) {
                const b = m.getBoundingClientRect();
                if (!(b.width > 0 && b.height > 0)) continue;
                laidOut = true;
                const v = cut(box(b), viewOf(m));
                if (v && (!best || area(v) > area(best))) { best = v; bestMark = m; }
            }
            // Nothing of it in view: no badge (counted below as not shown). A mark with no box yet keeps the old way.
            const pt: [number, number] | null = best ? clear(best, (a.label ?? "•").length, bestMark) : null;
            if (laidOut && !pt) continue;
            shown++;
            const badge = doc.createElement("div");
            badge.className = ANNOTATION_CLASS;
            badge.textContent = a.label ?? "•";
            if (a.title) badge.setAttribute("title", a.title);
            badge.setAttribute("role", "button");
            badge.setAttribute("aria-label", a.title ? `Note: ${a.title}` : `Note on ${want}`);
            Object.assign(badge.style, {
                position: "absolute",
                left: `${Math.round(pt ? pt[0] - origin.left : 0)}px`,
                top: `${Math.round(pt ? pt[1] - origin.top : 0)}px`,
                transform: "translate(-50%, -50%)",
                minWidth: "16px", height: "16px", padding: "0 4px", boxSizing: "border-box",
                borderRadius: "8px", font: "600 10px/16px system-ui, sans-serif", textAlign: "center",
                color: theme.bg || "#ffffff", background: theme.accent || theme.fg || "#0f6cbd",
                boxShadow: `0 0 0 1.5px ${theme.bg || "#ffffff"}`, cursor: onClick ? "pointer" : "default",
                // Never pointer-events (a host failsafe turns it back on); visibility hides a badge whose mark
                // has no box yet.
                visibility: laidOut ? "visible" : "hidden",
            });
            badge.addEventListener("click", e => {
                // The mark beneath must not be selected by a click meant for the note.
                e.stopPropagation();
                onClick?.(a);
            });
            layer.appendChild(badge);
        }
        report = { shown, notShown: list.length - shown };
    }

    return {
        set(next) {
            list = Array.isArray(next) ? next.slice() : [];
            watch(list.length > 0);
            if (last) paint(last.data, last.theme);
        },
        draw(data, theme) {
            last = { data, theme };
            paint(data, theme);
        },
        get report() { return report; },
        destroy() {
            watch(false);
            list = [];
            last = null;
            container.querySelector(`:scope > .${ANNOTATION_LAYER_CLASS}`)?.remove();
        },
    };
}
