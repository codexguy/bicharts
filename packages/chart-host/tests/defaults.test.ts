import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { resolveOptions } from "../src/defaults";
import { RenderOptions } from "../src/contract";

// BYTE-COMPARE lock: resolveOptions must reproduce EXACTLY the normalization that was
// inline in the visual's option assembly, so routing the visual through it is
// behavior-identical. The "oracle" below is the original inline expression for each
// normalized field; every case asserts resolveOptions == oracle. Host fields (width,
// palette, geo, closures, …) must pass through unchanged (identity).

// The original inline expressions, verbatim:
const oracle = (raw: any) => ({
    colorScaleLow: raw.colorScaleLow || undefined,
    colorScaleHigh: raw.colorScaleHigh || undefined,
    geoLandColor: raw.geoLandColor || undefined,
    geoNoDataColor: raw.geoNoDataColor || undefined,
    aggregation: raw.aggregation?.toString() || undefined,
    allowTooltips: raw.allowTooltips,                                  // already final in the visual
    animAutoPlay: !!raw.animAutoPlay,
    animPlaySpeedMs: Math.max(250, Math.min(5000, Number(raw.animPlaySpeedMs) || 1000)),
    animMaxIdealFrames: Math.max(3, Math.min(500, Number(raw.animMaxIdealFrames) || 60)),
    animStopAtEnd: !!raw.animStopAtEnd,
    filtersDuringPlay: !!raw.filtersDuringPlay,
    animTimelineStyle: (raw.animTimelineStyle || "").toString(),
});

function assertMatchesOracle(raw: any) {
    const got = resolveOptions(raw);
    const exp = oracle(raw);
    for (const k of Object.keys(exp) as (keyof typeof exp)[]) {
        expect(got[k as keyof RenderOptions], `field ${k} for ${JSON.stringify(raw)}`).toBe(exp[k]);
    }
}

