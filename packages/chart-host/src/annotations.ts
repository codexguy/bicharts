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

import { MARK_CLASS, ROW_IDX_ATTR } from "./contract";

export interface MarkAnnotation {
    /** The column holding the key. */
    column: string;
    /** The key's value; matched as text, trimmed, so a number column and a string key agree. */
    value: string | number;
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

const text = (v: unknown) => (v == null ? "" : String(v).trim());
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
                if (records.some(r => !(r.target as Element).closest?.(`.${ANNOTATION_LAYER_CLASS}`))) redrawSoon();
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
        let shown = 0;
        for (const a of list) {
            const col = names.indexOf(a.column);
            const want = text(a.value);
            const hits = new Set<Element>();
            if (col >= 0) (data.rows || []).forEach((row, r) => {
                if (text(row?.[col]) === want) for (const m of marksByRow.get(r) ?? []) hits.add(m);
            });
            if (!hits.size) continue;
            shown++;
            // The biggest of the key's marks carries the badge: a country's mainland, not an island; a route's arc,
            // not its end dot.
            let best: DOMRect | null = null;
            for (const m of hits) {
                const b = m.getBoundingClientRect();
                if (!best || b.width * b.height > best.width * best.height) best = b;
            }
            const badge = doc.createElement("div");
            badge.className = ANNOTATION_CLASS;
            badge.textContent = a.label ?? "•";
            if (a.title) badge.setAttribute("title", a.title);
            badge.setAttribute("role", "button");
            badge.setAttribute("aria-label", a.title ? `Note: ${a.title}` : `Note on ${want}`);
            const laidOut = !!best && best.width > 0 && best.height > 0;
            Object.assign(badge.style, {
                position: "absolute",
                left: `${Math.round(laidOut ? best!.left - origin.left + best!.width / 2 : 0)}px`,
                top: `${Math.round(laidOut ? best!.top - origin.top + best!.height / 2 : 0)}px`,
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
