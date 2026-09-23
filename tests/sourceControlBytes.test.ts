import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";

// NO CONTROL BYTES IN PACKAGE SOURCE.
//
// A raw NUL sat inside a string literal in chart-host's selection card from 0.5.32 on (a null
// value's distinct-count sentinel). The runtime value was right, but git takes a NUL as the mark of
// a binary file: `git ls-files --eol` read `i/-text`, and a diff whose NUL fell inside git's sniff
// window printed "Binary files differ" instead of the change - in a public repo. The likely cause
// is a backslash escape decoded by an editing tool on the way in, which can happen to any file, so
// the guard covers every source and test file rather than the one that was caught.
//
// Every such value is written as its escape (the four characters backslash, x, 0, 0), which is the
// same string at runtime. Checked by byte value, so this file holds no escape of its own to decode.

const root = resolve(__dirname, "..");
const TAB = 9, LF = 10, CR = 13, SPACE = 32;

function walk(dir: string, out: string[]): string[] {
    for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.(ts|tsx|js|mjs|cjs|json)$/.test(name)) out.push(p);
    }
    return out;
}

function sourceFiles(): string[] {
    const files: string[] = [];
    const pkgs = join(root, "packages");
    for (const pkg of readdirSync(pkgs)) {
        for (const sub of ["src", "tests"]) {
            const d = join(pkgs, pkg, sub);
            try { if (statSync(d).isDirectory()) walk(d, files); } catch { /* a package without tests */ }
        }
    }
    walk(join(root, "tests"), files);
    return files;
}

describe("package source holds no control bytes", () => {
    it("has no byte below 32 other than tab, LF and CR in any source or test file", () => {
        const offenders: string[] = [];
        for (const f of sourceFiles()) {
            const buf = readFileSync(f);
            for (let i = 0; i < buf.length; i++) {
                const b = buf[i];
                if (b < SPACE && b !== TAB && b !== LF && b !== CR) {
                    offenders.push(`${relative(root, f)} at byte ${i} (0x${b.toString(16).padStart(2, "0")})`);
                    break;
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it("actually scans the files it guards", () => {
        const names = sourceFiles().map(f => relative(root, f).split("\\").join("/"));
        expect(names).toContain("packages/chart-host/src/selectionCard.ts");
        expect(names).toContain("packages/shape-core/src/indexedText.ts");
    });
});
