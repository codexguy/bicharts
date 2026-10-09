import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as main from "../src/index";
import { noopViewStateService, viewStateIsDurable } from "../src/viewState";
import { assertViewStateConformance, ConformanceError, type ViewStateConformanceOptions } from "../src/testing/index";
import type { ViewStateProvider } from "../src/contract";
import type { ViewStateService } from "../src/host/services";

// THE VIEW-STATE SERVICE: its helpers, its entry, and its conformance suite.
//
// The suite is itself a gate, so it is tested the way the other conformance suites are: a reference
// service that must pass, and a broken service for every property it claims to check, each of which
// must be caught and must be caught for the stated reason.

const pkgRoot = resolve(__dirname, "..");

describe("the view-state entry", () => {
    it("the main entry does not export the helpers (its eager closure is budgeted)", () => {
        for (const name of ["noopViewStateService", "viewStateIsDurable"]) expect(name in main, name).toBe(false);
    });

    it("no runtime module imports the entry's source, so the main entry's closure cannot reach it", () => {
        const index = readFileSync(resolve(pkgRoot, "src/index.ts"), "utf8");
        expect(index).not.toMatch(/from\s+["']\.\/viewState["']/);
    });

    it("package.json exports ./view-state and build.mjs builds it", () => {
        const pkg = JSON.parse(readFileSync(resolve(pkgRoot, "package.json"), "utf8"));
        expect(pkg.exports["./view-state"]).toEqual({
            types: "./dist/types/viewState.d.ts",
            import: "./dist/view-state.mjs",
            default: "./dist/view-state.mjs",
        });
        const build = readFileSync(resolve(pkgRoot, "build.mjs"), "utf8");
        expect(build).toMatch(/"view-state":\s*join\(here,\s*"src\/viewState\.ts"\)/);
    });
});

describe("noopViewStateService", () => {
    it("stores nothing: the viewing store reads {} however much is saved, and there is no durable store", () => {
        const s = noopViewStateService();
        s.viewing.save({ camera: { yaw: 1 }, sort: "x" });
        expect(s.viewing.load()).toEqual({});
        expect(s.durable ?? null).toBeNull();
        expect(s.policy).toEqual({});
    });

    it("hands out a fresh service each time, so one host's stores are never another's", () => {
        expect(noopViewStateService()).not.toBe(noopViewStateService());
        expect(noopViewStateService().viewing).not.toBe(noopViewStateService().viewing);
    });

    it("is well formed, and fails only the checks that need something to be stored", async () => {
        const err = await assertViewStateConformance(noopViewStateService()).catch(e => e as ConformanceError);
        expect(err).toBeInstanceOf(ConformanceError);
        // Only the checks that need a store to hold something: nothing about its shape or its policy.
        for (const f of err.failures) expect(f, f).toMatch(/^viewing: (load\(\) after save\(\)|a second save\(\) did not replace)/);
    });
});

describe("viewStateIsDurable", () => {
    const provider: ViewStateProvider = { load: () => ({}), save: () => {} };
    it("is true exactly when there is a durable store", () => {
        expect(viewStateIsDurable({ viewing: provider, durable: provider, policy: {} })).toBe(true);
        expect(viewStateIsDurable({ viewing: provider, policy: {} })).toBe(false);
        expect(viewStateIsDurable({ viewing: provider, durable: null, policy: {} })).toBe(false);
    });
    it("is false for a host that passed no service, and for the no-op one", () => {
        expect(viewStateIsDurable(null)).toBe(false);
        expect(viewStateIsDurable(undefined)).toBe(false);
        expect(viewStateIsDurable(noopViewStateService())).toBe(false);
    });
});

// ---- the reference service, and the conformance suite against it ----

interface Medium { element: Record<string, unknown>; file: { saved: string } }

/** Stores behave like the real ones: the element's is a live object replaced in place, the file's is text. */
function build(medium: Medium, over: Partial<ViewStateService> = {}): ViewStateService {
    return {
        viewing: {
            load: () => medium.element,
            save: next => { for (const k of Object.keys(medium.element)) delete medium.element[k]; Object.assign(medium.element, next); },
        },
        durable: {
            load: () => JSON.parse(medium.file.saved),
            save: next => { medium.file.saved = JSON.stringify(next); },
        },
        policy: {},
        ...over,
    };
}

function good(): { medium: Medium; service: ViewStateService; options: ViewStateConformanceOptions } {
    const medium: Medium = { element: {}, file: { saved: "{}" } };
    return {
        medium,
        service: build(medium),
        options: {
            recreate: () => build(medium),
            reopen: () => build({ element: {}, file: medium.file }),
        },
    };
}

describe("assertViewStateConformance: the reference service", () => {
    it("passes, and reports every property it covered with nothing skipped", async () => {
        const { service, options } = good();
        const report = await assertViewStateConformance(service, options);
        expect(report.skipped).toEqual([]);
        expect(report.checked).toEqual([
            "shape",
            "viewing: load, save, replace, round trip",
            "durable: load, save, replace, round trip",
            "viewing: survives a host re-created on the same element",
            "durable: survives a reopen; viewing: starts clean after one",
        ]);
    });

    it("says what it could not check when it is not given the means", async () => {
        const { service } = good();
        const report = await assertViewStateConformance(service);
        expect(report.skipped).toHaveLength(2);
        expect(report.skipped[0]).toMatch(/options\.recreate/);
        expect(report.skipped[1]).toMatch(/options\.reopen/);
    });

    it("needs no reopen for a service with no durable store, and does not ask for one", async () => {
        const medium: Medium = { element: {}, file: { saved: "{}" } };
        const report = await assertViewStateConformance(build(medium, { durable: null }), { recreate: () => build(medium, { durable: null }) });
        expect(report.skipped).toEqual([]);
        expect(report.checked.some(c => c.startsWith("durable"))).toBe(false);
    });

    it("puts back whatever the stores held, and leaves no probe behind", async () => {
        const { medium, service, options } = good();
        service.viewing.save({ sort: { key: "Region" }, frame: 3 });
        service.durable!.save({ sort: { key: "Region" }, frame: 2 });
        await assertViewStateConformance(service, options);
        expect(medium.element).toEqual({ sort: { key: "Region" }, frame: 3 });
        expect(JSON.parse(medium.file.saved)).toEqual({ sort: { key: "Region" }, frame: 2 });
    });

    it("puts the stores back even when it fails", async () => {
        const { medium, service } = good();
        service.viewing.save({ keep: 1 });
        service.durable!.save({ kept: 2 });
        // A check that fails late, after both stores have been written to.
        const options: ViewStateConformanceOptions = { recreate: () => ({ policy: {} } as unknown as ViewStateService) };
        await expect(assertViewStateConformance(service, options)).rejects.toBeInstanceOf(ConformanceError);
        expect(medium.element).toEqual({ keep: 1 });
        expect(JSON.parse(medium.file.saved)).toEqual({ kept: 2 });
    });

    it("accepts a durable write that lands later, when it is given the means to wait", async () => {
        const { medium, service, options } = good();
        const pending: Array<() => void> = [];
        const debounced: ViewStateService = {
            ...service,
            durable: {
                load: () => JSON.parse(medium.file.saved),
                save: next => { const json = JSON.stringify(next); pending.push(() => { medium.file.saved = json; }); },
            },
        };
        const flush = () => { while (pending.length) pending.shift()!(); };
        await expect(assertViewStateConformance(debounced, options)).rejects.toBeInstanceOf(ConformanceError);
        await expect(assertViewStateConformance(debounced, { ...options, settle: flush })).resolves.toBeDefined();
    });

    it("awaits an asynchronous settle", async () => {
        const { medium, service, options } = good();
        let queued: string | null = null;
        const slow: ViewStateService = {
            ...service,
            durable: { load: () => JSON.parse(medium.file.saved), save: next => { queued = JSON.stringify(next); } },
        };
        const settle = () => new Promise<void>(res => setTimeout(() => { if (queued !== null) medium.file.saved = queued; res(); }, 1));
        await expect(assertViewStateConformance(slow, { ...options, settle })).resolves.toBeDefined();
    });
});

// ---- mutation check: one broken service per claimed property, each of which must be caught ----

type Mutant = {
    name: string;
    make: (m: Medium) => ViewStateService;
    options?: (m: Medium) => ViewStateConformanceOptions;
    /** The text the failure must carry, so a mutant is caught for the right reason. */
    expect: RegExp;
};

const reopenFresh = (m: Medium) => () => build({ element: {}, file: m.file });
const recreateSame = (m: Medium) => () => build(m);
const opts = (m: Medium): ViewStateConformanceOptions => ({ recreate: recreateSame(m), reopen: reopenFresh(m) });

const MUTANTS: Mutant[] = [
    { name: "viewing.load() throws", expect: /viewing: load\(\) threw, and it must never/,
        make: m => { const s = build(m); return { ...s, viewing: { ...s.viewing, load: () => { throw new Error("gone"); } } }; } },
    { name: "durable.load() throws", expect: /durable: load\(\) threw, and it must never/,
        make: m => { const s = build(m); return { ...s, durable: { ...s.durable!, load: () => { throw new Error("gone"); } } }; } },
    { name: "viewing.load() answers undefined when nothing is stored", expect: /viewing: load\(\) of a store with nothing set returned undefined, not an object/,
        make: m => { const s = build(m); return { ...s, viewing: { ...s.viewing, load: () => (Object.keys(m.element).length ? m.element : undefined as any) } }; } },
    { name: "viewing.load() answers null when emptied", expect: /viewing: load\(\) after save\(\{\}\) returned null, not an object/,
        make: m => { const s = build(m); return { ...s, viewing: { ...s.viewing, load: () => (Object.keys(m.element).length ? m.element : null as any) } }; } },
    { name: "viewing.save() merges into what was there", expect: /viewing: a second save\(\) did not replace the first/,
        make: m => { const s = build(m); return { ...s, viewing: { ...s.viewing, save: n => { Object.assign(m.element, n); } } }; } },
    { name: "viewing.save({}) does not empty the store", expect: /viewing: save\(\{\}\) did not empty the store/,
        make: m => { const s = build(m); return { ...s, viewing: { ...s.viewing, save: n => { if (Object.keys(n as object).length) { for (const k of Object.keys(m.element)) delete m.element[k]; Object.assign(m.element, n); } } } }; } },
    { name: "viewing.save() stores nothing", expect: /viewing: load\(\) after save\(\) returned \{\}/,
        make: m => { const s = build(m); return { ...s, viewing: { ...s.viewing, save: () => {} } }; } },
    { name: "viewing.save() flattens a nested value to text", expect: /viewing: load\(\) after save\(\) returned/,
        make: m => { const s = build(m); return { ...s, viewing: { ...s.viewing, save: n => { for (const k of Object.keys(m.element)) delete m.element[k]; for (const [k, v] of Object.entries(n as object)) m.element[k] = typeof v === "object" ? String(v) : v; } } }; } },
    { name: "viewing.save() drops arrays", expect: /viewing: load\(\) after save\(\) returned/,
        make: m => { const s = build(m); return { ...s, viewing: { ...s.viewing, save: n => { for (const k of Object.keys(m.element)) delete m.element[k]; Object.assign(m.element, JSON.parse(JSON.stringify(n, (_k, v) => (Array.isArray(v) ? undefined : v)))); } } }; } },
    { name: "the viewing store lives in the service, not the element", expect: /viewing: load\(\) on a service re-created over the same element returned \{\}/,
        make: m => { let own: Record<string, unknown> = {}; const s = build(m); return { ...s, viewing: { load: () => own, save: n => { own = { ...(n as object) }; } } }; },
        options: m => ({ recreate: () => { let own2: Record<string, unknown> = {}; const t = build(m); return { ...t, viewing: { load: () => own2, save: n => { own2 = { ...(n as object) }; } } }; } }) },
    { name: "recreate() hands back a service with no viewing store", expect: /recreate\(\) did not return a service with a viewing store/,
        make: m => build(m), options: m => ({ recreate: () => ({ policy: {} } as unknown as ViewStateService), reopen: reopenFresh(m) }) },
    { name: "durable.save() keeps the first write", expect: /durable: a second save\(\) did not replace the first/,
        make: m => { const s = build(m); return { ...s, durable: { ...s.durable!, save: n => { if (m.file.saved === "{}") m.file.saved = JSON.stringify(n); } } }; } },
    { name: "durable.save() throws", expect: /durable: threw during an ordinary load\(\) or save\(\): Error: quota/,
        make: m => { const s = build(m); return { ...s, durable: { ...s.durable!, save: () => { throw new Error("quota"); } } }; } },
    { name: "durable.save() lands later and no settle is given", expect: /durable: load\(\) after save\(\) returned/,
        make: m => { const s = build(m); return { ...s, durable: { ...s.durable!, save: n => { const json = JSON.stringify(n); setTimeout(() => { m.file.saved = json; }, 50); } } }; } },
    { name: "a reopened service reads a different file", expect: /durable: load\(\) on a service reopened over the same saved file returned \{\}/,
        make: m => build(m), options: m => ({ recreate: recreateSame(m), reopen: () => build({ element: {}, file: { saved: "{}" } }) }) },
    { name: "the viewing store outlives a reopen", expect: /viewing: load\(\) after a reopen \(a viewing starts clean\) returned/,
        make: m => build(m), options: m => ({ recreate: recreateSame(m), reopen: () => build({ element: m.element, file: m.file }) }) },
    { name: "reopen() hands back a service with no durable store", expect: /reopen\(\) did not return a service with a durable store/,
        make: m => build(m), options: m => ({ recreate: recreateSame(m), reopen: () => build({ element: {}, file: m.file }, { durable: null }) }) },
    { name: "no viewing store", expect: /viewing is missing, or has no load\(\) or save\(\)/,
        make: m => ({ ...build(m), viewing: undefined as any }) },
    { name: "a viewing store without save()", expect: /viewing is missing, or has no load\(\) or save\(\)/,
        make: m => ({ ...build(m), viewing: { load: () => ({}) } as any }) },
    { name: "a durable store without load()", expect: /durable has no load\(\) or save\(\)/,
        make: m => ({ ...build(m), durable: { save: () => {} } as any }) },
    { name: "no policy", expect: /policy is missing/,
        make: m => ({ ...build(m), policy: undefined as any }) },
    { name: "a lifetime that is neither viewing nor durable", expect: /policy\.camera\.lifetime is "forever"/,
        make: m => build(m, { policy: { camera: { lifetime: "forever" as any, dropOnNewVersion: true, dropOnFreshViewing: false } } }) },
    { name: "a drop flag that is not a boolean", expect: /policy\.camera\.dropOnNewVersion is not a boolean/,
        make: m => build(m, { policy: { camera: { lifetime: "durable", dropOnNewVersion: "yes" as any, dropOnFreshViewing: false } } }) },
    { name: "the other drop flag missing", expect: /policy\.stop\.dropOnFreshViewing is not a boolean/,
        make: m => build(m, { policy: { stop: { lifetime: "durable", dropOnNewVersion: false } as any } }) },
    { name: "a durableWhen that is not a name", expect: /policy\.camera\.durableWhen is not a preference name/,
        make: m => build(m, { policy: { camera: { lifetime: "durable", dropOnNewVersion: true, dropOnFreshViewing: false, durableWhen: 5 as any } } }) },
    { name: "a durableWhen on a key that never reaches the durable store", expect: /policy\.camera has a durableWhen but a "viewing" lifetime/,
        make: m => build(m, { policy: { camera: { lifetime: "viewing", dropOnNewVersion: true, dropOnFreshViewing: false, durableWhen: "rememberView" } } }) },
    { name: "a policy entry that is not an object", expect: /policy\.camera is not an object/,
        make: m => build(m, { policy: { camera: true as any } }) },
    { name: "a malformed chartKeys", expect: /chartKeys\.lifetime is "sometimes"/,
        make: m => build(m, { chartKeys: { lifetime: "sometimes" as any, dropOnNewVersion: false, dropOnFreshViewing: false } }) },
    { name: "an empty versionKey", expect: /versionKey is not a key name/,
        make: m => build(m, { versionKey: "" }) },
    { name: "a durableMaxChars of zero", expect: /durableMaxChars is not a positive whole number/,
        make: m => build(m, { durableMaxChars: 0 }) },
    { name: "a durableMaxChars with a fraction", expect: /durableMaxChars is not a positive whole number/,
        make: m => build(m, { durableMaxChars: 10.5 }) },
];

describe("assertViewStateConformance: a broken service for every property it checks", () => {
    for (const mutant of MUTANTS) {
        it(`catches: ${mutant.name}`, async () => {
            const medium: Medium = { element: {}, file: { saved: "{}" } };
            const service = mutant.make(medium);
            const options = mutant.options ? mutant.options(medium) : opts(medium);
            const err = await assertViewStateConformance(service, options).then(() => null, e => e as ConformanceError);
            expect(err, "the broken service passed").toBeInstanceOf(ConformanceError);
            expect(err!.contract).toBe("ViewStateService");
            expect(err!.failures.join("\n")).toMatch(mutant.expect);
        });
    }

    it("lists every broken property in one error, not just the first", async () => {
        const medium: Medium = { element: {}, file: { saved: "{}" } };
        const s = build(medium, { versionKey: "", durableMaxChars: 0, policy: { camera: { lifetime: "forever" as any, dropOnNewVersion: 1 as any, dropOnFreshViewing: false } } });
        const err = await assertViewStateConformance(s).catch(e => e as ConformanceError);
        expect(err.failures.length).toBeGreaterThanOrEqual(4);
    });

    it("rejects a missing service outright", async () => {
        for (const bad of [null, undefined, "service" as any]) {
            const err = await assertViewStateConformance(bad as any).catch(e => e as ConformanceError);
            expect(err.failures).toEqual(["the service is missing"]);
        }
    });
});
