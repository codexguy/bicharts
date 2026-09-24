import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { WireServices, WireSigner, CredentialSource } from "../src/index";
import { assertWireSignerConformance, ConformanceError } from "../src/testing/index";
import { SIMPLE_STRING_HASH } from "../src/util";

// The host-service contracts are TYPES: the file that declares them carries no runtime value,
// so declaring a contract can never change what any host does. The conformance checks beside
// them are what give the types teeth, and they are tested here against adapters that break
// each property on purpose.

const src = resolve(__dirname, "../src");

describe("host/services.ts declares types and nothing else", () => {
    it("has no runtime exports", async () => {
        const mod = await import("../src/host/services");
        expect(Object.keys(mod)).toEqual([]);
    });

    it("a host's services object needs only the required members", () => {
        const signer: WireSigner = { sign: b => String(SIMPLE_STRING_HASH(b + "k")) };
        const credentials: CredentialSource = { triple: () => ({ licensee: "", licenseKey: "", secretKey: "" }) };
        const services: WireServices = {
            signer,
            transport: { post: async () => ({ status: 204, contentType: null, body: null, text: async () => "" }) },
            credentials,
            clock: { now: () => 0 },
            renderers: new Set(["D3"]),
        };
        // Optional members are absent or null, and both mean "this host cannot".
        const withNulls: WireServices = { ...services, viewport: null, diagnostics: null };
        expect(withNulls.viewport).toBeNull();
        expect(services.renderers.has("D3")).toBe(true);
    });

    it("no runtime module reaches the testing entry", () => {
        const offenders: string[] = [];
        const walk = (d: string) => {
            for (const e of readdirSync(d)) {
                const p = join(d, e);
                if (statSync(p).isDirectory()) { if (e !== "testing") walk(p); continue; }
                if (!p.endsWith(".ts")) continue;
                if (/from\s+["'][^"']*\/testing(?:\/index)?["']/.test(readFileSync(p, "utf8"))) offenders.push(p);
            }
        };
        walk(src);
        expect(offenders).toEqual([]);
    });
});

describe("assertWireSignerConformance", () => {
    const hashSigner: WireSigner = { sign: b => SIMPLE_STRING_HASH(b + "suffix").toString() };

    it("passes a signer shaped like every host's: a keyed hash over the encoded body", () => {
        expect(() => assertWireSignerConformance(hashSigner)).not.toThrow();
    });

    const failing: Array<[string, WireSigner, RegExp]> = [
        ["a blank signature", { sign: () => "  " }, /blank signature/],
        ["the same signature for every body", { sign: () => "42" }, /same signature/],
        ["a signature that changes between calls", (() => { let n = 0; return { sign: () => String(n++) }; })(), /not deterministic/],
        ["a number instead of a string", { sign: b => SIMPLE_STRING_HASH(b) as unknown as string }, /not a string/],
        ["a throw", { sign: () => { throw new Error("no key"); } }, /threw.*no key/],
        ["no sign method", {} as WireSigner, /no sign\(\) method/],
    ];
    for (const [what, signer, message] of failing) {
        it(`fails ${what}`, () => {
            let err: unknown = null;
            try { assertWireSignerConformance(signer); } catch (e) { err = e; }
            expect(err).toBeInstanceOf(ConformanceError);
            expect((err as ConformanceError).contract).toBe("WireSigner");
            expect((err as Error).message).toMatch(message);
        });
    }

    it("reports every broken property in one run, not only the first", () => {
        let err: ConformanceError | null = null;
        try { assertWireSignerConformance({ sign: () => 7 as unknown as string }); } catch (e) { err = e as ConformanceError; }
        // A constant non-string is two failures: the type, and one signature for two bodies.
        expect(err?.failures.length).toBe(2);
    });
});
