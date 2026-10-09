import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveViewState, commitViewState, viewStateAfterSwap, CHART_OWNED_KEY_POLICY, type ViewStatePreferences } from "../src/viewState";
import type { ViewStateKeyPolicy, ViewStateService } from "../src/host/services";
import type { ViewStateProvider } from "../src/contract";

// THE VIEW-STATE RULES: what a chart is handed, and what its writes reach.
//
// Three groups. The first enumerates the rules cell by cell (lifetime x version change x fresh
// viewing x a preference), against an oracle small enough to check by eye. The second encodes the
// rules a Power BI-style host runs today as a policy and reproduces the behaviors that host has
// shipped, each by the behavior itself (what the chart is handed, what reaches the file), so a host
// that moves onto these functions can run the same cases unedited. The third encodes a host that forgets
// the whole bag whenever its chart changes, which is what a workbook add-in does today.

// ---- test doubles ----

/** A store the way the real ones behave: `load` is the live object, `save` replaces it in place. */
function memoryStore(initial: Record<string, unknown> = {}): ViewStateProvider & { bag: Record<string, unknown>; saves: number } {
    const bag: Record<string, unknown> = { ...initial };
    const store = {
        bag, saves: 0,
        load: () => bag,
        save: (next: Record<string, unknown>) => {
            store.saves++;
            for (const k of Object.keys(bag)) delete bag[k];
            Object.assign(bag, next);
        },
    };
    return store;
}

const prefs = (values: Record<string, unknown>): ViewStatePreferences => ({ get: (k: string) => values[k] });

const KEEP: ViewStateKeyPolicy = { lifetime: "durable", dropOnNewVersion: false, dropOnFreshViewing: false };

function deepFreeze<T>(v: T): T {
    if (v && typeof v === "object" && !Object.isFrozen(v)) {
        Object.freeze(v);
        for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]);
    }
    return v;
}

// ---- 1. the rules, cell by cell ----

