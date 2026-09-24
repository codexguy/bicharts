// CLIENT IDENTITY - ONE FINGERPRINT RECIPE FOR EVERY BROWSER HOST.
//
// The service keys three things on the client id a host sends: distinct-user reporting, chart variety (it avoids the
// chart types the same person just saw) and its unpaid rate limits. A host that can keep a minted id durably sends that.
// A host that cannot - the Power BI visual, and the Excel add-in when its storage is not durable - derives one by
// fingerprinting the browser with ThumbmarkJS, and the options below decide how long that id lives:
//
//   * the user agent and the parsed browser version are EXCLUDED. Both change with every browser release, so a
//     fingerprint that hashes them mints a new id for the same person roughly once a month;
//   * fonts are excluded (slow to probe, and noisy across font installs);
//   * logging is OFF. The library's default posts the fingerprint and every component to its vendor on a small share of
//     calls, with a once-per-session guard that never holds where sessionStorage is stubbed out.
//
// The browser NAME stays: one person in two browsers costs one extra id, never two people sharing one. Each host injects
// the library itself, so this package takes no dependency on it - it only states the options and reads the result.

/** Where a host's client id came from, reported on every request so identity durability is measured, not guessed.
 *  `persisted`: a minted id the host keeps; `fingerprint`: derived from the browser; `session`: neither was available,
 *  so the id lives for this session only. */
export type ClientIdSource = "persisted" | "fingerprint" | "session";

/** ThumbmarkJS options shared by every browser host. A fresh object each call, so no host can mutate another's. */
export function stableFingerprintOptions(): { exclude: string[]; logging: boolean } {
    return { exclude: ["fonts", "system.useragent", "system.browser.version"], logging: false };
}

// FNV-1a, 32 bit: small, dependency-free, and stable across runtimes - enough to tell one component value from another.
function fnv1a(text: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}

/**
 * A short digest of each fingerprint component - `name:xxxx` joined by commas, in the library's own order - so a log
 * line can say WHICH input moved when a host's fingerprint changes (the id alone cannot). A component the library gave
 * up on (it times out after a few seconds and reports `{timeout: "true"}`) reads `name:timeout`, because a timed-out
 * component alone changes the fingerprint. Opaque to every source value: 16 bits of a hash per component.
 */
export function fingerprintComponentDigest(components: Record<string, unknown> | null | undefined): string {
    if (!components || typeof components !== "object") return "";
    const parts: string[] = [];
    for (const [name, value] of Object.entries(components)) {
        const timedOut = !!value && typeof value === "object" && (value as Record<string, unknown>).timeout === "true";
        let text: string;
        try { text = JSON.stringify(value) ?? "undefined"; } catch { text = String(value); }
        parts.push(`${name}:${timedOut ? "timeout" : (fnv1a(text) >>> 16).toString(16).padStart(4, "0")}`);
    }
    return parts.join(",");
}
