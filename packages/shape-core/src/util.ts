// Package-owned pure utilities. These were previously reached via the visual's
// `lib/shared/Shared` (a large, PBI/DOM-coupled grab-bag); shape-core copies only
// the three pure functions the profiler needs so the package has NO dependency
// back into the visual. Keep these byte-equivalent to Shared's versions — the
// visual and the MCP client must profile identically. (If Shared's versions ever
// change, mirror the change here; a divergence would make the two hosts disagree.)

/** Null/undefined-safe stringify. Mirrors Shared.STR. */
export function STR(v: any): string {
    if (v !== undefined && v !== null) {
        return v.toString();
    }
    return "";
}

/** FNV-1a string hash masked to a JS-safe 53-bit integer. Mirrors
 *  Shared.SIMPLE_STRING_HASH. Deterministic — safe for stable keys. */
export function SIMPLE_STRING_HASH(str: string): number {
    if (!str) return 0;

    const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
    const FNV_PRIME = 0x100000001b3n;

    let hash = FNV_OFFSET_BASIS;

    for (let i = 0; i < str.length; i++) {
        hash ^= BigInt(str.charCodeAt(i));
        hash = (hash * FNV_PRIME) & 0xFFFFFFFFFFFFFFFFn; // Keep it within 64 bits
    }

    return Number(hash & 0x1FFFFFFFFFFFFFn); // Mask to JS safe integer (53 bits)
}

/** Uniform [0,1). Mirrors Shared.GET_RANDOM. Used ONLY by the sample-obfuscation
 *  path, never by stat/shape derivation — so the emitted SHAPE stats stay
 *  deterministic across runs and across hosts even though the obfuscated sample
 *  text does not. Prefers Web Crypto (browser + Node >=19 expose globalThis.crypto);
 *  falls back so the package never throws in a bare runtime. */
export function GET_RANDOM(): number {
    const g: any = (typeof globalThis !== "undefined") ? globalThis : {};
    if (g.crypto && typeof g.crypto.getRandomValues === "function") {
        const array = new Uint32Array(1);
        g.crypto.getRandomValues(array);
        return array[0] / (0xFFFFFFFF + 1);
    }
    // Last-resort fallback (no Web Crypto present). Obfuscation-only, so a weaker
    // source is acceptable here; stat derivation never reaches this.
    return Math.floor(Date.now() % 0xFFFFFFFF) / (0xFFFFFFFF + 1);
}

/**
 * Is this generate answer a VERDICT the server reached before any model ran - so that asking
 * again returns the same answer at the same price of nothing?
 *
 * The one rule, in one place, for every host with a retry loop. The Power BI visual used to
 * treat every non-empty errorMessage as a transient server error and re-send one refused
 * explicit pick three times per click; the MCP client refused to retry such an answer only by
 * omission (isServiceError was false). The server now says it on the wire as `isRefusal`, and
 * this predicate is the only thing a host needs to consult. Strict: only an explicit `true`
 * counts, so an older server (no field) and a transient failure both read as "not a verdict".
 */
export function isDeterministicRefusal(r: { isRefusal?: boolean | null } | null | undefined): boolean {
    return !!r && r.isRefusal === true;
}