describe("resolveViewState: every combination of the two drop rules, a version change and a fresh viewing", () => {
    // The oracle: a key survives unless a rule that applies to it fires.
    const expectedPresent = (dropV: boolean, dropF: boolean, versionChanged: boolean, fresh: boolean) =>
        !(dropV && versionChanged) && !(dropF && fresh);

    for (const dropV of [false, true]) for (const dropF of [false, true])
        for (const versionChanged of [false, true]) for (const fresh of [false, true]) {
            const cell = `dropOnNewVersion=${dropV} dropOnFreshViewing=${dropF} versionChanged=${versionChanged} fresh=${fresh}`;
            it(`a viewing-store key: ${cell}`, () => {
                const service: ViewStateService = {
                    viewing: memoryStore({ k: "set", v: 12 }), policy: { k: { lifetime: "durable", dropOnNewVersion: dropV, dropOnFreshViewing: dropF } },
                    versionKey: "v",
                };
                const r = resolveViewState(service, { codeVersion: versionChanged ? 13 : 12, freshViewing: fresh });
                expect("k" in r.bag).toBe(expectedPresent(dropV, dropF, versionChanged, fresh));
                expect(r.bag.v).toBe(versionChanged ? 13 : 12);
                expect(r.source).toBe("viewing");
                // What was dropped is reported with the rule that dropped it.
                const rules = r.dropped.map(d => `${d.key}:${d.reason}`);
                expect(rules).toEqual([
                    ...(dropF && fresh ? ["k:fresh-viewing"] : []),
                    ...(dropV && versionChanged && !(dropF && fresh) ? ["k:new-version"] : []),
                ]);
            });
        }

    for (const lifetime of ["viewing", "durable"] as const) for (const versionChanged of [false, true]) {
        it(`a durable-store key, lifetime ${lifetime}, versionChanged=${versionChanged}: a viewing-lifetime key is never believed from the durable store`, () => {
            const service: ViewStateService = {
                viewing: memoryStore(), durable: memoryStore({ k: "saved", v: 12 }),
                policy: { k: { lifetime, dropOnNewVersion: true, dropOnFreshViewing: false } }, versionKey: "v",
            };
            const r = resolveViewState(service, { codeVersion: versionChanged ? 13 : 12 });
            expect(r.source).toBe("durable");
            expect("k" in r.bag).toBe(lifetime === "durable" && !versionChanged);
        });
    }

    it("a key the policy does not name follows chartKeys, and the chart's own rule is to keep it", () => {
        const stores = () => ({ viewing: memoryStore({ sort: "a", v: 12 }), versionKey: "v", policy: {} });
        const keep = resolveViewState(stores(), { codeVersion: 13, freshViewing: true });
        expect(keep.bag).toEqual({ sort: "a", v: 13 });
        expect(keep.dropped).toEqual([]);
        const forget = resolveViewState({ ...stores(), chartKeys: { ...KEEP, dropOnNewVersion: true } }, { codeVersion: 13 });
        expect(forget.bag).toEqual({ v: 13 });
        expect(forget.dropped).toEqual([{ key: "sort", reason: "new-version" }]);
        const stale = resolveViewState({ ...stores(), chartKeys: { ...KEEP, dropOnFreshViewing: true } }, { codeVersion: 12, freshViewing: true });
        expect(stale.bag).toEqual({ v: 12 });
        expect(CHART_OWNED_KEY_POLICY).toEqual(KEEP);
        expect(Object.isFrozen(CHART_OWNED_KEY_POLICY)).toBe(true);
    });

    it("the version stamp itself is never dropped by a rule, whatever chartKeys says", () => {
        const service: ViewStateService = {
            viewing: memoryStore({ sort: "a", v: 12 }), versionKey: "v", policy: {},
            chartKeys: { lifetime: "durable", dropOnNewVersion: true, dropOnFreshViewing: true },
        };
        expect(resolveViewState(service, { codeVersion: 13, freshViewing: true }).bag).toEqual({ v: 13 });
    });

    it("a stamp that already matches changes nothing, and a missing one counts as another chart's", () => {
        const policy = { cam: { lifetime: "durable", dropOnNewVersion: true, dropOnFreshViewing: false } as ViewStateKeyPolicy };
        const same = resolveViewState({ viewing: memoryStore({ cam: 1, v: 5 }), policy, versionKey: "v" }, { codeVersion: 5 });
        expect(same.bag).toEqual({ cam: 1, v: 5 });
        const unstamped = resolveViewState({ viewing: memoryStore({ cam: 1 }), policy, versionKey: "v" }, { codeVersion: 5 });
        expect(unstamped.bag).toEqual({ v: 5 });
        const nullVersion = resolveViewState({ viewing: memoryStore({ cam: 1, v: 3 }), policy, versionKey: "v" }, {});
        expect(nullVersion.bag).toEqual({ v: null });
    });

    it("with no freshViewing given, a bag read from the durable store is a fresh viewing and one read from the viewing store is not", () => {
        const stop: ViewStateKeyPolicy = { lifetime: "durable", dropOnNewVersion: false, dropOnFreshViewing: true };
        const fromDurable = resolveViewState({ viewing: memoryStore(), durable: memoryStore({ stop: true, a: 1 }), policy: { stop } });
        expect(fromDurable.bag).toEqual({ a: 1 });
        const fromViewing = resolveViewState({ viewing: memoryStore({ stop: true, a: 1 }), durable: memoryStore(), policy: { stop } });
        expect(fromViewing.bag).toEqual({ stop: true, a: 1 });
    });

    it("an unstamped bag read with no version is still another chart's: the key goes and the stamp is null, never absent", () => {
        const policy = { cam: { lifetime: "durable", dropOnNewVersion: true, dropOnFreshViewing: false } as ViewStateKeyPolicy };
        const withKey = resolveViewState({ viewing: memoryStore({ cam: 1, a: 1 }), policy, versionKey: "v" }, { codeVersion: null });
        expect(withKey.bag).toEqual({ a: 1, v: null });
        expect(Object.prototype.hasOwnProperty.call(withKey.bag, "v")).toBe(true);
        const empty = resolveViewState({ viewing: memoryStore(), policy, versionKey: "v" }, {});
        expect(empty.bag).toEqual({ v: null });
        expect(Object.prototype.hasOwnProperty.call(empty.bag, "v")).toBe(true);
    });

    it("a service with no versionKey runs no version rule at all: nothing is stamped or dropped", () => {
        const service: ViewStateService = {
            viewing: memoryStore({ cam: 1 }), policy: { cam: { lifetime: "durable", dropOnNewVersion: true, dropOnFreshViewing: false } },
        };
        const r = resolveViewState(service, { codeVersion: 99 });
        expect(r.bag).toEqual({ cam: 1 });
        expect(r.dropped).toEqual([]);
    });

    it("the bag is a deep copy, arrays included: mutating a nested array or object in it changes no store", () => {
        const viewing = memoryStore({ rows: [{ id: 1 }, [2, 3]], deep: { list: [{ k: "v" }] } });
        const r = resolveViewState({ viewing, policy: {} });
        (r.bag.rows as any)[0].id = 99;
        (r.bag.rows as any)[1].push(4);
        (r.bag.deep as any).list[0].k = "changed";
        (r.bag.deep as any).list.push("extra");
        expect(viewing.bag).toEqual({ rows: [{ id: 1 }, [2, 3]], deep: { list: [{ k: "v" }] } });
        const swapped = viewStateAfterSwap({ viewing, policy: {} }, viewing.bag);
        (swapped.rows as any)[1].push(5);
        expect(viewing.bag.rows).toEqual([{ id: 1 }, [2, 3]]);
    });

    it("a chart key named like something every object inherits is still just a chart key", () => {
        const inherited = ["constructor", "toString", "hasOwnProperty", "valueOf", "__proto__"];
        const saved = JSON.parse(`{${inherited.map(k => `"${k}": 1`).join(",")}, "v": 12}`);
        const service: ViewStateService = { viewing: memoryStore(), durable: memoryStore(saved), policy: {}, versionKey: "v" };
        const r = resolveViewState(service, { codeVersion: 13, freshViewing: true });
        expect(Object.keys(r.bag).sort()).toEqual([...inherited, "v"].sort());
        expect(r.dropped).toEqual([]);
        const w = commitViewState(saved, { viewing: memoryStore(), durable: memoryStore(), policy: {} }, prefs({}));
        expect(w.withheld).toEqual([]);
        // ...and when the host's rule for chart keys is to forget them, those names are forgotten like any other.
        const forgetting: ViewStateService = { viewing: memoryStore(), policy: {}, chartKeys: { ...KEEP, dropOnNewVersion: true } };
        expect(viewStateAfterSwap(forgetting, saved)).toEqual({});
    });

    it("an empty viewing store reads the durable one, and an empty one of those reads nothing", () => {
        const both = resolveViewState({ viewing: memoryStore(), durable: memoryStore({ a: 1 }), policy: {} });
        expect(both).toMatchObject({ bag: { a: 1 }, source: "durable" });
        const none = resolveViewState({ viewing: memoryStore(), durable: memoryStore(), policy: {} });
        expect(none).toEqual({ bag: {}, source: "none", dropped: [] });
        const noDurable = resolveViewState({ viewing: memoryStore(), policy: {} });
        expect(noDurable.source).toBe("none");
    });

    it("the viewing store wins over the durable one, whichever is newer on paper", () => {
        const r = resolveViewState({ viewing: memoryStore({ from: "viewing" }), durable: memoryStore({ from: "durable" }), policy: {} });
        expect(r).toMatchObject({ bag: { from: "viewing" }, source: "viewing" });
    });

    it("a viewing that has already written is the bag even when it reads empty: the durable store may only lag", () => {
        const service: ViewStateService = { viewing: memoryStore(), durable: memoryStore({ sort: "stale" }), policy: {} };
        expect(resolveViewState(service, { freshViewing: false })).toMatchObject({ bag: {}, source: "viewing" });
        expect(resolveViewState(service, { freshViewing: true })).toMatchObject({ bag: { sort: "stale" }, source: "durable" });
    });
});

