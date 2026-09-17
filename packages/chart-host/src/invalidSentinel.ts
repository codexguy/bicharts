// THE INVALID SENTINEL AT RENDER TIME - a data state, not a broken chart.
//
// Generated render() code has exactly one sanctioned hard stop at runtime: a column the chart is
// built on is gone from data.columns, and the code throws `new Error('INVALID:<reason>')` - for a
// column bound by name, `INVALID:column "<name>" not found`. The CODE is fine; the data in front
// of it lacks something it needs. A host that treats that throw like any other crash tells the
// reader the chart "did not run" and invites a regeneration that is not needed - put the column
// back, or bind the field again, and the same code draws.
//
// The same marker also reaches hosts from older generations that guarded a MINIMUM COUNT at
// runtime (`if (stages.length < 3) throw new Error('INVALID:...')`). Those re-run on every filter,
// so a reader narrowing to one item trips them. Same answer: keep the code, say what the data
// lacks, re-run on the next data change.
//
// Pure text logic, shared so every host recognises the sentinel by one rule. createChartHost uses
// it to route the throw to `onInvalidSentinel` when the host supplies one.

/**
 * True when an error message, Python traceback or "Error:"-prefixed result carries the generated
 * code's INVALID sentinel. Matches the uppercase marker followed by a colon (space allowed before
 * the colon) anywhere in the text - Python surfaces it inside `ValueError: INVALID:...` at the END
 * of a multi-line traceback; a D3 throw surfaces it directly in `Error.message`. Lowercase
 * "Invalid" and the bare word without a colon are ordinary errors.
 */
export function isInvalidSentinelError(text: string | null | undefined): boolean {
    if (!text) return false;
    return /\bINVALID\s*:/.test(text);
}

/**
 * The reason the chart gave: the text after the first `INVALID:` up to the end of that line,
 * trimmed, and capped at `max` characters with an ASCII "..." so a host can put it in a one-line
 * status. Empty string when the text carries no sentinel.
 */
export function invalidSentinelReason(text: string | null | undefined, max = 240): string {
    if (!text) return "";
    const m = /\bINVALID\s*:\s*([^\r\n]*)/.exec(text);
    if (!m) return "";
    const reason = m[1].trim();
    const cap = Math.max(0, Math.floor(max));
    if (reason.length <= cap) return reason;
    return cap <= 3 ? reason.slice(0, cap) : reason.slice(0, cap - 3).trimEnd() + "...";
}
