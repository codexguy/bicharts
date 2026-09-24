import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { MarkerStore } from "../src/index";
import { assertMarkerStoreConformance, ConformanceError } from "../src/testing/index";

// The render-level host-service contracts are TYPES, restated wire interfaces included (a
// published declaration must not name the bundled shape-core - see host/services.ts). This
// file keeps the contracts free of runtime values, keeps the compile-time parity check wired,
// and tests the MarkerStore conformance check against stores that break it on purpose.

const src = resolve(__dirname, "../src");

describe("the restated wire interfaces are shape-core's, member for member", () => {
    it("the compile-time parity file exists and the package typecheck includes it", () => {
        // tests/typecheck/wireServicesParity.ts assigns each restated interface to shape-core's
        // and back; it only protects anything while tsconfig.json compiles it.
        const tsconfig = JSON.parse(readFileSync(resolve(__dirname, "../tsconfig.json"), "utf8"));
        expect(tsconfig.include).toContain("tests/typecheck/**/*.ts");
        const parity = readFileSync(resolve(__dirname, "typecheck/wireServicesParity.ts"), "utf8");
        for (const name of ["WireSigner", "WireResponse", "WireTransport", "CredentialTriple", "CredentialSource",
            "ViewportSource", "Clock", "DiagnosticEntry", "DiagnosticsSink", "RendererId", "WireServices"]) {
            expect(parity, name).toContain("Theirs." + name);
        }
    });
});

describe("host/services.ts declares types and nothing else", () => {
    it("has no runtime exports", async () => {
        const mod = await import("../src/host/services");
        expect(Object.keys(mod)).toEqual([]);
    });

    it("no runtime module reaches the testing entry", () => {
        const offenders: string[] = [];
        const walk = (d: string) => {
            for (const e of readdirSync(d)) {
                const p = join(d, e);
                if (statSync(p).isDirectory()) { if (e !== "testing") walk(p); continue; }
                if (!/\.tsx?$/.test(p)) continue;
                if (/from\s+["'][^"']*\/testing(?:\/index)?["']/.test(readFileSync(p, "utf8"))) offenders.push(p);
            }
        };
        walk(src);
        expect(offenders).toEqual([]);
    });
});

function mapStore(): MarkerStore & { map: Map<string, string> } {
    const map = new Map<string, string>();
    return {
        map,
        read: k => (map.has(k) ? map.get(k)! : null),
        write: (k, v) => { map.set(k, v); },
        clear: k => { map.delete(k); },
    };
}

async function failureOf(store: MarkerStore): Promise<ConformanceError | null> {
    try { await assertMarkerStoreConformance(store); return null; } catch (e) { return e as ConformanceError; }
}

describe("assertMarkerStoreConformance", () => {
    it("passes a synchronous map-backed store, and leaves no probe key behind", async () => {
        const s = mapStore();
        s.map.set("real", "kept");
        expect(await failureOf(s)).toBeNull();
        expect([...s.map.keys()]).toEqual(["real"]);
    });

    it("passes a store whose write completes asynchronously", async () => {
        const map = new Map<string, string>();
        const s: MarkerStore = {
            read: k => (map.has(k) ? map.get(k)! : null),
            write: (k, v) => new Promise<void>(res => setTimeout(() => { map.set(k, v); res(); }, 1)),
            clear: k => { map.delete(k); },
        };
        expect(await failureOf(s)).toBeNull();
    });

    it("fails a store that reads undefined for an absent key - the contract says null", async () => {
        const s = mapStore();
        const err = await failureOf({ ...s, read: k => (s.map.get(k) as string) });
        expect(err).toBeInstanceOf(ConformanceError);
        expect(err!.message).toMatch(/never written returned undefined, not null/);
        expect(err!.message).toMatch(/after clear\(\) returned undefined/);
    });

    it("fails a store whose clear does nothing", async () => {
        const s = mapStore();
        const err = await failureOf({ ...s, clear: () => {} });
        expect(err!.message).toMatch(/after clear\(\)/);
    });

    it("fails a store that keeps one value for every key", async () => {
        let only: string | null = null;
        const err = await failureOf({ read: () => only, write: (_k, v) => { only = v; }, clear: () => { only = null; } });
        expect(err!.message).toMatch(/changed another/);
    });

    it("fails a store that keeps the first write", async () => {
        const s = mapStore();
        const err = await failureOf({ ...s, write: (k, v) => { if (!s.map.has(k)) s.map.set(k, v); } });
        expect(err!.message).toMatch(/did not replace/);
    });

    it("reports a throwing store rather than throwing past the check", async () => {
        const s = mapStore();
        const err = await failureOf({ ...s, write: () => { throw new Error("quota"); } });
        expect(err!.contract).toBe("MarkerStore");
        expect(err!.message).toMatch(/threw.*quota/);
    });

    it("fails a store with a method missing", async () => {
        const err = await failureOf({ read: () => null } as unknown as MarkerStore);
        expect(err!.message).toMatch(/missing read\(\), write\(\) or clear\(\)/);
    });
});
