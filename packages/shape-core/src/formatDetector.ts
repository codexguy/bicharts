// ──────────────────────────────────────────────────────────────────────────
// Client-side format-signature detector
// ──────────────────────────────────────────────────────────────────────────
//
// Replaces `topCategoryValues` (obfuscated string samples) for String-dataType
// columns. Instead of shipping 5 class-preserving random tokens for the LLM
// to infer format-class from, we classify ONCE on the client (where the raw
// values are visible) and ship a single enum-like signature.
//
// Genesis (2026-05-27): the server's DataShapeAdvisor.IsLikelyIdColumn was
// already walking each character of the obfuscated tokens to infer "id-like"
// — that's a format-classifier in the wrong place. Obfuscation preserves
// character classes by design, so the server-side inference accidentally
// works, but the logic belongs on the client where it sees real data. Side
// benefit: no obfuscated values ship for Strings → the LLM can't hardcode
// one as a runtime filter (image-bug 2026-05-26).
//
// Signature catalog (returned values):
//   ALL_UPPER_FIXED_<n>   — every value is uppercase letters, length exactly n
//   ALL_UPPER             — uppercase-only, mixed length
//   TITLE_CASE_WORDS      — proper-name shape (e.g. "Delta Air Lines")
//   LOWER_WORDS           — lowercase-only words, often slugs / tags
//   SENTENCE_TEXT         — multi-word strings with mixed casing / punctuation
//   EMAIL_LIKE            — contains @ + a domain suffix
//   URL_LIKE              — starts with http(s):// or contains www.
//   PHONE_LIKE            — digits + parens/dashes/spaces, length 7-15
//   DATE_STR              — ISO-ish or slash-formatted dates
//   NUMERIC_ID            — all-digit strings of length ≥ 6
//   HEX_ID                — hex characters [0-9a-f]+ of length ≥ 8
//   UUID                  — 8-4-4-4-12 hex with dashes
//   OPAQUE_ID_ALPHANUMERIC — alphanumeric + dashes/underscores, no whitespace,
//                            mixed letters+digits, length ≥ 6
//   BOOLEAN               — Boolean-rendered text (True/False, Yes/No)
//   MIXED                 — distinct values don't agree on a single signature
//   OTHER                 — no signature matched (short categorical labels)
//
// Threshold: a signature is returned if ≥ 70% of the sampled distinct values
// match it. The 70% floor tolerates a few stragglers (e.g. one "TBD" in an
// otherwise ID-like column) without dropping to OTHER unnecessarily.

const SIGNATURE_FLOOR = 0.70;

// Per-value classifier. Returns the highest-specificity signature that fits
// a single value, or null if none.
function classifyOne(v: string): string | null {
    if (v === null || v === undefined) return null;
    const s = String(v);
    if (s.length === 0) return null;
    const len = s.length;

    // UUID — most specific, check first.
    if (len === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
        return "UUID";
    }

    // EMAIL — @ and a TLD-shaped suffix.
    if (/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(s)) return "EMAIL_LIKE";

    // URL — http(s):// or www.
    if (/^https?:\/\//i.test(s) || /^www\./i.test(s)) return "URL_LIKE";

    // PHONE — digits with separators, total digit count 7-15.
    if (/^[+\d][\d\s().\-]{5,17}\d$/.test(s)) {
        const digitCount = (s.match(/\d/g) || []).length;
        if (digitCount >= 7 && digitCount <= 15) return "PHONE_LIKE";
    }

    // DATE — ISO-ish or common slash/dash formats.
    if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?Z?)?$/.test(s)) return "DATE_STR";
    if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(s)) return "DATE_STR";

    // BOOLEAN — common text renderings.
    if (/^(true|false|yes|no|t|f|y|n)$/i.test(s)) return "BOOLEAN";

    // NUMERIC_ID — long all-digit (short ones are codes / years / ordinals).
    if (/^\d+$/.test(s)) {
        if (len >= 6) return "NUMERIC_ID";
        return null; // short numeric → falls through to OTHER
    }

    // HEX_ID — hex characters only, length ≥ 8.
    if (len >= 8 && /^[0-9a-f]+$/i.test(s)) return "HEX_ID";

    // ALL_UPPER — uppercase letters and digits, no spaces (codes / abbreviations).
    if (/^[A-Z][A-Z0-9]*$/.test(s) && !/^\d+$/.test(s)) {
        // Caller aggregates by length to decide ALL_UPPER_FIXED_n vs ALL_UPPER.
        return "ALL_UPPER";
    }

    // OPAQUE_ID — alphanumeric + dashes/underscores, no whitespace, has BOTH
    // letters and digits. Length ≥ 6 to skip short tokens like "A1" / "Q2".
    if (len >= 6 && /^[A-Za-z0-9_-]+$/.test(s) && /\d/.test(s) && /[A-Za-z]/.test(s)) {
        return "OPAQUE_ID_ALPHANUMERIC";
    }

    // Words-and-text classifiers (whitespace OK).
    // SENTENCE_TEXT — multi-word with mixed casing OR punctuation.
    const wordCount = s.trim().split(/\s+/).length;
    const hasInternalPunct = /[.!?,;:]/.test(s);
    if (wordCount >= 2) {
        if (hasInternalPunct || /[a-z][A-Z]/.test(s) || s.length > 40) return "SENTENCE_TEXT";
        // Multi-word, no internal punct, ≤ 40 chars — check casing.
        if (/^[A-Z]/.test(s) && /\b[A-Z][a-z]+/.test(s)) return "TITLE_CASE_WORDS";
        if (/^[a-z]/.test(s) && !/[A-Z]/.test(s)) return "LOWER_WORDS";
        return "SENTENCE_TEXT";
    }

    // Single word.
    if (/^[A-Z][a-z]+$/.test(s)) return "TITLE_CASE_WORDS";
    if (/^[a-z]+$/.test(s)) return "LOWER_WORDS";

    return null;
}

export function detectFormatSignature(values: string[]): string {
    if (!values || values.length === 0) return "OTHER";

    const counts = new Map<string, number>();
    const lengthBySig = new Map<string, Set<number>>();
    let classified = 0;

    for (const v of values) {
        const sig = classifyOne(v);
        if (!sig) continue;
        classified++;
        counts.set(sig, (counts.get(sig) || 0) + 1);
        if (!lengthBySig.has(sig)) lengthBySig.set(sig, new Set());
        lengthBySig.get(sig)!.add(String(v).length);
    }

    if (classified === 0) return "OTHER";

    // Pick the dominant signature.
    let topSig: string | null = null;
    let topCount = 0;
    for (const [sig, count] of counts.entries()) {
        if (count > topCount) {
            topCount = count;
            topSig = sig;
        }
    }
    if (!topSig) return "OTHER";

    const dominance = topCount / values.length;
    if (dominance < SIGNATURE_FLOOR) return "MIXED";

    // ALL_UPPER_FIXED_n specialization. If every classified-as-ALL_UPPER value
    // shares the same length, emit ALL_UPPER_FIXED_<n>. Otherwise plain
    // ALL_UPPER. The product spec (2026-05-27): "use n instead of hardcoding 2/3".
    if (topSig === "ALL_UPPER") {
        const lens = lengthBySig.get("ALL_UPPER")!;
        if (lens.size === 1) {
            const n = lens.values().next().value;
            return `ALL_UPPER_FIXED_${n}`;
        }
    }

    return topSig;
}
