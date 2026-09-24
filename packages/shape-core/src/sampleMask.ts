// THE OBFUSCATED SAMPLE - masking by Unicode class and script (2026-09-24).
//
// At the "Sample Data (with obfuscation)" privacy level a host ships a few rows of its data with
// every text value masked. The mask substitutes character for character, keeping the CLASS of
// each one, because the class is the signal the model needs and the letters are not: `USD-12345`
// still reads as a code, `Title Case` still reads as a name.
//
// WHAT WAS WRONG. The classes were `[A-Z]`, `[a-z]` and `[0-9]`, and everything else passed
// through unchanged as "punctuation". So every letter outside ASCII was punctuation:
// `Москва`, `東京都`, `Ελλάδα` and `서울` shipped VERBATIM, and `Zürich` shipped as `Xüxxxx` - the
// one letter that most identifies it kept. A privacy setting that masks only English is a
// privacy setting that does not work for one reader in five.
//
// THE RULE NOW. A letter, combining mark or decimal digit is replaced by a random character of the
// SAME general category (upper, lower, other letter, modifier, mark, digit) from the SAME script,
// so the shape signal survives - Cyrillic stays Cyrillic and title-cased, a Devanagari vowel sign
// stays a vowel sign on a consonant, an Arabic-Indic digit stays an Arabic-Indic digit. Nothing
// of the value's own letters survives: the replacement is drawn from the script's pool MINUS every
// character the value itself contains (falling back to "minus this character" only when a pool is
// too small for that, and to the character itself only for a singleton pool - a lone modifier
// such as the Katakana length mark, which identifies nothing). Whitespace, punctuation and symbols
// pass through as before: they are the format, not the value.

/** Unicode general categories the mask replaces. */
type MaskClass = "Lu" | "Ll" | "Lt" | "Lm" | "Lo" | "Mn" | "Mc" | "Nd";

const CLASS_TESTS: ReadonlyArray<[MaskClass, RegExp]> = [
    ["Lu", /^\p{Lu}$/u], ["Ll", /^\p{Ll}$/u], ["Lt", /^\p{Lt}$/u], ["Lm", /^\p{Lm}$/u],
    ["Lo", /^\p{Lo}$/u], ["Mn", /^\p{Mn}$/u], ["Mc", /^\p{Mc}$/u], ["Nd", /^\p{Nd}$/u],
];

function classOf(ch: string): MaskClass | null {
    for (const [c, re] of CLASS_TESTS) if (re.test(ch)) return c;
    return null;
}

/** The scripts the product authors for, each with the code-point ranges its pool is drawn from -
 *  the script's everyday modern letters, so a masked Russian value still looks like Russian rather
 *  than like Old Church Slavonic. Order matters only in that ASCII is tested first. A character of
 *  any other script (or outside these ranges) falls back to its own 128-code-point block. */
const SCRIPT_POOLS: ReadonlyArray<{ id: string; test: RegExp; ranges: ReadonlyArray<[number, number]> }> = [
    { id: "ascii", test: /^[A-Za-z]$/, ranges: [[0x41, 0x5A], [0x61, 0x7A]] },
    { id: "latin", test: /^[\u00C0-\u017F]$/u, ranges: [[0xC0, 0x17F]] },
    { id: "cyrillic", test: /^[\u0400-\u045F\u0490-\u0491]$/u, ranges: [[0x400, 0x45F], [0x490, 0x491]] },
    { id: "greek", test: /^[\u0386-\u03CE]$/u, ranges: [[0x386, 0x3CE]] },
    { id: "han", test: /^[\u4E00-\u9FFF]$/u, ranges: [[0x4E00, 0x9FFF]] },
    { id: "hiragana", test: /^\p{Script=Hiragana}$/u, ranges: [[0x3041, 0x309F]] },
    { id: "katakana", test: /^\p{Script=Katakana}$/u, ranges: [[0x30A0, 0x30FF]] },
    { id: "hangul", test: /^[\uAC00-\uD7A3]$/u, ranges: [[0xAC00, 0xD7A3]] },
    { id: "arabic", test: /^[\u0620-\u0652\u0671-\u06D3]$/u, ranges: [[0x620, 0x652], [0x671, 0x6D3]] },
    { id: "hebrew", test: /^[\u05B0-\u05EA]$/u, ranges: [[0x5B0, 0x5EA]] },
    { id: "devanagari", test: /^\p{Script=Devanagari}$/u, ranges: [[0x900, 0x97F]] },
    { id: "thai", test: /^\p{Script=Thai}$/u, ranges: [[0xE01, 0xE4E]] },
];

const poolCache = new Map<string, string[]>();

