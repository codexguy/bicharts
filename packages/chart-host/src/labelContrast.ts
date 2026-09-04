/**
 * Label-contrast fail-safe — pure logic.
 *
 * MOVED HERE FROM THE POWER BI VISUAL. Every decision below was written and proven there, and
 * none of it is Power-BI-specific: the generated chart is right, the RENDER is wrong, and only
 * the host can see it. The DOM half (labelContrastDom.ts) runs after every createChartHost
 * render, so the Excel add-in and a React page get the same pass the visual has had. The
 * visual keeps its own call site (its enable tri-state and page background are host state)
 * and imports the decision from here.
 *
 * A deterministic safety net for in-mark text labels (a value/category label
 * sitting ON a coloured tile/bar/cell) whose colour the generated chart code
 * mis-judged against the mark's ACTUAL rendered fill. The classic failure
 * (an incident: channel treemap): a header band drawn at fill-opacity 0.18
 * over white reads PALE, but the code picked the label colour from the nominal
 * full-opacity dark hue → white text on a pale band, unreadable.
 *
 * This module is DOM-free so it unit-tests cleanly; the visual supplies the
 * sampled fill / opacity / current text colour from the rendered SVG and applies
 * the returned colour. Decision: composite the mark fill (× its fill-opacity)
 * over the page background, measure WCAG contrast of the CURRENT text colour
 * against that composite, and only override (to black or white, whichever wins)
 * when contrast falls below MIN_CONTRAST — so well-coloured labels are untouched.
 */
// The visual's crossfilter module supplied this; inlined so the pass has no host dependency.
function parseRGBA(c: string): [number, number, number, number] | null {
    if (typeof c !== "string") return null;
    const s = c.trim();
    const m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
    if (m) return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), m[4] !== undefined ? parseFloat(m[4]) : 1];
    let h = s.replace(/^#/, "");
    if (h.length === 3) h = h.split("").map(ch => ch + ch).join("");
    if (h.length === 6 && /^[0-9a-fA-F]{6}$/.test(h)) {
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
    }
    return null;
}

// Deliberately NOT theme/high-contrast-swapped (the high-contrast audit): these are
// the two max-contrast CANDIDATES measured against the mark's ACTUAL rendered
// fill — the pick is computed, not aesthetic, so it stays correct under any
// theme including forced high-contrast colours (where marks are fg/bg anyway
// and the winner degenerates to the opposite slot).
export const DARK_TEXT = "#111111";
export const LIGHT_TEXT = "#ffffff";
// WCAG 3:1 is the AA floor for large/bold text; in-mark data labels are small
// but bold, so 3.0 is a sensible "hard to read below this" trip point.
export const MIN_CONTRAST = 3.0;
// Background relative-luminance at/below which we PREFER white text (else black). ~0.5 sits
// well above the WCAG black/white crossover (~0.18), so saturated mid-tone tiles (red, green,
// orange, mauve) get WHITE labels — the convention, and what the generated code does — rather
// than the black that raw max-contrast would pick on them. A readability guard still overrides
// this preference if the preferred colour would fall below MIN_CONTRAST.
export const WHITE_TEXT_BG_LUM = 0.5;

// Opacity band in which a shape can serve as a label BACKDROP (a "pill" painted over the
// cell and under the text). Both ends are load-bearing:
//   - at/above PILL_OPAQUE_ALPHA it is not a pill, it IS the cell;
//   - BELOW PILL_MIN_ALPHA there is no colour to work with. A fully transparent shape is an
//     invisible HIT TARGET, not a backdrop — cross-filter code paints full-entry
//     `fill:'transparent'` rects over legends and marks precisely so they are clickable
//     while showing nothing. toRGBA maps 'transparent' AND 'none' to [0,0,0,0], so its RGB
//     is not a colour anyone chose; boosting such a shape to opacity 0.9 paints BLACK over
//     the chart (an incident: one generation — black boxes behind world-map legend
//     entries). The alpha WAS the colour.
export const PILL_MIN_ALPHA = 0.05;
export const PILL_OPAQUE_ALPHA = 0.85;

// Per-channel slack for "this backing IS the page background" (see the bgIsPage guard in
// decideLabelColor). Small on purpose: a genuinely different tile is different by far more
// than this, while a card painted with the visual's own background colour can miss the page
// value by a rounding step once opacity compositing has been through floating point.
export const PAGE_MATCH_TOLERANCE = 2;

/** True when a shape's effective alpha lets it act as a label backdrop rather than the cell. */
export function isPillBackdropAlpha(a: number): boolean {
    return a >= PILL_MIN_ALPHA && a < PILL_OPAQUE_ALPHA;
}

