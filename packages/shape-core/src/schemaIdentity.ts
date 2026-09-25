// WHICH FIELDS IS THIS? - the schema identity a host compares two column sets by IN MEMORY.
//
// A host keeps several short-lived answers that belong to one set of bound fields and must be
// forgotten when the fields change: the most rows those fields have delivered (so "fewer now" can be
// read as a filter), the key that tells a double-fired request from a new one, and the stamp on a
// "what fits" list the reader looked at. Each needs the same question answered - are these the same
// fields? - and this is the one answer.
//
// THE IDENTITY IS NAME, ROLE AND TYPE FAMILY, PER COLUMN, IN ORDER.
//
//  - NAME, because generated code reaches its columns by name: a renamed column is a different field
//    to every chart.
//  - ROLE (measure or not), because a column that crosses between a measure and a category moves
//    off the axis it was drawn on, even under the same name.
//  - TYPE FAMILY, not the exact type. A whole-number column that gains one decimal value has not
//    become another field, and a comparison that says it has resets what the host had learned for
//    nothing. A column that turns from numbers into text has changed what any chart can do with it,
//    so the family is in.
//  - ORDER is kept: the keys this replaces were order-sensitive, so a reordered field well still
//    reads as a change, exactly as it did.
//
// NEVER A PERSISTED FINGERPRINT. A host that has stored a schema fingerprint in a saved file keeps
// its own formula for that value: changing it would make every stored value disagree with the next
// one computed, and a stored mismatch is read as "the fields changed". This key lives only as long
// as the host's memory does.
//
// A host may pre-process its columns first (collapsing one dimension delivered in several shapes
// into one column, say); the identity is of whatever list it passes.

import { SIMPLE_STRING_HASH } from "./util";

/** One column, as the identity reads it. */
export interface SchemaIdentityColumn {
    name: string;
    isMeasure: boolean;
    /** The host's data type name ("Integer", "Decimal", "DateTime", "String", ...). */
    dataType: string | null | undefined;
}

/** The known type names, lower-cased, and the family each belongs to. */
const TYPE_FAMILY: Readonly<Record<string, string>> = Object.freeze({
    integer: "number",
    decimal: "number",
    double: "number",
    datetime: "date",
    date: "date",
    boolean: "boolean",
    string: "text",
});

/**
 * The family a data type name belongs to: "number", "date", "boolean" or "text" for the names the
 * hosts send, matched without regard to case. Any other name is its own family (lower-cased), so an
 * unfamiliar type is never merged into a known one; no name at all is "".
 */
export function schemaTypeFamily(dataType: string | null | undefined): string {
    const key = String(dataType ?? "").trim().toLowerCase();
    return TYPE_FAMILY[key] ?? key;
}

/**
 * The identity of a column list as text: one self-delimiting token per column, in order, so no name -
 * whatever characters it holds - can make two different lists read alike. No columns is "".
 */
export function schemaIdentity(columns: ReadonlyArray<SchemaIdentityColumn>): string {
    let s = "";
    for (const c of columns) {
        s += JSON.stringify([String(c.name ?? ""), c.isMeasure ? "M" : "D", schemaTypeFamily(c.dataType)]);
    }
    return s;
}

/** The identity as a number for a host's keys: the string hash of `schemaIdentity`. No columns is 0. */
export function schemaIdentityKey(columns: ReadonlyArray<SchemaIdentityColumn>): number {
    return SIMPLE_STRING_HASH(schemaIdentity(columns));
}
