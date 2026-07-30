// Build the publishable artifact for @bicharts/shape-core.
//
// Same shape as the chart-host build, and for the same reason: consumers cannot use raw
// TypeScript (aliases satisfy a bundler but `tsc -b` will not route relative specifiers
// through tsconfig paths), so the package has to ship real .js + .d.ts.
//
// ATTRIBUTION: this package embeds the GeoNames city/admin table, which is CC BY 4.0 —
// attribution is a licence CONDITION and esbuild strips ordinary `//` comments. The banner
// below is what carries the credit into the artifact; do not remove it.
import { build } from "esbuild";
import { readFileSync, readdirSync, statSync, rmSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));

// THE PUBLISHED ARTIFACT IS A BUILD, NOT THE SOURCE.
//
// This package is Apache-2.0 and its repository is public, so this is not secrecy — the
// source is on GitHub for anyone who wants to read, fork or verify it. It is about what the
// npm tarball IS. Until now `npm install @bicharts/shape-core` delivered unminified ESM
// alongside 16 sourcemaps with `sourcesContent`, which embeds every original .ts file
// verbatim, comments included. That is not "shipping a package that happens to be
// inspectable"; it is shipping the source tree with extra steps, and it happened by default
// rather than by decision.
//
// So: `npm run build` stays readable with sourcemaps, because that is what you want when
// debugging locally. `prepack` — which npm runs for every publish, whether or not anyone
// remembers — minifies and emits no maps. The .d.ts files are unaffected: consumers need the
// types, and an API surface is meant to be public.
const MINIFY = process.argv.includes("--minify");

function sourceHash() {
    const files = [];
    const walk = (d) => {
        for (const e of readdirSync(d).sort()) {
            const p = join(d, e);
            if (statSync(p).isDirectory()) walk(p);
            else if (p.endsWith(".ts")) files.push(p);
        }
    };
    walk(join(here, "src"));
    const h = createHash("sha256");
    for (const f of files) h.update(readFileSync(f));
    return { hash: h.digest("hex").slice(0, 12), count: files.length };
}

const dist = join(here, "dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const { hash, count } = sourceHash();

// MULTI-ENTRY. The barrel alone would force a consumer that wants one classifier to import
// the whole profiler, and — more practically — the Power BI visual re-exports whole modules
// (`export * from ".../indexedText"`), which a curated barrel cannot reproduce. Each module
// that is genuinely part of the surface gets its own entry, with splitting so the shared
// internals (and the 103 KB geo tables) are emitted once rather than per entry.
await build({
    entryPoints: {
        index: join(here, "src/index.ts"),
        ingest: join(here, "src/ingest.ts"),
        indexedText: join(here, "src/indexedText.ts"),
        models: join(here, "src/models.ts"),
        geoDetector: join(here, "src/geoDetector.ts"),
        geoPoint: join(here, "src/geoPoint.ts"),
        ordinalDetector: join(here, "src/ordinalDetector.ts"),
        formatDetector: join(here, "src/formatDetector.ts"),
        monthNames: join(here, "src/monthNames.ts"),
        util: join(here, "src/util.ts"),
    },
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    outdir: dist,
    outExtension: { ".js": ".mjs" },
    // A real dependency, not something to inline — consumers resolve their own copy.
    external: ["papaparse"],
    minify: MINIFY,
    // Attribution survives minification: GeoNames CC BY 4.0 is a licence CONDITION, and
    // esbuild strips ordinary comments. `legalComments: "inline"` keeps /*! */ blocks, and
    // the banner below is emitted regardless.
    legalComments: "inline",
    banner: {
        js: "/*! @bicharts/shape-core — Apache-2.0. Bundled reference data: GeoNames "
          + "(https://www.geonames.org/) CC BY 4.0; US Census/TIGER (public domain). "
          + "Full text: NOTICE in this package. */",
    },
    // Never in the published artifact — a map with sourcesContent carries the whole original
    // .ts file and would undo the line above completely.
    sourcemap: !MINIFY,
});

execFileSync("npx", ["tsc", "-p", join(here, "tsconfig.build.json")], {
    stdio: "inherit", cwd: here, shell: process.platform === "win32",
});

console.log(`built dist — src:${hash} (${count} files)${MINIFY ? " [minified, no sourcemaps]" : ""}`);
