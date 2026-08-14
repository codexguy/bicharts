// resolveOptions — the ONE place the render-option defaults/clamps live.
//
// It reproduces EXACTLY the normalization that was inline in the visual's option
// assembly, so moving the assembly onto it is behavior-identical (locked by
// tests/defaults.test.ts, which checks each field against the original expression).
//
// Split of responsibility:
//   • NORMALIZED knobs (animation / colour-scale / aggregation): the caller passes
//     the RAW setting value; resolveOptions applies the default + clamp.
//   • HOST fields (width/height/palette/geo/theme/cultureCode/allowTooltips/
//     noDataText/uiState/setUiState/onSelect): the caller has already computed the
//     final value; resolveOptions passes it through untouched.
import {
    type RenderOptions,
    ANIM_PLAY_SPEED_DEFAULT, ANIM_PLAY_SPEED_MIN, ANIM_PLAY_SPEED_MAX,
    ANIM_LOOP_DELAY_DEFAULT, ANIM_LOOP_DELAY_MIN,
    ANIM_MAX_IDEAL_FRAMES_DEFAULT, ANIM_MAX_IDEAL_FRAMES_MIN, ANIM_MAX_IDEAL_FRAMES_MAX,
    COLOR_SCALE_SELF_CLAMP_PCT_DEFAULT, COLOR_SCALE_SELF_CLAMP_PCT_MIN, COLOR_SCALE_SELF_CLAMP_PCT_MAX,
    FLIP_MODE_DEFAULT,
} from "./contract";

// Raw input: every field optional/loose (the knobs arrive as raw setting values).
export type ResolveOptionsInput = { [K in keyof RenderOptions]?: any };

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
// For knobs where 0 is a MEANINGFUL value: the usual `Number(raw) || DEFAULT`
// idiom would silently turn an explicit 0 into the default. Default only when
// the value is absent, blank, or not a number.
const numberOr = (raw: unknown, dflt: number) => {
    const n = raw == null || raw === "" ? NaN : Number(raw);
    return Number.isFinite(n) ? n : dflt;
};

