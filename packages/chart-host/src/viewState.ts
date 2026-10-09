// VIEW STATE: THE SERVICE'S HELPERS AND RULES. Published as "@bicharts/chart-host/view-state".
//
// A chart keeps its resting state (a sort, a frame, a 3D camera) in a small bag it reads from
// `options.uiState` and writes through `options.setUiState`. Where that bag lives, and which of its
// keys may outlive a redraw, a reopen or a new version of the chart, is the host's to say, through a
// ViewStateService (host/services.ts). This entry holds the plain functions around that contract.
//
// Their own entry, not the package's main one, so a host that only draws charts loads none of it: the
// main entry's eager closure is budgeted (scripts/checkEagerSize.mjs). The TYPES are exported from the
// main entry, which costs nothing at run time.

import type { ViewStateProvider } from "./contract";
import type { ViewStateService } from "./host/services";

/**
 * A service that stores nothing: a static preview, a server-side render, a thumbnail capture,
 * where remembering would be wrong rather than merely absent (a thumbnail must be the same picture
 * every time it is taken). Saying so out loud differs from passing no service at all, which leaves
 * the choice to the host. The viewing store reads `{}` always and there is no durable store.
 */
export function noopViewStateService(): ViewStateService {
    const nowhere: ViewStateProvider = { load: () => ({}), save: () => { /* deliberately nowhere */ } };
    return { viewing: nowhere, durable: null, policy: {} };
}

/**
 * Whether this host can remember a chart's view across a close and reopen. This is the one
 * definition of "remembers the view": it is derived from the service, never declared beside it, so
 * a host cannot claim it without a durable store to back the claim.
 */
export function viewStateIsDurable(service: ViewStateService | null | undefined): boolean {
    return !!service && !!service.durable;
}
