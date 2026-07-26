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
    ANIM_MAX_IDEAL_FRAMES_DEFAULT, ANIM_MAX_IDEAL_FRAMES_MIN, ANIM_MAX_IDEAL_FRAMES_MAX,
    COLOR_SCALE_SELF_CLAMP_PCT_DEFAULT, COLOR_SCALE_SELF_CLAMP_PCT_MIN, COLOR_SCALE_SELF_CLAMP_PCT_MAX,
} from "./contract";

// Raw input: every field optional/loose (the knobs arrive as raw setting values).
export type ResolveOptionsInput = { [K in keyof RenderOptions]?: any };

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

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
        // Math.max(3, Math.min(500, Number(raw) || 60))
        animMaxIdealFrames: clamp(Number(p.animMaxIdealFrames) || ANIM_MAX_IDEAL_FRAMES_DEFAULT, ANIM_MAX_IDEAL_FRAMES_MIN, ANIM_MAX_IDEAL_FRAMES_MAX),
        animStopAtEnd: !!p.animStopAtEnd,
        filtersDuringPlay: !!p.filtersDuringPlay,
        animTimelineStyle: (p.animTimelineStyle || "").toString() as RenderOptions["animTimelineStyle"],
    };
}
