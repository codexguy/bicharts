// WHICH COLUMNS MUST THIS CHART'S CODE FIND? - the scanner behind a host's "the fields changed"
// guard for cached chart code.
//
// A host keeps cached generated code and re-runs it when the reader's fields change. The data
// contract is `columns: [{ name, ... }]`, and generated code resolves an index by name
// (`columns.findIndex(c => c.name === 'Region')`). When that column is gone the lookup returns -1
// and the chart draws garbage (undefined facets and axes) WITHOUT throwing, so no error path ever
// sees it. The host asks this scanner which of the code's hard lookups name a column that is not
// there, and says so instead of drawing.
//
// TWO THINGS THAT LOOK LIKE A HARD LOOKUP AND ARE NOT.
//
//  - AN OPTIONAL PROBE. Generated code is taught a defensive pattern:
//        const ciDate = columns.findIndex(c => c.name === 'Date');
//        ...
//        if (ciDate >= 0) { ... }
//    The code handles the column's absence by design, so a missing 'Date' breaks nothing. Treating
//    every `.name === 'X'` literal as a dependency blocked a fresh, correct chart one second after
//    it was generated (the reader's fields carried Year/Quarter/Month/Day and no 'Date'). A name is
//    only a HARD dependency when the code shows NO -1-awareness for the variable that captured the
//    lookup.
//
//  - A DATA-VALUE COMPARISON. `.name` is not only a column property - hierarchy code compares
//    NODE names too, e.g. a pass that relabels a group's single-member 'Other' bucket:
//        if (leaf.name === 'Other' && leaf.otherMembers.size === 1) { ... }
//    Read as a column lookup, that reported a missing column named 'Other' and spent a whole
//    second generation on implementation style. So a `.name === 'X'` match only counts as a
//    COLUMN reference when its own statement reads the columns collection (`columns` / `cols` /
//    `column` between the statement start and the match) - the form every taught probe uses. A
//    receiver with no columns provenance in its statement is a data-value comparison and is
//    ignored.
//
// FAIL-OPEN BY DESIGN. Misclassifying a real column probe as data (rare aliasing like
// `const flds = data.columns`) only reverts to the pre-guard behaviour for that name;
// misclassifying data as a column BLOCKS a correct chart and spends a paid generation - strictly
// worse.

