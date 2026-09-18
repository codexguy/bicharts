// Measure what a consumer of @bicharts/chart-host EAGERLY downloads.
//
// Naively checking the size of dist/index.mjs proves nothing: the build uses code
// splitting, so index.mjs is a 1.8 KB re-export shim in front of ~1.6 MB of chunks.
// The number that matters is the transitive closure of STATIC imports — dynamic
// import() is what geoLazy.ts uses to keep the ~1.3 MB of map geometry off the wire
// for the vast majority of charts, which are not maps.
//
// So: walk `import`/`export ... from` (static) and stop at `import(...)` (lazy).
//
// Usage: node scripts/checkEagerSize.mjs [entry] [limitKB]

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";

// The default is a TRIPWIRE for geometry reaching the eager path, not a size target. Most of
// the closure is the place-name gazetteer, which is eager by design and grows as the tables
// improve; the smallest map asset is ~228 KB, so any ceiling below (closure + 228) still
// catches one being statically imported. Keep the headroom generous — a budget that goes red
// on ordinary growth stops being read, and a gate nobody reads catches nothing.
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// 2026-09-17, item 637: THAT LAST SENTENCE CAME TRUE AND NOBODY WAS READING.
//
// This check went red at 0.5.103 and stayed red for ELEVEN consecutive runs, through 0.5.113,
// every one of them published anyway — because `Release` and `CI` are separate workflows on
// the same push and the publishing one never consulted the other.
//
// The cause was measured before the limit was touched, which is the order that matters:
//   * the closure carries NO map geometry. The three geometry chunks (885 KB / 279 KB /
//     223 KB) sit outside it, behind loadGeo(); the eager closure is four files, dominated by
//     the gazetteer (geoPointCities.generated.ts alone is 324 KB of source). The invariant
//     this guard exists for HOLDS, and held on every one of those eleven runs.
//   * what crossed 600 KB was 0.5.103 adding pendingGenerate.ts — 305 lines — to a closure
//     already within a few KB of the line. Ordinary growth, exactly as the note above predicts.
//
// So the limit moves, deliberately, and TWO things change so that a moved limit is not the
// whole answer:
//   (a) the invariant is now asserted BY NAME below, not inferred from a total. A geometry
//       module reaching the eager path fails instantly and says which one, at any size, and
//       that check cannot be defeated by gazetteer growth.
//   (b) the budget keeps its meaning: at ~625 KB of closure, the smallest map asset would take
//       it to ~848 KB, so a 700 KB ceiling still catches one with room to spare while leaving
//       ~75 KB of headroom for ordinary growth. Both numbers are asserted in
//       tests/eagerLoadBudget.test.ts so this reasoning cannot rot silently.
// ─────────────────────────────────────────────────────────────────────────────────────────
const entry = resolve(process.argv[2] ?? "packages/chart-host/dist/index.mjs");
const limitKB = Number(process.argv[3] ?? 700);

// The map GEOMETRY modules — the thing this guard is actually about.
//
// MATCHED ON CONTENT, NOT ON FILENAME, and the first draft of this check got that wrong. esbuild
// emits geometry into content-hashed chunks (chunk-ABGDJ3NJ.mjs) whose names carry no stem at
// all, so a filename test silently matched nothing and passed an entry whose closure is 223 KB of
// world geometry. What IS stable is the module-path comment esbuild writes at the top of each
// chunk — `// src/geoWorld110m.generated.ts` — which survives hashing and minification-off builds
// and names the real source. Proved both ways before shipping: the three geometry chunks each
// match, and the eager chunk matches zero times.
//
// The GAZETTEER (place names, country names, ZIP-3 prefixes) is deliberately NOT listed: it is
// eager by design, and listing it would make this check fail on the thing it must tolerate.
const GEOMETRY_STEMS = ["geoWorld110m", "geoUsStates", "geoUsZip3", "geoUsCounties", "geoNorthAmerica"];
const GEOMETRY_RX = new RegExp(String.raw`//\s*src/(${GEOMETRY_STEMS.join("|")})[\w.-]*`, "g");

if (!existsSync(entry)) {
    console.error(`no build at ${entry} — run \`npm run build\` first`);
    process.exit(1);
}

// Static forms only. `import("x")` has a paren after the keyword and is deliberately
// excluded by requiring a quote or a from-clause instead.
const STATIC = /(?:^|[;\n}])\s*(?:import|export)\s+(?:[^"';()]*?\sfrom\s*)?["']([^"']+)["']/g;

const seen = new Set();
const stack = [entry];
let total = 0;
const files = [];

while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);

    const src = readFileSync(file, "utf8");
    const bytes = Buffer.byteLength(src);
    total += bytes;
    // Record which geometry modules this file carries, read from esbuild's own module-path
    // comments, so the by-name verdict below is about CONTENT rather than a hashed filename.
    const carried = [...new Set([...src.matchAll(GEOMETRY_RX)].map((m) => m[1]))];
    files.push([bytes, file, carried]);

    for (const m of src.matchAll(STATIC)) {
        const spec = m[1];
        if (!spec.startsWith(".")) continue; // bare specifier = peer/external, not our weight
        const next = resolve(dirname(file), spec);
        if (existsSync(next)) stack.push(next);
    }
}

files.sort((a, b) => b[0] - a[0]);
console.log(`eager closure from ${entry}:`);
for (const [b, f] of files.slice(0, 8)) console.log(`  ${String(Math.round(b / 1024)).padStart(6)} KB  ${f.split(/[\\/]/).pop()}`);
console.log(`  ${"-".repeat(30)}`);
console.log(`  ${String(Math.round(total / 1024)).padStart(6)} KB  TOTAL across ${files.length} file(s)`);

// Sanity floor: a walker that resolves nothing would report the 1.8 KB shim and pass
// every threshold forever. If the closure is implausibly small, the walker is broken —
// which is a louder failure than the one it exists to catch.
if (total < 20_000) {
    console.error(`\nFAIL: closure of ${total} bytes is too small to be real — the import walker is not resolving.`);
    process.exit(1);
}

// THE INVARIANT, ASSERTED BY NAME (item 637). The byte budget below is a coarse proxy that
// only notices geometry once it is big enough to move a total; this notices it at ANY size,
// says which module, and keeps saying so however far the gazetteer grows. It is the check the
// header has always described, finally written down as itself.
const geometryInClosure = files
    .filter(([, , carried]) => carried.length)
    .map(([, f, carried]) => `${carried.join(" + ")} (in ${f.split(/[\\/]/).pop()})`);
if (geometryInClosure.length) {
    console.error(`\nFAIL: map GEOMETRY is in the eager closure: ${geometryInClosure.join(", ")}`);
    console.error("Every consumer now downloads it whether or not they draw a map.");
    console.error("Load it through loadGeo() in geoLazy.ts — a dynamic import() — not a top-level import.");
    process.exit(1);
}

if (total > limitKB * 1024) {
    console.error(`\nFAIL: ${Math.round(total / 1024)} KB eagerly loaded, limit ${limitKB} KB.`);
    console.error("Something that should be behind a dynamic import() is now statically imported.");
    console.error("No map GEOMETRY is in the closure (the check above would have named it), so this is");
    console.error("either a large new eager module or ordinary growth. Find what grew before moving the");
    console.error("limit — and if it IS ordinary growth, move it deliberately and say so, keeping the");
    console.error("ceiling under (closure + 223 KB) so a map asset still trips it. See item 637.");
    process.exit(1);
}

console.log(`\nOK: under the ${limitKB} KB eager-load budget.`);
