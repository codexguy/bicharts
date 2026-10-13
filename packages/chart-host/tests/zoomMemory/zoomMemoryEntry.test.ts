import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import * as main from "../../src/index";
import * as zoomMemory from "../../src/zoomMemory/index";
import * as pure from "../../src/zoomMemory/zoomMemory";
import * as dom from "../../src/zoomMemory/zoomMemoryDom";

// THE ZOOM MEMORY LIVES BEHIND ITS OWN ENTRY, NOT THE MAIN ONE.
//
// The main entry's eager closure is budgeted (scripts/checkEagerSize.mjs), and only a host that remembers a
// reader's zoom needs this code, so it is published as "@bicharts/chart-host/zoom-memory", the way
// "/legend-fit" and "/view-state" are. createChartHost takes the hook a host builds from it, and names its
// TYPE only. These checks keep that true: the main entry exports none of it, no runtime module outside the
// entry imports it (a type-only import is erased from the bundle, so it is allowed), the subpath stays built
// and exported, and its export list is a contract a host re-exports by name.

const pkgRoot = resolve(__dirname, "../..");
const srcRoot = resolve(pkgRoot, "src");

/** Every runtime export of the entry, which is what a host's re-export lists name. */
const EXPECTED_EXPORTS = [
    // pure
    "findZoomedNodes", "isIdentity", "isUsableTransform", "isZoomStateUsable", "parseZoomState", "readNodeTransform",
    "serializeZoomState", "soleZoomedNode", "transformsDiffer", "viewportBucket", "zoomStateKey",
    // DOM
    "attachZoomWatcher", "captureCurrentZoom", "captureZoomBehaviors", "createZoomMemoryHook", "flushPendingZoom",
    "forgetZoom", "restoreZoomForRender",
];

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) sourceFiles(p, out);
        else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
}

describe("the zoom-memory entry", () => {
    it("the main entry does not export any of its symbols (the eager closure is budgeted)", () => {
        const leaked = Object.keys(zoomMemory).filter(name => name in main);
        expect(leaked).toEqual([]);
    });

    it("no module outside the entry imports it at run time, so the main entry's closure cannot reach it", () => {
        const offenders = sourceFiles(srcRoot)
            .filter(f => !relative(srcRoot, f).split("\\").join("/").startsWith("zoomMemory/"))
            .filter(f => {
                const text = readFileSync(f, "utf8");
                const runtime = [...text.matchAll(/import\s+(type\s+)?[^;]*?from\s+["']([^"']*zoomMemory[^"']*)["']/g)]
                    .filter(m => !m[1]);
                return runtime.length > 0 || /import\(\s*["'][^"']*zoomMemory/.test(text)
                    || /export\s+(?!type\b)[^;]*from\s+["'][^"']*zoomMemory/.test(text);
            })
            .map(f => relative(srcRoot, f));
        expect(offenders).toEqual([]);
    });

    it("package.json exports ./zoom-memory and build.mjs builds it", () => {
        const pkg = JSON.parse(readFileSync(resolve(pkgRoot, "package.json"), "utf8"));
        expect(pkg.exports["./zoom-memory"]).toEqual({
            types: "./dist/types/zoomMemory/index.d.ts",
            import: "./dist/zoom-memory.mjs",
            default: "./dist/zoom-memory.mjs",
        });
        const build = readFileSync(resolve(pkgRoot, "build.mjs"), "utf8");
        expect(build).toMatch(/"zoom-memory":\s*join\(here,\s*"src\/zoomMemory\/index\.ts"\)/);
    });

    it("exports exactly the names a host re-exports (the list is a contract)", () => {
        expect(Object.keys(zoomMemory).sort()).toEqual([...EXPECTED_EXPORTS].sort());
    });

    it("every runtime export of the two modules is reachable from the entry", () => {
        for (const m of [pure, dom]) {
            for (const name of Object.keys(m)) expect(name in zoomMemory, name).toBe(true);
        }
    });

    it("reads d3 from its argument, never from the page's global", () => {
        for (const f of sourceFiles(resolve(srcRoot, "zoomMemory"))) {
            const code = readFileSync(f, "utf8").split(/\r?\n/).filter(l => !/^\s*(\/\/|\*)/.test(l)).join("\n");
            expect(code, relative(srcRoot, f)).not.toMatch(/\bwindow\s*\.\s*d3\b|globalThis\s*as\s*any\)\s*\.\s*d3\b/);
        }
    });
});
