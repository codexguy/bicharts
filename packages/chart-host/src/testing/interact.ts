// DRIVE A HOSTED CHART FROM A TEST (2026-10-02). Part of "@bicharts/chart-host/testing".
//
// The gestures a reader makes on a chart, for an app's own tests (jsdom, or a browser through
// Playwright's page.evaluate): click a mark, click it again, click empty canvas, Ctrl-click to add -
// and what the chart shows as selected afterwards. Written against the host's DOM contract (every
// mark is `.d3-mark[data-row-idx]`, a selected one carries `lch-mark-selected`, the hosted container
// `bic-chart-host`), so a test never reaches into a chart's internals.
//
// The checks an app should keep, because each failed in an agent-built app: a second click on the
// same mark un-filters; a page Clear clears the chart's marks; new data that drops the pick clears
// the page's state; a scenario saves before any slider has moved.

import { HOST_CONTAINER_CLASS, MARK_CLASS, MARK_SELECTED_CLASS, ROW_IDX_ATTR } from "../contract";

/** Every hosted chart container under `root` (a page, a component's element). */
export function chartContainers(root: ParentNode): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(`.${HOST_CONTAINER_CLASS}`));
}

/** The chart's data marks, in DOM order. */
export function marksOf(chart: ParentNode): Element[] {
    return Array.from(chart.querySelectorAll(`.${MARK_CLASS}[${ROW_IDX_ATTR}]`))
        .filter(m => (m.getAttribute(ROW_IDX_ATTR) ?? "") !== "");
}

/**
 * The mark drawing payload row `rowIdx` - or, given a predicate, the first mark it accepts (e.g.
 * `m => m.getAttribute("data-code") === "JPN"` for a chart that labels its marks).
 */
export function findMark(chart: ParentNode, which: number | ((mark: Element) => boolean)): Element | null {
    const marks = marksOf(chart);
    if (typeof which === "function") return marks.find(which) ?? null;
    return marks.find(m => (m.getAttribute(ROW_IDX_ATTR) ?? "").split(",").map(Number).includes(which)) ?? null;
}

/** Click a mark as a reader does; `add` holds Ctrl to add it to the selection. */
export function clickMark(mark: Element, opts: { add?: boolean } = {}): void {
    const win = mark.ownerDocument?.defaultView;
    const Ev = (win?.MouseEvent ?? MouseEvent) as typeof MouseEvent;
    mark.dispatchEvent(new Ev("click", { bubbles: true, cancelable: true, ctrlKey: !!opts.add }));
}

/** Click the chart's empty canvas (no mark): clears its selection. */
export function clickEmpty(chart: Element): void {
    const win = chart.ownerDocument?.defaultView;
    const Ev = (win?.MouseEvent ?? MouseEvent) as typeof MouseEvent;
    chart.dispatchEvent(new Ev("click", { bubbles: true, cancelable: true }));
}

/** The payload rows the chart shows as selected now. */
export function selectedRows(chart: ParentNode): number[] {
    const out = new Set<number>();
    for (const m of Array.from(chart.querySelectorAll(`.${MARK_CLASS}.${MARK_SELECTED_CLASS}`))) {
        for (const p of (m.getAttribute(ROW_IDX_ATTR) ?? "").split(",")) {
            const n = parseInt(p, 10);
            if (Number.isFinite(n)) out.add(n);
        }
    }
    return [...out].sort((a, b) => a - b);
}
