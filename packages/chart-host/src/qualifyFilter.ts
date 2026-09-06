// A NAME FILTER OVER THE "WHAT FITS?" LIST, and the two predicates that decide whether a host
// has room to offer one (2026-09-03).
//
// THE PROBLEM IS SIZE, AND IT IS MEASURED. The catalogue carries 108 active chart types; the
// per-type projection cap left one measured modal at 137 rows; and the refusal block behind
// "Show all chart types" puts the remainder of the catalogue on the same surface. A reader who
// already knows the word - "I want the Gantt" - had no way to say it, because the full-catalogue
// dropdown that used to let them was deliberately removed when the modal became the menu.
//
// THIS IS A FILTER, NOT A SEARCH, and the distinction is the whole contract. The server sorts by
// the picker's own chart-type score, and both hosts carry an explicit "order as received" rule
// because re-sorting throws the answer away. Everything here HIDES rows. Nothing reorders,
// re-ranks or renumbers them, and a filtered list showing 1., 7., 23. is correct: those numbers
// are what tells the reader the survivors are still ranked against everything else.
//
// WHY IT IS SHARED RATHER THAN A HOST IDIOM. Three surfaces have to answer "does 'gan' match this
// row" identically - the visual's modal, the add-in's inline panel and the MCP tool's
// `name_filter` - or the product finds a chart in one host and not in another, which is the class
// of drift nobody notices from inside any one of them. There is no host or renderer specificity
// in string matching, so there is no reason for it to live anywhere else.

/**
 * The comparison form of a term or a field.
 *
 * Accent folding is not decoration. The catalogue is English, but the reader's keyboard need not
 * be, and a "Sankey" typed through a dead key has to match the same row a plain one does. NFD
 * splits a composed character into base + combining marks and the range strip removes the marks,
 * which is the whole of it - no transliteration, no stemming, nothing that could make two
 * different chart names collide.
 *
 * Whitespace is collapsed rather than stripped: "bar chart" and "bar  chart" are the same query,
 * but "barchart" is deliberately NOT one. A reader who omits the space is asking for something we
 * do not have a name for, and silently succeeding there would make the failures inexplicable.
 */
