/**
 * Freemium entitlement walls a host can ANTICIPATE, in the server's own words.
 *
 * ITEM 634 (2026-09-17), from the prod 2956-2962 review.
 *
 * A first-time freemium reader behind a corporate proxy bound twenty fields against a cap of
 * twelve. The server did everything right: it refused at the routing boundary in 31 ms, charged
 * nothing, handed the rate-limit slot back, and composed a sentence naming exactly how many fields
 * to drop. The response never came back through the proxy, so what the reader actually read was
 * "We couldn't reach the charting service - it may be offline, or blocked on this network", and
 * they left inside a second.
 *
 * The question never needed the wire. The bound column count and the freemium state are both in
 * the host's hand before the request is built.
 *
 * TWO RULES THIS MODULE EXISTS TO KEEP:
 *
 * 1. ANTICIPATE, NEVER ENFORCE. The server's check does not move and stays the only gate that
 *    decides anything. A host that skips this, or is built from a patched bundle, or calls the
 *    API directly, is refused exactly as before. That is the USERTEXT lesson read the other way
 *    round: a tier boundary is never *enforced* on a client.
 *
 * 2. ONE AUTHOR OF THE WORDING. The sentence is not written here. The server ships its own
 *    templates on the licence-status response with `{n}` and `{fields}` left unfilled - it does
 *    not know the reader's count at status time - and this module only substitutes. An operator
 *    override of the server's message therefore reaches every host for free, and a host that
 *    re-words the refusal locally has reintroduced the drift this was built to remove.
 *
 * Absent fields (an older server, or a licensed caller) mean "cannot be anticipated", and every
 * function here answers null so the host behaves exactly as it did before the field existed.
 * There is no version test anywhere: the capability IS the presence of the field.
 */
import { GetLicenseStatusResult } from "./models";

/** What a host needs to answer the question, narrowed from the full status object so a caller can
 *  pass a partial - the add-in and the React demo hold their own reduced status shapes. */
export type FreemiumColumnCapStatus = Pick<
    GetLicenseStatusResult,
    "freemiumMaxShapeColumns" | "freemiumColumnCapMessageFew" | "freemiumColumnCapMessageMany" | "freemiumColumnCapPivot"
>;

/**
 * Is this binding over the freemium column cap, and by how many?
 *
 * `shapeColumnCount` is counted in SHAPE space - THE SAME ARRAY the server counts - which is the
 * property that matters: both sides read the same length, so there is no off-by-one at the
 * boundary whatever that array contains.
 *
 * What it contains, measured rather than inherited: the reader's VISIBLE fields. An older comment
 * on the server said the shape also carries the `__rowIdx__` column a host injects for selection
 * threading, making the visible limit one lower; `__rowIdx__` is a Shape entry in ZERO of 2,962
 * logged production payloads, so a cap of 12 is 12 visible fields.
 *
 * Every message still states the DIFFERENCE and never the cap - correct in either space, and it
 * stops a reader trimming to precisely the cap and being refused a second time.
 *
 * Returns 0 when within the cap, and null when the server did not send one.
 */
export function freemiumColumnsOverCap(
    shapeColumnCount: number,
    status: FreemiumColumnCapStatus | null | undefined
): number | null {
    const cap = status?.freemiumMaxShapeColumns;
    if (typeof cap !== "number" || !isFinite(cap) || cap < 1) return null;
    if (!isFinite(shapeColumnCount) || shapeColumnCount <= cap) return 0;
    return Math.round(shapeColumnCount - cap);
}

/**
 * The refusal a reader over the cap should read, or null when there is nothing to say - within the
 * cap, not freemium, or a server that sent no templates.
 *
 * The plural is chosen here rather than by the server for the one reason the server cannot: it
 * depends on the reader's count. It is English-only, like every other plural in this codebase, and
 * belongs to item 543's catalogue work rather than to this one.
 */
export function freemiumColumnCapRefusal(
    shapeColumnCount: number,
    status: FreemiumColumnCapStatus | null | undefined,
    shape?: readonly FreemiumDateGroupColumn[] | null
): string | null {
    const overBy = freemiumColumnsOverCap(shapeColumnCount, status);
    if (overBy === null || overBy <= 0) return null;

    const pivot = typeof status?.freemiumColumnCapPivot === "number" ? status!.freemiumColumnCapPivot! : 4;
    const template = overBy > pivot ? status?.freemiumColumnCapMessageMany : status?.freemiumColumnCapMessageFew;
    // A server that sent a cap but no template is a server half-upgraded, or one whose operator
    // blanked the message. Saying nothing is right: the round trip then happens and the server
    // answers, which is exactly today's behaviour.
    if (typeof template !== "string" || template.trim().length === 0) return null;

    const sentence = template
        .split("{n}").join(String(overBy))
        .split("{fields}").join(overBy === 1 ? "field" : "fields");
    const clauses = freemiumDateHierarchyClauses(shape);
    return clauses.length === 0 ? sentence : sentence + " " + clauses.join(" ");
}

/** The fields of a bound shape column the date-hierarchy clause reads. A partial, so a host can
 *  pass whatever column type it holds. */
export type FreemiumDateGroupColumn = {
    name?: string,
    isDatePart?: boolean,
    isReassembledDate?: boolean,
    dateGroupId?: string,
    sourceField?: string,
};

/**
 * A DATE HIERARCHY COUNTS AS SEVERAL FIELDS, AND THE REFUSAL SAYS SO (2026-09-23).
 *
 * When a host reassembles a shredded date hierarchy (Year / Quarter / Month / Day) it keeps the
 * levels and adds the reassembled date, so one hierarchy in the reader's field well is five entries
 * in the shape the cap counts. The count is right for the cap's purpose - every one of them is a
 * described column - but a reader with six fields in their field well who is told to remove two
 * has no way to see that the date hierarchies are what cost them. Binding the date itself instead
 * of its hierarchy frees all but one of those slots without losing a field.
 *
 * So each date group in the shape adds one clause naming it, in the order the groups first appear.
 * `{n}` is the group's levels plus the reassembled date; the name is the source field the date was
 * reassembled from when the host knows it, else the reassembled column's own name. A group with no
 * reassembled column is not a hierarchy this knows how to name, and adds nothing.
 *
 * THE LITERAL IS PINNED ON BOTH SIDES. The server composes the same clause for a request whose
 * shape carries a source field, so a reader is told the same sentence whichever side answers.
 */
export function freemiumDateHierarchyClauses(shape: readonly FreemiumDateGroupColumn[] | null | undefined): string[] {
    if (!shape || shape.length === 0) return [];
    const order: string[] = [];
    const parts = new Map<string, number>();
    const names = new Map<string, string>();
    for (const c of shape) {
        const gid = typeof c?.dateGroupId === "string" ? c.dateGroupId.trim() : "";
        if (gid === "") continue;
        if (!parts.has(gid)) { order.push(gid); parts.set(gid, 0); }
        if (c.isDatePart === true) parts.set(gid, parts.get(gid)! + 1);
        if (c.isReassembledDate === true && !names.has(gid)) {
            const field = typeof c.sourceField === "string" ? c.sourceField.trim() : "";
            const own = typeof c.name === "string" ? c.name.trim() : "";
            const name = field !== "" ? field : own;
            if (name !== "") names.set(gid, name);
        }
    }
    const out: string[] = [];
    for (const gid of order) {
        const name = names.get(gid);
        const levels = parts.get(gid) ?? 0;
        if (!name || levels === 0) continue;
        out.push(`'${name}' is a date hierarchy and counts as ${levels + 1} fields - bind the date itself instead of its hierarchy.`);
    }
    return out;
}
