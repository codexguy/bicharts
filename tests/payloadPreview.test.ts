import { describe, it, expect } from "vitest";
import { payloadPreview, PREVIEW_OMITTED_FIELDS } from "../packages/shape-core/src/payloadPreview";

// THE GUARANTEE THIS FILE EXISTS FOR: a preview is the real payload MINUS a named list, and
// nothing else. Asserted on the key set in BOTH directions, which is what makes the property
// hold as the wire grows:
//
//   - a NEW WIRE FIELD appears in the preview automatically (nobody has to remember to add it,
//     which is exactly how the Power BI visual's hand-maintained copy drifted);
//   - a NEW CREDENTIAL FIELD cannot ship inside it without being added to the omit list, because
//     the "no secret survives" test enumerates the list rather than a hardcoded handful.

/** A payload shaped like the add-in's real `buildGeneratePayload` output, with recognisable
 *  secrets so a leak is visible in the assertion message rather than merely counted. */
function realisticPayload(): Record<string, unknown> {
    return {
        licenseKey: "SECRET-LICENCE-KEY-8f2a",
        licensee: "SECRET-LICENSEE-Acme Corp",
        secretKey: "SECRET-SECRET-KEY-11bd",
        freemiumKey: "",
        linkNonce: "SECRET-NONCE-4c7e9a01",
        clientId: "SECRET-INSTALL-ID-77",
        instanceKey: "SECRET-INSTANCE-abc",
        correlationId: "SECRET-CORRELATION-de01",
        clientVersion: "0.2.4.0",
        host: "EXCEL",
        height: 600,
        width: 820,
        totalRows: 21,
        cultureCode: "en-US",
        shape: [{ name: "City", dataType: "String", isMeasure: false }],
        sampleCsv: null,
        genNew: true,
        version: 0,
        identifier: "",
        temp: 60,
        modifiers: [],
        renderer: "D3",
        supportsD3: true,
        backgroundColor: "#ffffff",
    };
}

const SECRET_MARKER = /SECRET-/;

describe("payloadPreview", () => {
    it("drops exactly the omitted fields and keeps everything else, in order", () => {
        const input = realisticPayload();
        const out = payloadPreview(input);

        const expectedKeys = Object.keys(input).filter(k => !PREVIEW_OMITTED_FIELDS.includes(k));
        // Order preserved: a reader scans this for their own column names.
        expect(Object.keys(out)).toEqual(expectedKeys);

        // Both directions. Nothing extra invented, nothing kept that should have gone.
        for (const k of PREVIEW_OMITTED_FIELDS) expect(out).not.toHaveProperty(k);
        for (const k of expectedKeys) expect(out[k]).toEqual(input[k]);
    });

    it("lets no credential VALUE survive anywhere in the rendered text", () => {
        // The panel stringifies the result, so the real test is on the serialised form: a secret
        // nested somewhere unexpected would pass a key-by-key check and still be on screen.
        const rendered = JSON.stringify(payloadPreview(realisticPayload()), null, 2);
        expect(rendered).not.toMatch(SECRET_MARKER);
    });

    it("never mutates the caller's payload", () => {
        // The add-in builds the payload for the preview and could reasonably reuse it; a
        // redactor that edited in place would strip the credentials off a real request.
        const input = realisticPayload();
        const before = JSON.stringify(input);
        payloadPreview(input);
        expect(JSON.stringify(input)).toEqual(before);
    });

    it("keeps a null sampleCsv verbatim - the product's privacy claim in its own wire format", () => {
        const out = payloadPreview({ shape: [{ name: "A" }], sampleCsv: null });
        expect(out).toHaveProperty("sampleCsv", null);
    });

    it("replaces a non-empty sampleCsv with the host's sentence, never the rows", () => {
        const note = "(omitted - the live request includes up to 25 OBFUSCATED sample rows)";
        const out = payloadPreview(
            { shape: [{ name: "A" }], sampleCsv: "City,Revenue\nBoston,42\n" },
            { sampleNote: note },
        );
        expect(out.sampleCsv).toBe(note);
        expect(JSON.stringify(out)).not.toContain("Boston");
    });

    it("drops the rows even when the host forgets to pass a note", () => {
        // Fail SAFE: showing cell values is never the right answer, so an absent note degrades
        // to null rather than to the CSV.
        const out = payloadPreview({ shape: [{ name: "A" }], sampleCsv: "City\nBoston\n" });
        expect(out.sampleCsv).toBeNull();
        expect(JSON.stringify(out)).not.toContain("Boston");
    });

    it("says so when nothing is bound, instead of showing an empty object", () => {
        const note = "No data selected yet.";
        expect(payloadPreview({ shape: [] }, { emptyShapeNote: note })._note).toBe(note);
        expect(payloadPreview({}, { emptyShapeNote: note })._note).toBe(note);
        // ...and stays quiet when there IS a shape.
        expect(payloadPreview({ shape: [{ name: "A" }] }, { emptyShapeNote: note })).not
            .toHaveProperty("_note");
    });

    it("tolerates an empty or absent payload", () => {
        expect(payloadPreview({})).toEqual({});
        expect(payloadPreview(undefined as any)).toEqual({});
    });

    it("names every credential the add-in and the visual actually send", () => {
        // A CONTRACT, not a restatement: these are the credential field names on the request
        // payloads the hosts actually build. If a host renames one, this fails and the omit list
        // is updated in the same change rather than silently leaking under the new name.
        expect([...PREVIEW_OMITTED_FIELDS].sort()).toEqual([
            "clientId", "correlationId", "freemiumKey", "instanceKey",
            "licenseKey", "licensee", "linkNonce", "secretKey",
        ]);
    });
});
