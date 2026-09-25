// FILTER NARROWING - telling "a filter took the rows away" from "the fields changed".
//
// THE CASE. A click in one chart cross-filtered a cached heatmap in another from 110 rows to 44; the
// heatmap's own binning had nothing left to lay out on one axis and drew an empty figure. The host's
// blank-figure guard fired correctly - a blank chart IS a failed render - but it had only one message,
// "the fields used to generate this chart changed", which was flatly wrong: the reader changed no
// fields, they clicked a mark somewhere else. The guard could not tell WHY the chart went blank. These
// predicates supply the missing signal so a host can pick an accurate message.
//
// THE SIGNAL: a per-schema high-water row count. Filtering can only ever REMOVE rows, so "fewer rows
// now than the most this schema has ever delivered" is direct evidence the data was narrowed, with no
// dependency on how the host reports its filters. (A host's filter-pane state was considered and
// rejected as the signal: a cross-filter driven by a click in another chart does not reliably appear
// there.)
//
// KEYED TO THE SCHEMA. When the schema changes, the high water resets and both predicates answer
// false, so genuine field drift keeps its own wording. The two causes never borrow each other's words.
//
// Known, accepted blind spot: if the very first load is ALREADY filtered, the high water is set from
// that narrowed load and no narrowing is detected. That degrades to the host's existing message
// rather than misfiring.

export interface NarrowingState {
    /** Row count of the dataset just delivered. */
    currentRows: number;
    /** Most rows ever seen for highWaterSchemaHash (0 = nothing recorded yet). */
    highWaterRows: number;
    /** Schema the high water was recorded against (null = nothing recorded yet). */
    highWaterSchemaHash: number | null;
    /** Schema of the dataset just delivered. */
    currentSchemaHash: number;
}

/**
 * True when the current dataset is a strict, non-empty subset of the largest one this schema has
 * produced - a slicer or cross-filter is narrowing the data right now, and the chart is drawable but
 * thin. Zero rows is a different state with its own predicate, `isEmptiedByFilter`, so neither caller
 * has to re-check a row count to learn which question it got an answer to.
 */
export function isNarrowedByFilter(s: NarrowingState): boolean {
    // Schema changed: the row counts are not comparable, and a field change is precisely the case
    // that must keep the schema-drift wording.
    if (s.highWaterSchemaHash === null || s.highWaterSchemaHash !== s.currentSchemaHash) return false;
    // No baseline yet - nothing to be narrower than.
    if (!(s.highWaterRows > 0)) return false;
    if (!(s.currentRows > 0)) return false;
    return s.currentRows < s.highWaterRows;
}

/**
 * True when the dataset has been filtered away to NOTHING - same schema, a positive high water, and
 * zero rows now.
 *
 * Filtered-to-nothing is legitimately empty, but it is not indistinguishable from an empty dataset,
 * and treating it as one cost a reader the connection between their own click and the chart that
 * then read a flat "no data". The evidence needed is the SAME high-water signal: at zero rows, on an
 * unchanged schema, a positive high water means this schema HAS delivered rows before and does not
 * now. Only a filter does that. A changed schema resets the high water, so field drift reads a high
 * water of 0 here and keeps the plain no-data wording.
 */
export function isEmptiedByFilter(s: NarrowingState): boolean {
    if (s.highWaterSchemaHash === null || s.highWaterSchemaHash !== s.currentSchemaHash) return false;
    if (!(s.highWaterRows > 0)) return false;
    return s.currentRows <= 0;
}

/**
 * Roll the high-water mark forward for a completed load. Resets (rather than maxing) when the schema
 * changes, so a field swap cannot leave a stale baseline from the previous schema making every later
 * load look narrowed.
 */
export function updateRowHighWater(
    prevRows: number,
    prevSchemaHash: number | null,
    currentRows: number,
    currentSchemaHash: number,
): { rows: number; schemaHash: number } {
    if (prevSchemaHash !== currentSchemaHash) {
        return { rows: currentRows, schemaHash: currentSchemaHash };
    }
    return { rows: Math.max(prevRows, currentRows), schemaHash: currentSchemaHash };
}
