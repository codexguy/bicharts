// THE LEGEND-FIT PASS A HOST HANDS TO createChartHost, as `layoutPass`.
//
// The two DOM passes of this entry, in the one order that works: the legend reconcile on the chart's own svg,
// then the frame fit on the container, because the legend pass can itself widen the viewBox and the frame fit
// must measure the final layout. Mechanism only: no placement setting, no sampling, no logging. What each run
// did is handed to `onReport`, and the host decides what, if anything, to record.
//
// It is injected rather than run by the host on its own because the main entry must not import this entry
// (its eager closure is budgeted): a host that never builds a pass never loads these modules.
import { reconcileLegendInSvg, type LegendReconcileResult } from "./legendReconcileDom";
import { fitTextToFrame, type FrameFitOutcome } from "./frameFitDom";
import { chartSvgOf, tableHostOf } from "../snapshot";

/** "smart" acts on smaller overlaps with larger moves; "narrow" only on large, unambiguous ones. */
export type LegendFitStrictness = "smart" | "narrow";

export interface LegendFitPassOptions {
    /** Run the legend reconcile (legend slide, colorbar, axis and label-row thinning, bottom-text push, content fit). Default true. */
    legend?: boolean | LegendFitStrictness;
    /** Run the frame fit (viewBox growth for text just past the frame, then shrink-and-cut of the labels it deferred). Default true. */
    frameFit?: boolean;
    /** What each run did. Counts and reasons only; the host decides what to log. */
    onReport?: (report: LegendFitReport) => void;
}

export interface LegendFitReport {
    legend: LegendReconcileResult | { skipped: "off" | "no-svg" } | { error: string };
    frame: FrameFitOutcome | { skipped: "off" | "table-lane" | "nothing-to-measure" } | { error: string };
}

/** The narrow gates: a legend moves only when it overlaps the plot by 16 units, into at most a fifth more width. */
const NARROW = { minOverlap: 16, maxGutterFraction: 0.2 };

const errorText = (e: unknown): string => String((e as Error)?.message ?? e).slice(0, 120);

/**
 * Build the pass once (module scope, or a memo) and hand it to createChartHost as `layoutPass`: a new function
 * on every render is a new host config. Each run never throws; a pass that fails reports `{ error }`.
 */
export function createLegendFitPass(opts: LegendFitPassOptions = {}): (container: HTMLElement) => void {
    const legendOn = opts.legend ?? true;
    const frameOn = opts.frameFit ?? true;
    return (container: HTMLElement) => {
        const report: LegendFitReport = { legend: { skipped: "off" }, frame: { skipped: "off" } };
        if (legendOn !== false) {
            try {
                const svg = chartSvgOf(container);
                report.legend = svg ? reconcileLegendInSvg(svg, legendOn === "narrow" ? NARROW : {}) : { skipped: "no-svg" };
            } catch (e) { report.legend = { error: errorText(e) }; }
        }
        // AFTER the legend pass, which can itself widen the viewBox: the frame fit measures the final layout. A table
        // lane is HTML rows with a small svg per cell, and growing one cell's viewBox fits nothing a reader sees.
        if (frameOn) {
            try {
                report.frame = tableHostOf(container) ? { skipped: "table-lane" }
                    : (fitTextToFrame(container) ?? { skipped: "nothing-to-measure" });
            } catch (e) { report.frame = { error: errorText(e) }; }
        }
        try { opts.onReport?.(report); } catch { /* a host's logger must never break the pass */ }
    };
}