describe("resolveOptions — normalized knobs match the original inline math", () => {
    it("representative values pass through their normalization", () => {
        assertMatchesOracle({
            animPlaySpeedMs: "2500", animMaxIdealFrames: "180", animTimelineStyle: "line",
            colorScaleLow: "#123456", colorScaleHigh: "#abcdef", aggregation: "average",
            animAutoPlay: true, animStopAtEnd: true, filtersDuringPlay: true, allowTooltips: true,
        });
    });

    it("play-speed: falsy/NaN -> 1000, below-min clamps to 250, above-max clamps to 5000", () => {
        expect(resolveOptions({ animPlaySpeedMs: 0 }).animPlaySpeedMs).toBe(1000);
        expect(resolveOptions({ animPlaySpeedMs: "" }).animPlaySpeedMs).toBe(1000);
        expect(resolveOptions({ animPlaySpeedMs: "notanumber" }).animPlaySpeedMs).toBe(1000);
        expect(resolveOptions({ animPlaySpeedMs: undefined }).animPlaySpeedMs).toBe(1000);
        expect(resolveOptions({ animPlaySpeedMs: 100 }).animPlaySpeedMs).toBe(250);
        expect(resolveOptions({ animPlaySpeedMs: 99999 }).animPlaySpeedMs).toBe(5000);
        expect(resolveOptions({ animPlaySpeedMs: 1500 }).animPlaySpeedMs).toBe(1500);
    });

    it("loop-restart delay: absent/junk -> 3, explicit 0 SURVIVES, floor 0, no upper clamp", () => {
        // Regression lock: this field was missing from the resolve list entirely, so a
        // caller passing it saw it dropped (undefined downstream -> treated as 0 ->
        // instant loop restarts). Absent defaults to 3...
        expect(resolveOptions({}).animLoopDelaySec).toBe(3);
        expect(resolveOptions({ animLoopDelaySec: undefined }).animLoopDelaySec).toBe(3);
        expect(resolveOptions({ animLoopDelaySec: null }).animLoopDelaySec).toBe(3);
        expect(resolveOptions({ animLoopDelaySec: "" }).animLoopDelaySec).toBe(3);
        expect(resolveOptions({ animLoopDelaySec: "junk" }).animLoopDelaySec).toBe(3);
        // ...but 0 means "restart immediately" and must NOT default away —
        // the one anim numeric where the `|| DEFAULT` idiom would be wrong.
        expect(resolveOptions({ animLoopDelaySec: 0 }).animLoopDelaySec).toBe(0);
        expect(resolveOptions({ animLoopDelaySec: "0" }).animLoopDelaySec).toBe(0);
        expect(resolveOptions({ animLoopDelaySec: 5 }).animLoopDelaySec).toBe(5);
        expect(resolveOptions({ animLoopDelaySec: "12" }).animLoopDelaySec).toBe(12);
        expect(resolveOptions({ animLoopDelaySec: -4 }).animLoopDelaySec).toBe(0);
        // Huge = "play once per viewing" is documented behavior, so no upper clamp.
        expect(resolveOptions({ animLoopDelaySec: 1000000 }).animLoopDelaySec).toBe(1000000);
    });

    it("max-ideal-frames: falsy -> 60, clamps to [3,500]", () => {
        expect(resolveOptions({ animMaxIdealFrames: 0 }).animMaxIdealFrames).toBe(60);
        expect(resolveOptions({ animMaxIdealFrames: "" }).animMaxIdealFrames).toBe(60);
        expect(resolveOptions({ animMaxIdealFrames: 1 }).animMaxIdealFrames).toBe(3);
        expect(resolveOptions({ animMaxIdealFrames: 9999 }).animMaxIdealFrames).toBe(500);
        expect(resolveOptions({ animMaxIdealFrames: 180 }).animMaxIdealFrames).toBe(180);
    });

    it("colour scale + aggregation: '' -> undefined, value preserved", () => {
        expect(resolveOptions({ colorScaleLow: "" }).colorScaleLow).toBeUndefined();
        expect(resolveOptions({ colorScaleLow: "#fff" }).colorScaleLow).toBe("#fff");
        expect(resolveOptions({ aggregation: "" }).aggregation).toBeUndefined();
        expect(resolveOptions({ aggregation: undefined }).aggregation).toBeUndefined();
        expect(resolveOptions({ aggregation: "sum" }).aggregation).toBe("sum");
    });

    it("timeline style: undefined -> '', value preserved", () => {
        expect(resolveOptions({}).animTimelineStyle).toBe("");
        expect(resolveOptions({ animTimelineStyle: "boxes" }).animTimelineStyle).toBe("boxes");
    });

    it("colour scale scope: only 'frame'/'self' opt in; everything else fails open to global ''", () => {
        expect(resolveOptions({}).colorScaleScope).toBe("");
        expect(resolveOptions({ colorScaleScope: "" }).colorScaleScope).toBe("");
        expect(resolveOptions({ colorScaleScope: "frame" }).colorScaleScope).toBe("frame");
        expect(resolveOptions({ colorScaleScope: "self" }).colorScaleScope).toBe("self");
        expect(resolveOptions({ colorScaleScope: "garbage" }).colorScaleScope).toBe("");
        expect(resolveOptions({ colorScaleScope: null }).colorScaleScope).toBe("");
    });

    it("map fills: '' -> undefined, value preserved, NO cascade here", () => {
        // The no-data -> land cascade deliberately lives in the chart, not resolveOptions,
        // so the fallback chain stays visible in generated code. resolveOptions must NOT
        // quietly fill geoNoDataColor in from geoLandColor.
        expect(resolveOptions({}).geoLandColor).toBeUndefined();
        expect(resolveOptions({}).geoNoDataColor).toBeUndefined();
        expect(resolveOptions({ geoLandColor: "" }).geoLandColor).toBeUndefined();
        expect(resolveOptions({ geoLandColor: "#ddd" }).geoLandColor).toBe("#ddd");
        expect(resolveOptions({ geoNoDataColor: "#f0a" }).geoNoDataColor).toBe("#f0a");
        expect(resolveOptions({ geoLandColor: "#ddd" }).geoNoDataColor).toBeUndefined();
    });

    it("colour scale self-clamp percentile: default 95, clamped 50-100", () => {
        expect(resolveOptions({}).colorScaleSelfClampPct).toBe(95);
        expect(resolveOptions({ colorScaleSelfClampPct: 80 }).colorScaleSelfClampPct).toBe(80);
        expect(resolveOptions({ colorScaleSelfClampPct: 10 }).colorScaleSelfClampPct).toBe(50);
        expect(resolveOptions({ colorScaleSelfClampPct: 500 }).colorScaleSelfClampPct).toBe(100);
        expect(resolveOptions({ colorScaleSelfClampPct: 0 }).colorScaleSelfClampPct).toBe(95);
        expect(resolveOptions({ colorScaleSelfClampPct: null }).colorScaleSelfClampPct).toBe(95);
    });

    it("booleans coerce with !!", () => {
        const r = resolveOptions({ animAutoPlay: 1 as any, animStopAtEnd: 0 as any, filtersDuringPlay: undefined });
        expect(r.animAutoPlay).toBe(true);
        expect(r.animStopAtEnd).toBe(false);
        expect(r.filtersDuringPlay).toBe(false);
    });

    it("matches the oracle across an edge matrix", () => {
        const speeds = [0, "", "250", 250, 5000, 99999, 1234, null, undefined];
        const frames = [0, "", 3, 500, 501, 60, "72", null];
        const aggs = ["", "sum", "average", undefined, null];
        for (const s of speeds) for (const f of frames) for (const a of aggs)
            assertMatchesOracle({ animPlaySpeedMs: s, animMaxIdealFrames: f, aggregation: a,
                colorScaleLow: a === "" ? "" : "#000", animTimelineStyle: s === 0 ? undefined : "line" });
    });
});