// A BACKDROP BACKS THE WHOLE LABEL; TOUCHING IT IS NOT BACKING IT (an incident: one generation:
// the HR card's value drew WHITE on a light card, and came back correct after two flips).
// Alpha alone said "pill", and the finder accepted ANY overlap greater than zero. On the card
// deck the big value sits directly above a translucent "vs median" chip, and the value's glyph
// box — 88px tall, descender included — grazes the chip's top edge by a pixel or two. That was
// enough: the chip was adopted as the value's backdrop, boosted to opacity 0.9 (turning a 0.14
// tint into a solid slab), composited in as a saturated red background, and the value was
// recoloured WHITE to contrast against a chip it does not sit on. The colour returned on a
// flip only because paint() rebuilds the text after the pass has run — the same tell as the
// normalize bug, and the reason both looked like one flicker.
//
// Coverage separates the two cases cleanly and without geometry-specific knowledge: a real
// backdrop is drawn AROUND its label and covers essentially all of it, while a neighbouring
// shape grazes an edge. Fraction of the GLYPH box covered, not of the shape — a large pill
// behind a short label is still a backdrop, and that is the common case.
export const PILL_MIN_COVERAGE = 0.6;

/** True when a candidate backdrop covers enough of the glyph box to be the thing behind it. */
export function pillBacksGlyph(overlapArea: number, glyphArea: number): boolean {
    if (!(glyphArea > 0) || !isFinite(overlapArea) || overlapArea <= 0) return false;
    return overlapArea / glyphArea >= PILL_MIN_COVERAGE;
}

// A MARK THAT HOLDS A MINORITY OF THE GLYPH IS NOT ITS BACKGROUND (an incident on a small-multiple progress ring: *"the color contrast sucks with the white text"*).
//
// The ring-hole rule below taught this pass that an annulus's hole is canvas, so a centre number
// sitting ENTIRELY in the hole is handed back to the chart. The STRADDLE is the other half of the
// same geometry and was still wrong. On a small-multiple ring the "180,000 of 200,000" sub-label
// is WIDER than the hole: its two ends clip the coloured arc while its middle floats over the
// page. Measured in real Chromium on that generation's own code at the tile's real size, the
// chosen cell backed 0.22–0.44 of the glyph box — and the pass repainted the WHOLE label #ffffff
// against an arc that two thirds of it is nowhere near, so the readable middle vanished into the
// white hole and only the ends survived. Half a label is worse than the dark text it replaced,
// which was legible everywhere except those same ends.
//
// So the surface a label sits on is whichever one holds MOST of it, and the PAGE is a candidate
// surface: when every shape that actually paints covers less than half the glyph between them,
// the label is on the canvas and this pass has nothing to say about it.
//
// UNION, NOT PER-SHAPE, and that distinction is the whole rule. A label overflowing a small tile
// onto its NEIGHBOURS — the Qingdao centre-miss the overlap-area rule exists for — is still
// wholly on marks, so the union clears the bar and it still flips; no single tile would have.
// Only a concavity puts real canvas under the middle of a label, which is why a ring is the shape
// that surfaced this and a treemap is not.
export const BACKING_MAJORITY = 0.5;

/** True when the painted marks under a glyph hold enough of it to count as its background. */
export function backingHoldsGlyph(backedArea: number, glyphArea: number): boolean {
    if (!(glyphArea > 0) || !isFinite(backedArea) || backedArea <= 0) return false;
    return backedArea / glyphArea >= BACKING_MAJORITY;
}

// A PANEL IS NOT A TILE, EVEN WHEN IT ISN'T THE PAGE COLOUR (an incident: second half of
// one generation: an EXPLICIT near-white card background made "fixed" jump 2 -> 72 on the same
// deck). The bgIsPage guard in decideLabelColor protects the canvas case, but the moment the
// reader picks a card fill that differs from the page by more than the tolerance, every card
// stops compositing to the page and normalize comes back on — blackening the same semantic
// colours the guard exists to protect, now BECAUSE the reader chose a colour.
//
// Normalize's justification is a DATA-coloured mark: on a tile whose fill encodes a value,
// mixed label colours read as a mistake, so unifying them is worth discarding intent. A card
// deck's panel encodes nothing — it is one uniform surface the reader (or the chart) chose —
// so on it the tile rationale never applies, at any fill. The deck contract already marks
// its panels `lch-deck-panel` (a RequiredCodeTokens entry for the lane), which makes this
// decidable from the cell alone: panel-backed labels get the check-only path — a colour that
// clears MIN_CONTRAST against the panel's ACTUAL fill survives, an illegible one is still
// recoloured. Class-string in, boolean out, so the caller stays DOM-thin and this stays
// testable.
export function cellSuppressesNormalize(cellClass: string | null | undefined): boolean {
    return typeof cellClass === "string" && /(^|\s)lch-deck-panel(\s|$)/.test(cellClass);
}