export function normalizeFilterTerm(raw: string | null | undefined): string {
    if (typeof raw !== "string" || raw === "") return "";
    return raw
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * THE SHORTEST TERM THAT FILTERS. One character matches most of a 108-row catalogue, so the
 * list would flicker through a near-identity pass and teach the reader nothing; below this the
 * list is returned untouched and the host hides its counter.
 */
export const FILTER_MIN_TERM_CHARS = 2;

/**
 * WHICH TIER ANSWERED - the host needs this, not just the rows.
 *
 * "all"      - no term (or too short). The rows are the input, unfiltered.
 * "name"     - the term starts a WORD in at least one name. Every lower tier is suppressed.
 * "namePart" - it appears mid-word in a name, and nowhere at a word start.
 * "desc"     - no name matched at all, so the description fallback answered. THE HOST SAYS SO.
 * "none"     - nothing matched anywhere.
 *
 * A HOST ONLY HAS TO ANNOUNCE "desc". The first two are both name matches and need no
 * explanation; the third is the one a reader would otherwise read as broken matching.
 */
export type QualifyFilterTier = "all" | "name" | "namePart" | "desc" | "none";

export interface QualifyFilterResult<T> {
    rows: T[];
    tier: QualifyFilterTier;
    /** The normalized term actually applied. Empty when the tier is "all". */
    term: string;
}

/** How to read a row's two searchable fields. Kept as a callback because the fitting rows and
 *  the refused rows carry different field names and must not need two copies of this logic. */
export type QualifyFilterRead<T> = (row: T) => { name?: string | null; description?: string | null };

/**
 * DOES `t` START A WORD IN `name`? Both already normalized.
 *
 * THE TEST THAT FOUND THIS (2026-09-03): "gan" matched `Organization chart`, because plain
 * substring does not know that "gan" is buried in "or-GAN-ization". The acceptance case for this
 * feature is that typing "gan" finds the Gantt chart, and a filter that also returns an org chart
 * has technically obeyed and practically failed - the reader learns not to trust the box.
 *
 * A word starts at position 0 or after any non-alphanumeric character, which is what the
 * catalogue's names are actually punctuated with: spaces, parentheses and hyphens
 * ("Pair plot (scatter matrix)", "Bivariate USA Choropleth (by state)"). Scanning for the term
 * rather than splitting into words is deliberate - a multi-word term like "bar ch" then works
 * with no extra case.
 */
function startsAWord(name: string, t: string): boolean {
    for (let i = name.indexOf(t); i >= 0; i = name.indexOf(t, i + 1)) {
        if (i === 0) return true;
        const prev = name.charCodeAt(i - 1);
        const alnum = (prev >= 97 && prev <= 122) || (prev >= 48 && prev <= 57);
        if (!alnum) return true;
    }
    return false;
}

/**
 * Filter `rows` by `term`, PRESERVING INPUT ORDER EXACTLY in every branch.
 *
 * THREE TIERS, AND THE FIRST NON-EMPTY ONE WINS OUTRIGHT. That single rule is what makes this
 * feel like a name filter instead of a search box:
 *
 *   1. the term starts a WORD in the name    - "gan" -> Gantt chart, and NOT Organization chart
 *   2. it appears mid-word in the name       - "eth" -> Choropleth, which tier 1 cannot reach
 *   3. it appears in the description         - "hierarchy" -> Organization chart
 *
 * Typing "time" returns `Time series plot` and NOT the dozen types whose descriptions happen to
 * say "over time", which is what a flat name-or-description match produces and which reads,
 * correctly, as broken.
 *
 * The description tier exists so a reader who types a word we carry in no NAME still finds
 * something rather than an empty list, and it fires only when both name tiers are empty. When it
 * fires the host has to say so ("No name matches - showing types whose description mentions
 * 'stacked'"): an unannounced fallback is indistinguishable from bad matching. The two NAME tiers
 * need no announcement - both are the reader's own word, found where they expected it.
 *
 * A row with no name is dropped from every tier. It cannot be labelled, so it cannot be chosen,
 * and the hosts already drop it at render time.
 */
export function filterQualifyRows<T>(
    rows: readonly T[] | null | undefined,
    term: string | null | undefined,
    read: QualifyFilterRead<T>,
): QualifyFilterResult<T> {
    const all = Array.isArray(rows) ? rows.slice() : [];
    const t = normalizeFilterTerm(term);
    if (t.length < FILTER_MIN_TERM_CHARS) return { rows: all, tier: "all", term: "" };

    const atWordStart: T[] = [];
    const midWord: T[] = [];
    const byDesc: T[] = [];
    for (const row of all) {
        const f = read(row);
        const name = normalizeFilterTerm(f.name);
        if (name === "") continue;
        if (name.indexOf(t) >= 0) {
            (startsAWord(name, t) ? atWordStart : midWord).push(row);
            continue;
        }
        if (normalizeFilterTerm(f.description).indexOf(t) >= 0) byDesc.push(row);
    }
    if (atWordStart.length > 0) return { rows: atWordStart, tier: "name", term: t };
    if (midWord.length > 0) return { rows: midWord, tier: "namePart", term: t };
    if (byDesc.length > 0) return { rows: byDesc, tier: "desc", term: t };
    return { rows: [], tier: "none", term: t };
}

/** Reads a fitting row (`charts[]`): `name` / `description`.
 *
 *  GENERIC, and it has to be. Written as a `const` with an explicit `QualifyFilterRead<{...}>`
 *  annotation it PINS the row type, and `filterQualifyRows` then infers T from the reader instead
 *  of from the rows - so a caller passing its own richer row type gets back an array typed as the
 *  reader's minimal shape and fails to assign it home. Caught by the MCP tool, which passes
 *  `EligibleChart[]` and got `{name?, description?}[]` back. */
export function readQualifyChartRow<T extends { name?: string | null; description?: string | null }>(
    r: T,
): { name?: string | null; description?: string | null } {
    return { name: r.name, description: r.description };
}

/**
 * Reads a REFUSED row (`refused[]`). Its second field is the gate's SENTENCE rather than a
 * description, and searching it is right for the same reason the tier exists: the sentence names
 * the reader's own columns, so "region" finding every type refused over Region is a useful
 * answer to "why isn't my chart here" - which is the only question that section is open to ask.
 */
export function readQualifyRefusalRow<T extends { name?: string | null; reason?: string | null }>(
    r: T,
): { name?: string | null; description?: string | null } {
    return { name: r.name, description: r.reason };
}

// ─────────────────────────────────────────────────────────────────────────────
//  IS THERE ROOM FOR THE BOX? Two conditions, and neither is guessed.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE HEIGHT THE FILTER ROW COSTS THE LIST - the row plus its 6px bottom margin.
 *
 * Measured, not assumed: 32px, and constant across all 195 tile sizes in the sweep below (the
 * row is a flex line around a 0.85em input, so it does not reflow with the card).
 */
export const FILTER_ROW_PX = 32;

/**
 * THE SMALLEST CARD THE FILTER BOX IS USABLE IN - measured 2026-09-03, and NOT arithmetic off
 * `CHOOSER_MIN_*`.
 *
 * The chooser's floor was measured with three pinned elements. The filter row is a FOURTH, in a
 * card that clips, so that envelope does not survive the addition and could not be adjusted by
 * adding 32px to it - the coupling between the two dimensions moves too.
 *
 * Same harness as the 2026-09-01 chooser sweep, re-run over 195 sizes with the row present.
 *
 * ONE CRITERION IS TIGHTER, and it is the reason this is a separate floor rather than a bigger
 * version of the old one: the chooser sweep asked for TWO visible list rows, this asks for
 * THREE. A filter that leaves two rows visible did not earn the height it cost.
 *
 * Measured envelope with the row present:
 *
 *     320-340 wide -> 380 tall      400 wide -> 300 tall      420+ wide -> 280 tall
 *
 * 420 x 300 is that envelope at its cheapest width, with one sweep step (20px) of margin on the
 * height for the reason `CHOOSER_MIN_*` states: the measurement used one font stack and one
 * string, every host localizes the title, and a longer translation wraps sooner than the sample.
 *
 * ⚠ THIS FLOOR INHERITED THE CHOOSER SWEEP'S DEFECT, AND HAS NOT BEEN RE-MEASURED (2026-09-04).
 * This comment used to argue that reproducing the chooser's published coupling when the row is
 * hidden (320-340 wide needs 280 tall, 360-380 needs 260, 400+ needs 220) proved the harness was
 * measuring the same card. It proved the two sweeps SHARED A CARD, which is a different claim,
 * and the re-measure behind `CHOOSER_MIN_*` shows the card they shared was not the one the
 * product draws: rows were sized without the DESCRIPTION each one carries, so a row measured
 * ~22px against a real 48. Every "N visible rows" number on both sweeps is therefore about twice
 * as generous as the screen, and this floor's criterion is the tighter one, so it is the more
 * affected of the two.
 *
 * IT IS LEFT ALONE ON PURPOSE, because the fix is not a re-run. Re-measuring "three visible rows"
 * against 48px rows pushes this floor past any tile a report actually uses, which would retire a
 * just-shipped control rather than place it. THE OPEN QUESTION IS THE CRITERION, NOT THE NUMBER:
 * "three visible rows" was a proxy for "the reader can still skim the list", and on a card whose
 * rows are twice as tall it no longer describes that. A plausible replacement is its inverse -
 * offer the filter precisely once the list has STOPPED being skimmable, which is nearer to what
 * a reader reaches for a filter box for. Settle that before re-deriving this constant.
 *
 * NOTE THE FRAME, when comparing the two numbers: this floor is measured on the CARD, and
 * `CHOOSER_MIN_*` on the CONTAINER. The card is 95% of the container less 32px of padding, so
 * 420 here is about a 476px tile - the two floors are further apart than the bare numbers read.
 *
 * ERRING HIGH IS THE CHEAP DIRECTION, exactly as it is for the chooser. Below this floor the
 * reader gets the chooser they have today, unchanged; above it wrongly, they get a clipped
 * control in a card that cannot scroll to reveal it.
 */
export const FILTER_MIN_WIDTH_PX = 420;
export const FILTER_MIN_HEIGHT_PX = 300;

/**
 * Condition A: can this card afford the box at all?
 *
 * MEASURE THE REAL SURFACE - the card as drawn, never a viewport the host reports outward. The
 * chooser's gate says the same thing for the same reason: where an author can state a viewport
 * for generation purposes, that stated size describes a tile that does not exist yet.
 */
export function filterFitsChooser(width: number, height: number): boolean {
    return Number.isFinite(width) && Number.isFinite(height)
        && width >= FILTER_MIN_WIDTH_PX && height >= FILTER_MIN_HEIGHT_PX;
}

/**
 * Condition B: is the list long enough to be worth filtering?
 *
 * A filter box over four rows is clutter that spends pinned height for nothing, so the box
 * appears only when the list actually scrolls.
 *
 * THE `- FILTER_ROW_PX` IS LOAD-BEARING, and leaving it out is how the naive version ships a
 * flicker loop: inserting the box shrinks the list, which can turn a list that did not overflow
 * into one that does, which would remove the box, which restores the overflow. Asking whether the
 * content exceeds the height the list WOULD have is a single stable pass, because `scrollHeight`
 * is content height and does not change when the container shrinks.
 */
export function listNeedsFilter(scrollHeight: number, clientHeight: number): boolean {
    if (!Number.isFinite(scrollHeight) || !Number.isFinite(clientHeight)) return false;
    return scrollHeight > clientHeight - FILTER_ROW_PX;
}

/** Why the box is or is not on screen - logged once per open, so the floor can be judged against
 *  real tiles rather than only against the sweep. */
export type QualifyFilterGateReason = "shown" | "too-small" | "no-overflow";

export interface QualifyFilterGateInput {
    /** Real drawn width of the CARD, in CSS pixels. */
    cardWidth: number;
    /** Real drawn height of the card. */
    cardHeight: number;
    /** The list's content height and its current viewport height. */
    scrollHeight: number;
    clientHeight: number;
}

/**
 * Both conditions, and the reason - which the host logs whichever way it comes out.
 *
 * DECIDED ONCE PER OPEN. Neither host re-asks this while the dialog is up: not when the filter
 * hides rows and the list stops overflowing (a control that vanishes mid-typing is worse than one
 * that is briefly unnecessary), and not on resize (a dialog whose controls appear and disappear
 * under a window drag reads as broken).
 */
export function qualifyFilterGate(i: QualifyFilterGateInput): { show: boolean; why: QualifyFilterGateReason } {
    if (!filterFitsChooser(i.cardWidth, i.cardHeight)) return { show: false, why: "too-small" };
    if (!listNeedsFilter(i.scrollHeight, i.clientHeight)) return { show: false, why: "no-overflow" };
    return { show: true, why: "shown" };
}


// ────────────────────────────────────────────────────────────────────────────────
//  WHAT THE FILTERED LIST LOOKS LIKE - the whole answer, computed once, for both hosts.
//
//  WHY THIS IS HERE AND NOT IN EACH HOST. It was written twice, in the two hosts, before it was
//  written here, and the two copies were already the same forty lines: which rows survive, which
//  HEADINGS are left introducing nothing, whether the refusal block has to be opened because the
//  reader's term only matches down there, and which of the five things the note has to say. None
//  of that is host-specific - the visual writes `style.display` and the add-in writes `hidden`,
//  and that difference is the only difference.
//
//  It is also what makes the behaviour TESTABLE. The DOM writes are a private function over live
//  elements in each host; this is a pure function over element HANDLES of any type, so the rules
//  that actually mislead when they drift - a dangling heading, a sticky auto-expansion - can be
//  driven directly instead of asserted against source text.
// ────────────────────────────────────────────────────────────────────────────────

/** One row, as the hosts record it while BUILDING the list - the element handle plus the text it
 *  is matched on, carried beside the element rather than scraped back out of it later. */
export interface QualifyFilterRow<E> {
    el: E;
    name: string;
    description: string;
}

/** A heading and the rows it introduces, in render order. `section` separates the fitting list
 *  from the refusal block behind "Show all chart types" - two independently visible surfaces
 *  answering two different questions, and only one of them can be auto-opened. */
export interface QualifyFilterGroup<E> {
    heading: E | null;
    section: "fits" | "refused";
    rows: QualifyFilterRow<E>[];
}

/** WHICH SENTENCE THE HOST HAS TO SHOW. The host owns the words (it localizes); this owns the
 *  decision, which is the half that can differ between two hosts without anyone noticing.
 *
 *  "none"         - a name tier answered, or nothing is being filtered. Say nothing: the reader's
 *                   own word was found where they expected it and needs no explanation.
 *  "descFallback" - no name matched ANYWHERE; these matched on description. MUST be said - a
 *                   silent fall-through is indistinguishable from bad matching.
 *  "onlyRefusals" - nothing that FITS matches, but something in the refusal block does. Say where
 *                   it went; that block is now open.
 *  "descAndRefusalName" - both at once, and the state that made this a five-way rather than a
 *                   four-way decision (2026-09-04). The fitting list answered on DESCRIPTION and
 *                   the refusal block answered on a NAME, so "no name matches" is a lie told over
 *                   the top of a visible name match, and the reader's own word needs BOTH halves
 *                   said: why the rows above look unrelated, and where the row they typed went.
 *  "noMatch"      - nothing anywhere. NEVER phrase this like "nothing fits your data": one is a
 *                   statement about a typed string and is fixed with backspace, the other is a
 *                   statement about the data and is not.
 */
export type QualifyFilterNoteKind = "none" | "descFallback" | "onlyRefusals" | "descAndRefusalName" | "noMatch";

export interface QualifyFilterView<E> {
    /** Rows to show, and rows to hide. Two lists rather than one predicate so a host can write
     *  them in one pass without asking a Set per element. */
    show: E[];
    hide: E[];
    /** Headings to show, and headings that now introduce nothing. A heading with nothing under it
     *  is a label for an empty category, and the rule it draws reads as a divider between two
     *  things that are not there. */
    showHeadings: E[];
    hideHeadings: E[];
    tier: QualifyFilterTier;
    /** Matches and totals for the FITTING list - what the "12 of 137" counter is made of. */
    matched: number;
    total: number;
    refusalMatched: number;
    /**
     * Does the refusal block need to be OPEN for this term?
     *
     * True when the block holds a match the fitting list cannot show the reader. "Why isn't my
     * chart here" is the only question that section is open to ask, and the reader has just
     * asked it by name - the server's own sentence about why it cannot be drawn is already
     * rendered, one collapsed checkbox away.
     *
     * TWO WAYS TO EARN IT, and the second was missing until 2026-09-04: nothing that fits
     * matched at all, OR the only NAME match is down there while the fitting list answered on
     * description. A description match above is not a substitute for the row the reader typed -
     * it is a weaker tier, and leaving the block shut hides the actual answer behind a checkbox
     * the reader has no reason to tick.
     *
     * THE HOST MUST TREAT THIS AS AN OVERRIDE, NOT A SETTING: remember what the reader's own
     * checkbox said before the first override, and put it back the moment this goes false. An
     * auto-expansion that sticks leaves the reader with a section they never opened.
     */
    openRefusals: boolean;
    note: QualifyFilterNoteKind;
    /** The normalized term, for the host to interpolate into whichever sentence it shows. */
    term: string;
}

/**
 * The filtered view of a whole dialog: fitting rows, refusal rows, headings and the note.
 *
 * ORDER IS UNTOUCHED, as everywhere else here - `show` and `hide` come out in the order the
 * groups were built, so a host writing them in sequence cannot reorder anything by accident.
 */
export function computeQualifyFilterView<E>(
    groups: readonly QualifyFilterGroup<E>[],
    term: string | null | undefined,
): QualifyFilterView<E> {
    const g = Array.isArray(groups) ? groups : [];
    const read = (r: QualifyFilterRow<E>) => ({ name: r.name, description: r.description });
    const collect = (section: "fits" | "refused"): QualifyFilterRow<E>[] => {
        const out: QualifyFilterRow<E>[] = [];
        for (const grp of g) if (grp.section === section) for (const r of grp.rows) out.push(r);
        return out;
    };
    const fitRows = collect("fits");
    const fit = filterQualifyRows(fitRows, term, read);
    const ref = filterQualifyRows(collect("refused"), term, read);

    const visible = new Set<E>();
    for (const r of fit.rows) visible.add(r.el);
    for (const r of ref.rows) visible.add(r.el);

    const show: E[] = [], hide: E[] = [], showHeadings: E[] = [], hideHeadings: E[] = [];
    for (const grp of g) {
        let any = false;
        for (const r of grp.rows) {
            if (visible.has(r.el)) { show.push(r.el); any = true; } else { hide.push(r.el); }
        }
        if (grp.heading !== null) (any ? showHeadings : hideHeadings).push(grp.heading);
    }

    const filtering = fit.tier !== "all";
    // THE REFUSAL BLOCK'S TIER IS PART OF THE ANSWER, and reading only `fit` is how this shipped
    // wrong.
    //
    // Genesis (2026-09-04): three unrelated
    // measures bound, "tern" typed. `Ternary plot` sat on screen under "Poor fit for these
    // fields" carrying the gate's own sentence, and the line above the list read "No name
    // matches - showing types whose description mentions 'tern'". That was TRUE of the fitting
    // list on its own - matching is plain substring, so a fitting type whose description says
    // "pattern" answers on the description tier - and plainly false to a reader looking at the
    // name they typed. A weaker tier above must not silence a stronger one below.
    const nameOnlyBelow = fit.tier === "desc" && (ref.tier === "name" || ref.tier === "namePart");
    const openRefusals = filtering && ref.rows.length > 0 && (fit.rows.length === 0 || nameOnlyBelow);
    let note: QualifyFilterNoteKind = "none";
    if (filtering) {
        if (fit.tier === "desc") note = nameOnlyBelow ? "descAndRefusalName" : "descFallback";
        else if (fit.tier === "none") note = openRefusals ? "onlyRefusals" : "noMatch";
    }

    return {
        show, hide, showHeadings, hideHeadings,
        tier: fit.tier, matched: fit.rows.length, total: fitRows.length,
        refusalMatched: ref.rows.length, openRefusals, note, term: fit.term,
    };
}

/**
 * The counter beside the box: "12 of 137" while filtering, the plain total otherwise - and
 * "0 of 19 (+1)" when the term also reached the refusal block.
 *
 * Digits only, assembled here so both hosts show the same shape of number - the words around it
 * (there are none today) would be the host's business, the arithmetic is not.
 *
 * THE PARENTHESISED COUNT IS THE SAME DEFECT THE NOTE WAS ALREADY FIXED FOR, one control over.
 *
 * Genesis (2026-09-06): a card with six rows and one measure
 * bound, "box" typed. `Box plot` was on screen under "Poor fit for these fields" carrying the
 * gate's own sentence, the note said where it had gone - and the counter beside the input read
 * "0 of 19". That was TRUE of the fitting list, which is all this function had ever been given,
 * and it is read as a claim about the DIALOG: a reader who takes the number and stops has been
 * told nothing was found, three lines above the row they asked for. The same shape of error as
 * the `descAndRefusalName` note (a weaker scope silencing a stronger one), and the count it
 * needed was already being computed for the log and simply never reached the screen.
 *
 * IT FIRES ON EVERY FILTERED TERM WITH A REFUSAL MATCH, not only when the fitting list came back
 * empty - and that is deliberate, because the collapsed case is the one with no other signal at
 * all. When `openRefusals` is true the reader can see the row and the note explains it; when the
 * fitting list answered by name the block stays shut and the note stays silent (correctly - a
 * section forced open on every shared word would be noise), so this "(+1)" is the ONLY thing
 * telling them the checkbox below has something of theirs behind it.
 *
 * NEVER FOLDED INTO `matched`. "0 of 19" and the "(+1)" count two different populations - 19 is
 * the types that FIT, and the catalogue behind the checkbox is not in that denominator. Adding
 * them would produce a ratio that is true of no list on screen.
 */
export function qualifyFilterCountText(
    view: { tier: QualifyFilterTier; matched: number; total: number; refusalMatched?: number },
): string {
    if (view.tier === "all") return String(view.total);
    const below = typeof view.refusalMatched === "number" && view.refusalMatched > 0
        ? ` (+${view.refusalMatched})`
        : "";
    return `${view.matched} of ${view.total}${below}`;
}

/**
 * The same question for a host whose chooser is an INLINE, SCROLLING PANEL - and it has no size
 * clause, for the reason `shouldOpenInlineChooserOnGenerate` already sets out at length.
 *
 * THE ASYMMETRY IS THE POINT AND IT IS MEASURED. The modal lives in a card that CLIPS, so past a
 * certain smallness its controls are simply not on screen. A panel that flows inside a scrolling
 * pane, with a wrapping footer and a list carrying its own max-height, cannot reach that state -
 * swept across 63 pane sizes down to 200x120, every one stayed usable. A size clause here would
 * protect nobody and would switch the feature off in a default Excel task pane, which is narrower
 * than the modal's floor.
 *
 * The OVERFLOW half still applies: a five-row answer does not want a filter box in any host.
 */
export function inlineFilterGate(rowCount: number): { show: boolean; why: QualifyFilterGateReason } {
    return rowCount >= INLINE_FILTER_MIN_ROWS
        ? { show: true, why: "shown" }
        : { show: false, why: "no-overflow" };
}

/**
 * The inline panel's stand-in for "the list scrolls".
 *
 * A COUNT RATHER THAN A MEASUREMENT, because the panel's list carries a fixed `max-height: 220px`
 * and rows are one line each - so the count IS the overflow question there, where in the modal
 * the card's height is the variable and the count is not. Eight rows at ~24px is the point the
 * 220px list starts scrolling; below it there is nothing to scroll past.
 */
export const INLINE_FILTER_MIN_ROWS = 8;