describe("resolveOptions — host fields pass through by identity", () => {
    it("width/height/palette/geo/uiState/setUiState/theme/etc. are returned unchanged", () => {
        const setUiState = () => {};
        const onSelect = () => {};
        const palette = ["#1", "#2"];
        const geo = { type: "FeatureCollection", features: [] };
        const geoUnmatched = { count: 2, examples: ["x"] };
        const uiState = { frame: 3 };
        const r = resolveOptions({
            width: 900, height: 520, palette, geo, geoUnmatched, uiState, setUiState, onSelect,
            backgroundColor: "#fff", themeBg: "#000", themeFg: "#eee", isHighContrast: true,
            themeAccent: "#0a6", cultureCode: "en-GB", allowTooltips: false, noDataText: "no data",
        });
        expect(r.width).toBe(900);
        expect(r.height).toBe(520);
        expect(r.palette).toBe(palette);          // same ref
        expect(r.geo).toBe(geo);
        expect(r.geoUnmatched).toBe(geoUnmatched);
        expect(r.uiState).toBe(uiState);
        expect(r.setUiState).toBe(setUiState);
        expect(r.onSelect).toBe(onSelect);
        expect(r.backgroundColor).toBe("#fff");
        expect(r.themeBg).toBe("#000");
        expect(r.themeFg).toBe("#eee");
        expect(r.isHighContrast).toBe(true);
        expect(r.themeAccent).toBe("#0a6");
        expect(r.cultureCode).toBe("en-GB");
        expect(r.allowTooltips).toBe(false);
        expect(r.noDataText).toBe("no data");
    });

    // THE SAME BUG AS animLoopDelaySec ABOVE, SECOND OCCURRENCE (2026-08-13). Both card-deck
    // knobs were absent from the resolve list, so the visual passed them, the generated chart
    // read them, and this function dropped them in between. The symptoms were exactly what the
    // two defaults produce downstream - which is why both defaults are pinned here rather than
    // just the pass-through.
    it("deck flipSync: ABSENT MEANS SYNCED, and only an explicit false switches it", () => {
        // The dangerous direction is a missing value reading as "independent": every card would
        // then grow its own control strip. Absent must be true.
        expect(resolveOptions({}).flipSync).toBe(true);
        expect(resolveOptions({ flipSync: undefined }).flipSync).toBe(true);
        expect(resolveOptions({ flipSync: null }).flipSync).toBe(true);
        expect(resolveOptions({ flipSync: true }).flipSync).toBe(true);
        // ...and false must SURVIVE - dropping it is what made "Flip Cards Together = Off" do
        // nothing at all, because the chart reads .
        expect(resolveOptions({ flipSync: false }).flipSync).toBe(false);
    });

    it("deck flipIntervalMs: absent/junk -> 0 (manual only), explicit 0 survives, floor 0", () => {
        expect(resolveOptions({}).flipIntervalMs).toBe(0);
        expect(resolveOptions({ flipIntervalMs: undefined }).flipIntervalMs).toBe(0);
        expect(resolveOptions({ flipIntervalMs: "" }).flipIntervalMs).toBe(0);
        expect(resolveOptions({ flipIntervalMs: "junk" }).flipIntervalMs).toBe(0);
        expect(resolveOptions({ flipIntervalMs: 0 }).flipIntervalMs).toBe(0);
        expect(resolveOptions({ flipIntervalMs: -5 }).flipIntervalMs).toBe(0);
        // A real interval must arrive INTACT: the chart-side clamp (500..120000) is the only
        // clamp, deliberately. Two clamps in two repositories is how they end up disagreeing.
        expect(resolveOptions({ flipIntervalMs: 1000 }).flipIntervalMs).toBe(1000);
        expect(resolveOptions({ flipIntervalMs: "250" }).flipIntervalMs).toBe(250);
        expect(resolveOptions({ flipIntervalMs: 999999 }).flipIntervalMs).toBe(999999);
    });


    // flipMode answers WHERE the controls live, which turned out to be a different question
    // from whether the cards move together. The back-compat rule is the interesting part: a
    // deck generated before this option existed must keep behaving exactly as it did, so an
    // absent flipMode DERIVES from flipSync rather than taking the new default.
    it("flipMode: an explicit mode wins, and junk falls back rather than throwing", () => {
        expect(resolveOptions({ flipMode: "single" }).flipMode).toBe("single");
        expect(resolveOptions({ flipMode: "all" }).flipMode).toBe("all");
        expect(resolveOptions({ flipMode: "both" }).flipMode).toBe("both");
        expect(resolveOptions({ flipMode: "BOTH" }).flipMode).toBe("both");   // case-insensitive
        expect(resolveOptions({ flipMode: "sideways" }).flipMode).toBe("both");
    });

    it("flipMode: absent DERIVES from flipSync, so cached decks do not change behaviour", () => {
        // This is the whole reason the legacy boolean is still read. Defaulting these to "both"
        // would silently add a control strip to every deck already sitting in a report.
        expect(resolveOptions({ flipSync: true }).flipMode).toBe("all");
        expect(resolveOptions({ flipSync: false }).flipMode).toBe("single");
        // ...and an explicit mode still outranks the legacy flag when both are sent.
        expect(resolveOptions({ flipSync: true, flipMode: "single" }).flipMode).toBe("single");
        expect(resolveOptions({ flipSync: false, flipMode: "both" }).flipMode).toBe("both");
    });

    it("flipMode: neither sent -> the default, and flipSync keeps its own default", () => {
        expect(resolveOptions({}).flipMode).toBe("both");
        expect(resolveOptions({}).flipSync).toBe(true);
    });

});

