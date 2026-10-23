// COMPILE-TIME ONLY - included by this package's tsconfig.json, so `npm run typecheck` (run by every release) fails when
// the share-and-rate block that shape-core types on the status answer and the one the line reads stop being the same
// shape: a host passes `licenseStatus.shareAsk` straight to mountShareRateLine.
import type { GetLicenseStatusResult, ShareAskWire as CoreAsk, ShareTargetWire as CoreTarget } from "@bicharts/shape-core";
import type { ShareAskWire, ShareTargetWire } from "../../src/shareRate";

/** Resolves to true only when A and B are each assignable to the other. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export const shareAskWire: {
    block: Same<CoreAsk, ShareAskWire>;
    target: Same<CoreTarget, ShareTargetWire>;
    onTheStatusAnswer: Same<NonNullable<GetLicenseStatusResult["shareAsk"]>, ShareAskWire>;
} = { block: true, target: true, onTheStatusAnswer: true };
