/**
 * A standing chart-type pick, checked against a FRESH qualify list.
 *
 * A reader's explicit pick can outlive the generate it was made for - a host that keeps it across a
 * refusal that spent nothing, or one whose pick is a standing control by design. Either way the fields
 * can change underneath it, and a pick the data no longer supports would otherwise cost a generate to
 * discover: the substitution warning arrives after the credit, not before it.
 *
 * ONLY AGAINST A FRESH LIST, and only against the server's own answer. The list is what the qualify
 * endpoint says fits the data as it is now; checking the pick against a client-side re-implementation of
 * the shape gates would be a second opinion quietly disagreeing with the engine.
 *
 * AN EMPTY LIST IS NOT EVIDENCE THE PICK DIED. It is the shape qualifying for nothing, which has its own
 * message and its own fix; dropping the pick there would add a second, misleading sentence.
 *
 * A DROP IS ALWAYS SAID. The message names the type and what the pick went back to, so a pick never
 * disappears silently. `offered` is every name the host would let the reader pick right now - a host whose
 * list also offers poor-fit types to pick anyway passes those too, because the pick is still choosable.
 */
export interface ChartPickReconciliation {
    /** The pick after reconciling: the original (trimmed) when still offered, else "" (no pick). */
    pick: string;
    /** True when a pick was dropped because the fresh list no longer offers it. */
    dropped: boolean;
    /** What to tell the reader when `dropped`; "" otherwise. */
    message: string;
}

export function reconcileChartPick(
    pick: string | null | undefined,
    offered: readonly (string | null | undefined)[],
    autoLabel: string,
): ChartPickReconciliation {
    const want = String(pick ?? "").trim();
    if (!want) return { pick: "", dropped: false, message: "" };
    const names = (offered || []).map(n => String(n ?? "").trim()).filter(n => n !== "");
    if (names.length === 0) return { pick: want, dropped: false, message: "" };
    const key = want.toLowerCase();
    if (names.some(n => n.toLowerCase() === key)) return { pick: want, dropped: false, message: "" };
    return {
        pick: "",
        dropped: true,
        message: `${want} no longer fits this selection, so the chart type is back to `
               + `"${autoLabel}". Pick another from the list if you want to force one.`,
    };
}