describe("commitViewState: lifetime x a preference that gates the durable write", () => {
    // [lifetime, durableWhen?, preference source, reaches the viewing store, reaches the durable store]
    const BAG = { key: "kept", plain: 1 };
    type Row = [ViewStateKeyPolicy["lifetime"], string | undefined, ViewStatePreferences | null | undefined | "throws", boolean];
    const rows: Row[] = [
        ["durable", undefined, prefs({}), true],
        ["durable", undefined, null, true],
        ["durable", "share", prefs({ share: true }), true],
        ["durable", "share", prefs({ share: 1 }), true],
        ["durable", "share", prefs({ share: false }), false],
        ["durable", "share", prefs({ share: 0 }), false],
        ["durable", "share", prefs({}), false],
        ["durable", "share", null, false],
        ["durable", "share", undefined, false],
        ["durable", "share", "throws", false],
        ["viewing", undefined, prefs({}), false],
        ["viewing", undefined, null, false],
    ];
    for (const [lifetime, durableWhen, source, toDurable] of rows) {
        const label = `lifetime ${lifetime}, durableWhen ${durableWhen ?? "none"}, preference ${source === "throws" ? "source throws" : JSON.stringify(source && (source as ViewStatePreferences).get("share"))}`;
        it(`${label}: the viewing store always gets it, the durable store ${toDurable ? "gets it" : "does not"}`, () => {
            const viewing = memoryStore(), durable = memoryStore();
            const policy: ViewStateKeyPolicy = { lifetime, dropOnNewVersion: false, dropOnFreshViewing: false, ...(durableWhen ? { durableWhen } : {}) };
            const src = source === "throws" ? { get: () => { throw new Error("no settings yet"); } } : source;
            const r = commitViewState(BAG, { viewing, durable, policy: { key: policy } }, src);
            expect(r.outcome).toBe("saved");
            expect(viewing.bag).toEqual(BAG);
            expect(durable.bag).toEqual(toDurable ? BAG : { plain: 1 });
            // A key held back only because its lifetime says so is not "withheld": that is by design, not a preference.
            expect(r.withheld).toEqual(lifetime === "durable" && !toDurable ? ["key"] : []);
        });
    }

    it("reports the withheld keys in policy order, not in the order the chart wrote them", () => {
        const gated = (): ViewStateKeyPolicy => ({ lifetime: "durable", dropOnNewVersion: false, dropOnFreshViewing: false, durableWhen: "share" });
        const service: ViewStateService = { viewing: memoryStore(), durable: memoryStore(), policy: { camera: gated(), zoom: gated() } };
        const r = commitViewState({ zoom: 1, other: 2, camera: 3 }, service, prefs({ share: false }));
        expect(r.withheld).toEqual(["camera", "zoom"]);
        expect(service.durable!.load()).toEqual({ other: 2 });
    });

    it("gates a key chartKeys names the same way", () => {
        const service: ViewStateService = {
            viewing: memoryStore(), durable: memoryStore(), policy: {},
            chartKeys: { lifetime: "durable", dropOnNewVersion: false, dropOnFreshViewing: false, durableWhen: "share" },
        };
        expect(commitViewState({ a: 1 }, service, prefs({ share: false })).withheld).toEqual(["a"]);
        expect(service.durable!.load()).toEqual({});
    });

    it("hands the durable store the same object when nothing needed removing", () => {
        const durable = memoryStore();
        const seen: unknown[] = [];
        const service: ViewStateService = { viewing: memoryStore(), durable: { load: durable.load, save: n => { seen.push(n); durable.save(n); } }, policy: {} };
        const bag = { a: 1 };
        commitViewState(bag, service);
        expect(seen[0]).toBe(bag);
    });

    it("writes the viewing store first, and a durable store that skips its write cannot cost the session it", () => {
        const order: string[] = [];
        const viewing = memoryStore();
        const service: ViewStateService = {
            viewing: { load: viewing.load, save: n => { order.push("viewing"); viewing.save(n); } },
            durable: { load: () => ({}), save: () => { order.push("durable"); /* unchanged payload: nothing to do */ } },
            policy: {},
        };
        commitViewState({ a: 1 }, service);
        expect(order).toEqual(["viewing", "durable"]);
        expect(viewing.bag).toEqual({ a: 1 });
    });

    it("a service with no durable store writes the viewing store alone, and reports it", () => {
        const viewing = memoryStore();
        const r = commitViewState({ a: 1 }, { viewing, durable: null, policy: { a: { ...KEEP, durableWhen: "x" } } }, prefs({}));
        expect(r).toMatchObject({ outcome: "saved", viewingSaved: true, durableSaved: false, withheld: [] });
        expect(viewing.bag).toEqual({ a: 1 });
    });

    it("a write that is not an object is ignored entirely: nothing saved, nothing measured", () => {
        for (const junk of [null, undefined, "text", 5, true]) {
            const viewing = memoryStore({ keep: 1 }), durable = memoryStore({ keep: 1 });
            const r = commitViewState(junk, { viewing, durable, policy: {} });
            expect(r).toMatchObject({ outcome: "ignored", viewingSaved: false, durableSaved: false });
            expect(viewing.saves + durable.saves).toBe(0);
        }
    });

    describe("the durable size limit", () => {
        const limited = (max: number) => {
            const viewing = memoryStore({ before: 1 }), durable = memoryStore({ before: 1 });
            return { viewing, durable, service: { viewing, durable, policy: { camera: { ...KEEP, durableWhen: "share" } }, durableMaxChars: max } as ViewStateService };
        };
        const sized = (n: number) => ({ s: "x".repeat(n - 8) });   // {"s":"..."} is 8 characters of frame

        it("a payload at the limit is saved and one character over is refused whole, in neither store", () => {
            const { viewing, durable, service } = limited(4000);
            const at = commitViewState(sized(4000), service);
            expect(at).toMatchObject({ outcome: "saved", durableChars: 4000 });
            const over = commitViewState(sized(4001), service);
            expect(over).toMatchObject({ outcome: "too-large", durableChars: 4001, viewingSaved: false, durableSaved: false });
            // The next read sees the state before the refused write.
            expect(JSON.stringify(viewing.bag).length).toBe(4000);
            expect(JSON.stringify(durable.bag).length).toBe(4000);
        });

        it("the limit is measured on the payload that would reach the durable store, withheld keys excluded", () => {
            const { viewing, durable, service } = limited(100);
            const big = { camera: { eye: "x".repeat(500) }, a: 1 };
            const r = commitViewState(big, service, prefs({ share: false }));
            expect(r).toMatchObject({ outcome: "saved", durableChars: 7, withheld: ["camera"] });
            expect(durable.bag).toEqual({ a: 1 });
            expect(viewing.bag).toEqual(big);
            expect(commitViewState(big, service, prefs({ share: true })).outcome).toBe("too-large");
        });

        it("is not measured without a limit or without a durable store", () => {
            const viewing = memoryStore();
            expect(commitViewState({ a: 1 }, { viewing, durable: memoryStore(), policy: {} }).durableChars).toBeNull();
            expect(commitViewState({ a: "x".repeat(9000) }, { viewing, durable: null, policy: {}, durableMaxChars: 10 }).outcome).toBe("saved");
        });

        it("a payload that cannot be serialized is refused and reported, not thrown", () => {
            const { viewing, service } = limited(100);
            const cyclic: Record<string, unknown> = {};
            cyclic.self = cyclic;
            const r = commitViewState(cyclic, service);
            expect(r.outcome).toBe("ignored");
            expect(r.errors).toHaveLength(1);
            expect(viewing.saves).toBe(0);
        });
    });

    it("a store that throws is reported, the other store is still written, and nothing throws out", () => {
        const viewing = memoryStore();
        const boom = new Error("host gone");
        const r = commitViewState({ a: 1 }, { viewing, durable: { load: () => ({}), save: () => { throw boom; } }, policy: {} });
        expect(r).toMatchObject({ outcome: "saved", viewingSaved: true, durableSaved: false, errors: [{ store: "durable", error: boom }] });
        expect(viewing.bag).toEqual({ a: 1 });
        const r2 = commitViewState({ a: 2 }, { viewing: { load: () => ({}), save: () => { throw boom; } }, durable: memoryStore(), policy: {} });
        expect(r2).toMatchObject({ viewingSaved: false, durableSaved: true, errors: [{ store: "viewing", error: boom }] });
    });
});

