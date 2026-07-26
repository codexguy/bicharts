// Build the PUBLISHABLE artifact for @bicharts/chart-host.
//
// Why a bundle rather than shipping src/: `npm pack` on the pre-build package produced a
// tarball whose every import failed (proven 2026-07-26: 20 files, no shape-core), because
// payload.ts reached OUTSIDE the package root. That import is now the real package specifier
// "@bicharts/shape-core"; bundling still inlines it so a consumer of chart-host gets one
// self-contained artifact, while shape-core stays independently publishable for consumers
// that want the profiler alone.
//
// A consumer also cannot use raw TypeScript: aliasing worked for Vite but `tsc -b` still
// failed, because TypeScript does not route RELATIVE specifiers through tsconfig `paths`.
// There is no tsconfig-only fix — the package has to ship real .js + .d.ts.
//
// shape-core is a BUILD-TIME devDependency, not a runtime one, precisely because it is
// inlined here. Declaring it as a `dependency` made the tarball UNINSTALLABLE — npm tried to
// fetch @bicharts/shape-core from the registry and 404'd — and would still have made every
// consumer download and ship a second copy of code already inside this bundle. Caught by
// installing the tarball into a fresh app; nothing in-repo could see it.
//
// Two entry points, because React is an OPTIONAL peer: a vanilla host must be able to
// import the runtime without React resolving at all.
import { build } from "esbuild";
import { readFileSync, readdirSync, statSync, rmSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));

/** Every source file that can end up inlined, hashed in a stable order (mcp/build.mjs rule). */
function sourceHash() {
    const roots = ["src", "../shape-core/src"].map(r => join(here, r));
    const files = [];
    const walk = (d) => {
        for (const e of readdirSync(d).sort()) {
            const p = join(d, e);
            if (statSync(p).isDirectory()) walk(p);
            else if (p.endsWith(".ts") || p.endsWith(".tsx")) files.push(p);
        }
    };
    for (const r of roots) walk(r);
    const h = createHash("sha256");
    for (const f of files) h.update(readFileSync(f));
    return { hash: h.digest("hex").slice(0, 12), count: files.length };
}

const dist = join(here, "dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const { hash, count } = sourceHash();

// splitting:true so the GEOMETRY (world-110m + us-states + us-zip3, ~1.3 MB raw) lands in
// its own chunk instead of the entry — a host that never touches a map should not pay for
// one. Anything still shared between entries also de-duplicates here.
const result = await build({
    entryPoints: {
        index: join(here, "src/index.ts"),
        react: join(here, "src/react.tsx"),
        geo: join(here, "src/geo.ts"),
    },
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    // AUTOMATIC JSX. esbuild defaults to the classic transform, which emits
    // React.createElement — and react.tsx never imports React (tsconfig uses jsx: react-jsx),
    // so the packed bundle threw "React is not defined" at first render. Caught only by
    // installing the tarball into a stock Vite app; nothing in-repo could have seen it,
    // because the demo compiles chart-host from source under the app's own JSX settings.
    jsx: "automatic",
    outdir: dist,
    outExtension: { ".js": ".mjs" },
    // Peers: never bundle a consumer's React, and d3 is injected/global, never imported.
    external: ["react", "react-dom", "react/jsx-runtime", "d3"],
    // ATTRIBUTION MUST SURVIVE THE BUILD. The GeoNames city/admin table is CC BY 4.0 —
    // attribution is a LICENSE CONDITION, not a courtesy — and it is compiled into these
    // bundles. esbuild strips ordinary `//` comments, so the source header that carried the
    // credit was being deleted on the way to the artifact we publish. `legalComments` keeps
    // /*! … */ blocks, and the banner guarantees the credit is in every entry regardless of
    // which chunk the data lands in.
    legalComments: "inline",
    banner: {
        js: "/*! @bicharts/chart-host — Apache-2.0. Bundled reference data: GeoNames "
          + "(https://www.geonames.org/) CC BY 4.0; Natural Earth and US Census/TIGER "
          + "(public domain). Full text: NOTICE in this package. */",
    },
    metafile: true,
    sourcemap: true,
});

// Declarations. tsc pulls shape-core in as a dependency of payload.ts and emits it under a
// common rootDir, so dist/types is self-contained too — no path escapes the package.
execFileSync("npx", ["tsc", "-p", join(here, "tsconfig.build.json")], {
    stdio: "inherit", cwd: here, shell: process.platform === "win32",
});

const sizes = Object.entries(result.metafile.outputs)
    .filter(([f]) => f.endsWith(".mjs"))
    .map(([f, o]) => `${f.split(/[\\/]/).pop()} ${(o.bytes / 1024).toFixed(0)}KB`)
    .sort()
    .join(", ");
console.log(`built dist — src:${hash} (${count} files)\n  ${sizes}`);

