// WHICH COLUMNS DOES THIS CHART'S CODE ACTUALLY READ?
//
// A host keeps drawing cached chart code after the reader changes the bound fields, and it warns
// when a column the chart was written for is no longer there. That warning is only true when the
// code USED the column. Readers routinely bind a field the chart never encodes (a measure the chart
// left out, a whole worksheet table of which the chart draws two columns), and removing that field
// changes nothing on screen. Telling them "the missing parts will be blank" is then false, and a
// false warning teaches people to stop reading the true one.
//
// So a host asks this before naming a column in a drift warning. Both hosts ask the same question
// through this one definition, so they cannot disagree about what counts as a use.
//
// THE RULE, AND WHY IT FAILS OPEN.
//
//  - A column is READ when its name appears in the code as a quoted string literal ('X', "X", `X`)
//    or, for a name that is a plain identifier, as a member access (.X). That covers how generated
//    code reaches a column by name in every renderer: `c.name === 'X'`, `df['X']`, `"field": "X"`,
//    `row["X"]`, `d.X`, and a Vega expression's `datum.X`.
//  - Code that picks columns by ROLE or POSITION (`columns.findIndex(c => c.isMeasure)`,
//    `df.iloc[:, 1]`, `for c in df.columns`) can depend on a column without ever naming it. No name
//    test can see that use, so for such code every column counts as read and the warning keeps
//    every name - exactly what a host said before this check existed.
//  - Empty code reads nothing: there is no chart on screen to be wrong about. A host with a
//    generation in flight decides when the code arrives.
//
// Every miss therefore errs toward the old behaviour (a warning shown), never toward silence
// about a column the chart needed. A match inside a comment or a title string also keeps the
// warning, which costs one sentence on a chart that probably mentions the field anyway.

/** True for a name that can be written as a member access (`.X`) in JavaScript or Python. */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Idioms that select a column by role, type or position rather than by name. Deliberately broad:
 * a false match only keeps a warning the host would have shown anyway.
 */
const READS_BY_ROLE_OR_POSITION = new RegExp([
    String.raw`\bisMeasure\b`,                                   // columns.find(c => c.isMeasure)
    String.raw`\bdataType\b`,                                    // columns.find(c => c.dataType === 'DateTime')
    String.raw`\bcolumns\s*\[\s*-?\d`,                           // data.columns[0], df.columns[1]
    String.raw`\.iloc\s*\[[^\]]*,`,                              // df.iloc[:, 1]
    String.raw`\.iat\s*\[`,                                      // df.iat[0, 1]
    String.raw`\bselect_dtypes\b`,                               // df.select_dtypes('number')
    String.raw`\b_get_numeric_data\b`,
    String.raw`\bis_numeric_dtype\b`,                            // [c for c in df if is_numeric_dtype(df[c])]
    String.raw`\bfor\s+\w+\s+in\s+(?:list\s*\(\s*)?df\.columns\b`, // for c in df.columns
    String.raw`\bdf\.columns\s*\.\s*(?:tolist|to_list|difference|drop)\b`,
    String.raw`\bdf\.dtypes\b`,
    String.raw`\bObject\s*\.\s*(?:keys|values|entries)\s*\(\s*(?:rows|data|df)?\s*\[\s*0\s*\]`, // Object.keys(rows[0])
    String.raw`\b(?:row|rw|r)\s*\[\s*\d+\s*\]`,                  // row[1]
].join("|"));

/**
 * Does `code` read the column `name` by name? A quoted string literal of the exact name, or a
 * member access `.name` when the name is a plain identifier. Empty code reads nothing.
 */
export function codeReadsColumn(code: string | null | undefined, name: string): boolean {
    if (!code || !name) return false;
    const n = escapeRegExp(name);
    if (new RegExp("['\"`]" + n + "['\"`]").test(code)) return true;
    return IDENTIFIER.test(name) && new RegExp("\\." + n + "(?![A-Za-z0-9_$])").test(code);
}

/** Does `code` pick any column by role, type or position, where a name test cannot see the use? */
export function codeReadsColumnsByRoleOrPosition(code: string | null | undefined): boolean {
    return !!code && READS_BY_ROLE_OR_POSITION.test(code);
}

/**
 * The subset of `names` (in their original order) that `code` may depend on - the columns a drift
 * warning can truthfully say will draw blank. Empty code gives none; code that reads columns by
 * role or position gives all of them; otherwise only the names the code reads by name.
 */
export function columnsTheCodeReads(code: string | null | undefined, names: readonly string[]): string[] {
    if (!code) return [];
    if (codeReadsColumnsByRoleOrPosition(code)) return [...names];
    return names.filter(n => codeReadsColumn(code, n));
}