type RGB = [number, number, number];
type RGBA = [number, number, number, number];

// A few CSS keywords the chart code uses that parseRGBA (hex + rgb/rgba only)
// doesn't cover. Anything else unparseable → null (caller skips it).
const NAMED: { [k: string]: RGBA } = {
    white: [255, 255, 255, 1],
    black: [0, 0, 0, 1],
    none: [0, 0, 0, 0],
    transparent: [0, 0, 0, 0],
};

/** Parse a colour string to RGBA, covering hex, rgb()/rgba() and a few keywords. */
export function toRGBA(c: string | null | undefined): RGBA | null {
    if (typeof c !== "string") return null;
    const k = c.trim().toLowerCase();
    if (k in NAMED) return NAMED[k];
    return parseRGBA(c) as RGBA | null;
}

/** Alpha-composite a foreground RGBA over an opaque RGB background. */
export function compositeOver(fg: RGBA, bg: RGB): RGB {
    const a = Math.max(0, Math.min(1, fg[3]));
    return [
        Math.round(fg[0] * a + bg[0] * (1 - a)),
        Math.round(fg[1] * a + bg[1] * (1 - a)),
        Math.round(fg[2] * a + bg[2] * (1 - a)),
    ];
}

/** WCAG relative luminance of an opaque sRGB colour (0..1). */
export function relativeLuminance(rgb: RGB): number {
    const lin = rgb.map(v => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG contrast ratio (1..21) between two luminances. */
export function contrastRatio(l1: number, l2: number): number {
    const hi = Math.max(l1, l2);
    const lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
}

export interface LabelDecision {
    fix: boolean;      // true → caller should recolour the text
    color: string;     // the colour to apply when fix is true (else current)
    reason: string;    // short tag for diagnostics
}

/**
 * Decide whether an in-mark label needs recolouring for legibility.
 *
 * @param textColor    current text colour (any CSS form the SVG carries)
 * @param fill         the backing mark's fill colour
 * @param fillOpacity  the backing mark's fill-opacity (0..1)
 * @param pageBg       the page/visual background the mark sits on (opaque; '' → white)
 * @param minContrast  trip point; defaults to MIN_CONTRAST
 */
export function decideLabelColor(
    textColor: string | null | undefined,
    fill: string | null | undefined,
    fillOpacity: number,
    pageBg: string | null | undefined,
    minContrast: number = MIN_CONTRAST,
    // NORMALIZE : when true, always return the best-contrast black/white for
    // the background instead of leaving any label that merely CLEARS the threshold. This unifies
    // every in-mark label on a given tile to ONE colour — fixing the "readable but mixed" look
    // (city white, value black on a medium tile, where both clear 3:1) — and replaces the
    // codegen's translucent label colours with crisp opaque text.
    normalize: boolean = false,
): LabelDecision {
    const fillRGBA = toRGBA(fill);
    if (!fillRGBA) return { fix: false, color: "", reason: "fill-unparsed" };

    // Page background the mark composites onto (default white).
    const pageRGBA = toRGBA(pageBg) || ([255, 255, 255, 1] as RGBA);
    const pageRGB: RGB = [pageRGBA[0], pageRGBA[1], pageRGBA[2]];

    // Effective background = mark fill (× its own opacity × any alpha) over page.
    const effFill: RGBA = [fillRGBA[0], fillRGBA[1], fillRGBA[2], fillRGBA[3] * clamp01(fillOpacity)];
    const bgRGB = compositeOver(effFill, pageRGB);
    const bgLum = relativeLuminance(bgRGB);

    // NORMALIZE APPLIES TO A TILE, AND A CARD IS NOT A TILE (an incident: one generation:
    // "these show as black text until I flip them - then they have color").
    //
    // Normalize exists to unify the labels sitting ON a coloured tile, where "readable but
    // mixed" (city white, value black on one medium tile) looks like a mistake. Its price is
    // that it discards whatever colour the chart chose. That price is only worth paying when
    // there IS a tile: if the backing composites to the PAGE background, the text is on the
    // canvas, there is nothing to unify it with, and forcing black destroys meaning for free.
    //
    // The flippable multi-card is exactly that case, and it is what surfaced this: cards are
    // filled with the page background and the value colour IS the semantics (teal = above the
    // cohort median, orange = below). The pass reported fixed 78 of 78 scanned - a "fail-safe"
    // that corrects one hundred percent of what it inspects is not measuring anything - and
    // the colour came back on flip only because paint() recreates the text nodes after it ran.
    //
    // Below the trip point we still recolour: legibility outranks intent, on the canvas as
    // much as on a tile. This only declines to overrule a colour that already reads.
    const bgIsPage = Math.abs(bgRGB[0] - pageRGB[0]) <= PAGE_MATCH_TOLERANCE
                  && Math.abs(bgRGB[1] - pageRGB[1]) <= PAGE_MATCH_TOLERANCE
                  && Math.abs(bgRGB[2] - pageRGB[2]) <= PAGE_MATCH_TOLERANCE;
    const effNormalize = normalize && !bgIsPage;

    // Effective text colour = current text over that background (handles
    // semi-transparent label colours like rgba(255,255,255,0.85)).
    const textRGBA = toRGBA(textColor);
    if (!effNormalize && textRGBA) {
        const txtRGB = compositeOver(textRGBA, bgRGB);
        const cur = contrastRatio(relativeLuminance(txtRGB), bgLum);
        if (cur >= minContrast) return { fix: false, color: "", reason: "ok" };
    }
    // Below threshold / normalize / unparseable text → choose black or white.
    const darkC = contrastRatio(relativeLuminance(hexToRGB(DARK_TEXT)), bgLum);
    const lightC = contrastRatio(relativeLuminance(hexToRGB(LIGHT_TEXT)), bgLum);
    // Conventional pick: WHITE on dark/saturated backgrounds, BLACK on light — NOT raw
    // max-contrast (which picks black on a saturated red where white reads better and is
    // expected). Guard: never return a colour that's unreadable when the other clears the floor.
    let useLight = bgLum <= WHITE_TEXT_BG_LUM;
    if (useLight && lightC < minContrast && darkC >= minContrast) useLight = false;
    if (!useLight && darkC < minContrast && lightC >= minContrast) useLight = true;
    return useLight
        ? { fix: true, color: LIGHT_TEXT, reason: "fixed-light" }
        : { fix: true, color: DARK_TEXT, reason: "fixed-dark" };
}

// A BOUNDING BOX IS NOT A FILL (an incident: one generation — "the kpi in the center is only
// present when you hover it"). The adapter decides which shape a label sits ON by overlapping
// the glyph box with each shape's getBoundingClientRect. For a rect — a treemap tile, a heatmap
// cell, a bar — the box IS the ink, so that proxy is exact. For a RING it is not: the bounding
// box of an annulus includes the HOLE, and the hole is canvas. Every gauge, donut, progress ring
// and sunburst puts its headline number in that hole, so the number was judged to sit on the
// value arc, normalized to white against a saturated blue it is nowhere near, and disappeared
// against the white page. Measured on that generation: 4 of 4 in-mark labels repainted, the
// centre value and its measure name among them — and `fixed === scanned` is the tell this
// module already names for a pass that is not measuring anything.
//
// The sample grid is the fix's pure half: a small, evenly-spaced set of points over the glyph
// box, which the adapter hit-tests against the shape's real fill (isPointInFill) to get the
// fraction of the label a shape ACTUALLY backs. That fraction then replaces bbox-overlap as
// the metric everywhere it was already used — candidacy, the topmost-cell ranking, and
// pillBacksGlyph — so this narrows what counts as a backing without inventing a second rule.
//
// WHY A GRID AND NOT THE CENTRE POINT: centre sampling is what the overlap-area rule replaced
// (a small or overflowing label's centre lands on a tile border or gap — the Qingdao mixed
// black/white incident). A grid keeps that lesson: a label hanging off its tile still has
// several points on it, so it stays scanned and still ranks that tile first.
export const GLYPH_SAMPLE_N = 3;

/**
 * Evenly-spaced sample points over a glyph box, in the box's own coordinate space.
 * `n` per side (n² points), each at the centre of its cell so no point lands on an edge.
 */
export function glyphSampleGrid(
    box: { left: number; top: number; width: number; height: number },
    n: number = GLYPH_SAMPLE_N,
): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    if (!box || !(box.width > 0) || !(box.height > 0) || !(n >= 1)) return out;
    const k = Math.floor(n);
    for (let i = 0; i < k; i++) {
        for (let j = 0; j < k; j++) {
            out.push({
                x: box.left + box.width * (i + 0.5) / k,
                y: box.top + box.height * (j + 0.5) / k,
            });
        }
    }
    return out;
}

function clamp01(v: number): number {
    if (typeof v !== "number" || !isFinite(v)) return 1;
    return Math.max(0, Math.min(1, v));
}

function hexToRGB(hex: string): RGB {
    const p = toRGBA(hex)!;
    return [p[0], p[1], p[2]];
}