export function resolveOptions(p: ResolveOptionsInput): RenderOptions {
    return {
        // ---- host fields: pass through exactly as supplied ----
        width: p.width,
        height: p.height,
        palette: p.palette,
        geoUnmatched: p.geoUnmatched,
        geo: p.geo,
        geoPoint: p.geoPoint,
        maxMapPoints: p.maxMapPoints,
        uiState: p.uiState,
        setUiState: p.setUiState,
        backgroundColor: p.backgroundColor,
        themeBg: p.themeBg,
        themeFg: p.themeFg,
        isHighContrast: p.isHighContrast,
        themeAccent: p.themeAccent,
        cultureCode: p.cultureCode,
        allowTooltips: p.allowTooltips,
        noDataText: p.noDataText,
        onSelect: p.onSelect,

        // ---- live-restyle knobs: `raw || undefined` / `.toString() || undefined` ----
        colorScaleLow: p.colorScaleLow || undefined,
        colorScaleHigh: p.colorScaleHigh || undefined,
        // "" (global, the default), "frame", or "self"; anything else fails open to global.
        colorScaleScope: (p.colorScaleScope === "frame" || p.colorScaleScope === "self" ? p.colorScaleScope : "") as RenderOptions["colorScaleScope"],
        // Math.max(50, Math.min(100, Number(raw) || 95)) — only meaningful under "self".
        colorScaleSelfClampPct: clamp(Number(p.colorScaleSelfClampPct) || COLOR_SCALE_SELF_CLAMP_PCT_DEFAULT, COLOR_SCALE_SELF_CLAMP_PCT_MIN, COLOR_SCALE_SELF_CLAMP_PCT_MAX),
        // Map fills: `raw || undefined` like the colour-scale endpoints. The no-data ->
        // land cascade is left to the chart (so the fallback chain is visible in the
        // generated code); HC substitution has already happened in the caller.
        geoLandColor: p.geoLandColor || undefined,
        geoNoDataColor: p.geoNoDataColor || undefined,
        aggregation: (p.aggregation == null ? "" : String(p.aggregation)) || undefined,

        // ---- animation: booleans, default+clamp numerics, "" default enum ----
        animAutoPlay: !!p.animAutoPlay,
        // Math.max(250, Math.min(5000, Number(raw) || 1000))
        animPlaySpeedMs: clamp(Number(p.animPlaySpeedMs) || ANIM_PLAY_SPEED_DEFAULT, ANIM_PLAY_SPEED_MIN, ANIM_PLAY_SPEED_MAX),
        // Loop-restart delay (seconds on the overview between auto-play passes).
        // Floored at 0, deliberately NO upper clamp (huge = play once per viewing),
        // and 0 must survive as 0 — hence numberOr, not `|| DEFAULT`. This field was
        // MISSING from the resolve list when the assembly moved here, so callers
        // that passed it saw it dropped: the scrubber read undefined -> 0 -> every
        // pass restarted instantly and resumed-state auto-play lost its pacing.
        animLoopDelaySec: Math.max(ANIM_LOOP_DELAY_MIN, numberOr(p.animLoopDelaySec, ANIM_LOOP_DELAY_DEFAULT)),
        // Math.max(3, Math.min(500, Number(raw) || 60))
        animMaxIdealFrames: clamp(Number(p.animMaxIdealFrames) || ANIM_MAX_IDEAL_FRAMES_DEFAULT, ANIM_MAX_IDEAL_FRAMES_MIN, ANIM_MAX_IDEAL_FRAMES_MAX),
        animStopAtEnd: !!p.animStopAtEnd,
        filtersDuringPlay: !!p.filtersDuringPlay,
        animTimelineStyle: (p.animTimelineStyle || "").toString() as RenderOptions["animTimelineStyle"],
        // ---- card deck ----
        // SECOND OCCURRENCE OF THE animLoopDelaySec BUG, six lines above (2026-08-13). The
        // visual passed both of these, the generated code read both correctly, and this
        // function — a whitelist that returns a NEW object — dropped them in between. Symptoms
        // were exactly what the two defaults produce: flipSync undefined -> `!== false` -> true
        // -> always synced, so "Flip Cards Together = Off" did nothing and the deck kept its
        // shared strip; flipIntervalMs undefined -> `+(undefined || 0)` -> 0 -> the timer branch
        // never ran, so a 1000 ms interval produced no flips. Two dead knobs, one omission.
        //
        // flipSync DEFAULTS TRUE, so it cannot use `!!p.flipSync` — that would read a missing
        // value as "independent" and hand every deck twelve control strips. Absent means
        // synced; only an explicit false switches it.
        flipSync: p.flipSync === undefined || p.flipSync === null ? true : !!p.flipSync,
        // WHERE the controls live, which is a different question from whether the cards move
        // together (Joel 2026-08-13: "the ability to flip individual cards shouldn't necessarily
        // stop being able to flip all together too"). Resolution order matters and is the whole
        // back-compat story:
        //   1. an explicit, recognised flipMode wins;
        //   2. otherwise DERIVE from flipSync, so a chart generated before this option existed
        //      behaves exactly as it did - true -> "all", false -> "single";
        //   3. and a caller that sends neither gets the default.
        // Deriving rather than defaulting is the point: a cached chart must not change behaviour
        // because a newer client shipped, and "both" would have done exactly that to every deck
        // already in a report.
        flipMode: ((): RenderOptions["flipMode"] => {
            const m = (p.flipMode == null ? "" : String(p.flipMode)).toLowerCase();
            if (m === "single" || m === "all" || m === "both") return m as RenderOptions["flipMode"];
            if (p.flipSync === false) return "single";
            if (p.flipSync === true) return "all";
            return FLIP_MODE_DEFAULT;
        })(),
        // 0 is MEANINGFUL here (manual only) and is the default, so numberOr — not
        // `|| DEFAULT` — for the same reason animLoopDelaySec uses it. Clamping stays
        // chart-side: the archetype already clamps 500..120000 and two clamps in two
        // repositories is how they end up disagreeing.
        flipIntervalMs: Math.max(0, numberOr(p.flipIntervalMs, 0)),
        // `raw || undefined`, the same idiom as the colour-scale endpoints and the map fills:
        // blank must arrive as ABSENT, not as an empty string, because the chart's fallback is
        // `options.cardBackgroundColor || <its own choice>` and "" would satisfy a truthiness
        // test in some hands while painting nothing in others.
        cardBackgroundColor: p.cardBackgroundColor || undefined,
    };
}
