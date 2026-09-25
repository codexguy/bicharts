// COMPILE-TIME ONLY - included by this package's tsconfig.json, so `npm run typecheck` (run by
// every release) fails when the wire interfaces restated in src/host/services.ts stop being
// shape-core's, member for member. Restated rather than imported because a published
// declaration must not name the bundled shape-core; see src/host/services.ts.
import type * as Ours from "../../src/host/services";
import type * as Theirs from "@bicharts/shape-core";

/** Resolves to true only when A and B are each assignable to the other. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export const wireServicesParity: {
    signer: Same<Ours.WireSigner, Theirs.WireSigner>;
    response: Same<Ours.WireResponse, Theirs.WireResponse>;
    // Mutual assignability cannot see an OPTIONAL member restated on one side only; the key sets can.
    responseKeys: Same<keyof Ours.WireResponse, keyof Theirs.WireResponse>;
    transport: Same<Ours.WireTransport, Theirs.WireTransport>;
    triple: Same<Ours.CredentialTriple, Theirs.CredentialTriple>;
    credentials: Same<Ours.CredentialSource, Theirs.CredentialSource>;
    viewport: Same<Ours.ViewportSource, Theirs.ViewportSource>;
    clock: Same<Ours.Clock, Theirs.Clock>;
    entry: Same<Ours.DiagnosticEntry, Theirs.DiagnosticEntry>;
    sink: Same<Ours.DiagnosticsSink, Theirs.DiagnosticsSink>;
    renderer: Same<Ours.RendererId, Theirs.RendererId>;
    // HostServices carries every WireServices member with the same optionality.
    wireHalf: Same<Pick<Ours.HostServices, keyof Theirs.WireServices>, Theirs.WireServices>;
} = {
    signer: true, response: true, responseKeys: true, transport: true, triple: true, credentials: true,
    viewport: true, clock: true, entry: true, sink: true, renderer: true, wireHalf: true,
};