// ---- 2. a Power BI-style host, as a policy ----

/**
 * The rules a report-file host runs today, as a service: a camera that is aimed at one chart version and
 * travels in the file only when the reader has asked for their view to be remembered, a diagram's zoom
 * that does the same, and a manual stop that belongs to the viewing that made it. Everything else a
 * chart writes is its own. The viewing store is a text cache written by every chart write and absent until
 * the first; the durable store prefers the file's saved text over the in-session settings value.
 */
function reportHost(init: { codeVersion?: number | null; saved?: string | null; settings?: string; remember?: boolean } = {}) {
    const st = {
        live: null as string | null, saved: init.saved ?? null, settings: init.settings ?? "",
        remember: init.remember ?? true, codeVersion: init.codeVersion === undefined ? 12 : init.codeVersion,
        persisted: [] as string[], persistThrows: false,
    };
    const parse = (raw: unknown): any => { try { return typeof raw === "string" && raw ? (JSON.parse(raw) || null) : null; } catch { return null; } };
    const share = (): ViewStateKeyPolicy => ({ lifetime: "durable", dropOnNewVersion: false, dropOnFreshViewing: false, durableWhen: "rememberView" });
    const service: ViewStateService = {
        viewing: { load: () => parse(st.live) ?? {}, save: n => { st.live = JSON.stringify(n); } },
        durable: {
            load: () => parse(st.saved) || parse(st.settings) || {},
            save: n => {
                const json = JSON.stringify(n);
                if (json === st.settings) return;          // unchanged payload: nothing to write
                st.settings = json;
                if (st.persistThrows) throw new Error("host gone");
                st.persisted.push(json);
            },
        },
        policy: {
            camera: { ...share(), dropOnNewVersion: true },
            llmZoom: share(),
            userStopped: { lifetime: "durable", dropOnNewVersion: false, dropOnFreshViewing: true },
        },
        versionKey: "cameraVersion",
        durableMaxChars: 4000,
    };
    const seen: any[] = [];
    const logs: Array<{ tag: string; data: unknown }> = [];
    const host = {
        st, service, seen, logs,
        render: () => {
            const r = resolveViewState(service, { codeVersion: st.codeVersion, freshViewing: st.live === null });
            seen.push(r.bag);
            return r;
        },
        write: (next: unknown) => commitViewState(next, service, prefs({ rememberView: st.remember })),
        last: () => seen[seen.length - 1],
        /** A page switch or a reopen: a new viewing over the file this one left behind. */
        reopen: (over: { codeVersion?: number | null; remember?: boolean } = {}) =>
            reportHost({ codeVersion: over.codeVersion === undefined ? st.codeVersion : over.codeVersion, saved: st.persisted.length ? st.persisted[st.persisted.length - 1] : st.saved, remember: over.remember ?? st.remember }),
    };
    return host;
}

