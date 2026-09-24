import { describe, it, expect } from "vitest";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    encodePayload, gzipWireText, keyedSigner, messageSignature, readWireField, SIMPLE_STRING_HASH,
    type GzipText,
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

// THE ENVELOPE'S KNOWN ANSWERS (2026-09-24). One pako, pinned exactly, compresses every host's
// request, so the bytes of an envelope are a property of the payload and can be pinned here. The
// literals below were derived once from pako 3.0.2's gzip at its default level; every host's own
// suite carries the same values for the fixtures it shares with this one.
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const KAT_FIXTURES: { payload: unknown; envelope?: string; sha256: string }[] = [
    { payload: {}, envelope: "H4sIAAAAAAAAA6uuBQBDv6ajAgAAAA==",
      sha256: "352c430f41c9481890d202d008898f2602e97efc4ca89db18f76c991fd57a996" },
    { payload: { a: 1, b: "two", c: [3, 4], d: { e: null } },
      envelope: "H4sIAAAAAAAAA6tWSlSyMtRRSlKyUiopz1fSUUpWsoo21jGJ1VFKUbKqVkpVssorzcmprQUAz5lB5SoAAAA=",
      sha256: "2f76e1c1e08fc110ed5aee4a1ac061c522d4b18409fa5db3eb14b3556bb6394d" },
    // Its plain base64 carries a '/', so this answer also pins the substitution.
    { payload: { text: "héllo ☃ 日本", n: -0.5, t: true },
      envelope: "H4sIAAAAAAAAA6tWKkmtKFGyUso4vDInJ1.h0YxmhWfTlz6bs0ZJRylPyUrXQM9UR6lEyaqkqDS1FgCjCwpGLgAAAA==",
      sha256: "d6a4722295bfe9f4fb8e8308ca6606fcb30c4a4c44795d0a75f27df94989f8e8" },
    { payload: { blob: "x".repeat(5000) },
      envelope: "H4sIAAAAAAAAA+3BwQkAIAwEsF1uDMfpu+BXEHd3iv6S3FTvysoBAAAAAMblfU26976TEwAA",
      sha256: "76a651e1d9f7c5eb92963816dd0826c46f9610f8243c1478cbc8e6e35aa6bbc1" },
    { payload: { rows: Array.from({ length: 20000 }, (_, i) => ({ i, name: `row ${i}` })) },
      sha256: "ebfb0e7b0109f808cabdd44073b5ee7c781be6f4be489cdbc1042d3b0eb41212" },
];

describe("encodePayload: JSON -> gzip -> base64 -> '/' to '.'", () => {
    it("compresses with pako pinned to one EXACT version, and that version is the one installed", () => {
        const manifest = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8"));
        const pinned: string = manifest.dependencies.pako;
        expect(pinned, "a range would let two installs send two byte streams").toMatch(/^\d+\.\d+\.\d+$/);
        const req = createRequire(resolve(__dirname, "../package.json"));
        const installed = JSON.parse(readFileSync(req.resolve("pako/package.json"), "utf8")).version;
        expect(installed).toBe(pinned);
    });

    KAT_FIXTURES.forEach(({ payload, envelope, sha256: digest }, i) => {
        it(`fixture ${i}: the known answer, and it inflates to exactly the payload's JSON`, () => {
            const body = encodePayload(payload);
            if (envelope) expect(body).toBe(envelope);
            expect(sha256(body)).toBe(digest);
            expect(gunzipSync(Buffer.from(body.replace(/\./g, "/"), "base64")).toString("utf-8"))
                .toBe(JSON.stringify(payload));
        });
    });

    it("is gzipWireText's bytes as standard base64 with every '/' written as '.'", () => {
        const payload = KAT_FIXTURES[2].payload;
        const plain = Buffer.from(gzipWireText(JSON.stringify(payload))).toString("base64");
        expect(plain).toContain("/");
        expect(encodePayload(payload)).toBe(plain.replace(/\//g, "."));
    });

    it("inflates back to the original JSON, exactly as the server undoes it", () => {
        const payload = { a: 1, b: "two", c: [3, 4], d: { e: null }, u: "héllo ☃" };
        expect(inflate(encodePayload(payload))).toEqual(payload);
    });

    it("leaves no '/' in the output of a realistic payload", () => {
        const payload = { blob: "x".repeat(5000), note: "slashes appear in base64 of most binary" };
        expect(encodePayload(payload)).not.toContain("/");
    });

    it("handles a payload large enough to break the naive String.fromCharCode(...bytes)", () => {
        const payload = { rows: Array.from({ length: 20000 }, (_, i) => ({ i, name: `row ${i}` })) };
        const encoded = encodePayload(payload);
        expect(encoded.length).toBeGreaterThan(1000);
        expect(inflate(encoded).rows).toHaveLength(20000);
    });

    it("base64 is the standard alphabet, byte for byte what Buffer produces", () => {
        const payload = { rows: Array.from({ length: 3000 }, (_, i) => ({ i, v: (i * 7919) % 1000 / 7 })) };
        const bytes = gzipWireText(JSON.stringify(payload));
        const expected = Buffer.from(bytes).toString("base64").replace(/\//g, ".");
        expect(encodePayload(payload)).toBe(expected);
    });

    it("ignores a compressor passed by a caller written against the old two-argument form", () => {
        // Node's zlib emits different bytes for the same text; the envelope must not.
        const payload = KAT_FIXTURES[4].payload;
        expect(zlibGzip(JSON.stringify(payload))).not.toEqual(gzipWireText(JSON.stringify(payload)));
        expect(encodePayload(payload, zlibGzip)).toBe(encodePayload(payload));
        expect(encodePayload({}, undefined as unknown as GzipText)).toBe(KAT_FIXTURES[0].envelope);
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
