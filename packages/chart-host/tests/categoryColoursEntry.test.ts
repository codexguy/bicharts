import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, relative, dirname } from "node:path";
import * as main from "../src/index";
import * as census from "../src/categoryColours";

// THE CATEGORY-COLOUR CENSUS HAS ITS OWN ENTRY, AND THE MAIN ONE STAYS AS LIGHT AS IT WAS.
//
// createChartHost loads the census lazily for onCategoryColourCensus. A host that draws outside createChartHost (it
// clears and draws its own container) calls the census itself, so it is published as
// "@bicharts/chart-host/category-colours". The main entry's eager closure is budgeted (scripts/checkEagerSize.mjs):
// these checks keep the census out of it. The main entry exports only its types and the floor constant; no module
// outside it imports it statically (the host's lazy import() is allowed, as the budget walker stops there); and, once
// built, the census module is in the new entry's static closure and in none of the main entry's chunks.

const pkgRoot = resolve(__dirname, "..");
const srcRoot = resolve(pkgRoot, "src");
const dist = resolve(pkgRoot, "dist");

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) sourceFiles(p, out);
        else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
}

/** A source file without its comment lines: prose ("a value export would ...") is not an import. */
function codeOf(file: string): string {
    return readFileSync(file, "utf8").split("\n").filter(l => {
        const t = l.trim();
        return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
    }).join("\n");
}

// The same walk the budget script makes: static `import`/`export ... from` only, stopping at a lazy import().
const STATIC = /(?:^|[;\n}])\s*(?:import|export)\s+(?:[^"';()]*?\sfrom\s*)?["']([^"']+)["']/g;
function staticClosure(entry: string): string[] {
    const seen = new Set<string>();
    const walk = (file: string) => {
        if (seen.has(file) || !existsSync(file)) return;
        seen.add(file);
        const text = readFileSync(file, "utf8");
        for (const m of text.matchAll(STATIC)) if (m[1].startsWith(".")) walk(resolve(dirname(file), m[1]));
    };
    walk(entry);
    return [...seen];
}
const holdsCensus = (file: string) => /\/\/\s*src\/categoryColours\.ts/.test(readFileSync(file, "utf8"));

describe("the category-colours entry", () => {
    it("the main entry exports no runtime symbol of the census (only its types, and the floor from the contract)", () => {
        const leaked = Object.keys(census).filter(name => name in main);
        expect(leaked).toEqual([]);
        expect(typeof census.censusCategoryColours).toBe("function");
    });

    it("no module outside the census imports it statically; the host's lazy import() is the one way in", () => {
        const offenders = sourceFiles(srcRoot)
            .filter(f => relative(srcRoot, f) !== "categoryColours.ts")
            .filter(f => {
                const text = codeOf(f);
                const runtime = [...text.matchAll(/import\s+(type\s+)?[^;]*?from\s+["']([^"']*categoryColours[^"']*)["']/g)]
                    .filter(m => !m[1]);
                return runtime.length > 0 || /export\s+(?!type\b)[^;]*from\s+["'][^"']*categoryColours/.test(text);
            })
            .map(f => relative(srcRoot, f));
        expect(offenders).toEqual([]);
    });

    it("package.json exports ./category-colours and build.mjs builds it", () => {
        const pkg = JSON.parse(readFileSync(resolve(pkgRoot, "package.json"), "utf8"));
        expect(pkg.exports["./category-colours"]).toEqual({
            types: "./dist/types/categoryColours.d.ts",
            import: "./dist/category-colours.mjs",
            default: "./dist/category-colours.mjs",
        });
        const build = readFileSync(resolve(pkgRoot, "build.mjs"), "utf8");
        expect(build).toMatch(/"category-colours":\s*join\(here,\s*"src\/categoryColours\.ts"\)/);
    });

    const built = existsSync(resolve(dist, "index.mjs")) && existsSync(resolve(dist, "category-colours.mjs"));
    it.skipIf(!built)("built: the census is in the new entry's closure and in none of the main entry's eager chunks", () => {
        const sub = staticClosure(resolve(dist, "category-colours.mjs"));
        expect(sub.some(holdsCensus), "the entry carries the census (positive control)").toBe(true);
        const eager = staticClosure(resolve(dist, "index.mjs"));
        expect(eager.length).toBeGreaterThan(1);
        expect(eager.filter(holdsCensus).map(f => relative(dist, f))).toEqual([]);
    });
});