const POSE = { yaw: 40, pitch: 10, dolly: 2 };

describe("a report-file host's rules, as a policy: the read side", () => {
    it("a fresh viewing with nothing saved is handed a bag holding only the version stamp", () => {
        expect(reportHost().render().bag).toEqual({ cameraVersion: 12 });
    });

    it("the viewing cache beats the file, even when the file's text turns up newer-looking", () => {
        const h = reportHost({ saved: JSON.stringify({ from: "file" }) });
        h.render();
        h.write({ from: "session" });
        h.st.saved = JSON.stringify({ from: "stale file" });
        h.st.settings = JSON.stringify({ from: "stale settings" });
        expect(h.render().bag).toEqual({ from: "session", cameraVersion: 12 });
    });

    it("a re-render before the file echoes a write sees the write, not the frame it replaced", () => {
        const h = reportHost({ saved: JSON.stringify({ frame: 2021 }) });
        h.render();
        h.write({ frame: 2022 });
        expect(h.render().bag.frame).toBe(2022);
    });

    it("a viewing that wrote an empty bag is not handed the older state the file still holds", () => {
        const h = reportHost({ saved: JSON.stringify({ sort: "old" }) });
        h.render();
        h.write({});
        expect(h.render().bag).toEqual({ cameraVersion: 12 });
    });

    it("a page switch starts without the cache and reads the file", () => {
        const h = reportHost();
        h.render();
        h.write({ sort: { key: "Region" } });
        const reopened = h.reopen();
        expect(reopened.render().bag).toEqual({ sort: { key: "Region" }, cameraVersion: 12 });
    });

    it("each render reads the cache afresh: a later write replaces the earlier one", () => {
        const h = reportHost();
        h.render();
        h.write({ n: 1 });
        h.write({ n: 2 });
        expect(h.render().bag.n).toBe(2);
    });

    it("the bag is a copy: a chart that mutates what it was handed does not change the next render's", () => {
        const h = reportHost({ saved: JSON.stringify({ sort: { key: "a" } }) });
        const first = h.render().bag;
        first.sort.key = "mutated";
        first.extra = true;
        expect(h.render().bag).toEqual({ sort: { key: "a" }, cameraVersion: 12 });
        h.write({ sort: { key: "b" } });
        const viaCache = h.render().bag;
        viaCache.sort.key = "mutated";
        expect(h.render().bag.sort.key).toBe("b");
    });

    it("pinned as observed: a saved value that is not an object is handed over as it was saved", () => {
        expect(reportHost({ saved: "5" }).render().bag).toBe(5);
        const arr = reportHost({ saved: "[1,2]" }).render().bag;
        expect(Array.isArray(arr)).toBe(true);
        expect(arr).toHaveLength(2);
    });

    it("a bad blob in the file is an empty bag with the stamp, never a throw", () => {
        expect(reportHost({ saved: "{x", settings: "{y" }).render().bag).toEqual({ cameraVersion: 12 });
    });
});

describe("a report-file host's rules: the manual stop belongs to the viewing that made it", () => {
    const SAVED = JSON.stringify({ frame: 7, selIdx: 7, sort: { col: 1 }, userStopped: true });

    it("a read from the file drops the stop, keeps everything else, and says what it dropped", () => {
        const r = reportHost({ saved: SAVED }).render();
        expect(r.bag).toEqual({ frame: 7, selIdx: 7, sort: { col: 1 }, cameraVersion: 12 });
        expect(r.dropped).toEqual([{ key: "userStopped", reason: "fresh-viewing" }]);
    });

    it("a falsy stop is left alone and nothing is reported", () => {
        const r = reportHost({ saved: JSON.stringify({ userStopped: false, frame: 1 }) }).render();
        expect(r.bag).toEqual({ userStopped: false, frame: 1, cameraVersion: 12 });
        expect(r.dropped).toEqual([]);
    });

    it("a load render that is aborted and retried drops it on BOTH passes (the cache has not been written)", () => {
        const h = reportHost({ saved: SAVED });
        h.render();
        h.render();
        expect(h.seen.map(s => "userStopped" in s)).toEqual([false, false]);
    });

    it("a real stop made in this viewing survives the re-renders its own write triggers", () => {
        const h = reportHost({ saved: SAVED });
        h.render();
        h.write({ ...h.last(), userStopped: true });
        h.render();
        h.render();
        expect(h.seen.slice(1).map(s => s.userStopped)).toEqual([true, true]);
    });

    it("the stop still rides the file, so the strip is the read side's job", () => {
        const h = reportHost();
        h.render();
        h.write({ frame: 3, userStopped: true });
        expect(JSON.parse(h.st.persisted[0])).toEqual({ frame: 3, userStopped: true });
    });

    it("a page switch is a fresh viewing: the stop the last one saved is dropped", () => {
        const h = reportHost();
        h.render();
        h.write({ frame: 3, userStopped: true });
        expect(h.reopen().render().bag).toEqual({ frame: 3, cameraVersion: 12 });
    });
});