// Escape a column name for embedding in a RegExp.
function rxEscape(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Tokens that mark a statement as reading the COLUMNS collection. Deliberately
// precise (`\b` word bounds, no substring matching) so `color(...)` /
// `colorMaps` in the window can never qualify a data-value comparison.
const COLUMNS_TOKEN = /\b(?:columns|cols|column)\b/i;

// True when the `.name === '<x>'` occurrence at `nameIdx` sits in a statement
// that reads from the columns collection. The statement window runs from the
// last `;` (bounded at 240 chars — generated probe statements are short) up to
// the match; newlines do NOT cut it, so multi-line findIndex chains keep their
// receiver. See the header.
export function isColumnContextRef(code: string, nameIdx: number): boolean {
    const from = Math.max(0, nameIdx - 240);
    let window = code.slice(from, nameIdx);
    const semi = window.lastIndexOf(";");
    if (semi >= 0) window = window.slice(semi + 1);
    return COLUMNS_TOKEN.test(window);
}

// True when EVERY column-context `.name === '<name>'` lookup in `code` is
// captured into a variable that the code tests for -1 / >= 0 somewhere — i.e.
// the reference is a deliberate OPTIONAL probe, not an assumed-present
// dependency. Conservative: an inline (non-assigned) lookup, or any assigned
// variable with no -1-awareness, keeps the reference HARD. Data-value
// comparisons (non-columns receiver — see isColumnContextRef and the header) are
// excluded from BOTH tallies so a `leaf.name === 'X'` compare can neither
// vouch for nor poison a real probe of the same name.
export function nameProbeIsGuarded(code: string, name: string): boolean {
    const esc = rxEscape(name);
    // `const|let|var <v> = <same statement containing> .name === '<name>'`
    // ([^;]* keeps the match within one statement).
    const asgnRe = new RegExp(
        String.raw`(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=[^;]*?\.name\s*===?\s*(['"])${esc}\2`,
        "g");
    const refRe = new RegExp(String.raw`\.name\s*===?\s*(['"])${esc}\1`, "g");
    let totalRefs = 0;
    let m: RegExpExecArray | null;
    while ((m = refRe.exec(code)) !== null) {
        if (isColumnContextRef(code, m.index)) totalRefs++;
    }
    let assigned = 0;
    while ((m = asgnRe.exec(code)) !== null) {
        // The columns token normally sits INSIDE the assignment match itself
        // (`const ci = columns.findIndex(c => c.name === ...`), which the
        // window ending at `.name` naturally includes.
        const nameIdx = m.index + m[0].lastIndexOf(".name");
        if (!isColumnContextRef(code, nameIdx)) continue;   // data-value assign — not a probe
        assigned++;
        const v = rxEscape(m[1]);
        // Any -1-awareness for the captured variable: `v >= 0`, `v > -1`,
        // `v !== -1`, `v === -1`, `v == -1`, `v != -1`.
        const guardRe = new RegExp(String.raw`\b${v}\s*(?:>=\s*0|>\s*-1|[!=]==?\s*-1)`);
        if (!guardRe.test(code)) return false;      // assigned but never checked → hard
    }
    // Guarded only when every column-context reference was an assigned+checked
    // probe. (assigned < totalRefs means at least one inline/unassigned use →
    // hard.)
    return assigned > 0 && assigned === totalRefs;
}

// Column names the code looks up BY NAME (`.name === 'X'` in a statement that
// reads the columns collection) that are (a) NOT present in `presentNames` and
// (b) NOT guarded optional probes. These are the hard references that would
// silently resolve to index -1 and render garbage. Data-value `.name`
// comparisons (hierarchy nodes, legend entries — e.g. the tail-pooling
// `leaf.name === 'Other'` relabel pass) never register: see the header.
// Host-synthesized columns the render-data builder appends AFTER the dataView: they
// are never bound fields, so treating a reference to one as "a column the user
// removed" misdiagnoses a runtime hiccup as "The fields changed" and burns a paid
// regeneration. Shared by this scanner and by a host's reading of a render error that names a
// column.
export const HOST_SYNTHETIC_COLUMNS: readonly string[] =
    ["__rowIdx__", "__geoIso__", "__geoLat__", "__geoLon__", "__geoPrecision__"];

export function missingHardColumnRefs(code: string, presentNames: Iterable<string>): string[] {
    if (!code) return [];
    const present = new Set<string>(presentNames);
    for (const s of HOST_SYNTHETIC_COLUMNS) present.add(s);   // synthetic contract columns, never in the dataView
    const referenced = new Set<string>();
    const re = /\.name\s*===?\s*(['"])([^'"]+)\1/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
        if (isColumnContextRef(code, m.index)) referenced.add(m[2]);
    }
    if (referenced.size === 0) return [];   // no name-based lookups → can't assess; don't block
    const missing: string[] = [];
    referenced.forEach(r => {
        if (present.has(r)) return;
        if (nameProbeIsGuarded(code, r)) return;   // optional probe — absence is handled
        missing.push(r);
    });
    return missing;
}

// The names a cached chart's column lookups can find: every live column name, PLUS each second
// name the index would answer to for THIS code (IndexedText.aliasesForCode). A host's render path
// already hands cached code a column under its host's pre-collapse name
// (`Sum of Sum of Revenue`) or its English aggregation name (`Sum of Volume` for a Spanish viewer's
// `Suma de Volume`), but the guard compared against live names only, so it painted the pinned
// "fields no longer match" banner over a chart that would have drawn. Asked of the code being
// checked rather than of whatever the index last armed, because the guard runs BEFORE the render
// entry arms anything.
export function guardColumnNames(
    index: { getColumns(): Array<{ name: string }>; aliasesForCode?(code: string): Array<{ alias: string }> } | null | undefined,
    code: string,
): string[] {
    if (!index) return [];
    const names = (index.getColumns() || []).map(c => c.name);
    if (!code || typeof index.aliasesForCode !== "function") return names;
    for (const a of index.aliasesForCode(code)) names.push(a.alias);
    return names;
}