// ---------------------------------------------------------------------------------------------
// THE GUARD. Four fields have now been declared on RenderOptions, passed by a caller, read by a
// chart, and silently dropped in between: animLoopDelaySec, flipSync/flipIntervalMs, geoPointDest
// and approximatePositions. Every one behaved as its downstream default, which is why none of
// them threw and two of them sat in the product as dead pane controls. The omission is structural
// - this function is a WHITELIST that returns a NEW object - so the check has to be structural
// too, and it must not itself be a list somebody remembers to extend.
// ---------------------------------------------------------------------------------------------
describe("resolveOptions - the whitelist covers the contract", () => {
    const readSrc = (f: string) => fs.readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");

    // Top-level fields of `export interface RenderOptions { ... }`, which are indented exactly
    // four spaces - nested shapes (geoPoint's members) are deeper and are not fields of the
    // interface itself.
    const contractFields = (): string[] => {
        const s = readSrc("contract.ts");
        const at = s.indexOf("export interface RenderOptions {");
        expect(at, "RenderOptions must be findable in contract.ts").toBeGreaterThan(-1);
        const body = s.slice(at).split(/\n\}/)[0];
        return [...body.matchAll(/^ {4}([A-Za-z][A-Za-z0-9]*)\??\s*:/gm)].map(m => m[1]);
    };

    // Keys of the object literal resolveOptions returns, indented eight spaces.
    const resolvedKeys = (): string[] => {
        const s = readSrc("defaults.ts");
        const at = s.indexOf("export function resolveOptions");
        expect(at, "resolveOptions must be findable in defaults.ts").toBeGreaterThan(-1);
        const body = s.slice(at);
        return [...body.matchAll(/^ {8}([A-Za-z][A-Za-z0-9]*)\s*:/gm)].map(m => m[1]);
    };

    it("every RenderOptions field appears in the returned object", () => {
        const declared = contractFields();
        // Sanity: the parse must actually find the interface, or this test passes vacuously.
        expect(declared.length, "parsed RenderOptions fields").toBeGreaterThan(25);
        expect(declared).toContain("width");
        expect(declared).toContain("flipMode");

        const resolved = new Set(resolvedKeys());
        expect(resolved.size, "parsed resolveOptions keys").toBeGreaterThan(25);

        const dropped = declared.filter(f => !resolved.has(f));
        expect(dropped, "declared on RenderOptions but DROPPED by resolveOptions - a caller can "
            + "pass these and a chart can read them, and they will never arrive").toEqual([]);
    });

    it("and the runtime agrees: every declared field is a KEY of the result, even when absent", () => {
        // The value may legitimately be undefined; the KEY must exist, because the object is
        // rebuilt rather than spread. This is the same check at runtime, so a parse that drifts
        // cannot quietly stop testing anything.
        const out = resolveOptions({}) as Record<string, unknown>;
        const missing = contractFields().filter(f => !(f in out));
        expect(missing, "not a key of resolveOptions({})").toEqual([]);
    });

    it("the two numeric live knobs keep a MEANINGFUL zero", () => {
        // Both mean "the chart decides" at 0, so an explicit 0 must survive and junk must not
        // become a number. This is the animLoopDelaySec lesson applied to the two fields that
        // were passed and read for weeks without ever being declared.
        expect(resolveOptions({}).geoPointRadiusPx).toBe(0);
        expect(resolveOptions({ geoPointRadiusPx: 0 }).geoPointRadiusPx).toBe(0);
        expect(resolveOptions({ geoPointRadiusPx: "" }).geoPointRadiusPx).toBe(0);
        expect(resolveOptions({ geoPointRadiusPx: "junk" }).geoPointRadiusPx).toBe(0);
        expect(resolveOptions({ geoPointRadiusPx: -4 }).geoPointRadiusPx).toBe(0);
        expect(resolveOptions({ geoPointRadiusPx: 7 }).geoPointRadiusPx).toBe(7);
        expect(resolveOptions({ geoPointRadiusPx: "12" }).geoPointRadiusPx).toBe(12);

        expect(resolveOptions({}).pageSize).toBe(0);
        expect(resolveOptions({ pageSize: 0 }).pageSize).toBe(0);
        expect(resolveOptions({ pageSize: "" }).pageSize).toBe(0);
        expect(resolveOptions({ pageSize: "junk" }).pageSize).toBe(0);
        expect(resolveOptions({ pageSize: -1 }).pageSize).toBe(0);
        expect(resolveOptions({ pageSize: 25 }).pageSize).toBe(25);
        expect(resolveOptions({ pageSize: "50" }).pageSize).toBe(50);
    });

    it("the four live knobs keep their own defaults and reject junk", () => {
        expect(resolveOptions({}).approximatePositions).toBe("mark");
        expect(resolveOptions({ approximatePositions: "aggregate" }).approximatePositions).toBe("aggregate");
        expect(resolveOptions({ approximatePositions: "skip" }).approximatePositions).toBe("skip");
        expect(resolveOptions({ approximatePositions: "SKIP" }).approximatePositions).toBe("skip");
        expect(resolveOptions({ approximatePositions: "sideways" }).approximatePositions).toBe("mark");

        expect(resolveOptions({}).valueAxisBaseline).toBe("fit");
        expect(resolveOptions({ valueAxisBaseline: "zero" }).valueAxisBaseline).toBe("zero");
        expect(resolveOptions({ valueAxisBaseline: "auto" }).valueAxisBaseline).toBe("auto");
        expect(resolveOptions({ valueAxisBaseline: "FIT" }).valueAxisBaseline).toBe("fit");
        expect(resolveOptions({ valueAxisBaseline: "tight" }).valueAxisBaseline).toBe("fit");

        // seasonalMarkers fails open to "auto" DELIBERATELY, and that direction is the assertion
        // worth pinning: "auto" is the mode that makes a chart prove the sampling grid before it
        // names a lag "wk", so junk must withdraw the claim, never grant one. If a later refactor
        // makes "always" the fallback, every garbled value starts asserting a weekly cycle.
        expect(resolveOptions({}).seasonalMarkers).toBe("auto");
        expect(resolveOptions({ seasonalMarkers: "always" }).seasonalMarkers).toBe("always");
        expect(resolveOptions({ seasonalMarkers: "never" }).seasonalMarkers).toBe("never");
        expect(resolveOptions({ seasonalMarkers: "ALWAYS" }).seasonalMarkers).toBe("always");
        expect(resolveOptions({ seasonalMarkers: "weekly" }).seasonalMarkers).toBe("auto");
        expect(resolveOptions({ seasonalMarkers: "" }).seasonalMarkers).toBe("auto");

        // A pass-through, so the caller's object must arrive by reference and untouched.
        const dest = { precision: null, precisionCounts: {} as any, coarseExamples: [], unplaced: 2,
                       unplacedExamples: ["x"], ambiguousRows: 0 };
        expect(resolveOptions({ geoPointDest: dest }).geoPointDest).toBe(dest);
    });
});