describe("a report-file host's rules: a camera belongs to the chart version it was aimed at", () => {
    const saved = (version: number | null) => JSON.stringify({ camera: POSE, cameraVersion: version, sort: { key: "Region" } });

    it("a pose saved against another version is dropped, the stamp moves to this one, siblings stay", () => {
        const r = reportHost({ codeVersion: 12, saved: saved(11) }).render();
        expect(r.bag).toEqual({ sort: { key: "Region" }, cameraVersion: 12 });
        expect(r.dropped).toEqual([{ key: "camera", reason: "new-version" }]);
    });

    it("the same version keeps the pose, and reports nothing", () => {
        const r = reportHost({ codeVersion: 12, saved: saved(12) }).render();
        expect(r.bag.camera).toEqual(POSE);
        expect(r.dropped).toEqual([]);
    });

    it("a reopened report keeps the pose its author chose to save", () => {
        const h = reportHost();
        h.render();
        h.write({ ...h.last(), camera: POSE });
        expect(h.reopen().render().bag.camera).toEqual(POSE);
    });

    it("a regeneration (a new version over the same file) drops the pose the old chart was left at", () => {
        const h = reportHost();
        h.render();
        h.write({ ...h.last(), camera: POSE });
        const regenerated = h.reopen({ codeVersion: 13 }).render();
        expect("camera" in regenerated.bag).toBe(false);
        expect(regenerated.bag.cameraVersion).toBe(13);
    });

    it("THE STAMP IS WRITTEN BACK by the chart: a pose set after a drop survives the next render when the chart carries the bag forward", () => {
        const h = reportHost({ codeVersion: 12, saved: saved(11) });
        h.render();
        h.write({ ...h.last(), camera: { yaw: 1, pitch: 2, dolly: 1 } });
        expect(JSON.parse(h.st.persisted[0]).cameraVersion).toBe(12);
        expect(h.render().bag.camera).toEqual({ yaw: 1, pitch: 2, dolly: 1 });
    });

    it("pinned as observed: a chart that writes a pose WITHOUT the stamp loses it on the next render", () => {
        const h = reportHost();
        h.render();
        h.write({ camera: POSE });
        const r = h.render();
        expect("camera" in r.bag).toBe(false);
        expect(r.bag.cameraVersion).toBe(12);
    });

    it("pinned as observed: a pose saved before the stamp existed is dropped on its first read", () => {
        expect(reportHost({ saved: JSON.stringify({ camera: POSE }) }).render().bag).toEqual({ cameraVersion: 12 });
    });

    it("no version yet is still a change: the pose goes and the stamp is null", () => {
        expect(reportHost({ codeVersion: null, saved: saved(3) }).render().bag).toEqual({ sort: { key: "Region" }, cameraVersion: null });
    });

    it("the version rule and the stop rule are independent: a regeneration leaves a cached stop alone", () => {
        const h = reportHost();
        h.render();
        h.write({ ...h.last(), userStopped: true, camera: POSE });
        h.st.codeVersion = 13;
        const r = h.render();
        expect(r.bag.userStopped).toBe(true);
        expect("camera" in r.bag).toBe(false);
    });

    it("pinned as observed: a render that throws is retried with {} even for a chart that saved nothing, because the stamp makes the bag non-empty", () => {
        // The retry's guard is "the bag has keys". An empty store still resolves to a bag with the stamp.
        expect(Object.keys(reportHost().render().bag).length).toBeGreaterThan(0);
        // A host with no versionKey has no stamp, so the same empty store resolves to an empty bag.
        expect(Object.keys(resolveViewState({ viewing: memoryStore(), policy: {} }).bag)).toEqual([]);
    });

    it("the default: keys the chart wrote survive a new version and a fresh viewing, and the chart validates them", () => {
        const h = reportHost();
        h.render();
        h.write({ ...h.last(), sort: { key: "Region" }, expanded: [1, 2], knob: 0.4, camera: POSE });
        const regenerated = h.reopen({ codeVersion: 13 }).render();
        expect(regenerated.bag).toEqual({ sort: { key: "Region" }, expanded: [1, 2], knob: 0.4, cameraVersion: 13 });
    });
});

