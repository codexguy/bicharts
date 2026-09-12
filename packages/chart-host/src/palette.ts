// A CATEGORICAL PALETTE THAT BELONGS TO THE SURFACE THE CHART SITS ON.
// (2026-05-30 in the Power BI visual; moved here 2026-09-09.)
//
// Written and proven in the visual, where the seed comes from
// `host.colorPalette.getColor(key)` so a chart follows the report theme. None of the walk is
// Power-BI-specific - it is "given a theme colour and the colours already issued, pick one a
// human will read as different" - and the other hosts had no answer at all: the Excel add-in
// and the MCP surface both sent an EMPTY palette, so the MODEL chose, and it reached for
// d3.schemeCategory10 every time. That set puts #2ca02c next to #d62728, the textbook
// deuteranopia collision, and nothing about the workbook or the caller ever entered into it.
//
// Pure (deterministic given seed + existing set): no `this`, no DOM, no host. A host resolves
// its OWN seed - a report theme colour, an Excel table's resolved accent fill, a caller-supplied
// brand colour - and this module runs the CIE2000-deltaE distance walk and returns a hex.
//
// Why CIE2000 instead of RGB Euclidean: RGB over-weights blue and
// under-weights green, so it would happily call (#00FF00, #008800)
// "distant" while accepting (#FF0000, #FF1010) as "different." CIE2000 is
// the perceptual metric that matches how the human eye actually decides
// "are these the same?". minDistance=10 is the chart-readable threshold at
// small swatch sizes (≈5 is JND).

import colorsea from "colorsea";
import { deltaEHex } from "./deltaE";

/**
 * Minimum perceptual distance (CIE2000 deltaE) that any returned color must
 * achieve from every previously-issued color. Picked for chart-readable
 * swatches; JND (just-noticeable-difference) at this scale is ≈5.
 */
export const MIN_DELTA_E = 10;

/**
 * Pick a hex color for a palette slot.
 *
 * Strategy (ordered from "closest to theme" to "furthest from theme"):
 *   1. The seed itself if it's already distant enough.
 *   2. Saturation walk around the seed (same hue family, in-theme).
 *   3. Lightness walk around the seed (same hue family, in-theme).
 *   4. Hue rotation around the seed (drifts off-theme but still tied).
 *   5. Give up — return the seed. Never random: a slightly-colliding theme
 *      color reads better than a stranger color.
 *
 * The set of `existing` colors is treated as readonly — the caller is
 * responsible for adding the returned color (and possibly the best-effort
 * fallback) to their own set when this function returns. We return BOTH the
 * chosen color AND the colorSet-entry to register, because the give-up case
 * registers a DIFFERENT value (the best-so-far candidate) than what it
 * returns (the seed): registering the seed would make a later call think
 * its slot is empty, but returning the best-so-far would lose theme
 * fidelity.
 */
export interface PaletteResult {
    /** Hex color to use for this slot. */
    readonly hex: string;
    /** Hex color to register in the palette-issued set (may differ from `hex` on the give-up fallback). */
    readonly registerHex: string;
}

