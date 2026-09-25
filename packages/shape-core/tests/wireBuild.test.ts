import { describe, it, expect } from "vitest";
import { viewportFields, maxNonMeasureCardinality, credentialFields, type ViewportSource, type CredentialSource } from "../src/index";

/** A source that counts how often it is measured and answers from a list, one per call. */
function countingSource(...answers: { width: number; height: number }[]): ViewportSource & { calls: number } {
    const s = {
        calls: 0,
        measure() { return answers[Math.min(s.calls++, answers.length - 1)]; },
    };
    return s;
}

describe("viewportFields - one measurement, stated twice", () => {
    it("states the request's size and the client hints' size from the same answer", () => {
        const f = viewportFields({ measure: () => ({ width: 640, height: 400 }) });
        expect(f.request).toEqual({ height: 400, width: 640 });
        expect(f.hints).toEqual({ viewportWidth: 640, viewportHeight: 400 });
    });

    it("measures once per call, so the two halves cannot disagree about a tile that is resizing", () => {
        const src = countingSource({ width: 640, height: 400 }, { width: 300, height: 200 });
        const f = viewportFields(src);
        expect(src.calls).toBe(1);
        expect(f.hints.viewportWidth).toBe(f.request.width);
        expect(f.hints.viewportHeight).toBe(f.request.height);
    });

    it("serialises in the order every host already sends: height then width, then width then height", () => {
        const f = viewportFields({ measure: () => ({ width: 1024, height: 768 }) });
        expect(JSON.stringify({ ...f.request })).toBe('{"height":768,"width":1024}');
        expect(JSON.stringify({ ...f.hints })).toBe('{"viewportWidth":1024,"viewportHeight":768}');
    });

    it("passes the source's numbers through unchanged - rounding and substitution are the source's", () => {
        const f = viewportFields({ measure: () => ({ width: 800.5, height: 600.25 }) });
        expect(f.request).toEqual({ height: 600.25, width: 800.5 });
        expect(f.hints).toEqual({ viewportWidth: 800.5, viewportHeight: 600.25 });
    });

    it("lets a source that throws throw - a request is never sized by a guess", () => {
        expect(() => viewportFields({ measure: () => { throw new Error("detached"); } })).toThrow("detached");
    });

    it("returns fresh objects, so a host that edits one half does not edit the other", () => {
        const f = viewportFields({ measure: () => ({ width: 10, height: 20 }) });
        (f.request as any).width = 99;
        expect(f.hints.viewportWidth).toBe(10);
    });
});

describe("maxNonMeasureCardinality - the largest category count among the dimensions", () => {
    it("is the largest distinctCount among the columns that are not measures", () => {
        expect(maxNonMeasureCardinality([
            { isMeasure: false, distinctCount: 4 },
            { isMeasure: false, distinctCount: 12 },
            { isMeasure: true, distinctCount: 190 },
        ])).toBe(12);
    });

    it("is 0 for a table of measures, and for no columns at all", () => {
        expect(maxNonMeasureCardinality([{ isMeasure: true, distinctCount: 50 }])).toBe(0);
        expect(maxNonMeasureCardinality([])).toBe(0);
    });

    it("reads a column with no isMeasure flag as a dimension", () => {
        expect(maxNonMeasureCardinality([{ distinctCount: 7 }])).toBe(7);
    });

    it("skips a count that is not a number: absent, null, NaN", () => {
        expect(maxNonMeasureCardinality([
            { isMeasure: false }, { isMeasure: false, distinctCount: null },
            { isMeasure: false, distinctCount: Number.NaN }, { isMeasure: false, distinctCount: 3 },
        ])).toBe(3);
    });
});

describe("credentialFields - one credential, and a linked session's nonce wins", () => {
    const TRIPLE = { licensee: "Contoso", licenseKey: "K".repeat(22), secretKey: "s3cret" };

    it("sends the source's triple, and an empty free-tier key, when the source has neither a nonce nor a free tier", () => {
        const f = credentialFields({ triple: () => TRIPLE });
        expect(f.request).toEqual({ licenseKey: "K".repeat(22), licensee: "Contoso", secretKey: "s3cret", freemiumKey: "" });
        expect(f.linkNonce).toBeNull();
    });

    it("serialises in the order every host sends them: key, licensee, secret, free-tier key", () => {
        const f = credentialFields({ triple: () => TRIPLE, freemiumKey: () => "1abc" });
        expect(JSON.stringify(f.request)).toBe(`{"licenseKey":"${"K".repeat(22)}","licensee":"Contoso","secretKey":"s3cret","freemiumKey":"1abc"}`);
    });

    it("a live nonce travels INSTEAD of the triple, never beside it, and is trimmed", () => {
        let asked = 0;
        const f = credentialFields({ triple: () => { asked++; return TRIPLE; }, linkNonce: () => "  nonce-abc  " });
        expect(f.request).toEqual({ licenseKey: "", licensee: "", secretKey: "", freemiumKey: "" });
        expect(f.linkNonce).toBe("nonce-abc");
        expect(asked).toBe(0);   // the triple is not even read
    });

    it("a blank or absent nonce is no nonce: the triple travels and the nonce field is empty, not missing", () => {
        for (const n of ["", "   ", null]) {
            const f = credentialFields({ triple: () => TRIPLE, linkNonce: () => n });
            expect(f.request.licenseKey).toBe("K".repeat(22));
            expect(f.linkNonce).toBe("");
        }
    });

    it("a host with no nonce member - absent or null - sends no nonce field at all", () => {
        expect(credentialFields({ triple: () => TRIPLE, linkNonce: null }).linkNonce).toBeNull();
        expect(credentialFields({ triple: () => TRIPLE }).linkNonce).toBeNull();
    });

    it("passes the source's values through as they are: trimming and mode are the source's", () => {
        const f = credentialFields({ triple: () => ({ licensee: " A ", licenseKey: "k ", secretKey: "" }) });
        expect(f.request).toEqual({ licenseKey: "k ", licensee: " A ", secretKey: "", freemiumKey: "" });
    });

    it("the free-tier key rides beside either credential, and reads \"\" when the source has none right now", () => {
        const src: CredentialSource = { triple: () => ({ licensee: "", licenseKey: "", secretKey: "" }), freemiumKey: () => null };
        expect(credentialFields(src).request.freemiumKey).toBe("");
        const withNonce = credentialFields({ triple: () => TRIPLE, linkNonce: () => "n", freemiumKey: () => "1abc" });
        expect(withNonce.request.freemiumKey).toBe("1abc");
        expect(withNonce.request.licenseKey).toBe("");
    });
});
