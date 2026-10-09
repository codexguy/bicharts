// COMPILE-TIME ONLY - included by this package's tsconfig.json, so `npm run typecheck` fails when the
// view-state contract in src/host/services.ts changes shape under a host that already builds against it.
// Each @ts-expect-error below is a line that MUST be rejected; if the contract loosens until one
// compiles, the directive itself becomes the error.
import type { HostServices, PreferenceSource, ViewStateKeyPolicy, ViewStateService } from "../../src/host/services";
import { commitViewState, resolveViewState, viewStateAfterSwap } from "../../src/viewState";
import type { ViewStateProvider } from "../../src/contract";

const provider: ViewStateProvider = { load: () => ({}), save: () => {} };

// The smallest service: a viewing store and an empty policy. Everything else is optional.
export const smallest: ViewStateService = { viewing: provider, policy: {} };

// The fullest: every member a host can set.
const camera: ViewStateKeyPolicy = {
    lifetime: "durable", dropOnNewVersion: true, dropOnFreshViewing: false, durableWhen: "rememberView",
};
export const fullest: ViewStateService = {
    viewing: provider,
    durable: provider,
    policy: { camera, userStopped: { lifetime: "durable", dropOnNewVersion: false, dropOnFreshViewing: true } },
    chartKeys: { lifetime: "durable", dropOnNewVersion: true, dropOnFreshViewing: false },
    versionKey: "cameraVersion",
    durableMaxChars: 4000,
};

// A host that cannot remember across a close says so with no durable store, or with null: the same thing.
export const noDurable: ViewStateService = { viewing: provider, durable: null, policy: {}, chartKeys: null, versionKey: null, durableMaxChars: null };

// viewState is optional on HostServices, and null is legal: a host that omits it still compiles.
type WithoutViewState = Omit<HostServices, "viewState">;
export const omitted: HostServices = {} as WithoutViewState;
export const nulled: Pick<HostServices, "viewState"> = { viewState: null };
export const absent: Pick<HostServices, "viewState"> = {};
export const present: Pick<HostServices, "viewState"> = { viewState: fullest };

// The policy is closed: a lifetime outside the two, a missing flag, and a missing store are all errors.
export const badLifetime: ViewStateService = {
    viewing: provider,
    policy: {
        // @ts-expect-error "forever" is not a lifetime
        x: { lifetime: "forever", dropOnNewVersion: false, dropOnFreshViewing: false },
    },
};
// @ts-expect-error a policy entry names both drop flags
export const missingFlag: ViewStateKeyPolicy = { lifetime: "viewing", dropOnNewVersion: false };
// @ts-expect-error the viewing store is required
export const noViewing: ViewStateService = { policy: {} };
// @ts-expect-error the policy is required, even when empty
export const noPolicy: ViewStateService = { viewing: provider };

// The rules take the preference source a host already passes in HostServices (keyed on RenderOptions),
// though the key they ask for is the host's own name for its switch.
declare const hostPrefs: PreferenceSource;
export const committed = commitViewState({ a: 1 }, fullest, hostPrefs);
export const committedWithout = commitViewState({ a: 1 }, fullest);
export const committedNull = commitViewState({ a: 1 }, fullest, null);
export const resolved: Record<string, unknown> = resolveViewState(fullest, { codeVersion: 3, freshViewing: true }).bag;
export const resolvedBare: Record<string, unknown> = resolveViewState(smallest).bag;
export const swapped: Record<string, unknown> = viewStateAfterSwap(fullest, resolved);
export const outcome: "saved" | "ignored" | "too-large" = committed.outcome;
