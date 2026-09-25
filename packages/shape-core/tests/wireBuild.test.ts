import { describe, it, expect } from "vitest";
import {
    viewportFields, maxNonMeasureCardinality, credentialFields, resolveFetchVersion, fetchFields,
    type ViewportSource, type CredentialSource,
} from "../src/index";

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

// Moved from the Power BI visual with every expected value unchanged; the visual's own copy of these
// cases now runs against this function through its re-export.
describe("resolveFetchVersion - a fetch asks for a real version and can never bill", () => {
    it("a refetch with an unset setting asks for the version in hand", () => {
        const r = resolveFetchVersion({ genNew: false, settingVersion: null, codeVersion: 4 });
        expect(r.version).toBe(4);
        expect(r.fetchOnly).toBe(true);
    });

    it("an explicit version the reader typed still wins over the one in hand", () => {
        const r = resolveFetchVersion({ genNew: false, settingVersion: 2, codeVersion: 4 });
        expect(r.version).toBe(2);
        expect(r.fetchOnly).toBe(true);
    });

    it("the recovery poll keeps absolute priority", () => {
        const r = resolveFetchVersion({ genNew: false, recoveryFetchVersion: 7, settingVersion: 2, codeVersion: 4 });
        expect(r.version).toBe(7);
        expect(r.fetchOnly).toBe(true);
    });

    it("recovery wins even on a genNew request - that path only ever fetches", () => {
        const r = resolveFetchVersion({ genNew: true, recoveryFetchVersion: 7, settingVersion: null, codeVersion: 4 });
        expect(r.version).toBe(7);
        expect(r.fetchOnly).toBe(true);
    });

    it("an explicit version is honored and is never turned into a correlation fetch", () => {
        for (const v of [1, 2, 5, 37]) {
            const r = resolveFetchVersion({ genNew: false, settingVersion: v, codeVersion: 9 });
            expect(r.version, `version ${v}`).toBe(v);
            expect(r.fetchOnly, `version ${v}`).toBe(true);
        }
        const r = resolveFetchVersion({ genNew: false, recoveryFetchByCorrelation: undefined, settingVersion: 3, codeVersion: 9 });
        expect(r.version).toBe(3);
    });

    it("navigating backwards works", () => {
        const r = resolveFetchVersion({ genNew: false, settingVersion: 2, codeVersion: 12 });
        expect(r.version).toBe(2);
        expect(r.fetchOnly).toBe(true);
    });

    it("a correlation-keyed recovery sends NO version, and still cannot bill", () => {
        const r = resolveFetchVersion({ genNew: false, recoveryFetchByCorrelation: true, settingVersion: 2, codeVersion: 4 });
        expect(r.version).toBeNull();
        expect(r.fetchOnly).toBe(true);
    });

    it("correlation beats the version the poll used to guess, and beats genNew", () => {
        const r = resolveFetchVersion({ genNew: true, recoveryFetchByCorrelation: true, recoveryFetchVersion: 7, settingVersion: 2, codeVersion: 4 });
        expect(r.version).toBeNull();
        expect(r.fetchOnly).toBe(true);
    });

    it("a generate is untouched, and is never marked fetch-only", () => {
        const r = resolveFetchVersion({ genNew: true, settingVersion: null, codeVersion: 4 });
        expect(r.version).toBeNull();
        expect(r.fetchOnly).toBeUndefined();
        expect(resolveFetchVersion({ genNew: true, settingVersion: 3, codeVersion: 4 }).version).toBe(3);
    });

    it("version 0 is 'no preference', not 'version zero'", () => {
        expect(resolveFetchVersion({ genNew: false, settingVersion: 0, codeVersion: 4 }).version).toBe(4);
    });

    it("with nothing in hand and nothing asked for, it does not invent a version", () => {
        const r = resolveFetchVersion({ genNew: false, settingVersion: null, codeVersion: null });
        expect(r.version).toBeNull();
        expect(r.fetchOnly).toBeUndefined();
    });

    it("undefined and null are treated alike on every input", () => {
        expect(resolveFetchVersion({ genNew: false, codeVersion: 4 }).version).toBe(4);
        expect(resolveFetchVersion({ genNew: false, settingVersion: undefined, codeVersion: 4 }).version).toBe(4);
    });

    it("never returns a fetchOnly flag without a version to fetch", () => {
        for (const s of [null, 0, 2, undefined]) {
            for (const c of [null, 0, 4, undefined]) {
                const r = resolveFetchVersion({ genNew: false, settingVersion: s, codeVersion: c });
                if (r.fetchOnly) expect(r.version).toBeGreaterThan(0);
            }
        }
    });
});

describe("fetchFields - the four fetch fields decided together", () => {
    it("an ordinary generate: a new generation, the stated version, nothing fetch-only - and nothing extra on the wire", () => {
        const f = fetchFields({ genNew: true, settingVersion: 0 });
        expect(f).toEqual({ genNew: true, version: 0, fetchOnly: undefined, fetchCorrelationId: undefined });
        expect(JSON.stringify(f)).toBe('{"genNew":true,"version":0}');
    });

    it("a recovery poll by correlation: never a generation, no version, fetch-only, the correlation - in that order", () => {
        const f = fetchFields({ genNew: true, fetchCorrelationId: "c-1", settingVersion: 0, codeVersion: 4 });
        expect(JSON.stringify(f)).toBe('{"genNew":false,"version":null,"fetchOnly":true,"fetchCorrelationId":"c-1"}');
    });

    it("an empty correlation is still a correlation: the host decides what counts as none", () => {
        expect(fetchFields({ genNew: true, fetchCorrelationId: "" }).genNew).toBe(false);
        expect(fetchFields({ genNew: true, fetchCorrelationId: null }).genNew).toBe(true);
    });

    it("a recovery poll by version: never a generation, that version, fetch-only", () => {
        expect(fetchFields({ genNew: true, recoveryFetchVersion: 7 }))
            .toEqual({ genNew: false, version: 7, fetchOnly: true, fetchCorrelationId: undefined });
    });

    it("a fetch of a stated version is fetch-only", () => {
        expect(fetchFields({ genNew: false, settingVersion: 3 }))
            .toEqual({ genNew: false, version: 3, fetchOnly: true, fetchCorrelationId: undefined });
    });

    it("a refetch of the version in hand is fetch-only", () => {
        expect(fetchFields({ genNew: false, settingVersion: null, codeVersion: 4 }))
            .toEqual({ genNew: false, version: 4, fetchOnly: true, fetchCorrelationId: undefined });
    });
});
