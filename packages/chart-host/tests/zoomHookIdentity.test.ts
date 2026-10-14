import { describe, it, expect, vi, afterEach } from "vitest";
import { noteZoomMemoryHost, zoomMemoryHostOf, sameZoomMemory } from "../src/zoomHookIdentity";

// WHICH MEMORY A ZOOM HOOK WAS BUILT OVER, asked by a binding without comparing hooks by identity. The host rides on the
// hook itself, so it holds when a consumer bundles the entries that write it (zoom-memory) and read it (react) as separate
// copies of this module.

afterEach(() => { vi.resetModules(); });

describe("zoom hook identity", () => {
    it("two hooks over the same host are the same memory; over different hosts, not", () => {
        const h1 = {}, h2 = {};
        const a = {}, b = {}, c = {};
        noteZoomMemoryHost(a, h1);
        noteZoomMemoryHost(b, h1);
        noteZoomMemoryHost(c, h2);
        expect(zoomMemoryHostOf(a)).toBe(h1);
        expect(sameZoomMemory(a, b)).toBe(true);
        expect(sameZoomMemory(a, c)).toBe(false);
    });

    it("a hook not built over a host is compared by identity", () => {
        const x = { keyFor: () => "k" }, y = { keyFor: () => "k" };
        expect(zoomMemoryHostOf(x)).toBeUndefined();
        expect(sameZoomMemory(x, x)).toBe(true);
        expect(sameZoomMemory(x, y)).toBe(false);
        expect(sameZoomMemory(undefined, null)).toBe(false);
        expect(sameZoomMemory(undefined, undefined)).toBe(true);
        expect(zoomMemoryHostOf("a string")).toBeUndefined();
    });

    it("the note does not show: not enumerable, not in JSON, not copied by a spread", () => {
        const hook = { keyFor: () => "k" };
        noteZoomMemoryHost(hook, {});
        expect(Object.keys(hook)).toEqual(["keyFor"]);
        expect(JSON.stringify(hook)).toBe("{}");
        expect(zoomMemoryHostOf({ ...hook })).toBeUndefined();
    });

    it("a frozen hook cannot carry the note, and noting it does not throw", () => {
        const hook = Object.freeze({ keyFor: () => "k" });
        expect(() => noteZoomMemoryHost(hook, {})).not.toThrow();
        expect(sameZoomMemory(hook, hook)).toBe(true);
    });

    it("two copies of the module agree on a hook one of them noted", async () => {
        vi.resetModules();
        const one = await import("../src/zoomHookIdentity");
        vi.resetModules();
        const two = await import("../src/zoomHookIdentity");
        expect(two.noteZoomMemoryHost).not.toBe(one.noteZoomMemoryHost);      // really two evaluations of the module
        const host = {};
        const a = {}, b = {};
        one.noteZoomMemoryHost(a, host);
        two.noteZoomMemoryHost(b, host);
        expect(two.zoomMemoryHostOf(a)).toBe(host);
        expect(one.zoomMemoryHostOf(b)).toBe(host);
        expect(one.sameZoomMemory(a, b)).toBe(true);
        expect(two.sameZoomMemory(a, b)).toBe(true);
        const other = {};
        one.noteZoomMemoryHost(other, {});
        expect(two.sameZoomMemory(a, other)).toBe(false);
    });

    it("hooks built by two copies of the zoom-memory entry, over one host, are the same memory to either copy", async () => {
        vi.resetModules();
        const dom1 = await import("../src/zoomMemory/zoomMemoryDom");
        const id1 = await import("../src/zoomHookIdentity");
        vi.resetModules();
        const dom2 = await import("../src/zoomMemory/zoomMemoryDom");
        const id2 = await import("../src/zoomHookIdentity");
        expect(dom2.createZoomMemoryHook).not.toBe(dom1.createZoomMemoryHook);
        expect(id2.sameZoomMemory).not.toBe(id1.sameZoomMemory);
        const zh: any = {
            liveZoomState: null, zoomWatchKey: "", zoomWatchAttached: false, zoomSettleTimer: 0, zoomContainer: null,
            rememberAcrossSessions: () => false, readPersistedZoom: () => null, persistZoom: () => undefined, log: () => undefined,
        };
        const a = dom1.createZoomMemoryHook(zh);
        const b = dom2.createZoomMemoryHook(zh);
        expect(id1.sameZoomMemory(a, b)).toBe(true);
        expect(id2.sameZoomMemory(a, b)).toBe(true);
        expect(id1.sameZoomMemory(a, dom2.createZoomMemoryHook({ ...zh }))).toBe(false);
    });
});
