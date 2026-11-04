// A CHART IS WRITTEN FOR THE ROWS IT WAS GENERATED ON. Its layout - bar widths, label budgets, how many marks fit -
// was chosen for that row count, and the same code redrawn on ten times as many rows can paint thousands of
// sub-pixel marks with nothing on screen to say why. This is the one rule every host applies after a render:
// when the rows drawn are at least ROW_GROWTH_MIN_RATIO times AND at least ROW_GROWTH_MIN_EXTRA more than the
// rows the chart was built for, the host says so, as a data notice (shown with the chart's notes, never forced
// open). Ordinary filtering shrinks the rows and a refresh that adds a few never reaches the thresholds.
export const ROW_GROWTH_MIN_RATIO = 10;
export const ROW_GROWTH_MIN_EXTRA = 500;

export interface RowGrowthNotice {
    code: "row-growth";
    /** The reader's priority, in the vocabulary of a generate result's notices: a fact about the data. */
    severity: "data";
    builtFor: number;
    rendered: number;
    /** The sentence a host shows when it does not word it itself (English). */
    text: string;
    /** The render row's Location token, `grow:<builtFor>` - kept per render row, so the population is countable. */
    locationToken: string;
}

export function rowGrowthNotice(
    builtFor: number | null | undefined,
    rendered: number | null | undefined,
    opts: { canGenerate?: boolean; formatCount?: (n: number) => string } = {},
): RowGrowthNotice | null {
    const b = typeof builtFor === "number" && Number.isFinite(builtFor) ? Math.floor(builtFor) : NaN;
    const r = typeof rendered === "number" && Number.isFinite(rendered) ? Math.floor(rendered) : NaN;
    if (!(b > 0) || !(r > 0)) return null;
    if (r < b * ROW_GROWTH_MIN_RATIO || r - b < ROW_GROWTH_MIN_EXTRA) return null;
    const fmt = opts.formatCount ?? ((n: number) => n.toLocaleString("en-US"));
    const tail = opts.canGenerate === false
        ? "enter a license to generate a chart for this data."
        : "Generate to rebuild it for this data.";
    return {
        code: "row-growth", severity: "data", builtFor: b, rendered: r,
        text: `Built for ${fmt(b)} row${b === 1 ? "" : "s"}, now showing ${fmt(r)} - ${tail}`,
        locationToken: `grow:${b}`,
    };
}