function buildPool(key: string, ranges: ReadonlyArray<[number, number]>, cls: MaskClass, script: RegExp | null): string[] {
    const hit = poolCache.get(key);
    if (hit) return hit;
    const out: string[] = [];
    for (const [lo, hi] of ranges) {
        for (let cp = lo; cp <= hi; cp++) {
            const ch = String.fromCodePoint(cp);
            if (classOf(ch) !== cls) continue;
            if (script && !script.test(ch)) continue;
            out.push(ch);
        }
    }
    poolCache.set(key, out);
    return out;
}

/** A decimal digit's own run of ten - `٣` draws from `٠-٩`, never from `0-9` or `۰-۹`. */
function digitPool(ch: string): string[] {
    const cp = ch.codePointAt(0)!;
    let zero = cp;
    for (let k = 0; k < 9 && classOf(String.fromCodePoint(zero - 1)) === "Nd"; k++) zero--;
    const key = "nd:" + zero.toString(16);
    const hit = poolCache.get(key);
    if (hit) return hit;
    const out: string[] = [];
    for (let d = zero; d < zero + 10; d++) {
        const c = String.fromCodePoint(d);
        if (classOf(c) === "Nd") out.push(c);
    }
    poolCache.set(key, out);
    return out;
}

function poolFor(ch: string, cls: MaskClass): string[] {
    if (cls === "Nd") return digitPool(ch);
    for (const s of SCRIPT_POOLS) {
        if (s.test.test(ch)) return buildPool(s.id + ":" + cls, s.ranges, cls, s.id === "ascii" ? null : s.test);
    }
    const cp = ch.codePointAt(0)!;
    const lo = cp & ~0x7F;
    return buildPool("block:" + lo.toString(16) + ":" + cls, [[lo, lo + 0x7F]], cls, null);
}

function pick(pool: string[], avoid: ReadonlySet<string>, self: string, rand: () => number): string {
    let choices = pool.filter(c => !avoid.has(c));
    if (choices.length === 0) choices = pool.filter(c => c !== self);
    if (choices.length === 0) return self;
    return choices[Math.min(choices.length - 1, Math.floor(rand() * choices.length))];
}

/** Letters, marks and digits are what the mask replaces; everything else is format. */
const MASKABLE = /^[\p{L}\p{M}\p{Nd}]$/u;
/** Where a jitter character may be inserted or removed: letters and digits, never a mark (a mark
 *  belongs to the letter before it) and never punctuation or whitespace (the format). */
const JITTERABLE = /^[\p{L}\p{Nd}]$/u;

/**
 * Mask one text value - see the header. `rand` is uniform [0,1); the host passes its own
 * GET_RANDOM, a test passes a seeded one. Same-class, same-script, and no character of the value
 * survives; length jitters by about a fifth, as it always has, so a length is not a fingerprint.
 */
export function maskSampleText(input: string, rand: () => number): string {
    if (!input) return input ?? "";
    const own = new Set(Array.from(input));

    const substitute = (ch: string): string => {
        const cls = classOf(ch);
        if (!cls || !MASKABLE.test(ch)) return ch;
        return pick(poolFor(ch, cls), own, ch, rand);
    };

    const maskPart = (str: string): string => {
        const out: string[] = [];
        for (const ch of str) {
            out.push(substitute(ch));
            // Length jitter up (~20%): after a letter or digit only, and of the same class and
            // script, so a letters-only value never gains a digit and punctuation is never doubled
            // ('flight-1234' must not become 'flight--1234').
            if (JITTERABLE.test(ch) && rand() < 0.2) out.push(substitute(ch));
        }
        // Length jitter down: remove up to 2 letters or digits once past six characters. Never
        // whitespace (word count), never a separator, never a mark.
        if (out.length > 6) {
            const numToRemove = Math.floor(rand() * Math.min(3, out.length - 6));
            for (let i = 0; i < numToRemove; i++) {
                for (let attempts = 0; attempts < 5; attempts++) {
                    const at = Math.floor(rand() * out.length);
                    if (JITTERABLE.test(out[at])) { out.splice(at, 1); break; }
                }
            }
        }
        return out.join("");
    };

    // An e-mail keeps its shape: masked local part, masked domain, and a `.com` suffix kept as the
    // one piece of format worth keeping.
    const isEmail = input.includes("@") && input.includes(".");
    if (!isEmail) return maskPart(input);
    const [local, domain = ""] = input.split("@");
    const preserveSuffix = domain.endsWith(".com");
    const domainName = preserveSuffix ? domain.slice(0, -4) : domain;
    return `${maskPart(local)}@${maskPart(domainName)}${preserveSuffix ? ".com" : ""}`;
}