export function pickDistinctColorFromSeed(
    seedHex: string,
    existing: ReadonlySet<string>,
    minDistance: number = MIN_DELTA_E,
): PaletteResult {
    const existingCs = [...existing].map(c => colorsea(c));
    const seed = colorsea(seedHex);

    // Min CIE2000 deltaE between `c` and every issued color. Empty palette
    // → +Infinity so the seed wins on the first call.
    const minDeltaE = (c: colorsea.Color): number =>
        existingCs.length === 0
            ? Number.POSITIVE_INFINITY
            : Math.min(...existingCs.map(c2 => c.deltaE(c2, "CIE2000")));

    // Step 1 — the seed itself.
    if (minDeltaE(seed) >= minDistance) {
        const hex = seed.hex();
        return { hex, registerHex: hex };
    }

    // Track best-so-far for the give-up fallback (step 5).
    let bestCandidate = seed;
    let bestMinDist = minDeltaE(seed);

    const tryVariant = (c: colorsea.Color): PaletteResult | null => {
        const d = minDeltaE(c);
        if (d >= minDistance) {
            const hex = c.hex();
            return { hex, registerHex: hex };
        }
        if (d > bestMinDist) {
            bestMinDist = d;
            bestCandidate = c;
        }
        return null;
    };

    // Step 2 — saturation walk. colorsea takes a *delta* in [-100, 100].
    for (const dSat of [25, -25, 50, -50, 75]) {
        const hit = tryVariant(dSat >= 0 ? seed.saturate(dSat) : seed.desaturate(-dSat));
        if (hit) return hit;
    }

    // Step 3 — lightness walk. Bracketed up/down so theme dark colors get
    // tried light and vice versa.
    for (const dLight of [15, -15, 30, -30, 45]) {
        const hit = tryVariant(dLight >= 0 ? seed.lighten(dLight) : seed.darken(-dLight));
        if (hit) return hit;
    }

    // Step 4 — hue rotation (`.spin()`). Sweep ±30 → ±120 to maximize the
    // chance of a free slot without straying too far around the wheel.
    for (const dHue of [30, -30, 60, -60, 90, -90, 120, -120]) {
        const hit = tryVariant(seed.spin(dHue));
        if (hit) return hit;
    }

    // Step 5 — give up. Return the seed (theme-faithful) but register the
    // best-so-far so future distance calculations use the more representative
    // anchor.
    return { hex: seed.hex(), registerHex: bestCandidate.hex() };
}

/**
 * A whole categorical palette from ONE seed colour.
 *
 * THE DIFFERENCE BETWEEN THE TWO HOSTS, and the reason this wrapper exists rather than each
 * host looping for itself. Power BI hands the visual a DIFFERENT theme colour per slot
 * (`getColor("1")`, `getColor("2")`, ...), so its loop varies the seed and the walk mostly
 * settles at step 1. Excel has no such API: a workbook offers ONE resolvable accent - the fill
 * a themed table style actually painted - so every slot is seeded from the SAME colour and the
 * walk does the spreading, saturation first, then lightness, then hue.
 *
 * That ordering is why one accent is enough to be worth doing. The early slots stay in the
 * seed's own hue family, so a two- or three-series chart reads as the workbook's colour rather
 * than as a stranger's; only once those are exhausted does it rotate away. A host with one
 * brand colour gets a palette that still looks like the brand.
 *
 * Deterministic: same seed and count in, same array out, which is what lets a host PERSIST the
 * result and re-derive it later without the colours shifting under a saved chart.
 */
export function buildPaletteFromSeed(
    seedHex: string,
    count: number,
    minDistance: number = MIN_DELTA_E,
): string[] {
    return buildPalette(() => seedHex, count, minDistance);
}

/**
 * WHERE EACH SLOT'S BASE COLOUR COMES FROM. Called with the slot index, 0-based.
 *
 * Returning a blank or nothing means "no base colour for this slot" - the builder then falls
 * back to the last one that WAS supplied, so a host whose colour source runs dry degrades into
 * spreading rather than into a gap.
 */
export type SeedForSlot = (slot: number) => string | null | undefined;

/**
 * The general form: a palette whose BASE COLOURS the host decides, slot by slot.
 *
 * THIS IS THE RICH FORM AND `buildPaletteFromSeed` IS THE DEGENERATE ONE. Read that sentence
 * before "simplifying" a host onto the single-seed call, because the difference is a real loss
 * and it is invisible in the output - both return a plausible list of distinct colours.
 *
 * Power BI hands a visual a DIFFERENT theme colour per slot (`colorPalette.getColor("1")`,
 * `getColor("2")`, ...). Every one of those is a deliberate choice by whoever built the report
 * theme, and feeding them in per slot means the walk usually settles at step 1 and RETURNS THEM
 * UNCHANGED - the chart is coloured by the theme, not by our arithmetic. Collapse that host onto
 * one seed and twenty authored colours become one authored colour plus nineteen derived ones:
 * still distinct, still pretty, and no longer the report's.
 *
 * A host with no such API - an Excel workbook offers exactly one resolvable accent - passes a
 * constant provider and the walk does the spreading. That is a fallback, not the design.
 */
