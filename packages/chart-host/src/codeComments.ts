/**
 * Generated chart code with its JavaScript COMMENTS removed, and nothing else.
 *
 * WHY A HOST NEEDS THIS. A host decides from the code which optional libraries a chart needs before
 * running it (see `requiredD3Plugins`), and a word in a comment is not a call. The helpers a generator
 * prepends to every chart are documented in prose, and prose names things: one helper's comment listed the
 * chart types it serves, "Basic Sankey" among them, so every chart carrying it - bar charts, cards,
 * tables - read as needing the Sankey plugin, and a host fetched a library it would never call on every
 * render.
 *
 * NOT THE NAIVE STRIP, ON PURPOSE. A regex that deletes from `//` to the end of the line also deletes from
 * the `//` inside "https://..." to the end of that line - taking any real code after the string with it.
 * For a check that can only ever REMOVE evidence, over-stripping is the dangerous direction: a plugin name
 * lost that way is a chart failing several frames deep. So this walks the code once, tracking the three
 * places a comment marker is not a comment - a string, a template literal (including code inside its
 * `${...}`), and a regular-expression literal - and removes only what is genuinely a comment.
 *
 * THE ONE AMBIGUITY - is a `/` a division or the start of a regex? - is settled by the usual rule: what
 * came before it. A division misread as a regex only keeps text (the comments after it, up to the next `/`
 * on that line, stay in the output). The reverse - a regex literal that opens a statement right after `)`
 * or `}` - is read as a division, and would lose text only if that regex itself contained `//` or `/*`.
 * Generated chart code does not write that form; it is named here so nobody has to rediscover it.
 *
 * A removed comment is replaced by a single space, keeping any newlines a block comment spanned, so tokens
 * either side never fuse and line numbers are preserved.
 */
export function stripJsComments(code: string): string {
    const src = String(code ?? "");
    const n = src.length;
    let out = "";
    let i = 0;
    // A stack of open template literals: each entry is the `${` brace depth inside that template's current
    // substitution, or -1 while scanning the template's literal text.
    const templates: number[] = [];
    // The last significant (non-space, non-comment) character emitted - decides whether `/` starts a regex.
    let prevSig = "";
    let prevWord = "";
    // Whether the next identifier character extends `prevWord` (no space or punctuation in between).
    let wordOpen = false;

    const regexMayFollow = (): boolean => {
        if (prevSig === "") return true;
        if ("(,=:[!&|?{};+-*%<>~^".includes(prevSig)) return true;
        return /^(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/.test(prevWord);
    };

    while (i < n) {
        const ch = src[i];
        const next = i + 1 < n ? src[i + 1] : "";
        const top = templates.length > 0 ? templates[templates.length - 1] : null;

        // Inside a template literal's TEXT: copy until the closing backtick or a `${`.
        if (top === -1) {
            if (ch === "\\") { out += src.slice(i, i + 2); i += 2; continue; }
            if (ch === "`") { templates.pop(); out += ch; i++; prevSig = "`"; prevWord = ""; wordOpen = false; continue; }
            if (ch === "$" && next === "{") { templates[templates.length - 1] = 0; out += "${"; i += 2; prevSig = "{"; prevWord = ""; wordOpen = false; continue; }
            out += ch; i++; continue;
        }

        // Code (top level, or inside a `${...}` substitution).
        if (ch === "/" && next === "/") {
            let j = i + 2;
            while (j < n && src[j] !== "\n" && src[j] !== "\r") j++;
            out += " ";
            i = j;
            wordOpen = false;
            continue;
        }
        if (ch === "/" && next === "*") {
            const end = src.indexOf("*/", i + 2);
            const body = end < 0 ? src.slice(i + 2) : src.slice(i + 2, end);
            const newlines = body.match(/\r\n|\r|\n/g);
            out += newlines ? newlines.join("") : " ";
            i = end < 0 ? n : end + 2;
            wordOpen = false;
            continue;
        }
        if (ch === "'" || ch === "\"") {
            let j = i + 1;
            while (j < n && src[j] !== ch && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
            out += src.slice(i, Math.min(j + 1, n));
            i = j + 1;
            prevSig = ch; prevWord = ""; wordOpen = false;
            continue;
        }
        if (ch === "`") { templates.push(-1); out += ch; i++; wordOpen = false; continue; }
        if (ch === "/" && regexMayFollow()) {
            let j = i + 1, inClass = false;
            while (j < n && src[j] !== "\n") {
                const c = src[j];
                if (c === "\\") { j += 2; continue; }
                if (c === "[") inClass = true;
                else if (c === "]") inClass = false;
                else if (c === "/" && !inClass) break;
                j++;
            }
            if (j < n && src[j] === "/") {
                j++;
                while (j < n && /[A-Za-z]/.test(src[j])) j++;
                out += src.slice(i, j);
                i = j;
                prevSig = "/"; prevWord = ""; wordOpen = false;
                continue;
            }
            // No closing slash on this line: it was not a regex after all. Emit the `/` as an operator.
        }
        if (top !== null && top >= 0) {
            if (ch === "{") templates[templates.length - 1] = top + 1;
            else if (ch === "}") {
                if (top === 0) { templates[templates.length - 1] = -1; out += ch; i++; continue; }
                templates[templates.length - 1] = top - 1;
            }
        }
        out += ch;
        i++;
        if (/\s/.test(ch)) {
            wordOpen = false;
        } else {
            if (/[A-Za-z0-9_$]/.test(ch)) {
                prevWord = wordOpen ? prevWord + ch : ch;
                wordOpen = true;
            } else {
                prevWord = "";
                wordOpen = false;
            }
            prevSig = ch;
        }
    }
    return out;
}
