// THE MODEL PICKER'S SHARED RULES - the four decisions every host's model list makes the same way.
//
// A host that lets the reader choose a language model builds its list from the service's catalogue of
// active models (codes, display names, cost multipliers, and which one is the default). How a host
// LABELS a row, prices it, and whether it adds a row of its own ("use the service's default") is the
// host's; these four rules are not:
//
//   - A bring-your-own-key code (prefix "BYO") is never offered in the open list: it only works with
//     a key the reader supplies elsewhere.
//   - The default model is marked, after the rest of its label, with the words " — default".
//   - The default model sorts first; every other row keeps the catalogue's order.
//   - A saved pick the catalogue no longer offers falls back to the default, never to nothing: a
//     stale preference must not pin a request to a model that is gone, and an empty picker is not an
//     answer.
//
// Pure: the host passes the codes and labels it built.

/** The suffix that marks the default model's row, after its cost. */
export const DEFAULT_MODEL_SUFFIX = " — default";

/** Whether a catalogue code may appear in the open list: not empty, and not a bring-your-own-key code. */
export function isPickableModelCode(code: string | null | undefined): boolean {
    const c = String(code ?? "");
    return c !== "" && !c.startsWith("BYO");
}

/** The label with the default marker appended when `code` is the (non-empty) default. */
export function markDefaultModel(label: string, code: string, defaultCode: string | null | undefined): string {
    return defaultCode && code === defaultCode ? label + DEFAULT_MODEL_SUFFIX : label;
}

/** A copy of `rows` with the default model's row first and every other row in its original order. */
export function defaultModelFirst<T extends { value: string }>(rows: readonly T[], defaultCode: string | null | undefined): T[] {
    if (!defaultCode) return rows.slice();
    const first = rows.filter(r => r.value === defaultCode);
    return first.concat(rows.filter(r => r.value !== defaultCode));
}

/**
 * The pick to show: `saved` when the list still offers it; otherwise `fallback` (the host's default -
 * the default model's code, or the host's own "service default" row) when the list offers that;
 * otherwise the list's first row; "" only for an empty list.
 */
export function reconcileModelPick(saved: string | null | undefined, offered: readonly string[], fallback: string | null | undefined): string {
    const s = String(saved ?? "");
    if (offered.includes(s)) return s;
    const f = String(fallback ?? "");
    if (offered.includes(f)) return f;
    return offered.length ? offered[0] : "";
}