export function buildPalette(
    seedFor: SeedForSlot,
    count: number,
    minDistance: number = MIN_DELTA_E,
): string[] {
    const out: string[] = [];
    if (!(count > 0)) return out;

    const issued = new Set<string>();
    const issuedCs: colorsea.Color[] = [];
    const distance = (hex: string): number =>
        issuedCs.length === 0
            ? Number.POSITIVE_INFINITY
            : Math.min(...issuedCs.map(c => colorsea(hex).deltaE(c, "CIE2000")));

    let sweep: string[] | null = null;
    let sweepAt = 0;
    // The last base colour the host actually gave us. A provider is allowed to run out - Power
    // BI's own palette wraps after a while, and a host may simply have fewer authored colours
    // than slots - and carrying the last one forward is what turns "ran out" into "spread from
    // here" rather than into a hole.
    let lastSeed = "";

    for (let i = 0; i < count; i++) {
        let seedHex = "";
        try { seedHex = normalise(seedFor(i)); } catch { seedHex = ""; }
        if (!seedHex) seedHex = lastSeed;
        // NOTHING HAS EVER BEEN SUPPLIED. Not an error and not a guess: a host that cannot name
        // a single colour has no palette to offer, and an invented one would be indistinguishable
        // from a real one at exactly the moment the caller most needs to know the difference.
        if (!seedHex) break;
        lastSeed = seedHex;

        const { hex, registerHex } = pickDistinctColorFromSeed(seedHex, issued, minDistance);
        let chosen = hex;
        let register = registerHex;

        // THE WALK GAVE UP, AND FROM ONE SEED IT EVENTUALLY MUST. `pickDistinctColorFromSeed`
        // returns the seed itself when every variant it tries is too close to something already
        // issued - theme-faithful, and correct for the visual, which asks again with a DIFFERENT
        // theme colour next time. Asking again with the SAME colour just returns it again, so a
        // single-accent host would fill slots 5..20 with one repeated hex and a legend would
        // have several entries in identical colours.
        if (distance(chosen) < minDistance) {
            if (!sweep) sweep = sweepCandidates(seedHex);
            // Rare in the per-slot form and routine in the single-seed one: with authored
            // colours arriving per slot the walk normally settles at step 1 and never reaches
            // here at all, which is the whole point of feeding them in separately.
            let best = chosen;
            let bestD = distance(chosen);
            // Candidates are consumed monotonically: `issued` only grows, so distances only
            // shrink, and a candidate that is too close now can never become far enough later.
            while (sweepAt < sweep.length) {
                const cand = sweep[sweepAt++];
                const d = distance(cand);
                if (d >= minDistance) { best = cand; bestD = d; break; }
                if (d > bestD) { best = cand; bestD = d; }
            }
            chosen = best;
            register = best;
        }

        issued.add(register);
        issuedCs.push(colorsea(register));
        out.push(chosen);
    }
    return out;
}

/**
 * A POOL OF ACCEPTABLE COLOURS, ORDERED SO THE MOST DISTINCT COME FIRST.
 *
 * For a host that knows WHICH colours belong to the surface but not in what ORDER to use them.
 * Excel is the case that needed it: a workbook's theme offers a grid of accents and their tints,
 * none of which is ranked, and the order a host invents decides what a two- or five-series chart
 * looks like. The order Office itself lists its accents in puts two blues four slots apart, so a
 * five-series chart following that list gives two of its series nearly the same colour - which
 * reads as one series.
 *
 * NEVER USE THIS ON AN AUTHORED ORDER. A report theme's slot order is somebody's decision, and
 * `buildPalette` exists to honour it verbatim; re-sorting it here would override the author with
 * arithmetic. This is only for a pool a host assembled itself.
 *
 * The method is greedy max-min (the farthest-point walk used for categorical colour sets): keep
 * the lead, then repeatedly take the pool colour whose NEAREST already-chosen colour is farthest
 * away, by CIEDE2000. Two properties follow and the tests pin both. The distance each pick adds is
 * never larger than the one before it, so the early slots, which every chart uses, are the best
 * separated. And every input colour is returned unchanged, so the palette is still the surface's
 * own colours, only re-ordered.
 *
 * Deterministic: ties go to the colour listed earlier in the pool. Duplicates (case-insensitive)
 * and anything that is not `#rgb` / `#rrggbb` are dropped, because a colour that cannot be
 * measured cannot be placed. A blank or unmeasurable lead means "start from the pool's first
 * colour". Feed the result to `buildPalette`, which still guarantees the minimum separation when
 * two pool colours are too close to share a legend.
 */
