// Added by the RegiaBI chart server (setup_fabric_app). Yours to edit; it is never rewritten.
import { useRef, useState, type ReactNode } from "react";
import { useMeasuredSize } from "@bicharts/chart-host/react";

export type QueryTable = { columns: { name: string }[]; rows: unknown[][] };

/** What useSemanticModelQuery returns (the template's hook); only these fields are read. */
export interface PanelQueryResult {
  data?: { status: "success"; table: QueryTable } | { status: "error"; error: { message: string } } | undefined;
  isLoading: boolean;
  error?: Error;
}

interface BicChartPanelProps {
  result: PanelQueryResult;
  /** The panel's height when its cell has none (a section with no height of its own). A cell with a height - even a
   *  smaller one - keeps it: the panel fills that cell and scrolls, so it never runs over what's below it. */
  minHeight?: number;
  /** The smallest size this chart is drawn at; below it the panel scrolls rather than squash or clip the chart.
   *  A world map wants about 2:1 (e.g. 560 x 300); a time series wants height. */
  minChartWidth?: number;
  minChartHeight?: number;
  /** A page filter narrowed the query to nothing: shown as a "Clear" beside "Nothing matches" - e.g. region.clear. */
  onClearFilters?: () => void;
  /** Renders the chart once the query has rows and the panel has a size. */
  children: (table: QueryTable, size: { width: number; height: number }) => ReactNode;
}

/**
 * A chart's box: sized by the layout (put it in a cell that has a height - a grid row, h-full, a flex item with
 * min-h-0), never by the chart. The measured box is absolutely positioned inside its cell, so a drawn chart can't
 * make it taller than the card shows; when the cell is smaller than the chart's minimum, the panel scrolls. Shows
 * the query's loading, error and empty states in place of the chart. While a NEW result loads (a filter changed the
 * query), the last one stays on screen, dimmed: the chart isn't unmounted, so it keeps its zoom and its selection.
 *   <BicChartPanel result={useSemanticModelQuery({ connection, query })} minChartWidth={560} minChartHeight={300}>
 *     {(table, size) => <MyChart table={table} {...size} options={options} />}
 *   </BicChartPanel>
 */
export function BicChartPanel({ result, minHeight = 360, minChartWidth = 320, minChartHeight = 240, onClearFilters, children }: BicChartPanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { width: boxWidth, height: boxHeight } = useMeasuredSize(ref);
  const width = Math.max(boxWidth, minChartWidth);
  const height = Math.max(boxHeight, minChartHeight);
  const { data, isLoading, error } = result;
  const failed = error?.message ?? (data?.status === "error" ? data.error.message : undefined);
  const fresh = data?.status === "success" ? data.table : undefined;
  // The last result, kept while the next one loads (state set during render: React's pattern for a previous value).
  const [last, setLast] = useState<QueryTable | undefined>(undefined);
  if (fresh && fresh !== last) setLast(fresh);
  const table = fresh ?? (isLoading ? last : undefined);
  const stale = !fresh && !!table;
  // The template's tokens: muted text for loading and empty, destructive for a failure.
  const note = (text: string, role?: "alert") => (
    <div role={role} className={role ? "text-300 text-destructive" : "text-300 text-muted-foreground"}
         style={{ display: "grid", placeItems: "center", height: "100%" }}>{text}</div>
  );
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", minWidth: 0 }}>
      {/* The fallback height, capped at 100% of the panel: in a cell with a height the cap holds it to the cell; in a
          cell with none, 100% resolves to nothing and this gives the panel its height. A min-height can't tell the two. */}
      <div aria-hidden="true" style={{ height: minHeight, maxHeight: "100%" }} />
      <div ref={ref} style={{ position: "absolute", inset: 0, overflow: "auto" }}>
        {failed ? note(`The query failed: ${failed}`, "alert")
          : !table ? note("Loading...")
          : table.rows.length === 0
            ? onClearFilters
              ? <div className="text-300 text-muted-foreground" style={{ display: "grid", placeItems: "center", height: "100%" }}>
                  <span>Nothing matches the current filter. <button type="button" className="underline" onClick={onClearFilters}>Clear</button></span>
                </div>
              : note("No data for this selection.")
          : boxWidth > 0 && boxHeight > 0 && width > 0 && height > 0
            ? <div aria-busy={stale || undefined} style={{ opacity: stale ? 0.55 : 1, transition: "opacity 120ms" }}>
                {children(table, { width, height })}
              </div>
          : null}
        {stale ? <div role="status" className="text-200 text-muted-foreground" style={{ position: "absolute", top: 8, right: 8 }}>Updating...</div> : null}
      </div>
    </div>
  );
}
