// THE OPTIONS VOCABULARY (2026-09-25) - one table of the reader-facing options every host shares.
//
// A host offers a reader a set of knobs - a format pane, a task-pane form, a component's props - and
// each knob has the same four facts wherever it appears: what "not set" means (the default), the
// bounds a value must sit inside, when a change takes effect (the chart on screen repaints, or the
// next generated chart is made differently), and where it travels on a generate request. Written down
// separately in each host, those facts drift: a default moves in one pane and not in another, a bound
// is typed as a number here and stated as prose there. This table states them once.
//
// THE KEY IS THE WIRE / RENDER-OPTION NAME - the name a request field or `options` carries. A host
// that stores a knob under another name (a saved file's property, say) keeps that name and maps it;
// no stored name has to change for a host to read this table.
//
// FACTS, NOT A RESOLVER. The render knobs are normalised by `resolveOptions`, from the same constants
// this table is built from, so the two cannot disagree; a host reads the table for its own defaults,
// validators and "does this repaint now?" answers. `min` / `max` are the bounds a reader's value must
// sit inside - a pane's validators, a restored value's check - which for the animation knobs are also
// what `resolveOptions` clamps to, and for Max Map Points and the limit count are input bounds only.

import {
    ANIM_PLAY_SPEED_DEFAULT, ANIM_PLAY_SPEED_MIN, ANIM_PLAY_SPEED_MAX,
    ANIM_LOOP_DELAY_DEFAULT, ANIM_LOOP_DELAY_MIN,
    ANIM_MAX_IDEAL_FRAMES_DEFAULT, ANIM_MAX_IDEAL_FRAMES_MIN, ANIM_MAX_IDEAL_FRAMES_MAX,
    VALUE_AXIS_BASELINE_DEFAULT, SEASONAL_MARKERS_DEFAULT, MAX_MAP_POINTS_DEFAULT,
} from "./contract";

/**
 * When a change to an option takes effect.
 * - `live`: the chart on screen repaints with it; no request, no new chart.
 * - `next-generate`: it steers what the engine makes, so it applies to the next generated chart.
 * - `live-and-next-generate`: both - the chart on screen repaints, and the request carries it too.
 * - `after-render`: it governs what happens after a chart is drawn (a review, a thumbnail).
 */
export type OptionTiming = "live" | "next-generate" | "live-and-next-generate" | "after-render";

/** Where an option travels on a generate request: the request itself, or its client hints. */
export type OptionWire = "request" | "clientHints";

/** The shared facts about one option. */
export interface OptionVocabularyEntry {
    readonly timing: OptionTiming;
    /** What "not set" means. A host that stores blank or 0 for "the default" resolves to this. */
    readonly default: string | number | boolean;
    /** The least value a reader may set, for a number. */
    readonly min?: number;
    /** The greatest value a reader may set, for a number. Absent: no upper bound. */
    readonly max?: number;
    /** The values a choice accepts, "" being "leave it to the engine" where offered. */
    readonly values?: readonly string[];
    /** Where it travels on a generate request; absent when it never travels. */
    readonly wire?: OptionWire;
}

/** Max Map Points: the fewest and the most points a reader may allow a point map. */
export const MAX_MAP_POINTS_MIN = 10;
export const MAX_MAP_POINTS_MAX = 100_000;
/** Favor Limit Count: the most groups a reader may ask a chart to keep. 0 asks for no limit. */
export const LIMIT_COUNT_MAX = 10_000;

const entry = (e: OptionVocabularyEntry): OptionVocabularyEntry => Object.freeze({ ...e, ...(e.values ? { values: Object.freeze([...e.values]) } : {}) });

