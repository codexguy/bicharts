// BUILDING A GENERATE REQUEST, ONE CONCERN AT A TIME.
//
// Every host builds its own generate request - the Power BI visual from its format pane, the Excel
// add-in from its task pane, the MCP server from a tool call's arguments - and most of what each
// one sends is its own: its settings, its credentials, its identity. What is the SAME rule in every
// host lives here, as a function that returns the fields it owns. Each host places them where it
// always placed them, so a request serialises to the same bytes before and after a concern moves.
//
// A concern moves here only when every host already applies the same rule. Where hosts send
// different values for one field, that difference is a decision, not a refactor, and it stays in
// the hosts until it is made.

import type { ViewportSource } from "./host/services";

/** The two places a generate request states its drawing area, in the order they travel. */
export interface ViewportFields {
    /** The request's own `height` and `width`. */
    request: { height: number; width: number };
    /** The client hints' `viewportWidth` and `viewportHeight`. */
    hints: { viewportWidth: number; viewportHeight: number };
}

/**
 * THE VIEWPORT A REQUEST IS SIZED FOR: one measurement, stated twice.
 *
 * A generate request carries its drawing area in two places - the request's `width`/`height` and
 * the client hints' `viewportWidth`/`viewportHeight` - and the server reads each in a different
 * place (the chart gates on one side, the prompt's size guidance on the other). If they disagree,
 * the server's two readers are told two different sizes for the same chart. So the source is
 * measured ONCE per call and both halves come from that one answer.
 *
 * The numbers are the source's, unchanged: a host that rounds, clamps or substitutes a stated size
 * for a measured one does it in its source, where it knows why.
 */
export function viewportFields(source: ViewportSource): ViewportFields {
    const { width, height } = source.measure();
    return {
        request: { height, width },
        hints: { viewportWidth: width, viewportHeight: height },
    };
}