export function orderMostDistinct(lead: string | null | undefined, pool: readonly string[]): string[] {
    const seen = new Set<string>();
    const valid: string[] = [];
    const take = (c: unknown): void => {
        const s = typeof c === "string" ? c.trim() : "";
        // deltaEHex is NaN exactly when the string does not parse, so measuring a colour
        // against itself is the parse test, with no second grammar to keep in step.
        if (!s || !Number.isFinite(deltaEHex(s, s))) return;
        const key = s.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        valid.push(s);
    };
    take(lead);
    for (const c of pool ?? []) take(c);
    if (!valid.length) return [];

    const out = [valid[0]];
    const rest = valid.slice(1);
    // nearest[i] = distance from rest[i] to the closest colour already chosen. Updated
    // incrementally, because choosing one colour can only shrink it.
    const nearest = rest.map(c => deltaEHex(c, out[0]));
    while (rest.length) {
        let best = 0;
        for (let i = 1; i < rest.length; i++) if (nearest[i] > nearest[best]) best = i;
        const picked = rest.splice(best, 1)[0];
        nearest.splice(best, 1);
        out.push(picked);
        for (let i = 0; i < rest.length; i++) nearest[i] = Math.min(nearest[i], deltaEHex(rest[i], picked));
    }
    return out;
}

/**
 * Deterministic spare colours for when the seed's own neighbourhood is used up.
 *
 * AN ACHROMATIC SEED HAS NOTHING TO WALK, which is the case the visual never met. A workbook's
 * accent can perfectly well be black, white or a grey header fill, and on those colorsea reports
 * hue as NaN and `saturate()` / `spin()` are both no-ops - so the walk's steps 2 and 4 do
 * nothing at all and only the lightness step moves, yielding four greys and then repeats.
 * Power BI never exposed this because it hands the visual a different theme colour per slot.
 *
 * So this sweeps hue explicitly, at a saturation and lightness the seed only *influences*.
 * Hue varies fastest because that is what the eye separates fastest, and every value is clamped
 * into the band where a chart mark stays legible on both a white and a dark page - a near-white
 * or near-black mark is invisible against one of them, which is a worse outcome than being
 * off-theme.
 */
/**
 * A seed as a usable string, or "".
 *
 * Deliberately NOT a hex validator. Hosts hand back whatever their colour API returns and
 * colorsea accepts several notations; rejecting anything that is not `#rrggbb` here would
 * silently drop a colour the host meant, which is the failure this whole module is about.
 */
function normalise(seed: string | null | undefined): string {
    return typeof seed === "string" ? seed.trim() : "";
}

function sweepCandidates(seedHex: string): string[] {
    const [h, s, l] = colorsea(seedHex).hsl();
    const baseHue = Number.isFinite(h) ? h : 210;
    const baseSat = s < 25 ? 62 : Math.min(90, s);
    const baseLight = l < 25 || l > 78 ? 52 : l;
    const out: string[] = [];
    for (const dl of [0, -16, 16, -30, 30]) {
        const li = Math.min(78, Math.max(26, baseLight + dl));
        for (let k = 1; k <= 12; k++) {
            out.push(colorsea.hsl((baseHue + k * 30) % 360, baseSat, li).hex());
        }
    }
    return out;
}