/** The options the hosts share, keyed by wire / render-option name. */
export const OPTIONS_VOCABULARY = Object.freeze({
    // ---- drawn from on every render, and stated on the request so the model reasons about them ----
    aggregation: entry({ timing: "live-and-next-generate", default: "", values: ["", "sum", "average", "median", "min", "max", "count", "distinct"], wire: "request" }),
    colorScaleLow: entry({ timing: "live-and-next-generate", default: "", wire: "request" }),
    colorScaleHigh: entry({ timing: "live-and-next-generate", default: "", wire: "request" }),
    /** Blank: the host's own colours when it offers them, else the engine's. */
    palette: entry({ timing: "live-and-next-generate", default: "", wire: "request" }),
    /** A HARD offer gate on the server as well as a live cap on what a point map plots. */
    maxMapPoints: entry({ timing: "live-and-next-generate", default: MAX_MAP_POINTS_DEFAULT, min: MAX_MAP_POINTS_MIN, max: MAX_MAP_POINTS_MAX, wire: "clientHints" }),
    // ---- live only ----
    /** 0 means no paging. */
    pageSize: entry({ timing: "live", default: 0, min: 0 }),
    valueAxisBaseline: entry({ timing: "live", default: VALUE_AXIS_BASELINE_DEFAULT, values: ["fit", "zero", "auto"] }),
    seasonalMarkers: entry({ timing: "live", default: SEASONAL_MARKERS_DEFAULT, values: ["auto", "always", "never"] }),
    animAutoPlay: entry({ timing: "live", default: false }),
    animPlaySpeedMs: entry({ timing: "live", default: ANIM_PLAY_SPEED_DEFAULT, min: ANIM_PLAY_SPEED_MIN, max: ANIM_PLAY_SPEED_MAX }),
    /** 0 restarts at once; no upper bound, so a very large value plays once per viewing. */
    animLoopDelaySec: entry({ timing: "live", default: ANIM_LOOP_DELAY_DEFAULT, min: ANIM_LOOP_DELAY_MIN }),
    animStopAtEnd: entry({ timing: "live", default: false }),
    animMaxIdealFrames: entry({ timing: "live", default: ANIM_MAX_IDEAL_FRAMES_DEFAULT, min: ANIM_MAX_IDEAL_FRAMES_MIN, max: ANIM_MAX_IDEAL_FRAMES_MAX }),
    /** "" chooses by the number of periods. */
    animTimelineStyle: entry({ timing: "live", default: "", values: ["", "line", "boxes"] }),
    filtersDuringPlay: entry({ timing: "live", default: false }),
    // ---- the next generated chart ----
    levelOfDetail: entry({ timing: "next-generate", default: "", values: ["", "High", "Medium", "Low"], wire: "clientHints" }),
    favorLimitTo: entry({ timing: "next-generate", default: "", values: ["", "latest", "top / greatest", "bottom / smallest", "most common", "outliers"], wire: "clientHints" }),
    /** 0 asks for no limit, and travels as absent (`wireLimitCount`): any value the server receives is a limit. */
    favorLimitCount: entry({ timing: "next-generate", default: 0, min: 0, max: LIMIT_COUNT_MAX, wire: "clientHints" }),
    /** "1" asks for a title, "0" for none, "" leaves it to the engine. */
    favorTitle: entry({ timing: "next-generate", default: "", values: ["", "1", "0"], wire: "clientHints" }),
    /** Data labels on the marks: "1", "0", or "" for the engine's choice. */
    favorDPValues: entry({ timing: "next-generate", default: "", values: ["", "1", "0"], wire: "clientHints" }),
    legendPlacement: entry({ timing: "next-generate", default: "", values: ["", "outside", "inside", "none"], wire: "clientHints" }),
    /** Free text: the industry the data belongs to. */
    industryContext: entry({ timing: "next-generate", default: "", wire: "clientHints" }),
    /** Free text: a font family for the chart's own text. */
    suggestFontFamily: entry({ timing: "next-generate", default: "", wire: "clientHints" }),
    // ---- after a chart is drawn ----
    visionReview: entry({ timing: "after-render", default: false }),
    saveThumbnails: entry({ timing: "after-render", default: false }),
} satisfies Record<string, OptionVocabularyEntry>);

/** A shared option's key. */
export type OptionKey = keyof typeof OPTIONS_VOCABULARY;

/** The keys whose change repaints the chart on screen, in table order. */
export const LIVE_OPTION_KEYS: readonly OptionKey[] = Object.freeze(
    (Object.keys(OPTIONS_VOCABULARY) as OptionKey[])
        .filter(k => OPTIONS_VOCABULARY[k].timing === "live" || OPTIONS_VOCABULARY[k].timing === "live-and-next-generate"),
);

/**
 * THE LIMIT COUNT A REQUEST CARRIES: a positive count, or null - never 0. The server reads any value it
 * receives as the reader's own limit (and 0 as a limit of zero), so "no limit" must arrive as no value.
 * A host places null where it always has; one that omits blank fields maps it to absent.
 */
export function wireLimitCount(count: unknown): number | null {
    const n = typeof count === "number" ? count : count == null || count === "" ? NaN : Number(count);
    return Number.isFinite(n) && n > 0 ? n : null;
}