describe("a report-file host's rules: the write side", () => {
    it("a write persists its JSON once, in the chart's own key order", () => {
        const h = reportHost();
        h.render();
        h.write({ b: 1, a: { z: 1, y: 2 } });
        expect(h.st.persisted).toEqual(['{"b":1,"a":{"z":1,"y":2}}']);
    });

    it("the same payload twice persists once, and a payload equal to the settings value persists nothing", () => {
        const h = reportHost({ settings: '{"a":1}' });
        h.render();
        h.write({ a: 1 });
        expect(h.st.persisted).toEqual([]);
        h.write({ a: 2 });
        h.write({ a: 2 });
        expect(h.st.persisted).toHaveLength(1);
        // The cache holds the write either way.
        expect(h.render().bag.a).toBe(2);
    });

    it("OFF: the camera and a diagram's zoom stay out of the file, every other key rides it, and the keys held back are named", () => {
        const h = reportHost({ remember: false });
        h.render();
        const r = h.write({ sort: { key: "Region" }, camera: POSE, llmZoom: { v: 1, k: 0.5 }, frame: 3 });
        expect(JSON.parse(h.st.persisted[0])).toEqual({ sort: { key: "Region" }, frame: 3 });
        expect(r.withheld).toEqual(["camera", "llmZoom"]);
    });

    it("ON: the camera and the diagram's zoom travel in the file", () => {
        const h = reportHost({ remember: true });
        h.render();
        const r = h.write({ sort: { key: "Region" }, camera: POSE, llmZoom: { v: 1, k: 0.5 } });
        expect(JSON.parse(h.st.persisted[0])).toEqual({ sort: { key: "Region" }, camera: POSE, llmZoom: { v: 1, k: 0.5 } });
        expect(r.withheld).toEqual([]);
    });

    it("OFF: the session keeps the whole bag while the pane is open, even across several re-renders", () => {
        const h = reportHost({ remember: false });
        h.render();
        h.write({ a: 1, camera: POSE, llmZoom: { v: 1, k: 2 }, cameraVersion: 12 });
        h.render();
        h.render();
        expect(h.seen.slice(1)).toEqual([
            { a: 1, camera: POSE, llmZoom: { v: 1, k: 2 }, cameraVersion: 12 },
            { a: 1, camera: POSE, llmZoom: { v: 1, k: 2 }, cameraVersion: 12 },
        ]);
    });

    it("OFF: a page switch comes back without the camera, because the file never had it", () => {
        const h = reportHost({ remember: false });
        h.render();
        h.write({ a: 1, camera: POSE, cameraVersion: 12 });
        expect(h.reopen().render().bag).toEqual({ a: 1, cameraVersion: 12 });
    });

    it("ON: a page switch brings the camera back, at the same version", () => {
        const h = reportHost({ remember: true });
        h.render();
        h.write({ a: 1, camera: POSE, cameraVersion: 12 });
        expect(h.reopen().render().bag).toEqual({ a: 1, camera: POSE, cameraVersion: 12 });
    });

    it("the toggle is read when the chart writes, not when the render started", () => {
        const h = reportHost({ remember: true });
        h.render();
        h.st.remember = false;
        h.write({ camera: POSE, a: 1 });
        expect(JSON.parse(h.st.persisted[0])).toEqual({ a: 1 });
    });

    it("THE ORDER: with the toggle off a camera-only change leaves the file payload unchanged, persists nothing more, and the session still holds the new pose", () => {
        const h = reportHost({ remember: false });
        h.render();
        h.write({ sort: { key: "Region" }, cameraVersion: 12 });
        h.write({ sort: { key: "Region" }, cameraVersion: 12, camera: POSE });
        expect(h.st.persisted).toHaveLength(1);
        expect(h.render().bag.camera).toEqual(POSE);
    });

    it("pinned as observed: with the toggle off a first write that is only a camera and its stamp still persists the stamp", () => {
        const h = reportHost({ remember: false });
        h.render();
        h.write({ camera: POSE, cameraVersion: 12 });
        expect(h.st.persisted).toEqual(['{"cameraVersion":12}']);
        expect(h.render().bag.camera).toEqual(POSE);
    });

    it("OFF: a big camera that is stripped keeps the file payload under the cap, and the session still gets it whole", () => {
        const big = { eye: "x".repeat(4500) };
        const h = reportHost({ remember: false });
        h.render();
        h.write({ a: 1, cameraVersion: 12, camera: big });
        expect(h.st.persisted).toEqual(['{"a":1,"cameraVersion":12}']);
        expect(h.render().bag.camera).toEqual(big);
    });

    it("an oversized write is dropped whole and not cached: the next render sees the state before it", () => {
        const h = reportHost();
        h.render();
        h.write({ small: 1 });
        const r = h.write({ s: "x".repeat(5000) });
        expect(r.outcome).toBe("too-large");
        expect(h.render().bag).toEqual({ small: 1, cameraVersion: 12 });
    });

    it("a write that is not an object is ignored entirely", () => {
        const h = reportHost();
        h.render();
        h.write({ keep: 1 });
        for (const junk of [null, undefined, "text", 5, true]) h.write(junk);
        expect(h.st.persisted).toHaveLength(1);
        expect(h.render().bag).toEqual({ keep: 1, cameraVersion: 12 });
    });

    it("pinned as observed: a host that throws while persisting leaves the write cached, and the chart is not told", () => {
        const h = reportHost();
        h.render();
        h.st.persistThrows = true;
        const r = h.write({ n: 9 });
        expect(r.errors).toHaveLength(1);
        expect(r.viewingSaved).toBe(true);
        expect(h.render().bag.n).toBe(9);
    });
});

// ---- 3. a workbook add-in's rule: forget the whole bag when the chart changes ----

