import { describe, it, expect } from "vitest";
import { gzipSync, gunzipSync } from "node:zlib";
import {
    encodePayload, keyedSigner, messageSignature, readWireField, SIMPLE_STRING_HASH, type GzipText,
} from "../src/index";
import { assertWireSignerConformance } from "../src/testing/index";

// KNOWN-ANSWER tests, not round trips. A round trip ("encode then decode gives the input back")
// passes against a wrong hash, a wrong key and a wrong envelope - it only proves the code agrees
// with itself. The hash values below were computed by an independent implementation that is
// itself pinned against the server's, and every host that signs requests carries the same
// values in its own suite with its own key.

const zlibGzip: GzipText = text => gzipSync(Buffer.from(text, "utf-8"), { level: 6 });
const inflate = (encoded: string) =>
    JSON.parse(gunzipSync(Buffer.from(encoded.replace(/\./g, "/"), "base64")).toString("utf-8"));

describe("the signing hash: FNV-1a 64, masked to 53 bits", () => {
    it("matches the reference implementation on known inputs", () => {
        expect(SIMPLE_STRING_HASH("")).toBe(0);
        expect(SIMPLE_STRING_HASH("a")).toBe(1086646154030220);
        expect(SIMPLE_STRING_HASH("hello")).toBe(4741396945353995);
        expect(SIMPLE_STRING_HASH("BIC")).toBe(4597168453995013);
        expect(SIMPLE_STRING_HASH("abc")).toBe(8903952624080715);
    });

    it("stays a safe integer on a long input, and is order-sensitive", () => {
        const h = SIMPLE_STRING_HASH("x".repeat(10000));
        expect(Number.isSafeInteger(h)).toBe(true);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(SIMPLE_STRING_HASH("ab")).not.toBe(SIMPLE_STRING_HASH("ba"));
    });
});

describe("keyedSigner + messageSignature", () => {
    it("hashes the encoded body with the key APPENDED, as a decimal string", () => {
        expect(messageSignature("ab", keyedSigner("c"))).toBe("8903952624080715");
        expect(messageSignature("abc", keyedSigner("k"))).toBe("6632820772899680");
        expect(messageSignature("H4sIAAAA.xyz", keyedSigner("test-key"))).toBe("2858252268928562");
    });

    it("changes when the body changes by one character", () => {
        const s = keyedSigner("k");
        expect(messageSignature("abc", s)).not.toBe(messageSignature("abd", s));
    });

    it("passes the signer conformance check every host's adapter runs", () => {
        expect(() => assertWireSignerConformance(keyedSigner("k"))).not.toThrow();
    });

    it("refuses a missing key at construction, not at the first request", () => {
        expect(() => keyedSigner("")).toThrow(/signing key/);
        expect(() => keyedSigner(undefined as unknown as string)).toThrow(/signing key/);
    });

    it("refuses a signer that returns a blank signature", () => {
        expect(() => messageSignature("abc", { sign: () => "" })).toThrow(/blank signature/);
        expect(() => messageSignature("abc", { sign: () => " " })).toThrow(/blank signature/);
        expect(() => messageSignature("abc", { sign: () => 12 as unknown as string })).toThrow(/blank signature/);
    });
});

describe("encodePayload: JSON -> gzip -> base64 -> '/' to '.'", () => {
    it("hands the compressor the JSON text, and writes every '/' of the base64 as '.'", () => {
        // A fixed byte string whose base64 is "+/+/AD8+EA==": two slashes to substitute, and
        // '+' left alone. The gzip step is the host's; this pins what the envelope does around it.
        const seen: string[] = [];
        const fixed: GzipText = text => { seen.push(text); return Uint8Array.from([0xfb, 0xff, 0xbf, 0x00, 0x3f, 0x3e, 0x10]); };
        expect(encodePayload({ a: 1, b: "two" }, fixed)).toBe("+.+.AD8+EA==");
        expect(seen).toEqual(['{"a":1,"b":"two"}']);
    });

    it("inflates back to the original JSON, exactly as the server undoes it", () => {
        const payload = { a: 1, b: "two", c: [3, 4], d: { e: null }, u: "héllo ☃" };
        expect(inflate(encodePayload(payload, zlibGzip))).toEqual(payload);
    });

    it("leaves no '/' in the output of a realistic payload", () => {
        const payload = { blob: "x".repeat(5000), note: "slashes appear in base64 of most binary" };
        expect(encodePayload(payload, zlibGzip)).not.toContain("/");
    });

    it("handles a payload large enough to break the naive String.fromCharCode(...bytes)", () => {
        const payload = { rows: Array.from({ length: 20000 }, (_, i) => ({ i, name: `row ${i}` })) };
        const encoded = encodePayload(payload, zlibGzip);
        expect(encoded.length).toBeGreaterThan(1000);
        expect(inflate(encoded).rows).toHaveLength(20000);
    });

    it("base64 is the standard alphabet, byte for byte what Buffer produces", () => {
        const payload = { rows: Array.from({ length: 3000 }, (_, i) => ({ i, v: (i * 7919) % 1000 / 7 })) };
        const bytes = zlibGzip(JSON.stringify(payload));
        const expected = Buffer.from(bytes).toString("base64").replace(/\//g, ".");
        expect(encodePayload(payload, () => bytes)).toBe(expected);
    });

    it("refuses to run without a compressor", () => {
        expect(() => encodePayload({}, undefined as unknown as GzipText)).toThrow(/gzip/);
    });
});

describe("readWireField: a response field in either casing", () => {
    it("reads the camel form first", () => {
        expect(readWireField({ errorMessage: "a", ErrorMessage: "b" }, "errorMessage")).toBe("a");
    });

    it("falls back to the Pascal form when the camel form is absent or null", () => {
        expect(readWireField({ ErrorMessage: "b" }, "errorMessage")).toBe("b");
        expect(readWireField({ errorMessage: null, ErrorMessage: "b" }, "errorMessage")).toBe("b");
    });

    it("keeps a falsy camel value that is not null: false, 0 and the empty string are answers", () => {
        expect(readWireField({ isVeto: false, IsVeto: true }, "isVeto")).toBe(false);
        expect(readWireField({ rank: 0, Rank: 3 }, "rank")).toBe(0);
        expect(readWireField({ code: "", Code: "x" }, "code")).toBe("");
    });

    it("returns undefined when neither is present, and when both are null the Pascal null", () => {
        expect(readWireField({}, "code")).toBeUndefined();
        expect(readWireField({ code: null, Code: null }, "code")).toBeNull();
        expect(readWireField({ code: undefined }, "code")).toBeUndefined();
    });

    it("reads a null or non-object body as absent", () => {
        expect(readWireField(null, "code")).toBeUndefined();
        expect(readWireField(undefined, "code")).toBeUndefined();
        expect(readWireField("code", "length")).toBeUndefined();
    });

    it("capitalises only the first letter", () => {
        expect(readWireField({ ServedCorrelationId: "c" }, "servedCorrelationId")).toBe("c");
        expect(readWireField({ DestPointLat: "x" }, "destPointLat")).toBe("x");
    });
});
