// WHAT A HOST WOULD SEND, SAFE TO SHOW THE PERSON WHOSE DATA IT IS.
//
// A generate request carries two very different kinds of field: the DISCLOSURE (the measured
// shape, the viewport, the settings that steer the model) and the CREDENTIAL (a licence
// triple, a link nonce, an install id, a per-request correlation id). A person is entitled to
// read the first before they press the button. The second they cannot usefully read — it is
// their own secret, and printing it into a panel they may screenshot is a way to leak it.
//
// So this takes a REAL payload — the object the wire builder actually produced — and returns
// the same object minus the credential fields. That direction is the whole point. The Power BI
// visual's own preview was written the other way round, as a second literal listing the fields
// it believed were sent, and it drifted: the viewport ended up emitted from five places, two of
// them inside that preview, and nothing failed until somebody measured. A preview built by
// SUBTRACTION from the real thing cannot drift, because there is nothing in it that is not the
// wire.
//
// PURE, and deliberately so. It takes an object and returns an object; it does not know what a
// pane looks like, it does not stringify, and it does not decide how an array should wrap. A
// host renders it. That split is what lets the same function serve a 95%-of-the-tile overlay in
// Power BI and a narrow inline block in an Excel task pane.

/** Fields that never appear in a preview, whatever a caller passes.
 *
 *  OMITTED, not masked. An earlier cut of the visual's preview printed `"licenseKey":
 *  "<redacted>"` and it was removed as noise: a field whose value you are not allowed to see
 *  tells you nothing by its name, and a column of placeholders reads as though the product is
 *  hiding more than it is. The panel's own heading says credentials are stripped; that sentence
 *  does the work the placeholders were pretending to do.
 *
 *  The list is BY NAME rather than by heuristic (`/key|token|secret/`) because a heuristic gets
 *  this wrong in both directions — it would drop `keyColumn` from a shape and would miss
 *  `instanceKey` on a rename. A name that is not here is shown, which is the safe default for a
 *  DISCLOSURE surface and the reason the test asserts the key set both ways: a new wire field
 *  appears in the preview automatically, and a new credential cannot ship in it without being
 *  added here. */
export const PREVIEW_OMITTED_FIELDS: readonly string[] = Object.freeze([
    // The licence triple. Any one of the three is enough to generate somewhere else.
    "licenseKey",
    "licensee",
    "secretKey",
    // The freemium key and the Excel link nonce — bearer credentials with a shorter life and
    // exactly the same consequence.
    "freemiumKey",
    "linkNonce",
    // Identity rather than entitlement, and still not the reader's business: clientId is a
    // per-install id the server hashes into a rate-limit key, instanceKey identifies the
    // workbook's chart slot, and correlationId ties a support conversation to a log row. None
    // of them describe the DATA, which is what this panel is for.
    "clientId",
    "instanceKey",
    "correlationId",
]);

export interface PayloadPreviewOptions {
    /** Replaces a non-empty `sampleCsv` with a sentence.
     *
     *  The preview must never re-run the obfuscation pipeline to show rows: that would put real
     *  cell values (obfuscated or not) on screen and into any screenshot of it, which is the one
     *  thing a privacy panel must not do. A sentence saying what WOULD travel is the honest
     *  substitute, and the host writes it because only the host knows the tier and the entitlement
     *  ("the server strips this on freemium" is a different sentence from "up to 25 obfuscated
     *  rows travel"). Omit it and a non-empty `sampleCsv` still does not survive — it becomes
     *  `null`, because showing the CSV is never right. */
    sampleNote?: string;
    /** Added as `_note` when the payload carries no measured shape.
     *
     *  An empty object is the least useful thing a disclosure panel can show: it reads as
     *  "nothing is sent" when the truth is "nothing is bound yet". */
    emptyShapeNote?: string;
}

/** True when `shape` is absent or carries no columns. */
function shapeIsEmpty(payload: Record<string, unknown>): boolean {
    const shape = payload["shape"];
    return !Array.isArray(shape) || shape.length === 0;
}

/**
 * The redacted twin of a real request payload.
 *
 * Key ORDER is preserved from the input, because the reader is scanning for their own column
 * names and a re-sorted object makes that harder than it needs to be. The input is not mutated.
 *
 * `sampleCsv` is the one field whose VALUE is rewritten rather than dropped: it is kept in the
 * object so the reader can see that the field exists and is empty on their tier, which is a
 * stronger statement than its absence would be.
 */
export function payloadPreview(
    payload: Record<string, unknown>,
    opts: PayloadPreviewOptions = {},
): Record<string, unknown> {
    const omit = new Set<string>(PREVIEW_OMITTED_FIELDS);
    const out: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(payload ?? {})) {
        if (omit.has(key)) continue;

        if (key === "sampleCsv") {
            // Present-and-empty is the common case (every add-in lane sends `null`) and it is
            // worth showing verbatim: `"sampleCsv": null` is the product's best privacy claim
            // stated in its own wire format.
            const hasRows = typeof value === "string" ? value.length > 0 : value !== null && value !== undefined;
            out[key] = hasRows ? (opts.sampleNote ?? null) : value;
            continue;
        }

        out[key] = value;
    }

    if (opts.emptyShapeNote && shapeIsEmpty(payload ?? {})) {
        out["_note"] = opts.emptyShapeNote;
    }

    return out;
}
