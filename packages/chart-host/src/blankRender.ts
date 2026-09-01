// A chart that ran clean and painted nothing — the failure mode with no signal (2026-09-01).
//
// Generated charts bind their columns BY NAME and guard the lookup, which is good practice and
// produces a silent failure: `if (idx === -1) { container.append(...).text(noDataText); return; }`
// is a correct, defensive, entirely successful render. It does not throw. It returns normally. A
// host that treats "did not throw" as "drew a chart" reports it as a success, and the reader is
// left looking at an empty rectangle with nothing anywhere to explain it. Seen in production: a
// chart whose column had been renamed between generating it and rendering it.
//
// A blank-detection guard that keys on the RENDERER cannot catch this — the code ran fine and the
// renderer has no opinion about whether marks appeared. Nor can a zero-row check: the table was
// full, it was the binding that had moved. The only thing that knows is the DOM.
//
// So: count what the render left behind, and let the host decide what "this render failed" means
// to it. Hosts that track a "last render OK" flag should clear it here — that single flag is
// usually what every downstream empty-canvas net already tests, so setting it correctly makes
// those nets work rather than requiring a parallel warning path.
//
// WHY THIS LIVES IN THE SHARED PACKAGE. It is the mark contract asking a question about itself,
// and the contract is already here (MARK_CLASS / ROW_IDX_ATTR). Every host renders the same
// generated code against the same contract, so every host can be wrong the same way; a copy per
// host is one more chance to disagree about what "blank" means.

import { MARK_CLASS, LEGEND_MARK_CLASS, ROW_IDX_ATTR } from "./contract";

export interface MarkCensus {
    /** Data marks found anywhere in the container. */
    markCount: number;
    /** Legend swatches / axis furniture — clickable, but NOT evidence the data drew. */
    legendMarkCount: number;
    /** What the chart built. `html` is a first-class answer, not a failure — see below. */
    containerKind: "svg" | "html" | "empty";
}

const EMPTY: MarkCensus = { markCount: 0, legendMarkCount: 0, containerKind: "empty" };

/**
 * Count what the render actually left behind.
 *
 * NOT SCOPED TO `<svg>`, and that is what makes this work at all. Plenty of chart types are pure
 * HTML - a table with embedded bars, a KPI card - and never create an SVG, so a census that
 * starts from `container.querySelector("svg")` finds nothing for exactly the charts it most needs
 * to measure. Those charts still honour the contract: their working path tags each row
 * `class="d3-mark"` + `data-row-idx`, and their no-data branch appends a bare element with
 * neither. The class and the attribute ARE the signal, in both DOM worlds; the element name never
 * was.
 *
 * Counts by contract, never by tag: a chart marking `<rect>`, `<text>`, `<path>`, `<circle>` or
 * `<div>` is equally visible here. Never throws — telemetry must not be why a delivered render
 * fails.
 */
export function censusMarks(container: Element | null | undefined): MarkCensus {
    if (!container || typeof (container as any).querySelectorAll !== "function") return EMPTY;
    try {
        // A mark declares itself by class OR by row index; charts do both and neither is
        // guaranteed alone. A Set of elements keeps an element tagged both ways counting once.
        const marks = new Set<Element>();
        for (const el of Array.from(container.querySelectorAll(`.${MARK_CLASS}`))) marks.add(el);
        for (const el of Array.from(container.querySelectorAll(`[${ROW_IDX_ATTR}]`))) marks.add(el);
        // Legend swatches are filterable furniture, not evidence that the DATA drew. A chart that
        // renders its legend and then bails leaves these behind, and counting them as marks would
        // hide precisely the case this exists to catch.
        const legend = new Set<Element>();
        for (const el of Array.from(container.querySelectorAll(`.${LEGEND_MARK_CLASS}`))) { legend.add(el); marks.delete(el); }
        const hasSvg = !!container.querySelector("svg");
        const hasAnything = hasSvg || (container.childElementCount ?? 0) > 0;
        return {
            markCount: marks.size,
            legendMarkCount: legend.size,
            containerKind: hasSvg ? "svg" : (hasAnything ? "html" : "empty"),
        };
    } catch {
        return EMPTY;
    }
}

export interface BlankVerdictInput {
    /** From censusMarks. */
    markCount: number;
    /** Rows the chart was HANDED. Zero rows is a different, already-handled story. */
    rows: number;
    /**
     * This chart declares time keyframes. Its first frame is legitimately allowed to be empty
     * (an animated map before any country enters the series), so a verdict on frame one would be
     * a lie about the commonest animated opening.
     */
    animated?: boolean;
    /**
     * The author configured their own "No Data Text". They asked for this rectangle to say
     * something when there is nothing to draw, and overruling them would be telling someone their
     * deliberate empty state is a defect.
     */
    authoredNoDataText?: boolean;
    /**
     * The chart's marks are not tagged by our contract at all — a Vega lane, whose marks the
     * generated spec names itself. Absence of `.d3-mark` there proves nothing, so the census is
     * evidence-free and must not return a verdict.
     */
    contractUntagged?: boolean;
}

/**
 * Did this render paint nothing, against data that had something to paint?
 *
 * EVERY CLAUSE IS A FALSE POSITIVE WE WOULD OTHERWISE SHIP. The value of this verdict is that a
 * human believes it; one wrong accusation on a chart that is fine costs more than the case it
 * catches, which is the same argument `columnsGoneFromDiff` makes about type narrowings.
 */
export function isBlankRender(i: BlankVerdictInput): boolean {
    if (i.contractUntagged) return false;   // no contract, no evidence
    if (i.animated) return false;           // frame one may legitimately be empty
    if (i.authoredNoDataText) return false; // the author asked for this rectangle
    if (!(i.rows > 0)) return false;        // zero rows is the never-silent banner's job
    return i.markCount === 0;
}

/** A short, stable token a host can attach to its own per-render telemetry. Deliberately
 *  formatted for an always-on channel rather than a debug log: a blank render is most
 *  interesting in aggregate, and the charts worth counting are the ones nobody is watching. */
export function blankRenderFlag(lang: string, cause: string): string {
    const clean = (s: string) => String(s || "unknown").toLowerCase().replace(/[^a-z0-9-]+/g, "-");
    return `blankrender:${clean(lang)}:${clean(cause)}`;
}