describe("a host that forgets everything when its chart changes", () => {
    const forgetAll = (): ViewStateService => ({
        viewing: memoryStore(), durable: memoryStore(), policy: {},
        chartKeys: { lifetime: "durable", dropOnNewVersion: true, dropOnFreshViewing: false },
    });

    it("viewStateAfterSwap leaves nothing of the old chart's bag, whatever it held", () => {
        const bag = { sort: { key: "Region" }, camera: POSE, cameraVersion: 12, userStopped: true, frame: 3 };
        expect(viewStateAfterSwap(forgetAll(), bag)).toEqual({});
        expect(viewStateAfterSwap(forgetAll(), undefined)).toEqual({});
        expect(viewStateAfterSwap(forgetAll(), 5)).toEqual({});
    });

    it("without a versionKey it reads the stored bag as it is: no stamp is added and nothing is dropped on read", () => {
        const service = forgetAll();
        service.durable!.save({ sort: "a", camera: POSE });
        const r = resolveViewState(service, { codeVersion: 99 });
        expect(r.bag).toEqual({ sort: "a", camera: POSE });
        expect(r.dropped).toEqual([]);
    });

    it("the host that sees the swap saves what comes back, and the chart that replaced it is handed an empty bag", () => {
        const service = forgetAll();
        commitViewState({ sort: "a", frame: 3 }, service);
        const forgotten = viewStateAfterSwap(service, service.durable!.load());
        service.viewing.save(forgotten);
        service.durable!.save(forgotten);
        expect(resolveViewState(service, { freshViewing: false })).toMatchObject({ bag: {}, source: "viewing" });
        expect(service.durable!.load()).toEqual({});
    });

    it("pinned as observed: a write from the old chart's writer that lands after the swap is taken as the new chart's bag", () => {
        const service = forgetAll();
        service.viewing.save(viewStateAfterSwap(service, { sort: "old" }));
        commitViewState({ sort: "old" }, service);   // the writer carries no chart identity
        expect(resolveViewState(service).bag).toEqual({ sort: "old" });
    });

    it("with a versionKey the same rule is applied on read instead, and the swap drops every key the chart wrote", () => {
        const service: ViewStateService = { ...forgetAll(), versionKey: "v" };
        service.viewing.save({ sort: "a", v: 12 });
        expect(resolveViewState(service, { codeVersion: 12 }).bag).toEqual({ sort: "a", v: 12 });
        expect(resolveViewState(service, { codeVersion: 13 }).bag).toEqual({ v: 13 });
    });

    it("a swap leaves the version stamp, even when every other key goes", () => {
        const service: ViewStateService = { ...forgetAll(), versionKey: "v" };
        expect(viewStateAfterSwap(service, { sort: "a", v: 12 })).toEqual({ v: 12 });
    });

    it("on a host that keeps the chart's keys, a swap drops only what the policy marks", () => {
        const service: ViewStateService = {
            viewing: memoryStore(), policy: { camera: { ...KEEP, dropOnNewVersion: true }, userStopped: { ...KEEP, dropOnFreshViewing: true } },
            versionKey: "cameraVersion",
        };
        const bag = { sort: "a", camera: POSE, cameraVersion: 12, userStopped: true };
        expect(viewStateAfterSwap(service, bag)).toEqual({ sort: "a", cameraVersion: 12, userStopped: true });
    });
});

// ---- 4. purity ----

describe("the rules are pure", () => {
    it("run over frozen inputs without changing them, and return copies nothing aliases", () => {
        const stored = deepFreeze({ sort: { key: "Region" }, camera: POSE, cameraVersion: 12, userStopped: true });
        const service = deepFreeze({
            viewing: { load: () => stored, save: () => {} }, durable: { load: () => stored, save: () => {} },
            policy: {
                camera: { lifetime: "durable", dropOnNewVersion: true, dropOnFreshViewing: false, durableWhen: "share" },
                userStopped: { lifetime: "durable", dropOnNewVersion: false, dropOnFreshViewing: true },
            },
            versionKey: "cameraVersion",
        }) as ViewStateService;
        const r = resolveViewState(service, { codeVersion: 13, freshViewing: true });
        expect(r.bag).toEqual({ sort: { key: "Region" }, cameraVersion: 13 });
        (r.bag.sort as any).key = "mutated";
        expect(stored.sort.key).toBe("Region");
        expect(viewStateAfterSwap(service, stored)).toEqual({ sort: { key: "Region" }, cameraVersion: 12, userStopped: true });
        const frozenNext = deepFreeze({ camera: POSE, sort: { key: "Region" } });
        expect(commitViewState(frozenNext, service, prefs({ share: false })).outcome).toBe("saved");
    });

    it("resolve never writes a store, and commit never reads one", () => {
        const calls: string[] = [];
        const tracked: ViewStateProvider = { load: () => { calls.push("load"); return { a: 1 }; }, save: () => { calls.push("save"); } };
        resolveViewState({ viewing: tracked, durable: tracked, policy: {} });
        resolveViewState({ viewing: { load: () => ({}), save: tracked.save }, durable: tracked, policy: {} }, { freshViewing: true });
        expect(calls.every(c => c === "load")).toBe(true);
        calls.length = 0;
        commitViewState({ a: 1 }, { viewing: tracked, durable: tracked, policy: {} });
        expect(calls).toEqual(["save", "save"]);
    });

    it("never throw, whatever the stores do", () => {
        const throws: ViewStateProvider = { load: () => { throw new Error("gone"); }, save: () => { throw new Error("gone"); } };
        const service: ViewStateService = { viewing: throws, durable: throws, policy: {} };
        expect(resolveViewState(service)).toEqual({ bag: {}, source: "none", dropped: [] });
        expect(() => commitViewState({ a: 1 }, service)).not.toThrow();
        const nulls: ViewStateProvider = { load: () => null as any, save: () => {} };
        expect(resolveViewState({ viewing: nulls, durable: nulls, policy: {} }).bag).toEqual({});
    });

    it("carry a saved key named __proto__ as data, never as a prototype", () => {
        const saved = JSON.parse('{"__proto__": {"polluted": true}, "a": 1}');
        const r = resolveViewState({ viewing: { load: () => saved, save: () => {} }, policy: {} });
        expect(Object.keys(r.bag).sort()).toEqual(["__proto__", "a"]);
        expect(({} as any).polluted).toBeUndefined();
        expect((r.bag as any).polluted).toBeUndefined();
    });

    it("the module reads no DOM, timer, clock, randomness or storage", () => {
        const src = readFileSync(resolve(__dirname, "../src/viewState.ts"), "utf8")
            .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
        for (const word of ["document", "window", "setTimeout", "setInterval", "Date", "Math.random", "localStorage", "sessionStorage", "globalThis", "process", "performance", "fetch"]) {
            expect(new RegExp(`\\b${word.replace(".", "\\.")}\\b`).test(src), word).toBe(false);
        }
    });
});
