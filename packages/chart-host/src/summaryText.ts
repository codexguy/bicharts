// THE CHART'S DESCRIPTION AND THE GENERATION WARNING ARE ONE TEXT, AND THEY RAN TOGETHER
// (2026-08-31).
//
// Every host tells the reader two things about a generated chart: the model's one-line
// description of what it drew, and - when the chart on screen is NOT the chart that was asked
// for - the warning that says so. They are shown in the same place, one after the other, and
// joining them with a single space produced this:
//
//     "...cumulative quarterly revenue contributions with connector lines and total
//      bar Warning: your requested chart type wasn't used: a streamgraph needs..."
//
// which reads as one run-on sentence on first pass - "total bar Warning" scans as a noun
// phrase, and the reader has to back up to find where the description ended. The warning is the
// sentence saying the chart on screen is not the chart that was asked for; it should not have to
// be excavated from the end of the description.
//
// So: close the sentence when the model did not. Terminal punctuation the model DID supply is
// left alone - including ':' and ';', which some descriptions end on before a detail clause -
// and a description that is blank or absent contributes no separator at all.
//
// THE String() ON THE DESCRIPTION IS NOT COSMETIC. A host with a service error to report sets
// the description to null, and a `!== ""` test passes for null, so a null description with a
// live warning concatenated the literal string "null " in front of it.
//
// THE WARNING LEG IS TRIMMED. A whitespace-only warning is not a warning; without the trim, a
// bare "Warning: " was appended with nothing after it. One test for "is there a warning",
// shared by this text and by whatever each host does to put it on screen.
//
// WHY THIS IS SHARED. Three hosts show this pair - a hover panel over a tile, a task-pane status
// bar, and a tool result - and where one sentence ends and the next begins is exactly the kind
// of one-line rule that gets rewritten slightly differently in each of them. The words around
// it are per host; this join is not.

/**
 * Join a chart's description and its generation warning into one readable text.
 *
 * Either may be absent. Returns "" when both are, so a caller can use the result itself as the
 * test for "is there anything to show".
 */
export function composeSummaryText(
    codeSummary: string | null | undefined,
    warningMsg: string | null | undefined,
): string {
    let sumText = String(codeSummary ?? "");
    if (String(warningMsg ?? "").trim() !== "") {
        sumText = sumText.replace(/\s+$/, "");
        if (sumText !== "") {
            sumText += /[.!?:;]$/.test(sumText) ? " " : ". ";
        }
        sumText += "Warning: " + warningMsg;
    }
    return sumText;
}
