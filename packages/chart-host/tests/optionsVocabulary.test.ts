import { describe, it, expect } from "vitest";
import {
    OPTIONS_VOCABULARY, LIVE_OPTION_KEYS, MAX_MAP_POINTS_MIN, MAX_MAP_POINTS_MAX, LIMIT_COUNT_MAX, wireLimitCount,
    resolveOptions, codeReadsOption, type OptionKey,
} from "../src/index";

const KEYS = Object.keys(OPTIONS_VOCABULARY) as OptionKey[];

describe("the options vocabulary is internally consistent", () => {
    it("every default sits inside its own bounds and among its own values", () => {
        for (const k of KEYS) {
            const e = OPTIONS_VOCABULARY[k];
            if (typeof e.default === "number") {
                if (e.min !== undefined) expect(e.default, k).toBeGreaterThanOrEqual(e.min);
                if (e.max !== undefined) expect(e.default, k).toBeLessThanOrEqual(e.max);
            }
            if (e.min !== undefined && e.max !== undefined) expect(e.min, k).toBeLessThanOrEqual(e.max);
            if (e.values) {
                expect(e.values, k).toContain(e.default);
                expect(new Set(e.values).size, k).toBe(e.values.length);
            }
        }
    });

    it("is frozen, entries and value lists included", () => {
        expect(Object.isFrozen(OPTIONS_VOCABULARY)).toBe(true);
        for (const k of KEYS) {
            expect(Object.isFrozen(OPTIONS_VOCABULARY[k]), k).toBe(true);
            if (OPTIONS_VOCABULARY[k].values) expect(Object.isFrozen(OPTIONS_VOCABULARY[k].values), k).toBe(true);
        }
        expect(Object.isFrozen(LIVE_OPTION_KEYS)).toBe(true);
    });

    it("the bounds constants are the table's", () => {
        expect([OPTIONS_VOCABULARY.maxMapPoints.min, OPTIONS_VOCABULARY.maxMapPoints.max]).toEqual([MAX_MAP_POINTS_MIN, MAX_MAP_POINTS_MAX]);
        expect([MAX_MAP_POINTS_MIN, MAX_MAP_POINTS_MAX, LIMIT_COUNT_MAX]).toEqual([10, 100_000, 10_000]);
        expect(OPTIONS_VOCABULARY.favorLimitCount.max).toBe(LIMIT_COUNT_MAX);
    });

    it("the live keys are the options that repaint the chart on screen", () => {
        expect([...LIVE_OPTION_KEYS]).toEqual([
            "aggregation", "colorScaleLow", "colorScaleHigh", "palette", "maxMapPoints", "pageSize", "valueAxisBaseline",
            "seasonalMarkers", "animAutoPlay", "animPlaySpeedMs", "animLoopDelaySec", "animStopAtEnd", "animMaxIdealFrames",
            "animTimelineStyle", "filtersDuringPlay", "flipMode", "flipIntervalMs", "flipDirection",
            "cardBackgroundColor", "hoverDropLines",
        ]);
    });
});

describe("the vocabulary and resolveOptions agree", () => {
    const resolved = resolveOptions({}) as Record<string, unknown>;

    it("an option not set resolves to the vocabulary's default (blank text resolves to absent)", () => {
        for (const k of LIVE_OPTION_KEYS) {
            if (k === "palette") continue;   // a host field, passed through untouched
            const d = OPTIONS_VOCABULARY[k].default;
            if (d === "") expect(resolved[k] ?? "", k).toBe("");
            else expect(resolved[k], k).toBe(d);
        }
    });

    it("the animation numbers are clamped to the vocabulary's bounds", () => {
        for (const k of ["animPlaySpeedMs", "animMaxIdealFrames"] as const) {
            const e = OPTIONS_VOCABULARY[k];
            expect((resolveOptions({ [k]: e.min! - 1 }) as any)[k], k).toBe(e.min);
            expect((resolveOptions({ [k]: e.max! + 1 }) as any)[k], k).toBe(e.max);
        }
        expect(resolveOptions({ animLoopDelaySec: -5 }).animLoopDelaySec).toBe(OPTIONS_VOCABULARY.animLoopDelaySec.min);
    });

    it("every value a choice lists is accepted, and anything else falls to the default", () => {
        for (const k of ["valueAxisBaseline", "seasonalMarkers", "flipMode", "flipDirection"] as const) {
            for (const v of OPTIONS_VOCABULARY[k].values!) expect((resolveOptions({ [k]: v }) as any)[k], `${k}=${v}`).toBe(v);
            expect((resolveOptions({ [k]: "sideways" }) as any)[k], k).toBe(OPTIONS_VOCABULARY[k].default);
        }
    });
});

describe("codeReadsOption - a host shows a control only for a chart that responds to it", () => {
    it("is true when the code reads the option, in either form a chart writes it", () => {
        expect(codeReadsOption("orb.dropLines(sel, xyz, options.hoverDropLines === true);", "hoverDropLines")).toBe(true);
        expect(codeReadsOption("const on = options.hoverDropLines !== false;", "hoverDropLines")).toBe(true);
    });

    it("is false for code that never reads it, and for no code at all", () => {
        expect(codeReadsOption("const w = options.width;", "hoverDropLines")).toBe(false);
        expect(codeReadsOption("", "hoverDropLines")).toBe(false);
        expect(codeReadsOption(null, "hoverDropLines")).toBe(false);
        expect(codeReadsOption(undefined, "hoverDropLines")).toBe(false);
    });

    it("matches the whole key, not a longer name that starts with it", () => {
        expect(codeReadsOption("options.hoverDropLinesColor", "hoverDropLines")).toBe(false);
        expect(codeReadsOption("myoptions.hoverDropLines", "hoverDropLines")).toBe(false);
    });

    it("answers only for keys in the vocabulary", () => {
        expect(codeReadsOption("options.notAnOption", "notAnOption" as OptionKey)).toBe(false);
        for (const k of KEYS) expect(codeReadsOption(`x = options.${k};`, k), k).toBe(true);
    });
});

describe("wireLimitCount - no limit travels as no value", () => {
    it("a positive count travels; 0, blank, junk and negatives travel as null", () => {
        expect(wireLimitCount(12)).toBe(12);
        expect(wireLimitCount("7")).toBe(7);
        for (const v of [0, "0", "", null, undefined, -3, NaN, "x", Infinity]) expect(wireLimitCount(v), String(v)).toBeNull();
    });
});
